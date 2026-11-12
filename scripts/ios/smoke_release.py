#!/usr/bin/env python3
"""Run startup, update UI, streaming audio and drawing rotation on one owned simulator.

Each phase launches a fresh app process and retains separate evidence. Reusing
the verified device avoids a second independent OS boot/install window; it does
not retry failed launches or weaken their timeout, PID, crash or UI checks.
"""
import argparse
import json
import os
from pathlib import Path

from smoke_simulator_launch import LaunchSmoke, SmokeFailure
from smoke_app_update_gate import UpdateGateSmoke
from smoke_audio_stream import AudioStreamSmoke
from smoke_drawing_orientation import DrawingOrientationSmoke
from smoke_locale import LocaleSmoke


class ReleaseSmoke:
    def __init__(self, app, output):
        self.output = output.resolve()
        self.output.mkdir(parents=True, exist_ok=True)
        self.normal = LaunchSmoke(app, self.output / 'launch-smoke')
        self.locale = LocaleSmoke(app, self.output / 'locale-smoke')
        self.update = UpdateGateSmoke(app, self.output / 'update-gate-smoke')
        self.audio = AudioStreamSmoke(app, self.output / 'audio-stream-smoke')
        self.orientation = DrawingOrientationSmoke(app, self.output / 'drawing-orientation-smoke')
        self.report = {'passed': False, 'normalStartup': False, 'localization': False, 'updateGate': False, 'audioStream': False, 'drawingOrientation': False, 'sameInstalledApp': True}

    def run(self):
        variables = ('SIMCTL_CHILD_MAYDAN_SIMULATOR_APP_POLICY', 'SIMCTL_CHILD_MAYDAN_SIMULATOR_AUDIO', 'SIMCTL_CHILD_MAYDAN_SIMULATOR_ORIENTATION', 'SIMCTL_CHILD_MAYDAN_SIMULATOR_LOCALE')
        previous = {variable: os.environ.pop(variable, None) for variable in variables}
        try:
            # Leave the verified simulator alive, but not its app process. The
            # update scenario injects its finite environment only for next launch.
            if self.normal.run(cleanup=False, terminate_after=True) != 0:
                self.report['error'] = 'Normal startup failed; later scenarios were not run.'
            else:
                self.report['normalStartup'] = True
                # Locale ends with a retained Arabic choice and a stopped process.
                # The existing Arabic update-panel checks then retain their exact
                # assertions, independent of the simulator's system language.
                phases = [(self.locale, 'localization', False), (self.update, 'updateGate', True),
                          (self.audio, 'audioStream', True), (self.orientation, 'drawingOrientation', False)]
                for phase, key, terminate in phases:
                    if phase.run(prepared=self.normal) != 0:
                        self.report['error'] = f'{key} scenario failed.'
                        break
                    self.report[key] = True
                    if terminate:
                        phase.terminate_for_relaunch()
                        phase.write_summary()
                else:
                    self.report['passed'] = True
        except (OSError, ValueError, SmokeFailure) as error:
            self.report['error'] = str(error)
        finally:
            self.normal.cleanup_device()
            self.normal.write_summary()
            for variable, value in previous.items():
                if value is None:
                    os.environ.pop(variable, None)
                else:
                    os.environ[variable] = value
            self.report['normalEvidence'] = str(self.normal.output)
            self.report['localizationEvidence'] = str(self.locale.output)
            self.report['updateEvidence'] = str(self.update.output)
            self.report['audioEvidence'] = str(self.audio.output)
            self.report['drawingOrientationEvidence'] = str(self.orientation.output)
            (self.output / 'release-smoke-summary.json').write_text(json.dumps(self.report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(self.report))
        return 0 if self.report['passed'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    raise SystemExit(ReleaseSmoke(args.app, args.output_dir).run())
