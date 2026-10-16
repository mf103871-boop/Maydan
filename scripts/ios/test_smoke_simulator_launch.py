"""Keep simulator preparation failures separate from actual app survival checks."""
from pathlib import Path
import json
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from smoke_simulator_launch import LaunchSmoke, SmokeFailure
from smoke_app_update_gate import UpdateGateSmoke


class LaunchSmokeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def smoke(self, kind=LaunchSmoke):
        smoke = kind(self.root / 'Maydan.app', self.root / 'evidence')
        smoke.device, smoke.bundle = 'fresh-simulator', 'Maydan'
        smoke.simctl = Mock(return_value=subprocess.CompletedProcess([], 0, 'Maydan: 123\n', ''))
        smoke.process_is_app = Mock(return_value=True)
        smoke.screenshot = Mock()
        smoke.collect_crashes = Mock()
        return smoke

    def test_fresh_normal_and_update_gate_launch_without_termination(self):
        for kind in (LaunchSmoke, UpdateGateSmoke):
            with self.subTest(kind=kind.__name__):
                smoke = self.smoke(kind)
                with patch('smoke_simulator_launch.time.monotonic', side_effect=[0, 45]):
                    smoke.launch('cold', 45)
                args, kwargs = smoke.simctl.call_args
                self.assertEqual(args[0], 'launch')
                self.assertNotIn('--terminate-running-process', args)
                self.assertEqual(args[-2:], ('fresh-simulator', 'Maydan'))
                self.assertEqual(kwargs['timeout'], 45)
                self.assertEqual(smoke.report['launches'][0]['requiredSeconds'], 45)
                self.assertTrue(smoke.report['launches'][0]['passed'])
                smoke.process_is_app.assert_called_with(123)
                smoke.collect_crashes.assert_called_once()

    def test_relaunch_terminates_only_the_known_app_and_waits_for_exit(self):
        smoke = self.smoke()
        smoke.report['launches'] = [{'name': 'cold', 'pid': 123, 'passed': True}]
        smoke.process_is_app.side_effect = [True, True, False]
        with patch('smoke_simulator_launch.time.sleep'), patch('smoke_simulator_launch.time.monotonic', side_effect=[0, 1]):
            smoke.terminate_for_relaunch()
        smoke.simctl.assert_called_once_with('terminate', 'fresh-simulator', 'Maydan', timeout=45, label='cold-terminate')
        self.assertTrue(smoke.report['launches'][0]['terminatedForRelaunch'])
        self.assertEqual(smoke.process_is_app.call_count, 3)

    def test_relaunch_refuses_absent_failed_or_changed_process(self):
        for records, alive in [([], True), ([{'name': 'cold', 'pid': 123, 'passed': False}], True),
                               ([{'name': 'cold', 'pid': 123, 'passed': True}], False)]:
            smoke = self.smoke()
            smoke.report['launches'], smoke.process_is_app.return_value = records, alive
            with self.assertRaisesRegex(SmokeFailure, 'previously verified app process'):
                smoke.terminate_for_relaunch()
            smoke.simctl.assert_not_called()

    def test_relaunch_fails_if_known_process_does_not_exit(self):
        smoke = self.smoke()
        smoke.report['launches'] = [{'name': 'cold', 'pid': 123, 'passed': True}]
        with patch('smoke_simulator_launch.time.monotonic', side_effect=[0, 11]):
            with self.assertRaisesRegex(SmokeFailure, 'did not terminate'):
                smoke.terminate_for_relaunch()
        self.assertNotIn('terminatedForRelaunch', smoke.report['launches'][0])

    def test_successful_launch_still_requires_a_pid_and_exact_live_app(self):
        smoke = self.smoke()
        smoke.simctl.return_value.stdout = 'No application PID'
        with self.assertRaisesRegex(SmokeFailure, 'did not report'):
            smoke.launch('cold', 45)
        smoke.simctl.return_value.stdout = 'Maydan: 123\n'
        smoke.process_is_app.return_value = False
        with self.assertRaisesRegex(SmokeFailure, 'exact app process exited'):
            smoke.launch('cold', 45)
        self.assertFalse(smoke.report['launches'][0]['passed'])

    def test_launch_timeout_still_fails_without_retrying_or_claiming_success(self):
        smoke = LaunchSmoke(self.root / 'Maydan.app', self.root / 'evidence')
        smoke.device, smoke.bundle = 'fresh-simulator', 'Maydan'
        with patch('smoke_simulator_launch.subprocess.run', side_effect=subprocess.TimeoutExpired('simctl', 45)) as run:
            with self.assertRaisesRegex(SmokeFailure, 'Timed out after 45s'):
                smoke.launch('cold', 45)
        run.assert_called_once()
        self.assertEqual(smoke.report['launches'], [])

    def prepared_fixture(self):
        app = self.root / 'Maydan.app'
        app.mkdir()
        (app / 'Maydan').write_bytes(b'test executable')
        (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'Maydan', 'CFBundleExecutable': 'Maydan'}))
        smoke = LaunchSmoke(app, self.root / 'preparation')
        runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-2'
        inventory = {'runtimes': [{'identifier': runtime, 'version': '26.2', 'isAvailable': True}],
                     'devices': {runtime: [{'name': 'iPhone SE', 'isAvailable': True,
                                           'deviceTypeIdentifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-SE'}]}}
        def result(*args, **kwargs):
            values = {'list': json.dumps(inventory), 'create': '00000000-0000-4000-8000-000000000001', 'get_app_container': str(app)}
            return subprocess.CompletedProcess([], 0, values.get(args[0], ''), '')
        smoke.simctl = Mock(side_effect=result)
        return smoke

    def test_runtime_readiness_finishes_before_boot_and_container_has_preparation_deadline(self):
        smoke = self.prepared_fixture()
        with patch('smoke_simulator_launch.sys.platform', 'darwin'):
            smoke.prepare()
        calls = smoke.simctl.call_args_list
        self.assertEqual([call.args[0] for call in calls], ['runtime', 'list', 'create', 'boot', 'bootstatus', 'install', 'get_app_container'])
        self.assertEqual(calls[0].args, ('runtime', 'dyld_shared_cache', 'update', '--all'))
        self.assertEqual(calls[0].kwargs['timeout'], 300)
        self.assertEqual(calls[-1].kwargs['timeout'], 180)
        self.assertTrue(all(item['passed'] and item['elapsedSeconds'] >= 0 for item in smoke.report['preparation']))
        self.assertEqual(smoke.report['launches'], [])

    def test_readiness_failure_is_recorded_and_never_retried_or_followed_by_boot(self):
        smoke = self.prepared_fixture()
        smoke.simctl.side_effect = SmokeFailure('Readiness timed out')
        with patch('smoke_simulator_launch.sys.platform', 'darwin'):
            with self.assertRaisesRegex(SmokeFailure, 'Readiness timed out'):
                smoke.prepare()
        smoke.simctl.assert_called_once()
        self.assertFalse(smoke.report['preparation'][0]['passed'])
        self.assertIsNone(smoke.device)
        self.assertEqual(smoke.report['launches'], [])

    def test_update_data_container_uses_preparation_deadline_and_cannot_skip_failure(self):
        smoke = self.smoke(UpdateGateSmoke)
        smoke.prepare = Mock()
        smoke.launch = Mock(side_effect=lambda *args: smoke.report['launches'].append({'pid': 123}))
        smoke.simctl.side_effect = SmokeFailure('Data container timed out')
        smoke.read_until = Mock()
        smoke.finish = Mock()
        self.assertEqual(smoke.run(), 1)
        smoke.simctl.assert_called_once_with('get_app_container', 'fresh-simulator', 'Maydan', 'data',
                                            timeout=180, label='data-container')
        smoke.read_until.assert_not_called()
        self.assertFalse(smoke.report['passed'])
        self.assertFalse(smoke.report['preparation'][0]['passed'])


if __name__ == '__main__':
    unittest.main()
