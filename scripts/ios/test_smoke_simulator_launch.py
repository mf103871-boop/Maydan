"""Keep simulator preparation failures separate from actual app survival checks."""
from pathlib import Path
import json
import os
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

    def smoke(self, kind=LaunchSmoke, auto_ready=True):
        smoke = kind(self.root / 'Maydan.app', self.root / 'evidence')
        smoke.device, smoke.bundle = 'fresh-simulator', 'Maydan'
        smoke.simctl = Mock(return_value=subprocess.CompletedProcess([], 0, 'Maydan: 123\n', ''))
        smoke.data_container = self.root / 'data'
        smoke.data_container.mkdir(exist_ok=True)
        if auto_ready:
            def launched(*args, **kwargs):
                token = kwargs.get('env', {}).get('SIMCTL_CHILD_MAYDAN_SIMULATOR_LAUNCH_TOKEN')
                if args[0] == 'launch' and token:
                    self.write_ready(smoke, token)
                return smoke.simctl.return_value
            smoke.simctl.side_effect = launched
        smoke.process_is_app = Mock(return_value=True)
        smoke.screenshot = Mock()
        smoke.collect_crashes = Mock()
        return smoke

    def write_ready(self, smoke, token, **changes):
        value = {'token': token, 'pid': 123, 'ready': True, 'initialized': True, 'migrationComplete': True,
                 'phase': 'home-ready', 'route': 'home', 'gameCardCount': 8}
        value.update(changes)
        path = smoke.data_container / 'Library/Caches/MaydanLaunchSmoke/ready.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')
        return value

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
                self.assertEqual(smoke.report['launches'][0]['readyRequired'], kind is LaunchSmoke)
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
        smoke.data_container = self.root
        with patch('smoke_simulator_launch.subprocess.run', side_effect=subprocess.TimeoutExpired('simctl', 45)) as run:
            with self.assertRaisesRegex(SmokeFailure, 'Timed out after 45s'):
                smoke.launch('cold', 45)
        run.assert_called_once()
        self.assertEqual(smoke.report['launches'], [])

    def test_run_retains_cold_and_relaunch_survival_requirements(self):
        smoke = self.smoke()
        smoke.prepare, smoke.launch = Mock(), Mock()
        smoke.terminate_for_relaunch, smoke.finish = Mock(), Mock()
        self.assertEqual(smoke.run(), 0)
        smoke.prepare.assert_called_once_with()
        self.assertEqual([call.args for call in smoke.launch.call_args_list], [('cold', 45), ('relaunch', 15)])
        smoke.terminate_for_relaunch.assert_called_once_with()
        self.assertTrue(smoke.report['passed'])

    def test_surviving_launch_still_fails_on_matching_crash_report(self):
        smoke = self.smoke()
        smoke.collect_crashes.side_effect = lambda: smoke.crashes.add(self.root / 'Maydan.ips')
        with patch('smoke_simulator_launch.time.monotonic', side_effect=[0, 45]):
            with self.assertRaisesRegex(SmokeFailure, 'matching application crash report'):
                smoke.launch('cold', 45)
        smoke.process_is_app.assert_called_once_with(123)
        smoke.collect_crashes.assert_called_once()

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
        self.assertEqual([call.args[0] for call in calls], ['runtime', 'list', 'create', 'boot', 'bootstatus', 'install', 'get_app_container', 'get_app_container'])
        self.assertEqual(calls[0].args, ('runtime', 'dyld_shared_cache', 'update', '--all'))
        self.assertEqual(calls[0].kwargs['timeout'], 300)
        self.assertEqual(calls[4].args, ('bootstatus', smoke.device, '-b'))
        self.assertEqual(calls[4].kwargs['timeout'], 600)
        self.assertEqual(calls[-3].args[0], 'install')
        self.assertEqual(calls[-3].kwargs['timeout'], 300)
        self.assertEqual(calls[-2].kwargs['timeout'], 180)
        self.assertEqual(calls[-2].args[-1], 'app')
        self.assertEqual(calls[-1].kwargs['timeout'], 180)
        self.assertEqual(calls[-1].args[-1], 'data')
        self.assertTrue(all(item['passed'] and item['elapsedSeconds'] >= 0 for item in smoke.report['preparation']))
        self.assertEqual(smoke.report['launches'], [])

    def test_bootstatus_timeout_prevents_install_and_launch_without_retry(self):
        smoke = self.prepared_fixture()
        previous = smoke.simctl.side_effect
        def result(*args, **kwargs):
            if args[0] == 'bootstatus':
                self.assertEqual(kwargs['timeout'], 600)
                raise SmokeFailure('Timed out after 600s: xcrun simctl bootstatus')
            return previous(*args, **kwargs)
        smoke.simctl.side_effect = result
        smoke.launch, smoke.finish = Mock(), Mock()
        with patch('smoke_simulator_launch.sys.platform', 'darwin'):
            self.assertEqual(smoke.run(), 1)
        self.assertEqual([call.args[0] for call in smoke.simctl.call_args_list],
                         ['runtime', 'list', 'create', 'boot', 'bootstatus'])
        record = smoke.report['preparation'][-1]
        self.assertEqual(record['step'], 'simulator-bootstatus')
        self.assertEqual(record['timeoutSeconds'], 600)
        self.assertFalse(record['passed'])
        self.assertFalse(smoke.report['passed'])
        self.assertEqual(smoke.report['launches'], [])
        self.assertIsNone(smoke.installed_app)
        smoke.launch.assert_not_called()

    def test_install_timeout_remains_a_failed_preparation_without_retry_or_launch(self):
        smoke = self.prepared_fixture()
        previous = smoke.simctl.side_effect
        def result(*args, **kwargs):
            if args[0] == 'install':
                self.assertEqual(kwargs['timeout'], 300)
                raise SmokeFailure('Timed out after 300s: xcrun simctl install')
            return previous(*args, **kwargs)
        smoke.simctl.side_effect = result
        smoke.launch, smoke.finish = Mock(), Mock()
        with patch('smoke_simulator_launch.sys.platform', 'darwin'):
            self.assertEqual(smoke.run(), 1)
        installs = [call for call in smoke.simctl.call_args_list if call.args[0] == 'install']
        self.assertEqual(len(installs), 1)
        self.assertEqual(smoke.report['preparation'][-1]['step'], 'simulator-install')
        self.assertFalse(smoke.report['preparation'][-1]['passed'])
        self.assertEqual(smoke.report['preparation'][-1]['timeoutSeconds'], 300)
        self.assertFalse(smoke.report['passed'])
        self.assertEqual(smoke.report['launches'], [])
        smoke.launch.assert_not_called()
        self.assertIsNone(smoke.installed_app)

    def test_failed_preparation_collects_host_pressure_and_install_service_diagnostics(self):
        smoke = self.smoke()
        smoke.command = Mock(return_value=subprocess.CompletedProcess([], 0, '', ''))
        smoke.cleanup_device = Mock()
        with patch('smoke_simulator_launch.time.sleep'):
            smoke.finish()
        smoke.command.assert_called_once_with(['/usr/bin/top', '-l', '1', '-n', '0'],
                                              timeout=10, label='host-resources', check=False)
        log_call = smoke.simctl.call_args
        predicate = log_call.args[log_call.args.index('--predicate') + 1]
        for service in ['installd', 'lsd', 'containermanagerd']:
            self.assertIn(f'process == "{service}"', predicate)
        self.assertEqual(log_call.kwargs['timeout'], 30)
        self.assertFalse(smoke.report['passed'])

    def test_screenshot_failure_does_not_suppress_unified_logs_or_cleanup(self):
        smoke = self.smoke()
        smoke.command = Mock(return_value=subprocess.CompletedProcess([], 0, '', ''))
        smoke.screenshot.side_effect = SmokeFailure('simulator screenshot timed out')
        smoke.cleanup_device = Mock()
        with patch('smoke_simulator_launch.time.sleep'):
            smoke.finish()
        smoke.collect_crashes.assert_called_once()
        smoke.screenshot.assert_called_once_with('final-state')
        self.assertEqual(smoke.simctl.call_args.args[:3], ('spawn', 'fresh-simulator', 'log'))
        self.assertEqual(smoke.simctl.call_args.kwargs['label'], 'simulator-unified-log')
        smoke.cleanup_device.assert_called_once()
        self.assertIn('simulator screenshot timed out', smoke.report['diagnosticWarnings'])
        self.assertFalse(smoke.report['passed'])

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

    def test_alive_blank_or_migration_recovery_screen_cannot_pass_startup(self):
        for changes in [None, {'migrationComplete': False}, {'initialized': False},
                        {'phase': 'document-finished'}, {'gameCardCount': 0}]:
            with self.subTest(changes=changes):
                smoke = self.smoke(auto_ready=False)
                def launched(*args, **kwargs):
                    path = smoke.data_container / 'Library/Caches/MaydanLaunchSmoke/ready.json'
                    if path.exists():
                        path.unlink()
                    if changes is not None:
                        self.write_ready(smoke, kwargs['env']['SIMCTL_CHILD_MAYDAN_SIMULATOR_LAUNCH_TOKEN'], **changes)
                    return subprocess.CompletedProcess([], 0, 'Maydan: 123\n', '')
                smoke.simctl.side_effect = launched
                with patch('smoke_simulator_launch.time.monotonic', side_effect=[0, 45]):
                    with self.assertRaisesRegex(SmokeFailure, 'survived but initialized game readiness'):
                        smoke.launch('cold', 45)
                record = smoke.report['launches'][0]
                self.assertTrue(record['survived'])
                self.assertFalse(record['passed'])
                self.assertFalse(record['ready'])
                smoke.collect_crashes.assert_called_once()

    def test_each_cold_and_relaunch_requires_its_own_token_and_exact_pid(self):
        smoke = self.smoke()
        with patch.dict(os.environ, {'SIMCTL_CHILD_MAYDAN_SIMULATOR_LAUNCH_TOKEN': 'inherited-stale-token'}):
            with patch('smoke_simulator_launch.time.monotonic', side_effect=[0, 45, 100, 115]):
                smoke.launch('cold', 45)
                smoke.launch('relaunch', 15)
            self.assertEqual(os.environ['SIMCTL_CHILD_MAYDAN_SIMULATOR_LAUNCH_TOKEN'], 'inherited-stale-token')
        cold, relaunch = smoke.report['launches']
        self.assertNotEqual(cold['launchToken'], relaunch['launchToken'])
        for record in [cold, relaunch]:
            self.assertTrue(record['ready'])
            self.assertTrue(record['readyRequired'])
            self.assertTrue(record['passed'])
            self.assertEqual(record['readyObservedSeconds'], record['requiredSeconds'])
            receipt = json.loads((smoke.output / record['readyReceiptFile']).read_text())
            self.assertEqual(receipt['token'], record['launchToken'])
            self.assertEqual(receipt['pid'], record['pid'])
        stale = self.smoke(auto_ready=False)
        self.write_ready(stale, cold['launchToken'])
        with patch('smoke_simulator_launch.time.monotonic', side_effect=[0, 15]):
            with self.assertRaisesRegex(SmokeFailure, 'another launch or process'):
                stale.launch('relaunch', 15)
        self.assertFalse(stale.report['launches'][0]['ready'])

    def test_receipt_rejects_wrong_identity_partial_values_and_unbounded_input(self):
        token = '00000000-0000-4000-8000-000000000001'
        smoke = self.smoke(auto_ready=False)
        valid = self.write_ready(smoke, token)
        smoke.validate_game_ready(valid, token, 123)
        for changes in [{'token': 'another'}, {'pid': 124}, {'pid': True}, {'ready': 1},
                        {'initialized': None}, {'migrationComplete': 'true'}, {'route': 'migration'},
                        {'gameCardCount': 7}, {'gameCardCount': 8.0}, {'gameCardCount': 9}]:
            with self.assertRaises(SmokeFailure):
                smoke.validate_game_ready({**valid, **changes}, token, 123)
        with self.assertRaises(SmokeFailure):
            smoke.validate_game_ready([], token, 123)
        path = smoke.data_container / 'Library/Caches/MaydanLaunchSmoke/ready.json'
        for value in ['{partial', ' ' * (16 * 1024 + 1)]:
            path.write_text(value)
            record = {'name': 'cold', 'launchToken': token, 'pid': 123, 'ready': False}
            smoke.read_game_ready(record, 1)
            self.assertFalse(record['ready'])
            self.assertNotIn('readyReceiptFile', record)

    def test_current_eight_game_catalog_passes_but_old_seven_game_receipt_is_rejected(self):
        token = '00000000-0000-4000-8000-000000000001'
        smoke = self.smoke(auto_ready=False)
        receipt = self.write_ready(smoke, token, gameCardCount=8)
        smoke.validate_game_ready(receipt, token, 123)
        with self.assertRaisesRegex(SmokeFailure, 'all eight game controls'):
            smoke.validate_game_ready({**receipt, 'gameCardCount': 7}, token, 123)

    def test_early_readiness_does_not_shorten_process_survival_or_hide_later_crash(self):
        smoke = self.smoke()
        smoke.process_is_app.side_effect = [True, False]
        with patch('smoke_simulator_launch.time.monotonic', side_effect=[0, 1, 2]), patch('smoke_simulator_launch.time.sleep'):
            with self.assertRaisesRegex(SmokeFailure, 'exact app process exited'):
                smoke.launch('cold', 45)
        record = smoke.report['launches'][0]
        self.assertTrue(record['ready'])
        self.assertEqual(record['readyObservedSeconds'], 1)
        self.assertFalse(record['passed'])
        self.assertEqual(record['requiredSeconds'], 45)


if __name__ == '__main__':
    unittest.main()
