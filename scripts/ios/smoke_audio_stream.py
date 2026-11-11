#!/usr/bin/env python3
"""Measure bundled streaming music in actual simulator WKWebView/Web Audio.

The app injects measurement wrappers only in an opted-in simulator build. Audio
assets, decoding, media source, mixer, context close and clocks are real. Finite
DOM/lifecycle notifications are injected; physical touch, speaker output,
Bluetooth, real iOS background delivery and human listening are not certified.
"""
import argparse
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time

from smoke_app_update_gate import UpdateGateSmoke
from smoke_simulator_launch import SmokeFailure


EXPECTED_MEDIA = 'maydan://app/audio/selected/sunny-steps-e79c0b47.m4a'
PREVIEW_ORIGIN = 'https://maydan-mafia-preview.mf103871.workers.dev'


def audio_expectation(expected_audio=None):
    """Pure validators default to the unchanged legacy recording, not job env."""
    if expected_audio is None:
        return {'url': EXPECTED_MEDIA, 'seconds': 480.0}
    if (not isinstance(expected_audio, dict)
            or not isinstance(expected_audio.get('url'), str)
            or re.fullmatch(r'maydan://app/(?:audio/(?:selected|candidates)/[a-z0-9-]+|audio-warmth-preview/audio/[a-z][a-z0-9-]{0,79}-[a-f0-9]{12})\.m4a', expected_audio['url']) is None
            or type(expected_audio.get('seconds')) not in (int, float)
            or not math.isfinite(expected_audio['seconds']) or expected_audio['seconds'] <= 0):
        raise SmokeFailure('Invalid expected bundled audio identity or duration.')
    return {'url': expected_audio['url'], 'seconds': expected_audio['seconds']}


def expected_audio_for_build(app, root=None, env=None):
    """Select a preview expectation only after catalog and bundled-byte checks.

    Warmth takes priority over the older private-candidate build. Its pinned
    runtime catalog, all bundled files and materialization receipt are checked;
    the legacy private branch continues to verify its selected home recording.
    A named preview request can never silently fall back to legacy expectations.
    """
    env = os.environ if env is None else env
    warmth = env.get('MAYDAN_WARMTH_PREVIEW') == '1'
    if warmth and env.get('MAYDAN_PRIVATE_AUDIO_PREVIEW') != '1':
        raise SmokeFailure('Warmth audio smoke requires private audio and the named isolated preview build.')
    if env.get('MAYDAN_PRIVATE_AUDIO_PREVIEW') != '1':
        return None
    if env.get('IOS_RELEASE_ENVIRONMENT') != 'mafia-preview' or env.get('MAYDAN_ROOMS_URL') != PREVIEW_ORIGIN:
        raise SmokeFailure('Private audio smoke requires the named isolated preview build.')
    root = Path(root).resolve() if root is not None else Path(__file__).resolve().parents[2]
    script = r"""
import path from 'node:path';import {pathToFileURL} from 'node:url';
import {readFile,lstat,readdir,realpath} from 'node:fs/promises';import {createHash} from 'node:crypto';
const [root,app]=process.argv.slice(1);
const {privateAudioBuild}=await import(pathToFileURL(path.join(root,'scripts/audio/private-preview.mjs')));
if(!privateAudioBuild())throw Error('Private audio environment is not enabled.');
const {validateNativeReleaseConfig}=await import(pathToFileURL(path.join(root,'scripts/ios/release-environment.mjs')));
validateNativeReleaseConfig(JSON.parse(await readFile(path.join(app,'www/native-config.json'),'utf8')),process.env);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(process.env.MAYDAN_WARMTH_PREVIEW==='1'){
  const {readWarmthManifest,warmthAudioBuild,WARMTH_BUNDLE_ID}=await import(pathToFileURL(path.join(root,'scripts/audio/warmth-preview.mjs')));
  if(!warmthAudioBuild())throw Error('Warmth audio environment is not enabled.');
  const manifest=await readWarmthManifest(root),pack=manifest.runtimePack;
  const suite=pack.musicSuites?.[pack.musicDirections?.bossaAlternative?.home];
  const entry=pack.assets?.[suite?.introTrackId];
  if(entry?.kind!=='music'||!suite.trackIds.includes(entry.id))throw Error('Warmth home has no verified introductory recording.');
  const seconds=entry.file.frames/entry.file.sampleRate;
  if(!Number.isFinite(seconds)||seconds<=0||Math.abs(seconds-entry.file.durationSeconds)>.001)throw Error('Warmth home duration differs from its verified frames.');
  const www=await realpath(path.join(app,'www'));
  const checked=async relative=>{
    let file=www;
    for(const part of relative.split('/')){
      file=path.join(file,part);
      if((await lstat(file)).isSymbolicLink())throw Error('Bundled warmth resources must not traverse symbolic links.');
    }
    const info=await lstat(file),actual=await realpath(file),escaped=path.relative(www,actual);
    if(!info.isFile()||escaped.startsWith('..')||path.isAbsolute(escaped))throw Error('Bundled warmth resource is not a regular contained file.');
    return readFile(file);
  };
  const names=(await readdir(path.join(www,'audio-warmth-preview/audio'))).sort();
  if(JSON.stringify(names)!==JSON.stringify(manifest.files.map(file=>path.basename(file.url)).sort()))throw Error('Bundled warmth resource inventory differs from the verified catalog.');
  const verified=[];
  for(const file of manifest.files){
    const bytes=await checked('audio-warmth-preview/'+file.url);
    if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw Error('Bundled warmth asset differs from the verified catalog: '+file.url);
    verified.push({url:'maydan://app/audio-warmth-preview/'+file.url,sha256:file.sha256,bytes:bytes.length});
  }
  const receipt=JSON.parse(await checked('audio-warmth-preview/pack-receipt.json'));
  if(receipt.schemaVersion!==1||receipt.bundleId!==WARMTH_BUNDLE_ID||receipt.sourceManifestSHA256!==manifest.sourceManifestSHA256||receipt.runtimePackSHA256!==manifest.runtimePackSHA256||receipt.previewOnly!==true||receipt.deviceTested!==false||receipt.productionApproved!==false)throw Error('Bundled warmth materialization receipt mismatch.');
  console.log(JSON.stringify({url:'maydan://app/audio-warmth-preview/'+entry.file.url,seconds,sha256:entry.file.sha256,bytes:entry.file.bytes,sourceManifestSHA256:manifest.sourceManifestSHA256,runtimePackSHA256:manifest.runtimePackSHA256,verifiedFiles:verified}));
}else{
const {readManifest}=await import(pathToFileURL(path.join(root,'scripts/audio/private-preview.mjs')));
const manifest=await readManifest(root);
const catalogURL=pathToFileURL(path.join(root,'src/shared/fx/audio-candidate-catalog.js'));catalogURL.searchParams.set('sha256',manifest.catalogSHA256);
const {CANDIDATE_SCENES}=await import(catalogURL.href);
const {validPrivateAudioCandidate}=await import(pathToFileURL(path.join(root,'src/shared/fx/audio-candidate-policy.js')));
const entry=CANDIDATE_SCENES?.home;
if(!validPrivateAudioCandidate(entry)||!manifest.files.some(f=>f.url===entry.url&&f.sha256===entry.sha256&&f.bytes===entry.bytes))throw Error('Private home is not a verified catalog asset.');
const file=path.join(app,'www',entry.url),info=await lstat(file);
if(!info.isFile()||info.isSymbolicLink())throw Error('Bundled private home is not a regular file.');
const bytes=await readFile(file),sha256=createHash('sha256').update(bytes).digest('hex');
if(bytes.length!==entry.bytes||sha256!==entry.sha256)throw Error('Bundled private home differs from the verified catalog.');
console.log(JSON.stringify({url:'maydan://app/'+entry.url,seconds:entry.seconds,sha256,bytes:bytes.length,catalogSHA256:manifest.catalogSHA256}));
}
"""
    try:
        result = subprocess.run(['node', '--input-type=module', '--eval', script, str(root), str(Path(app).resolve())],
                                text=True, capture_output=True, timeout=30, env={**os.environ, **env})
        if result.returncode:
            raise SmokeFailure('Cannot verify private simulator audio expectation: ' + result.stderr.strip())
        expected = json.loads(result.stdout)
        audio_expectation(expected)
        return expected
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        raise SmokeFailure('Cannot verify private simulator audio expectation: ' + str(error)) from error


class AudioStreamSmoke(UpdateGateSmoke):
    @staticmethod
    def media(state, playing=False, expected_audio=None):
        expected = audio_expectation(expected_audio)
        values = state.get('media')
        if not isinstance(values, list):
            return None
        matches = [value for value in values if isinstance(value, dict)
                   and value.get('url') == expected['url']
                   and value.get('contextIndex') == state.get('contextCount', 0) - 1
                   and (not playing or value.get('paused') is False)]
        return matches[-1] if matches else None

    @classmethod
    def is_playing(cls, state, expected_audio=None):
        expected = audio_expectation(expected_audio)
        media = cls.media(state, playing=True, expected_audio=expected)
        return bool(media and state.get('contextState') == 'running'
                    and isinstance(media.get('duration'), (float, int))
                    and expected['seconds'] - 0.25 <= media['duration'] <= expected['seconds'] + 0.25
                    and media.get('time', 0) > 0.2 and media.get('readyState', 0) >= 2
                    and state.get('rms', 0) > 0.00001)

    @classmethod
    def validate(cls, state, playing=True, expected_audio=None):
        if not isinstance(state, dict):
            raise SmokeFailure('Audio evidence is not a measured object.')
        if (state.get('fixture') != 'streaming-recovery'
                or state.get('webAudioSupported') is not True
                or state.get('documentURL') not in ('maydan://app/index.html', 'maydan://app/index.html#/', 'maydan://app/')
                or state.get('errors') != []):
            raise SmokeFailure('Real WK audio instrumentation is missing or reported an error: ' + json.dumps(state))
        for name in ('contextTime', 'rms', 'decodedMaxSeconds'):
            value = state.get(name)
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                raise SmokeFailure('Invalid measured audio value: ' + name)
        if (type(state.get('contextCount')) is not int or state['contextCount'] < 1
                or type(state.get('decodedCount')) is not int or state['decodedCount'] < 1
                or state['decodedMaxSeconds'] >= 60):
            raise SmokeFailure('Long music was decoded as a full buffer or actual cue decodes were not observed.')
        expected = audio_expectation(expected_audio)
        if expected['url'].startswith('maydan://app/audio-warmth-preview/'):
            media_values = state.get('media')
            if isinstance(media_values, list) and any(
                    isinstance(value, dict) and value.get('contextIndex') == state['contextCount'] - 1
                    and value.get('paused') is False and value.get('url') != expected['url']
                    for value in media_values):
                raise SmokeFailure('Unexpected concurrent music or legacy fallback in the Warmth audio graph.')
        media = cls.media(state, playing=playing, expected_audio=expected)
        if not media or media.get('error') is not None:
            raise SmokeFailure('The selected bundled music has no real media element in the current context.')
        if playing and not cls.is_playing(state, expected_audio=expected):
            raise SmokeFailure(f"The real bundled {expected['seconds']:g}-second media stream is not advancing through the mixer.")
        return media

    @classmethod
    def validate_progress(cls, before, after, expected_audio=None):
        first = cls.validate(before, expected_audio=expected_audio)
        second = cls.validate(after, expected_audio=expected_audio)
        if (before['contextCount'] != after['contextCount']
                or after['contextTime'] <= before['contextTime'] + 0.3
                or second['time'] <= first['time'] + 0.3):
            raise SmokeFailure('The same real audio graph and media playhead did not advance together.')

    def read_until(self, state_path, predicate, timeout=30, expected_audio=None):
        expected = audio_expectation(expected_audio)
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            if not self.process_is_app(self.latest_pid):
                raise SmokeFailure('The app process exited during the WK audio scenario.')
            try:
                last = json.loads(state_path.read_text(encoding='utf-8'))
                if predicate(last):
                    return last
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        if last is not None:
            (self.output / 'last-timeout-state.json').write_text(json.dumps(last, indent=2) + '\n', encoding='utf-8')
        (self.output / 'last-timeout-expected-audio.json').write_text(json.dumps(expected, indent=2) + '\n', encoding='utf-8')
        raise SmokeFailure('The real WK media graph did not reach its expected state; see last-timeout-state.json.')

    def record(self, name, state):
        (self.output / (name + '.json')).write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    @staticmethod
    def send(state_path, command):
        state_path.with_name('command.json').write_text(json.dumps({'id': command, 'command': command}), encoding='utf-8')

    @staticmethod
    def commanded(state, command):
        return state.get('lastCommand') == {'id': command, 'command': command}

    def run(self, prepared=None):
        variable = 'SIMCTL_CHILD_MAYDAN_SIMULATOR_AUDIO'
        previous = os.environ.get(variable)
        os.environ[variable] = 'streaming-recovery'
        try:
            if prepared is None:
                self.prepare()
            else:
                self.use_verified_simulator(prepared)
            expected = expected_audio_for_build(self.app)
            self.expected_audio = expected
            self.record('expected-audio', expected if expected is not None else audio_expectation(expected))
            self.launch('audio-stream', 5)
            self.latest_pid = self.report['launches'][-1]['pid']
            data = Path(self.prepare_command('audio-data-container', 180, 'get_app_container', self.device, self.bundle, 'data').stdout.strip())
            state_path = data / 'Documents/audio-stream-fixture/state.json'
            self.read_until(state_path, lambda value: value.get('fixture') == 'streaming-recovery', expected_audio=expected)
            self.send(state_path, 'activate')
            initial = self.read_until(state_path, lambda value: self.commanded(value, 'activate') and self.is_playing(value, expected_audio=expected), expected_audio=expected)
            self.record('initial-playing', initial)
            first_media = self.validate(initial, expected_audio=expected)
            advancing = self.read_until(state_path, lambda value: self.is_playing(value, expected_audio=expected)
                                        and value.get('contextTime', 0) > initial['contextTime'] + 0.3
                                        and self.media(value, True, expected_audio=expected)['time'] > first_media['time'] + 0.3, expected_audio=expected)
            self.record('advancing', advancing)
            self.validate_progress(initial, advancing, expected_audio=expected)
            before_background = self.validate(advancing, expected_audio=expected)
            self.send(state_path, 'background')
            background = self.read_until(state_path, lambda value: self.commanded(value, 'background')
                                         and value.get('contextState') != 'running'
                                         and self.media(value, expected_audio=expected) is not None and self.media(value, expected_audio=expected).get('paused') is True, expected_audio=expected)
            self.record('background-paused', background)
            self.validate(background, playing=False, expected_audio=expected)
            self.send(state_path, 'foreground')
            resumed = self.read_until(state_path, lambda value: self.commanded(value, 'foreground') and self.is_playing(value, expected_audio=expected)
                                     and self.media(value, True, expected_audio=expected)['time'] >= before_background['time'], expected_audio=expected)
            self.record('foreground-resumed', resumed)
            resumed_media = self.validate(resumed, expected_audio=expected)
            self.send(state_path, 'replace-context')
            replaced = self.read_until(state_path, lambda value: self.commanded(value, 'replace-context')
                                      and value.get('contextCount', 0) > resumed['contextCount'] and self.is_playing(value, expected_audio=expected)
                                      and self.media(value, True, expected_audio=expected)['time'] >= resumed_media['time'] - 0.3, expected_audio=expected)
            self.record('closed-context-replaced', replaced)
            replacement_media = self.validate(replaced, expected_audio=expected)
            final = self.read_until(state_path, lambda value: self.is_playing(value, expected_audio=expected)
                                   and value['contextTime'] > replaced['contextTime'] + 0.3
                                   and self.media(value, True, expected_audio=expected)['time'] > replacement_media['time'] + 0.3, expected_audio=expected)
            self.record('replacement-advancing', final)
            self.validate_progress(replaced, final, expected_audio=expected)
            self.screenshot('audio-stream-verified')
            self.report['audioStream'] = {
                'selectedBundledMedia': audio_expectation(expected)['url'],
                'expectedAudio': audio_expectation(expected),
                'durationSeconds': first_media['duration'],
                'initialPlayhead': first_media['time'],
                'finalPlayhead': self.media(final, True, expected_audio=expected)['time'],
                'contextCountBeforeReplacement': resumed['contextCount'],
                'contextCountAfterReplacement': final['contextCount'],
                'decodedCount': final['decodedCount'],
                'maximumDecodedBufferSeconds': final['decodedMaxSeconds'],
                'outputRms': final['rms'],
                'realWKCustomScheme': True,
                'realMediaClockAndMixer': True,
                'longMusicNotFullyDecoded': True,
                'injectedLifecyclePauseResume': True,
                'realContextCloseAndReplacement': True,
                'physicalDeviceTest': False,
                'evidence': f"Actual bundled full app/WKWebView, verified {audio_expectation(expected)['seconds']:g}s AAC and real Web Audio mixer; finite injected DOM/lifecycle signals. No physical speaker, real user gesture or hardware interruption claim."}
            self.report['passed'] = True
        except (OSError, ValueError, SmokeFailure) as error:
            self.report['error'] = str(error)
        finally:
            self.finish()
            if previous is None:
                os.environ.pop(variable, None)
            else:
                os.environ[variable] = previous
        print(json.dumps({'passed': self.report['passed'], 'error': self.report.get('error'), 'evidence': str(self.output)}))
        return 0 if self.report['passed'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    raise SystemExit(AudioStreamSmoke(args.app, args.output_dir).run())
