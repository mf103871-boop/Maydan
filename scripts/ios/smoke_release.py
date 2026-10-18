#!/usr/bin/env python3
"""Run normal startup and the update UI gate on one owned simulator.

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


class ReleaseSmoke:
    def __init__(self, app, output):
        self.output = output.resolve()
        self.output.mkdir(parents=True, exist_ok=True)
        self.normal = LaunchSmoke(app, self.output / 'launch-smoke')
        self.update = UpdateGateSmoke(app, self.output / 'update-gate-smoke')
        self.report = {'passed': False, 'normalStartup': False, 'updateGate': False, 'sameInstalledApp': True}

    def run(self):
        variable = 'SIMCTL_CHILD_MAYDAN_SIMULATOR_APP_POLICY'
        previous = os.environ.pop(variable, None)
        try:
            # Leave the verified simulator alive, but not its app process. The
            # update scenario injects its finite environment only for next launch.
            if self.normal.run(cleanup=False, terminate_after=True) != 0:
                self.report['error'] = 'Normal startup failed; update scenario was not run.'
            else:
                self.report['normalStartup'] = True
                if self.update.run(prepared=self.normal) != 0:
                    self.report['error'] = 'Update UI scenario failed.'
                else:
                    self.report['updateGate'] = True
                    self.report['passed'] = True
        except (OSError, ValueError, SmokeFailure) as error:
            self.report['error'] = str(error)
        finally:
            self.normal.cleanup_device()
            self.normal.write_summary()
            if previous is None:
                os.environ.pop(variable, None)
            else:
                os.environ[variable] = previous
            self.report['normalEvidence'] = str(self.normal.output)
            self.report['updateEvidence'] = str(self.update.output)
            (self.output / 'release-smoke-summary.json').write_text(json.dumps(self.report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(self.report))
        return 0 if self.report['passed'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    raise SystemExit(ReleaseSmoke(args.app, args.output_dir).run())
