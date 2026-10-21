"""Reject UI-only, buffered, silent and stale audio gate evidence."""
from contextlib import redirect_stdout
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from smoke_audio_stream import AudioStreamSmoke, EXPECTED_MEDIA
from smoke_simulator_launch import SmokeFailure


class AudioStreamEvidenceTests(unittest.TestCase):
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
            with patch.dict(os.environ,{variable:'previous'}),redirect_stdout(io.StringIO()):
                self.assertEqual(smoke.run(),0)
                self.assertEqual(os.environ[variable],'previous')
            for filename,expected in zip(['initial-playing','advancing','background-paused','foreground-resumed','closed-context-replaced','replacement-advancing'],states[1:]):
                self.assertEqual(json.loads((smoke.output/(filename+'.json')).read_text()),expected)
            self.assertTrue(smoke.report['audioStream']['realWKCustomScheme'])
            self.assertFalse(smoke.report['audioStream']['physicalDeviceTest'])
            self.assertEqual(smoke.report['audioStream']['contextCountAfterReplacement'],2)
            self.assertIn('No physical speaker',smoke.report['audioStream']['evidence'])
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


if __name__=='__main__':unittest.main()
