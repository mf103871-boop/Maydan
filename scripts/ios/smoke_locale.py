#!/usr/bin/env python3
"""Verify real Settings language changes and fresh-process retention in Release WKWebView.

Four processes use the same installed app and data. Only finite UI actions are
injected; rendered labels, direction, native defaults and bridge counts are read.
This does not certify physical taps, the OS permission-sheet language or all UI.
"""
import argparse
import json
import os
from pathlib import Path
import time

from smoke_app_update_gate import UpdateGateSmoke
from smoke_simulator_launch import SmokeFailure


GAMES = {
    'ar': {'ersomha': 'ارسمها', 'mafia': 'مافيا ميدان', 'badeeha': 'بَديهة', 'beep': 'قبل ما يطق!',
           'mamnoo': 'ممنوع!', 'jabeen': 'على جبينك', 'fabraka': 'فَبْرَكة', 'meenfina': 'مين فينا؟'},
    'en': {'ersomha': 'Draw It', 'mafia': 'Mafia', 'badeeha': 'Badeeha', 'beep': 'Beat the Beep',
           'mamnoo': 'Forbidden', 'jabeen': 'Heads Up', 'fabraka': 'Fabraka', 'meenfina': 'Who Among Us?'},
}
SCENARIOS = ('set-en', 'retain-en', 'set-ar', 'retain-ar')


class LocaleSmoke(UpdateGateSmoke):
    requires_game_ready = True

    @staticmethod
    def validate_locale(value, token, pid, scenario):
        if scenario not in SCENARIOS or not isinstance(value, dict):
            raise SmokeFailure('Invalid locale scenario or receipt.')
        if (value.get('token') != token or type(value.get('pid')) is not int or value['pid'] != pid
                or value.get('scenario') != scenario):
            raise SmokeFailure('Locale evidence belongs to another launch, process or scenario.')
        locale = scenario[-2:]
        direction = 'ltr' if locale == 'en' else 'rtl'
        if (value.get('gameReady') is not True or value.get('migrationComplete') is not True
                or value.get('nativeLocale') != locale or value.get('nativeDirection') != direction
                or type(value.get('nativeBridgeMessages')) is not int or value['nativeBridgeMessages'] < 1
                or value.get('nativeRetryText') != ('Try again' if locale == 'en' else 'إعادة المحاولة')):
            raise SmokeFailure('Native locale, trusted bridge delivery or initialized game was not measured.')
        if scenario.startswith('retain-') and value.get('initialNativeLocale') != locale:
            raise SmokeFailure('Native language was not retained before the new WK process initialized.')
        rendered = value.get('rendered')
        if (not isinstance(rendered, dict) or rendered.get('lang') != locale
                or any(rendered.get(key) != direction for key in ('dir', 'homeDir', 'navDir'))):
            raise SmokeFailure('Actual document, home and navigation language/direction disagree.')
        expected_navigation = ['Play', 'Friends', 'Store', 'Me'] if locale == 'en' else ['العب', 'الأصدقاء', 'المتجر', 'أنا']
        if rendered.get('navigation') != expected_navigation:
            raise SmokeFailure('Rendered navigation labels do not match the selected language.')
        expected_settings = ('Interface language' if locale == 'en' else 'لغة الواجهة') if scenario.startswith('set-') else None
        if rendered.get('settingsLabel') != expected_settings:
            raise SmokeFailure('The actual Settings language control was not localized or retention mutated Settings.')
        games = rendered.get('games')
        if (not isinstance(games, list) or len(games) != 8
                or any(not isinstance(item, dict) or set(item) != {'id', 'label'}
                       or not isinstance(item['id'], str) or not isinstance(item['label'], str) for item in games)
                or {item['id']: item['label'] for item in games} != GAMES[locale]):
            raise SmokeFailure('The eight rendered game labels do not match the selected language.')

    def read_locale(self, record, scenario, timeout=20):
        path = self.data_container / 'Library/Caches/MaydanLaunchSmoke/locale.json'
        deadline = time.monotonic() + timeout
        last = 'No fresh native locale receipt.'
        while time.monotonic() < deadline:
            if not self.process_is_app(record['pid']):
                raise SmokeFailure('The exact app process exited during the locale scenario.')
            try:
                if path.stat().st_size > 16 * 1024:
                    raise SmokeFailure('Locale receipt exceeds its bounded size.')
                value = json.loads(path.read_text(encoding='utf-8'))
                self.validate_locale(value, record['launchToken'], record['pid'], scenario)
                (self.output / f'{scenario}-locale.json').write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                return value
            except (OSError, ValueError, SmokeFailure) as error:
                last = str(error)
            time.sleep(0.25)
        raise SmokeFailure(f'{scenario}: real locale verification failed: {last}')

    def run(self, prepared=None):
        variable = 'SIMCTL_CHILD_MAYDAN_SIMULATOR_LOCALE'
        previous = os.environ.pop(variable, None)
        try:
            if prepared is None:
                self.prepare()
            else:
                self.use_verified_simulator(prepared)
                self.data_container = prepared.data_container
            if self.data_container is None or not self.data_container.is_dir():
                raise SmokeFailure('Locale smoke requires the verified app data container.')
            self.report['localeScenarios'] = []
            for scenario in SCENARIOS:
                os.environ[variable] = scenario
                self.launch(scenario, 15)
                record = self.report['launches'][-1]
                value = self.read_locale(record, scenario)
                self.screenshot(scenario + '-verified')
                self.report['localeScenarios'].append({'scenario': scenario, 'pid': record['pid'],
                    'nativeLocale': value['nativeLocale'], 'documentLocale': value['rendered']['lang'], 'passed': True})
                self.terminate_for_relaunch()
            if len({item['pid'] for item in self.report['localeScenarios']}) != 4:
                raise SmokeFailure('Locale retention requires four distinct app processes.')
            self.report.update({'passed': True, 'sameInstalledAppAndData': True, 'storageSeeded': False,
                                'physicalDeviceTest': False, 'settingsActionsInjected': True})
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
    raise SystemExit(LocaleSmoke(args.app, args.output_dir).run())
