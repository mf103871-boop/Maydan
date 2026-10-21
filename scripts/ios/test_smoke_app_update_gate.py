"""Require real check-path evidence and retain failed mounted measurements."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from smoke_app_update_gate import UpdateGateSmoke


class UpdateGateEvidenceTests(unittest.TestCase):
    @staticmethod
    def required_state():
        return {'fixture': 'required-then-offline', 'productionCheckPath': True, 'phase': 'required',
                'observedUnavailableStorefront': True,
                'storefrontAttempts': 2, 'requestCount': 1, 'generation': 2, 'pendingRetry': False,
                'automaticRetries': 1, 'maximumAutomaticRetries': 3,
                'lastRequest': {'storefront': 'JOR', 'osVersion': '26.2'},
                'blocked': True, 'initialLoadPermitted': True, 'offline': False, 'panel': {
                    'mounted': True, 'heading': 'تحديث ميدان مطلوب',
                    'message': 'يتوفر تحديث مطلوب لميدان. حدّث التطبيق للمتابعة.', 'modalAccessibility': True,
                    'update': {'title': 'تحديث من App Store', 'hidden': False, 'enabled': True,
                               'width': 319, 'height': 52, 'accessible': True,
                               'accessibilityLabel': 'تحديث ميدان من متجر التطبيقات', 'buttonTrait': True},
                    'retry': {'title': 'إعادة التحقق', 'hidden': False, 'enabled': True,
                              'width': 319, 'height': 52, 'accessible': True,
                              'accessibilityLabel': 'إعادة التحقق من التحديث', 'buttonTrait': True}}}

    @classmethod
    def recovered_state(cls):
        state = cls.required_state()
        state.update({'phase': 'failed-open', 'generation': 3, 'requestCount': 2, 'storefrontAttempts': 3,
                      'blocked': False, 'offline': True, 'panel': None, 'failOpenReason': 'network',
                      'automaticRetries': 0, 'pendingRetry': True})
        return state

    @classmethod
    def exhausted_state(cls):
        state = cls.recovered_state()
        state.update({'generation': 6, 'requestCount': 5, 'storefrontAttempts': 6,
                      'automaticRetries': 3, 'pendingRetry': False})
        return state

    @staticmethod
    def smoke(folder, states):
        smoke = UpdateGateSmoke(folder / 'Maydan.app', folder / 'evidence')
        smoke.device, smoke.bundle = 'owned-simulator', 'Maydan'
        smoke.prepare = Mock()
        smoke.launch = Mock(side_effect=lambda *args: smoke.report['launches'].append({'pid': 123}))
        data = folder / 'data'
        (data / 'Documents/app-update-fixture').mkdir(parents=True)
        smoke.prepare_command = Mock(return_value=subprocess.CompletedProcess([], 0, str(data), ''))
        smoke.finish = Mock()
        smoke.screenshot = Mock()
        smoke.process_is_app = Mock(return_value=True)
        smoke.read_until = Mock(side_effect=states)
        return smoke

    def test_failed_button_preserves_measurements_before_assertion(self):
        for changed in ({'width': 0}, {'height': 0}, {'accessible': False}, {'accessibilityLabel': ''}, {'buttonTrait': False}):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                folder = Path(temporary)
                state = self.required_state()
                button = state['panel']['update']
                button.update(changed)
                smoke = self.smoke(folder, [state])
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(smoke.run(), 1)
                self.assertFalse(smoke.report['passed'])
                self.assertEqual(json.loads((smoke.output / 'required-view.json').read_text(encoding='utf-8')), state)
                self.assertIn(json.dumps(button, ensure_ascii=False, sort_keys=True), smoke.report['error'])

    def test_ui_only_or_incomplete_native_check_evidence_is_rejected_and_saved(self):
        invalid = [{'productionCheckPath': False}, {'observedUnavailableStorefront': False}, {'storefrontAttempts': 1}, {'requestCount': 0},
                   {'generation': 0}, {'generation': True}, {'phase': 'checking'}, {'pendingRetry': None},
                   {'automaticRetries': 4}, {'automaticRetries': True}, {'maximumAutomaticRetries': 4},
                   {'lastRequest': {'storefront': 'USA', 'osVersion': '26.2'}},
                   {'lastRequest': {'storefront': 'JOR', 'osVersion': 'unknown'}},
                   {'lastRequest': {'storefront': 'JOR', 'osVersion': '26.2', 'url': 'not-permitted'}}]
        for changed in invalid:
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                state = self.required_state()
                state.update(changed)
                smoke = self.smoke(Path(temporary), [state])
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(smoke.run(), 1)
                self.assertEqual(json.loads((smoke.output / 'required-view.json').read_text(encoding='utf-8')), state)
                self.assertNotIn('updateGate', smoke.report)

    def test_retry_needs_a_new_failed_request_and_generation(self):
        for changed in ({'requestCount': 1}, {'generation': 2}, {'failOpenReason': ''},
                        {'productionCheckPath': False}, {'phase': 'required'}, {'pendingRetry': None}):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                required, recovered = self.required_state(), self.recovered_state()
                recovered.update(changed)
                smoke = self.smoke(Path(temporary), [required, recovered])
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(smoke.run(), 1)
                self.assertEqual(json.loads((smoke.output / 'offline-recovery-view.json').read_text(encoding='utf-8')), recovered)
                self.assertNotIn('updateGate', smoke.report)

    def test_delayed_storefront_and_retry_report_only_their_actual_scope(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            smoke = self.smoke(folder, [self.required_state(), self.recovered_state(),
                                        self.exhausted_state(), self.exhausted_state()])
            variable = 'SIMCTL_CHILD_MAYDAN_SIMULATOR_APP_POLICY'
            with patch.dict(os.environ, {variable: 'previous'}), patch('smoke_app_update_gate.time.sleep'), redirect_stdout(io.StringIO()):
                self.assertEqual(smoke.run(), 0)
                self.assertEqual(os.environ[variable], 'previous')
            report = smoke.report['updateGate']
            self.assertTrue(report['productionCheckPath'])
            self.assertTrue(report['delayedStorefrontRecovery'])
            self.assertTrue(report['initialGamePermittedDuringTransientFailure'])
            self.assertFalse(report['initialGameNotLoadedBehindGate'])
            self.assertEqual(report['requestsAtRequired'], 1)
            self.assertEqual(report['requestsAfterRetry'], 2)
            self.assertEqual(report['requestsAfterExhaustion'], 5)
            self.assertTrue(report['boundedAutomaticRetries'])
            self.assertEqual(report['maximumAutomaticRetries'], 3)
            self.assertIn('No real StoreKit/network or physical touch claim', report['evidence'])
            self.assertEqual((folder / 'data/Documents/app-update-fixture/command.txt').read_text(encoding='utf-8'), 'retry-offline')
            self.assertEqual([call.args[0] for call in smoke.screenshot.call_args_list], ['required-update-verified', 'offline-recovery'])
            smoke.finish.assert_called_once()

    def test_retry_budget_and_quiescence_are_both_required(self):
        for changed in ({'requestCount': 6}, {'automaticRetries': 2}, {'pendingRetry': True},
                        {'generation': 3}, {'failOpenReason': 'other'}):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                exhausted = self.exhausted_state()
                exhausted.update(changed)
                smoke = self.smoke(Path(temporary), [self.required_state(), self.recovered_state(), exhausted])
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(smoke.run(), 1)
                self.assertEqual(json.loads((smoke.output / 'offline-exhausted-view.json').read_text(encoding='utf-8')), exhausted)
                self.assertNotIn('updateGate', smoke.report)
        with tempfile.TemporaryDirectory() as temporary:
            settled = self.exhausted_state()
            settled['requestCount'] += 1
            smoke = self.smoke(Path(temporary), [self.required_state(), self.recovered_state(),
                                                self.exhausted_state(), settled])
            with patch('smoke_app_update_gate.time.sleep'), redirect_stdout(io.StringIO()):
                self.assertEqual(smoke.run(), 1)
            self.assertIn('kept polling', smoke.report['error'])
            self.assertEqual(json.loads((smoke.output / 'offline-settled-view.json').read_text(encoding='utf-8')), settled)

    def test_late_observation_of_offline_failure_keeps_the_same_budget(self):
        with tempfile.TemporaryDirectory() as temporary:
            recovered = self.exhausted_state()
            smoke = self.smoke(Path(temporary), [self.required_state(), recovered,
                                                self.exhausted_state(), self.exhausted_state()])
            with patch('smoke_app_update_gate.time.sleep'), redirect_stdout(io.StringIO()):
                self.assertEqual(smoke.run(), 0)


if __name__ == '__main__':
    unittest.main()
