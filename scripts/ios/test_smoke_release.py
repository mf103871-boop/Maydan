"""Verify sequence, ownership and failure propagation without needing macOS."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from smoke_release import ReleaseSmoke
from smoke_simulator_launch import LaunchSmoke, SmokeFailure
from smoke_app_update_gate import UpdateGateSmoke


class ReleaseSmokeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_normal_sequence_terminates_verified_process_before_handoff(self):
        smoke = LaunchSmoke(self.root / 'Maydan.app', self.root / 'normal')
        order = []
        smoke.prepare = lambda: order.append('prepare')
        smoke.launch = lambda name, duration: order.append((name, duration))
        smoke.terminate_for_relaunch = lambda: order.append('terminate-verified')
        smoke.finish = lambda cleanup: order.append(('finish', cleanup))
        self.assertEqual(smoke.run(cleanup=False, terminate_after=True), 0)
        self.assertEqual(order, ['prepare', ('cold', 45), 'terminate-verified', ('relaunch', 15), 'terminate-verified', ('finish', False)])

    def test_combined_runner_requires_all_phases_and_cleans_only_owner(self):
        for normal_result, update_result, audio_result, orientation_result, expected in [(0, 0, 0, 0, 0), (1, 0, 0, 0, 1), (0, 1, 0, 0, 1), (0, 0, 1, 0, 1), (0, 0, 0, 1, 1)]:
            with self.subTest(normal=normal_result, update=update_result, audio=audio_result, orientation=orientation_result):
                runner = ReleaseSmoke(self.root / 'Maydan.app', self.root / f'evidence-{normal_result}-{update_result}-{audio_result}-{orientation_result}')
                order = []
                runner.normal.run = Mock(side_effect=lambda **kwargs: order.append(('normal', kwargs)) or normal_result)
                runner.update.run = Mock(side_effect=lambda **kwargs: order.append(('update', kwargs)) or update_result)
                runner.update.terminate_for_relaunch = Mock(side_effect=lambda: order.append('terminate-update-process'))
                runner.update.write_summary = Mock()
                runner.audio.run = Mock(side_effect=lambda **kwargs: order.append(('audio', kwargs)) or audio_result)
                runner.audio.terminate_for_relaunch = Mock(side_effect=lambda: order.append('terminate-audio-process'))
                runner.audio.write_summary = Mock()
                runner.orientation.run = Mock(side_effect=lambda **kwargs: order.append(('orientation', kwargs)) or orientation_result)
                runner.normal.cleanup_device = Mock(side_effect=lambda: order.append('cleanup-owner'))
                runner.normal.write_summary = Mock()
                self.assertEqual(runner.run(), expected)
                self.assertEqual(order[0], ('normal', {'cleanup': False, 'terminate_after': True}))
                self.assertEqual(order[-1], 'cleanup-owner')
                runner.normal.cleanup_device.assert_called_once()
                if normal_result:
                    runner.update.run.assert_not_called()
                else:
                    runner.update.run.assert_called_once_with(prepared=runner.normal)
                    self.assertEqual(order[1][0], 'update')
                if normal_result or update_result:
                    runner.audio.run.assert_not_called()
                    runner.update.terminate_for_relaunch.assert_not_called()
                else:
                    self.assertEqual(order[2], 'terminate-update-process')
                    runner.audio.run.assert_called_once_with(prepared=runner.normal)
                    runner.update.terminate_for_relaunch.assert_called_once()
                if normal_result or update_result or audio_result:
                    runner.orientation.run.assert_not_called()
                    runner.audio.terminate_for_relaunch.assert_not_called()
                else:
                    runner.audio.terminate_for_relaunch.assert_called_once()
                    runner.orientation.run.assert_called_once_with(prepared=runner.normal)
                    self.assertEqual(order[4], 'terminate-audio-process')
                self.assertEqual(runner.report['passed'], expected == 0)

    def test_borrowed_gate_requires_verified_stopped_app_and_never_cleans_device(self):
        normal = LaunchSmoke(self.root / 'Maydan.app', self.root / 'normal')
        normal.device, normal.owns_device = 'owned-device', True
        normal.installed_app, normal.executable, normal.bundle = self.root / 'installed.app', 'Maydan', 'Maydan'
        normal.report.update({'passed': True, 'launches': [{'pid': 123, 'passed': True, 'terminatedForRelaunch': True}]})
        for key in ('bundleIdentifier', 'version', 'build', 'executableSha256', 'simulatorUdid', 'simulatorModel', 'runtime'):
            normal.report[key] = key
        normal.process_is_app = Mock(return_value=False)
        gate = UpdateGateSmoke(normal.app, self.root / 'update')
        gate.use_verified_simulator(normal)
        self.assertEqual(gate.device, normal.device)
        self.assertEqual(gate.installed_app, normal.installed_app)
        self.assertFalse(gate.owns_device)
        gate.simctl = Mock()
        gate.cleanup_device()
        gate.simctl.assert_not_called()
        normal.process_is_app.return_value = True
        with self.assertRaisesRegex(SmokeFailure, 'still running'):
            gate.use_verified_simulator(normal)
        normal.process_is_app.return_value = False
        normal.report['passed'] = False
        with self.assertRaisesRegex(SmokeFailure, 'requires the same installed app'):
            gate.use_verified_simulator(normal)

    def test_owned_simulator_is_cleaned_once_even_if_cleanup_is_called_again(self):
        smoke = LaunchSmoke(self.root / 'Maydan.app', self.root / 'normal')
        smoke.device, smoke.owns_device = 'owned-device', True
        smoke.simctl = Mock()
        smoke.cleanup_device()
        smoke.cleanup_device()
        self.assertEqual([call.args for call in smoke.simctl.call_args_list], [('shutdown', 'owned-device'), ('delete', 'owned-device')])


if __name__ == '__main__':
    unittest.main()
