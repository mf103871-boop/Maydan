#!/usr/bin/env python3
"""Measure actual UIKit landscape, stale lease isolation and previous orientation restore.

The finite simulator fixture injects eligibility and lease commands into the
production lease core. UIKit geometry and WK view dimensions are measured, not
mocked. No production room is joined and no hardware rotation claim is made.
"""
import argparse
import json
import os
from pathlib import Path

from smoke_audio_stream import AudioStreamSmoke
from smoke_simulator_launch import SmokeFailure


class DrawingOrientationSmoke(AudioStreamSmoke):
    @staticmethod
    def valid_state(state):
        return (state.get('fixture') == 'drawing-orientation-lease'
                and state.get('eligibilityInjected') is True and state.get('geometryInjected') is False
                and state.get('gameLoaded') is True
                and type(state.get('orientationRaw')) is int
                and type(state.get('webWidth')) in (int, float)
                and type(state.get('webHeight')) in (int, float)
                and state['webWidth'] > 100 and state['webHeight'] > 100)

    @classmethod
    def is_portrait(cls, state):
        return (cls.valid_state(state) and state['orientationRaw'] == 1
                and state.get('landscape') is False and state['webHeight'] > state['webWidth']
                and state.get('lease') is None and state.get('supportedMask') == 26
                and state.get('edgeBackEnabled') is True)

    @classmethod
    def is_landscape(cls, state, lease):
        return (cls.valid_state(state) and state['orientationRaw'] in (3, 4)
                and state.get('landscape') is True and state['webWidth'] > state['webHeight']
                and state.get('lease') == lease and state.get('supportedMask') == 24
                and state.get('edgeBackEnabled') is False)

    def run(self, prepared=None):
        variable = 'SIMCTL_CHILD_MAYDAN_SIMULATOR_ORIENTATION'
        previous = os.environ.get(variable)
        os.environ[variable] = 'lease-recovery'
        try:
            if prepared is None:
                self.prepare()
            else:
                self.use_verified_simulator(prepared)
            self.launch('drawing-orientation', 5)
            self.latest_pid = self.report['launches'][-1]['pid']
            data = Path(self.prepare_command('orientation-data-container', 180, 'get_app_container', self.device, self.bundle, 'data').stdout.strip())
            state_path = data / 'Documents/drawing-orientation-fixture/state.json'
            self.read_until(state_path, self.valid_state)
            self.send(state_path, 'portrait')
            baseline = self.read_until(state_path, lambda value: self.commanded(value, 'portrait') and self.is_portrait(value) and value.get('baselineRaw') == 1)
            self.record('baseline-portrait', baseline)
            self.send(state_path, 'acquire-first')
            first = self.read_until(state_path, lambda value: self.commanded(value, 'acquire-first') and self.is_landscape(value, 'ers-simulator-first'))
            self.record('first-landscape', first)
            self.screenshot('drawing-landscape')
            self.send(state_path, 'acquire-next')
            next_lease = self.read_until(state_path, lambda value: self.commanded(value, 'acquire-next') and self.is_landscape(value, 'ers-simulator-next') and value.get('generation', 0) > first['generation'])
            self.record('next-landscape', next_lease)
            self.send(state_path, 'release-stale')
            stale = self.read_until(state_path, lambda value: self.commanded(value, 'release-stale') and self.is_landscape(value, 'ers-simulator-next') and value.get('generation') == next_lease['generation'])
            self.record('stale-release-ignored', stale)
            self.send(state_path, 'release-current')
            restored = self.read_until(state_path, lambda value: self.commanded(value, 'release-current') and self.is_portrait(value) and value.get('generation', 0) > stale['generation'])
            self.record('restored-portrait', restored)
            self.screenshot('drawing-orientation-restored')
            self.report['drawingOrientation'] = {
                'measuredBaseline': baseline['orientationRaw'], 'measuredLandscape': first['orientationRaw'],
                'landscapeWebWidth': first['webWidth'], 'landscapeWebHeight': first['webHeight'],
                'restoredOrientation': restored['orientationRaw'], 'staleReleaseIgnored': True,
                'nativeEdgeBackDisabledDuringDrawingAndRestored': True,
                'productionLeaseCore': True, 'eligibilityInjected': True, 'geometryInjected': False,
                'physicalDeviceTest': False, 'productionRoomJoined': False,
            }
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
    raise SystemExit(DrawingOrientationSmoke(args.app, args.output_dir).run())
