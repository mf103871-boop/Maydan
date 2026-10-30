"""Reject UI-only, buffered, silent and stale audio gate evidence."""
from contextlib import redirect_stdout
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from smoke_audio_stream import AudioStreamSmoke, EXPECTED_MEDIA, PREVIEW_ORIGIN, audio_expectation, expected_audio_for_build
from smoke_simulator_launch import SmokeFailure


class AudioStreamEvidenceTests(unittest.TestCase):
    private_audio = {'url': 'maydan://app/audio/candidates/audition-menus-123456789abc.m4a', 'seconds': 580.754286}
    @staticmethod
    def state(command='activate', context_count=1, position=1.0, clock=1.0, paused=False):
        # Synthetic unit fixture only. The release gate itself requires fresh
        # snapshots written by an actual simulator app/WKWebView process.
        return {'fixture':'streaming-recovery','webAudioSupported':True,'documentURL':'maydan://app/index.html',
                'generatedAt':1,'lastCommand':{'id':command,'command':command},'contextCount':context_count,
                'contextState':'suspended' if paused else 'running','contextTime':clock,'rms':0 if paused else .02,
                'decodedCount':16,'decodedMaxSeconds':2.8,'errors':[],
                'media':[{'url':EXPECTED_MEDIA,'duration':480.0,'time':position,'paused':paused,'readyState':4,
                          'error':None,'contextIndex':context_count-1,'contextState':'suspended' if paused else 'running'}]}

    def test_only_real_current_custom_scheme_media_with_output_can_pass(self):
        self.assertEqual(AudioStreamSmoke.validate(self.state())['duration'],480)
        for changed in [{'fixture':'other'}, {'webAudioSupported':False}, {'documentURL':'https://example.test'},
                        {'contextCount':0}, {'decodedCount':0}, {'decodedMaxSeconds':480}, {'decodedMaxSeconds':float('nan')},
                        {'rms':0}, {'rms':float('inf')}, {'contextTime':-1}, {'errors':['failed']}, {'media':[]}]:
            with self.subTest(changed=changed):
                value=self.state();value.update(changed)
                with self.assertRaises(SmokeFailure):AudioStreamSmoke.validate(value)
        for changed in [{'url':'https://example.test/song.m4a'}, {'duration':45}, {'paused':True}, {'error':4},
                        {'contextIndex':1}, {'time':0}, {'readyState':0}]:
            with self.subTest(media=changed):
                value=self.state();value['media'][0].update(changed)
                with self.assertRaises(SmokeFailure):AudioStreamSmoke.validate(value)

    def test_paused_state_requires_current_media_and_unchanged_bounded_decodes(self):
        AudioStreamSmoke.validate(self.state('background',paused=True),playing=False)
        value=self.state('background',paused=True);value['decodedMaxSeconds']=480
        with self.assertRaises(SmokeFailure):AudioStreamSmoke.validate(value,playing=False)

    def test_media_and_context_must_both_advance_within_one_graph(self):
        before=self.state()
        AudioStreamSmoke.validate_progress(before,self.state(position=1.5,clock=1.5))
        for after in [self.state(position=1,clock=1.5),self.state(position=1.5,clock=1),self.state(context_count=2,position=1.5,clock=1.5)]:
            with self.subTest(after=after):
                with self.assertRaisesRegex(SmokeFailure,'advance together'):
                    AudioStreamSmoke.validate_progress(before,after)

    def private_state(self, **kwargs):
        state = self.state(**kwargs)
        state['media'][0].update(url=self.private_audio['url'], duration=self.private_audio['seconds'])
        return state

    def test_private_expectation_is_explicit_and_keeps_every_measurement_gate(self):
        expected = self.private_audio
        AudioStreamSmoke.validate(self.private_state(), expected_audio=expected)
        AudioStreamSmoke.validate_progress(self.private_state(), self.private_state(position=1.5, clock=1.5), expected_audio=expected)
        with patch.dict(os.environ, {'MAYDAN_PRIVATE_AUDIO_PREVIEW':'1', 'IOS_RELEASE_ENVIRONMENT':'mafia-preview', 'MAYDAN_ROOMS_URL':PREVIEW_ORIGIN}):
            AudioStreamSmoke.validate(self.state())  # pure/default remains legacy in a private CI job
            with self.assertRaises(SmokeFailure): AudioStreamSmoke.validate(self.private_state())
        with self.assertRaises(SmokeFailure): AudioStreamSmoke.validate(self.state(), expected_audio=expected)
        for changed in [{'rms':0}, {'decodedMaxSeconds':60}, {'decodedCount':0}, {'webAudioSupported':False}, {'errors':['fixture']}]:
            value=self.private_state(); value.update(changed)
            with self.subTest(changed=changed), self.assertRaises(SmokeFailure): AudioStreamSmoke.validate(value, expected_audio=expected)
        for changed in [{'duration':480}, {'duration':581.1}, {'contextIndex':3}, {'paused':True}, {'time':0}, {'readyState':0}]:
            value=self.private_state(); value['media'][0].update(changed)
            with self.subTest(media=changed), self.assertRaises(SmokeFailure): AudioStreamSmoke.validate(value, expected_audio=expected)
        for changed in [{'url':'https://example.test/song.m4a','seconds':580}, {'url':expected['url'],'seconds':float('nan')}, {'url':expected['url'],'seconds':True}]:
            with self.subTest(expected=changed), self.assertRaises(SmokeFailure): audio_expectation(changed)
        for after in [self.private_state(position=1,clock=1.5), self.private_state(position=1.5,clock=1), self.private_state(context_count=2,position=1.5,clock=1.5)]:
            with self.subTest(after=after), self.assertRaisesRegex(SmokeFailure,'advance together'):
                AudioStreamSmoke.validate_progress(self.private_state(),after,expected_audio=expected)

    def test_helper_sequence_saves_all_measurements_and_restores_environment(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary)
            smoke=AudioStreamSmoke(folder/'Maydan.app',folder/'evidence')
            smoke.prepare=Mock();smoke.launch=Mock(side_effect=lambda *args:smoke.report['launches'].append({'pid':123}))
            data=folder/'data';(data/'Documents/audio-stream-fixture').mkdir(parents=True)
            smoke.prepare_command=Mock(return_value=subprocess.CompletedProcess([],0,str(data),''))
            smoke.finish=Mock();smoke.screenshot=Mock();smoke.process_is_app=Mock(return_value=True)
            states=[self.state(),self.state(),self.state(position=1.5,clock=1.5),self.state('background',position=1.5,clock=1.5,paused=True),
                    self.state('foreground',position=1.6,clock=1.6),self.state('replace-context',context_count=2,position=1.7,clock=.3),
                    self.state('replace-context',context_count=2,position=2.2,clock=.8)]
            smoke.read_until=Mock(side_effect=copy.deepcopy(states))
            variable='SIMCTL_CHILD_MAYDAN_SIMULATOR_AUDIO'
            with patch.dict(os.environ,{variable:'previous','MAYDAN_PRIVATE_AUDIO_PREVIEW':'0'}),redirect_stdout(io.StringIO()):
                self.assertEqual(smoke.run(),0)
                self.assertEqual(os.environ[variable],'previous')
            for filename,expected in zip(['initial-playing','advancing','background-paused','foreground-resumed','closed-context-replaced','replacement-advancing'],states[1:]):
                self.assertEqual(json.loads((smoke.output/(filename+'.json')).read_text()),expected)
            self.assertTrue(smoke.report['audioStream']['realWKCustomScheme'])
            self.assertFalse(smoke.report['audioStream']['physicalDeviceTest'])
            self.assertEqual(smoke.report['audioStream']['contextCountAfterReplacement'],2)
            self.assertIn('No physical speaker',smoke.report['audioStream']['evidence'])
            smoke.finish.assert_called_once()

    def test_private_helper_threads_the_verified_expectation_through_resume_and_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary); smoke=AudioStreamSmoke(folder/'Maydan.app',folder/'evidence')
            smoke.prepare=Mock(); smoke.launch=Mock(side_effect=lambda *args:smoke.report['launches'].append({'pid':123}))
            data=folder/'data'; (data/'Documents/audio-stream-fixture').mkdir(parents=True)
            smoke.prepare_command=Mock(return_value=subprocess.CompletedProcess([],0,str(data),''))
            smoke.finish=Mock(); smoke.screenshot=Mock(); smoke.process_is_app=Mock(return_value=True)
            states=[self.private_state(),self.private_state(),self.private_state(position=1.5,clock=1.5),
                    self.private_state(command='background',position=1.5,clock=1.5,paused=True),
                    self.private_state(command='foreground',position=1.6,clock=1.6),
                    self.private_state(command='replace-context',context_count=2,position=1.7,clock=.3),
                    self.private_state(command='replace-context',context_count=2,position=2.2,clock=.8)]
            smoke.read_until=Mock(side_effect=copy.deepcopy(states))
            with patch('smoke_audio_stream.expected_audio_for_build',return_value=self.private_audio) as resolve,redirect_stdout(io.StringIO()):
                self.assertEqual(smoke.run(),0)
            resolve.assert_called_once_with(smoke.app)
            self.assertTrue(all(call.kwargs.get('expected_audio')==self.private_audio for call in smoke.read_until.call_args_list))
            self.assertEqual(smoke.report['audioStream']['selectedBundledMedia'],self.private_audio['url'])
            self.assertEqual(smoke.report['audioStream']['expectedAudio'],self.private_audio)
            self.assertEqual(smoke.report['audioStream']['contextCountAfterReplacement'],2)
            self.assertEqual(json.loads((smoke.output/'expected-audio.json').read_text()),self.private_audio)
            smoke.finish.assert_called_once()

    def test_reader_retains_timeout_measurements_instead_of_claiming_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);smoke=AudioStreamSmoke(folder/'Maydan.app',folder/'evidence')
            smoke.latest_pid=123;smoke.process_is_app=Mock(return_value=True)
            state=folder/'state.json';state.write_text(json.dumps(self.state()))
            with patch('smoke_audio_stream.time.monotonic',side_effect=[0,0,2]),patch('smoke_audio_stream.time.sleep'):
                with self.assertRaisesRegex(SmokeFailure,'expected state'):
                    smoke.read_until(state,lambda value:False,timeout=1)
            self.assertEqual(json.loads((smoke.output/'last-timeout-state.json').read_text()),self.state())


class PrivateAudioExpectationTests(unittest.TestCase):
    env = {'MAYDAN_PRIVATE_AUDIO_PREVIEW':'1', 'IOS_RELEASE_ENVIRONMENT':'mafia-preview', 'MAYDAN_ROOMS_URL':PREVIEW_ORIGIN}

    def test_disabled_and_misnamed_private_requests_never_silently_change_the_legacy_gate(self):
        self.assertIsNone(expected_audio_for_build(Path('not-read.app'),env={}))
        self.assertIsNone(expected_audio_for_build(Path('not-read.app'),env={**self.env,'MAYDAN_PRIVATE_AUDIO_PREVIEW':'0'}))
        for patch_env in [{'IOS_RELEASE_ENVIRONMENT':'production'},{'MAYDAN_ROOMS_URL':'https://maydan-game.mf103871.workers.dev'}]:
            with self.subTest(env=patch_env), self.assertRaisesRegex(SmokeFailure,'named isolated'):
                expected_audio_for_build(Path('not-read.app'),env={**self.env,**patch_env})

    def test_expected_home_is_bound_to_the_sealed_catalog_native_origin_and_actual_app_bytes(self):
        # Synthetic tiny files test the verifier wiring, not AAC or simulator playback.
        source_root=Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)/'source'; app=Path(temporary)/'Maydan.app'; root.mkdir()
            (root/'package.json').write_text('{"type":"module"}',encoding='utf-8')
            for name in ['scripts/audio/private-preview.mjs','scripts/ios/release-environment.mjs','scripts/ios/native.mjs',
                         'src/shared/fx/audio-candidate-policy.js','src/shared/lib/environment.js','src/shared/account/config.js']:
                file=root/name; file.parent.mkdir(parents=True,exist_ok=True); file.write_bytes((source_root/name).read_bytes())
            payload=b'synthetic-media-integrity-fixture'; digest=hashlib.sha256(payload).hexdigest()
            entries=[]
            for index in range(24):
                entries.append({'id':f'audition-fixture-{index}','url':f'audio/candidates/audition-fixture-{index}-{digest[:12]}.m4a',
                                'sha256':digest,'bytes':len(payload),'frames':27876000,'seconds':580.75,'sampleRate':48000,'channels':2,
                                'sourceUrl':'https://pixabay.com/music/synthetic-test-1/','candidateForPrivateTest':True,
                                'licenseVerified':True,'listeningApproved':False})
            catalog=root/'src/shared/fx/audio-candidate-catalog.js'
            catalog_text='export const CANDIDATE_FILES='+json.dumps(entries)+';export const CANDIDATE_SCENES={home:CANDIDATE_FILES[0]};'
            catalog.write_text(catalog_text,encoding='utf-8')
            manifest={'schemaVersion':1,'bundleId':'pixabay-candidates-20261030-v1',
                      'catalogSHA256':hashlib.sha256(catalog.read_bytes()).hexdigest(),
                      'files':[{key:entry[key] for key in ('url','sha256','bytes')} for entry in entries]}
            manifest_file=root/'assets/audio-preview/manifest.json'; manifest_file.parent.mkdir(parents=True)
            manifest_file.write_text(json.dumps(manifest),encoding='utf-8')
            media=app/'www'/entries[0]['url']; media.parent.mkdir(parents=True); media.write_bytes(payload)
            config=app/'www/native-config.json'; config.write_text(json.dumps({'version':1,'apiOrigin':PREVIEW_ORIGIN,'authCallback':'maydan://auth'}),encoding='utf-8')
            result=expected_audio_for_build(app,root=root,env=self.env)
            self.assertEqual(result['url'],'maydan://app/'+entries[0]['url']); self.assertEqual(result['seconds'],580.75)
            self.assertEqual(result['sha256'],digest); self.assertEqual(result['catalogSHA256'],manifest['catalogSHA256'])
            media.write_bytes(b'changed')
            with self.assertRaisesRegex(SmokeFailure,'Bundled private home differs'):
                expected_audio_for_build(app,root=root,env=self.env)
            media.write_bytes(payload); catalog.write_text(catalog_text+'\n// changed after sealing',encoding='utf-8')
            with self.assertRaisesRegex(SmokeFailure,'catalog changed after sealing'):
                expected_audio_for_build(app,root=root,env=self.env)
            catalog.write_text(catalog_text,encoding='utf-8')
            config.write_text(json.dumps({'version':1,'apiOrigin':'https://maydan-game.mf103871.workers.dev','authCallback':'maydan://auth'}),encoding='utf-8')
            with self.assertRaisesRegex(SmokeFailure,'native config does not match'):
                expected_audio_for_build(app,root=root,env=self.env)


if __name__=='__main__':unittest.main()
