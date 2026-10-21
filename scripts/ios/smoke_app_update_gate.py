#!/usr/bin/env python3
"""Exercise delayed storefront recovery, the native panel and its real Retry action.

Run after the ordinary startup smoke. View snapshots come from actual mounted
UILabel/UIButton properties; screenshots accompany them. This does not simulate
a physical finger tap, contact Apple, or enable a production update policy. The
simulator injects finite storefront/transport responses into the production
check path; it does not certify real StoreKit, DNS, TLS or device connectivity.
"""
import argparse
import json
import os
from pathlib import Path
import re
import time

from smoke_simulator_launch import LaunchSmoke, SmokeFailure


class UpdateGateSmoke(LaunchSmoke):
    @staticmethod
    def validate_check_path(state, phase):
        """Reject UI-only fixtures that bypass storefront/request/decoding work."""
        measured = json.dumps(state, ensure_ascii=False, sort_keys=True)
        if (state.get('productionCheckPath') is not True or state.get('phase') != phase
                or state.get('observedUnavailableStorefront') is not True):
            raise SmokeFailure(f'The native update check path was not exercised: {measured}')
        for key, minimum in [('storefrontAttempts', 2), ('requestCount', 1), ('generation', 1)]:
            if type(state.get(key)) is not int or state[key] < minimum:
                raise SmokeFailure(f'The native update check lacks measured {key}: {measured}')
        request = state.get('lastRequest')
        if (not isinstance(request, dict) or set(request) != {'storefront', 'osVersion'}
                or request.get('storefront') != 'JOR' or not isinstance(request.get('osVersion'), str)
                or re.fullmatch(r'[0-9]{1,6}(?:\.[0-9]{1,6}){0,2}', request['osVersion']) is None):
            raise SmokeFailure(f'The native policy request context is missing or unexpected: {measured}')
        if type(state.get('pendingRetry')) is not bool:
            raise SmokeFailure(f'The native update retry state was not measured: {measured}')
        if (state.get('maximumAutomaticRetries') != 3 or type(state.get('maximumAutomaticRetries')) is not int
                or type(state.get('automaticRetries')) is not int
                or not 0 <= state['automaticRetries'] <= state['maximumAutomaticRetries']):
            raise SmokeFailure(f'The native update retry budget is missing or exceeded: {measured}')

    @classmethod
    def validate_recovery(cls, required, recovered):
        cls.validate_check_path(recovered, 'failed-open')
        measured = json.dumps(recovered, ensure_ascii=False, sort_keys=True)
        reason = recovered.get('failOpenReason')
        if (reason != 'network'
                or recovered['requestCount'] <= required['requestCount']
                or recovered['generation'] <= required['generation']):
            raise SmokeFailure(f'The Retry action did not perform a new failing policy request: {measured}')

    @classmethod
    def validate_exhausted_retries(cls, recovered, exhausted):
        cls.validate_check_path(exhausted, 'failed-open')
        measured = json.dumps(exhausted, ensure_ascii=False, sort_keys=True)
        remaining = recovered['maximumAutomaticRetries'] - recovered['automaticRetries']
        if (exhausted['pendingRetry'] is not False or exhausted['automaticRetries'] != 3
                or exhausted.get('failOpenReason') != 'network'
                or exhausted['requestCount'] - recovered['requestCount'] != remaining
                or exhausted['generation'] < recovered['generation']
                or (remaining > 0 and exhausted['generation'] == recovered['generation'])):
            raise SmokeFailure(f'The offline retry cycle did not stop at its bounded budget: {measured}')

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

    def read_until(self, state_path, predicate, timeout=15):
        deadline = time.monotonic() + timeout
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
            data = Path(self.prepare_command('data-container', 180, 'get_app_container', self.device, self.bundle, 'data').stdout.strip())
            state_path = data / 'Documents/app-update-fixture/state.json'
            required = self.read_until(state_path, lambda value: value.get('blocked') is True and (value.get('panel') or {}).get('mounted') is True)
            # Preserve measured facts even when an assertion below fails.
            (self.output / 'required-view.json').write_text(json.dumps(required, ensure_ascii=False, indent=2), encoding='utf-8')
            self.validate_check_path(required, 'required')
            panel = required['panel']
            if (required.get('initialLoadPermitted') is not True or required['pendingRetry'] is not False
                    or panel.get('heading') != 'تحديث ميدان مطلوب'):
                raise SmokeFailure('The delayed-storefront retry did not show the required panel after permitting initial gameplay.')
            if panel.get('message') != 'يتوفر تحديث مطلوب لميدان. حدّث التطبيق للمتابعة.' or not panel.get('modalAccessibility'):
                raise SmokeFailure('The mounted update panel lacks its Arabic message or modal accessibility.')
            for key, title in [('update', 'تحديث من App Store'), ('retry', 'إعادة التحقق')]:
                button = panel.get(key, {})
                measured = json.dumps(button, ensure_ascii=False, sort_keys=True)
                if button.get('title') != title or button.get('hidden') is not False or button.get('enabled') is not True:
                    raise SmokeFailure(f'The visible {key} action is missing or disabled: {measured}')
                if button.get('height', 0) < 44 or button.get('width', 0) < 100 or not button.get('accessible'):
                    raise SmokeFailure(f'The {key} action is not a usable accessible button: {measured}')
                label = 'تحديث ميدان من متجر التطبيقات' if key == 'update' else 'إعادة التحقق من التحديث'
                if button.get('accessibilityLabel') != label or button.get('buttonTrait') is not True:
                    raise SmokeFailure(f'The {key} action lacks its Arabic accessibility label or button trait: {measured}')
            self.screenshot('required-update-verified')
            # Only the simulator fixture can consume this finite command. It
            # dispatches the production Retry UIButton target/action, then makes
            # the policy unavailable to prove the user is not trapped offline.
            state_path.with_name('command.txt').write_text('retry-offline', encoding='utf-8')
            recovered = self.read_until(state_path, lambda value: value.get('offline') is True and value.get('blocked') is False and value.get('initialLoadPermitted') is True and value.get('panel') is None)
            (self.output / 'offline-recovery-view.json').write_text(json.dumps(recovered, ensure_ascii=False, indent=2), encoding='utf-8')
            self.validate_recovery(required, recovered)
            exhausted = self.read_until(state_path, lambda value: value.get('phase') == 'failed-open'
                                        and value.get('automaticRetries') == 3 and value.get('pendingRetry') is False,
                                        timeout=30)
            (self.output / 'offline-exhausted-view.json').write_text(json.dumps(exhausted, ensure_ascii=False, indent=2), encoding='utf-8')
            self.validate_exhausted_retries(recovered, exhausted)
            time.sleep(3)
            if not self.process_is_app(self.latest_pid):
                raise SmokeFailure('The app exited after the update gate released gameplay.')
            settled = self.read_until(state_path, lambda value: value.get('offline') is True and value.get('blocked') is False and value.get('panel') is None)
            (self.output / 'offline-settled-view.json').write_text(json.dumps(settled, ensure_ascii=False, indent=2), encoding='utf-8')
            self.validate_check_path(settled, 'failed-open')
            if (settled['requestCount'] != exhausted['requestCount'] or settled['pendingRetry'] is not False
                    or settled['automaticRetries'] != exhausted['automaticRetries']):
                raise SmokeFailure('The native update check kept polling after exhausting its automatic retries.')
            self.screenshot('offline-recovery')
            self.report['updateGate'] = {'requiredHeadingAndActions': True,
                                        'initialGameNotLoadedBehindGate': False,
                                        'delayedStorefrontRecovery': True,
                                        'initialGamePermittedDuringTransientFailure': True,
                                        'productionCheckPath': True,
                                        'storefrontAttemptsAtRequired': required['storefrontAttempts'],
                                        'requestsAtRequired': required['requestCount'],
                                        'requestsAfterRetry': recovered['requestCount'],
                                        'requestsAfterExhaustion': exhausted['requestCount'],
                                        'maximumAutomaticRetries': exhausted['maximumAutomaticRetries'],
                                        'boundedAutomaticRetries': True,
                                        'realRetryAction': True, 'offlineRecovery': True,
                                        'evidence': 'Injected simulator storefront/transport responses traverse the production check path; mounted native view measurements and screenshots. No real StoreKit/network or physical touch claim.'}
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
