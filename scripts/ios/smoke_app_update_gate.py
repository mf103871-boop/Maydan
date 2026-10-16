#!/usr/bin/env python3
"""Exercise the simulator-only active native update panel and its real Retry action.

Run after the ordinary startup smoke. View snapshots come from actual mounted
UILabel/UIButton properties; screenshots accompany them. This does not simulate
a physical finger tap, contact Apple, or enable a production update policy.
"""
import argparse
import json
import os
from pathlib import Path
import time

from smoke_simulator_launch import LaunchSmoke, SmokeFailure


class UpdateGateSmoke(LaunchSmoke):
    def use_verified_simulator(self, source):
        previous = source.report['launches'][-1] if source.report['launches'] else {}
        if (not source.report['passed'] or not source.owns_device or not source.device
                or not previous.get('passed') or not previous.get('terminatedForRelaunch')
                or self.app != source.app):
            raise SmokeFailure('Update gate requires the same installed app on a verified, terminated simulator process.')
        if source.process_is_app(previous['pid']):
            raise SmokeFailure('The normal smoke app is still running before the fixture launch.')
        self.device = source.device
        self.installed_app = source.installed_app
        self.bundle = source.bundle
        self.executable = source.executable
        # Keep ownership with the normal smoke. Never erase/reinstall its app:
        # the coordinator's initial-load state is process-local, not persisted.
        self.owns_device = False
        for key in ('bundleIdentifier', 'version', 'build', 'executableSha256', 'simulatorUdid', 'simulatorModel', 'runtime'):
            self.report[key] = source.report[key]
        self.report['reusedVerifiedSimulator'] = True

    def read_until(self, state_path, predicate):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if not self.process_is_app(self.latest_pid):
                raise SmokeFailure('The app process exited during the update gate scenario.')
            try:
                state = json.loads(state_path.read_text(encoding='utf-8'))
                if predicate(state):
                    return state
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        raise SmokeFailure('The native view hierarchy did not reach the expected update-gate state.')

    def run(self, prepared=None):
        variable = 'SIMCTL_CHILD_MAYDAN_SIMULATOR_APP_POLICY'
        previous = os.environ.get(variable)
        os.environ[variable] = 'required-then-offline'
        try:
            if prepared is None:
                self.prepare()
            else:
                self.use_verified_simulator(prepared)
            self.launch('required-update', 5)
            self.latest_pid = self.report['launches'][-1]['pid']
            data = Path(self.simctl('get_app_container', self.device, self.bundle, 'data', label='data-container').stdout.strip())
            state_path = data / 'Documents/app-update-fixture/state.json'
            required = self.read_until(state_path, lambda value: value.get('blocked') is True and (value.get('panel') or {}).get('mounted') is True)
            panel = required['panel']
            if required.get('initialLoadPermitted') is not False or panel.get('heading') != 'تحديث ميدان مطلوب':
                raise SmokeFailure('The required-update heading is missing or the game was started behind it.')
            if panel.get('message') != 'يتوفر تحديث مطلوب لميدان. حدّث التطبيق للمتابعة.' or not panel.get('modalAccessibility'):
                raise SmokeFailure('The mounted update panel lacks its Arabic message or modal accessibility.')
            for key, title in [('update', 'تحديث من App Store'), ('retry', 'إعادة التحقق')]:
                button = panel.get(key, {})
                if button.get('title') != title or button.get('hidden') is not False or button.get('enabled') is not True:
                    raise SmokeFailure(f'The visible {key} action is missing or disabled.')
                if button.get('height', 0) < 44 or button.get('width', 0) < 100 or not button.get('accessible'):
                    raise SmokeFailure(f'The {key} action is not a usable accessible button.')
            self.screenshot('required-update-verified')
            (self.output / 'required-view.json').write_text(json.dumps(required, ensure_ascii=False, indent=2), encoding='utf-8')
            # Only the simulator fixture can consume this finite command. It
            # dispatches the production Retry UIButton target/action, then makes
            # the policy unavailable to prove the user is not trapped offline.
            state_path.with_name('command.txt').write_text('retry-offline', encoding='utf-8')
            recovered = self.read_until(state_path, lambda value: value.get('offline') is True and value.get('blocked') is False and value.get('initialLoadPermitted') is True and value.get('panel') is None)
            (self.output / 'offline-recovery-view.json').write_text(json.dumps(recovered, ensure_ascii=False, indent=2), encoding='utf-8')
            time.sleep(3)
            if not self.process_is_app(self.latest_pid):
                raise SmokeFailure('The app exited after the update gate released gameplay.')
            self.screenshot('offline-recovery')
            self.report['updateGate'] = {'requiredHeadingAndActions': True, 'initialGameNotLoadedBehindGate': True,
                                        'realRetryAction': True, 'offlineRecovery': True,
                                        'evidence': 'Mounted native view properties plus screenshots; no physical touch claim.'}
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
    raise SystemExit(UpdateGateSmoke(args.app, args.output_dir).run())
