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
import time

from smoke_app_update_gate import UpdateGateSmoke
from smoke_simulator_launch import SmokeFailure


EXPECTED_MEDIA = 'maydan://app/audio/selected/sunny-steps-e79c0b47.m4a'


class AudioStreamSmoke(UpdateGateSmoke):
    @staticmethod
    def media(state, playing=False):
        values = state.get('media')
        if not isinstance(values, list):
            return None
        matches = [value for value in values if isinstance(value, dict)
                   and value.get('url') == EXPECTED_MEDIA
                   and value.get('contextIndex') == state.get('contextCount', 0) - 1
                   and (not playing or value.get('paused') is False)]
        return matches[-1] if matches else None

    @classmethod
    def is_playing(cls, state):
        media = cls.media(state, playing=True)
        return bool(media and state.get('contextState') == 'running'
                    and isinstance(media.get('duration'), (float, int))
                    and 479.75 <= media['duration'] <= 480.25
                    and media.get('time', 0) > 0.2 and media.get('readyState', 0) >= 2
                    and state.get('rms', 0) > 0.00001)

    @classmethod
    def validate(cls, state, playing=True):
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
        media = cls.media(state, playing=playing)
        if not media or media.get('error') is not None:
            raise SmokeFailure('The selected bundled music has no real media element in the current context.')
        if playing and not cls.is_playing(state):
            raise SmokeFailure('The real bundled 480-second media stream is not advancing through the mixer.')
        return media

    @classmethod
    def validate_progress(cls, before, after):
        first = cls.validate(before)
        second = cls.validate(after)
        if (before['contextCount'] != after['contextCount']
                or after['contextTime'] <= before['contextTime'] + 0.3
                or second['time'] <= first['time'] + 0.3):
            raise SmokeFailure('The same real audio graph and media playhead did not advance together.')

    def read_until(self, state_path, predicate, timeout=30):
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
            self.launch('audio-stream', 5)
            self.latest_pid = self.report['launches'][-1]['pid']
            data = Path(self.prepare_command('audio-data-container', 180, 'get_app_container', self.device, self.bundle, 'data').stdout.strip())
            state_path = data / 'Documents/audio-stream-fixture/state.json'
            self.read_until(state_path, lambda value: value.get('fixture') == 'streaming-recovery')
            self.send(state_path, 'activate')
            initial = self.read_until(state_path, lambda value: self.commanded(value, 'activate') and self.is_playing(value))
            self.record('initial-playing', initial)
            first_media = self.validate(initial)
            advancing = self.read_until(state_path, lambda value: self.is_playing(value)
                                        and value.get('contextTime', 0) > initial['contextTime'] + 0.3
                                        and self.media(value, True)['time'] > first_media['time'] + 0.3)
            self.record('advancing', advancing)
            self.validate_progress(initial, advancing)
            before_background = self.validate(advancing)
            self.send(state_path, 'background')
            background = self.read_until(state_path, lambda value: self.commanded(value, 'background')
                                         and value.get('contextState') != 'running'
                                         and self.media(value) is not None and self.media(value).get('paused') is True)
            self.record('background-paused', background)
            self.validate(background, playing=False)
            self.send(state_path, 'foreground')
            resumed = self.read_until(state_path, lambda value: self.commanded(value, 'foreground') and self.is_playing(value)
                                     and self.media(value, True)['time'] >= before_background['time'])
            self.record('foreground-resumed', resumed)
            resumed_media = self.validate(resumed)
            self.send(state_path, 'replace-context')
            replaced = self.read_until(state_path, lambda value: self.commanded(value, 'replace-context')
                                      and value.get('contextCount', 0) > resumed['contextCount'] and self.is_playing(value)
                                      and self.media(value, True)['time'] >= resumed_media['time'] - 0.3)
            self.record('closed-context-replaced', replaced)
            replacement_media = self.validate(replaced)
            final = self.read_until(state_path, lambda value: self.is_playing(value)
                                   and value['contextTime'] > replaced['contextTime'] + 0.3
                                   and self.media(value, True)['time'] > replacement_media['time'] + 0.3)
            self.record('replacement-advancing', final)
            self.validate_progress(replaced, final)
            self.screenshot('audio-stream-verified')
            self.report['audioStream'] = {
                'selectedBundledMedia': EXPECTED_MEDIA,
                'durationSeconds': first_media['duration'],
                'initialPlayhead': first_media['time'],
                'finalPlayhead': self.media(final, True)['time'],
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
                'evidence': 'Actual bundled full app/WKWebView, original 480s AAC and real Web Audio mixer; finite injected DOM/lifecycle signals. No physical speaker, real user gesture or hardware interruption claim.'}
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
