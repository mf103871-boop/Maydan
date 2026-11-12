"""Reject stale, fabricated-direction, untranslated and non-retained locale evidence."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from smoke_locale import LocaleSmoke, GAMES, SCENARIOS
from smoke_simulator_launch import SmokeFailure


def receipt(scenario='set-en'):
    locale = scenario[-2:]
    direction = 'ltr' if locale == 'en' else 'rtl'
    return {'token': 'current-token', 'pid': 456, 'scenario': scenario,
            'gameReady': True, 'migrationComplete': True, 'nativeLocale': locale,
            'initialNativeLocale': locale, 'nativeBridgeMessages': 1, 'nativeDirection': direction,
            'nativeRetryText': 'Try again' if locale == 'en' else 'إعادة المحاولة',
            'rendered': {'lang': locale, 'dir': direction, 'homeDir': direction, 'navDir': direction,
                         'settingsLabel': ('Interface language' if locale == 'en' else 'لغة الواجهة') if scenario.startswith('set-') else None,
                         'navigation': ['Play', 'Friends', 'Store', 'Me'] if locale == 'en' else ['العب', 'الأصدقاء', 'المتجر', 'أنا'],
                         'games': [{'id': key, 'label': label} for key, label in GAMES[locale].items()]}}


class LocaleSmokeTests(unittest.TestCase):
    def test_all_four_actual_shapes_pass(self):
        for scenario in SCENARIOS:
            LocaleSmoke.validate_locale(receipt(scenario), 'current-token', 456, scenario)

    def test_each_identity_native_and_rendered_requirement_is_independent(self):
        for scope, key, invalid in [('top', 'token', 'old-token'), ('top', 'pid', 455), ('top', 'pid', True),
                                   ('top', 'scenario', 'retain-en'), ('top', 'gameReady', False), ('top', 'migrationComplete', False),
                                   ('top', 'nativeLocale', 'ar'), ('top', 'nativeDirection', 'rtl'), ('top', 'nativeBridgeMessages', 0),
                                   ('top', 'nativeBridgeMessages', True), ('top', 'nativeRetryText', 'إعادة المحاولة'),
                                   ('rendered', 'lang', 'ar'), ('rendered', 'dir', 'rtl'), ('rendered', 'homeDir', 'rtl'),
                                   ('rendered', 'navDir', 'rtl'), ('rendered', 'settingsLabel', 'لغة الواجهة'),
                                   ('rendered', 'navigation', ['العب', 'Friends', 'Store', 'Me']), ('rendered', 'games', [])]:
            with self.subTest(scope=scope, key=key, invalid=invalid):
                value = receipt()
                (value if scope == 'top' else value['rendered'])[key] = invalid
                with self.assertRaises(SmokeFailure):
                    LocaleSmoke.validate_locale(value, 'current-token', 456, 'set-en')

    def test_missing_duplicate_or_arabic_game_label_cannot_pass(self):
        for change in ('missing', 'duplicate', 'arabic'):
            value = receipt()
            if change == 'missing':
                value['rendered']['games'].pop()
            elif change == 'duplicate':
                value['rendered']['games'][-1] = copy.deepcopy(value['rendered']['games'][0])
            else:
                value['rendered']['games'][0]['label'] = 'ارسمها'
            with self.assertRaises(SmokeFailure):
                LocaleSmoke.validate_locale(value, 'current-token', 456, 'set-en')

    def test_retention_must_precede_bridge_and_cannot_use_a_settings_change(self):
        for scenario in ('retain-ar', 'retain-en'):
            for key, invalid in [('initialNativeLocale', 'en' if scenario.endswith('ar') else 'ar'), ('settingsLabel', 'changed')]:
                value = receipt(scenario)
                (value['rendered'] if key == 'settingsLabel' else value)[key] = invalid
                with self.assertRaises(SmokeFailure):
                    LocaleSmoke.validate_locale(value, 'current-token', 456, scenario)

    def test_fresh_process_sequence_preserves_data_and_restores_environment(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {'SIMCTL_CHILD_MAYDAN_SIMULATOR_LOCALE': 'prior'}):
            root = Path(temporary)
            smoke = LocaleSmoke(root / 'Maydan.app', root / 'evidence')
            smoke.prepare = lambda: setattr(smoke, 'data_container', root)
            smoke.finish = Mock()
            order = []
            def launch(name, duration):
                self.assertEqual(os.environ['SIMCTL_CHILD_MAYDAN_SIMULATOR_LOCALE'], name)
                self.assertEqual(duration, 15)
                smoke.report['launches'].append({'name': name, 'pid': 456 + len(order), 'launchToken': name})
                order.append(('launch', name))
            smoke.launch = launch
            smoke.read_locale = lambda record, scenario: receipt(scenario)
            smoke.screenshot = Mock()
            smoke.terminate_for_relaunch = lambda: order.append(('terminate', smoke.report['launches'][-1]['name']))
            self.assertEqual(smoke.run(), 0)
            self.assertEqual(order, [action for scenario in SCENARIOS for action in [('launch', scenario), ('terminate', scenario)]])
            self.assertEqual(os.environ['SIMCTL_CHILD_MAYDAN_SIMULATOR_LOCALE'], 'prior')
            self.assertFalse(smoke.report['storageSeeded'])
            self.assertTrue(smoke.report['sameInstalledAppAndData'])
            smoke.finish.assert_called_once()

    def test_failure_never_advances_to_a_retention_claim(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            root = Path(temporary)
            smoke = LocaleSmoke(root / 'Maydan.app', root / 'evidence')
            smoke.prepare = lambda: setattr(smoke, 'data_container', root)
            smoke.finish = Mock()
            smoke.launch = Mock(side_effect=SmokeFailure('Failed genuine home readiness'))
            smoke.read_locale = Mock()
            self.assertEqual(smoke.run(), 1)
            self.assertFalse(smoke.report['passed'])
            smoke.read_locale.assert_not_called()
            self.assertNotIn('SIMCTL_CHILD_MAYDAN_SIMULATOR_LOCALE', os.environ)


if __name__ == '__main__':
    unittest.main()
