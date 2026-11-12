import hashlib
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
import zipfile

from verify_release_features import PreparedBundle, expected_warmth, verify, verify_localization
from verify_runtime_dependencies import Bundle


class ReleaseFeaturesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='maydan-release-features-')
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / 'Maydan.app'
        self.env = {'IOS_VERSION': '1.9', 'IOS_BUILD': '57', 'GITHUB_SHA': 'a' * 40}
        self.origin = 'https://maydan-game.mf103871.workers.dev'
        self.write('Info.plist', plistlib.dumps({'CFBundleIdentifier': 'Maydan', 'CFBundleShortVersionString': '1.9', 'CFBundleVersion': '57'}))
        native = {'apiOrigin': self.origin}
        self.write('www/native-config.json', json.dumps(native).encode())
        self.write('www/index.html', b'<html>prepared</html>')
        self.write('www/audio/selected/music.m4a', b'synthetic-unit-test-audio')
        files = ['www/index.html', 'www/native-config.json', 'www/audio/selected/music.m4a']
        self.receipt = {
            'schemaVersion': 1, 'sourceCommit': 'a' * 40, 'version': '1.9', 'build': '57',
            'profile': 'compatibility', 'environment': 'production', 'apiOrigin': self.origin, 'gameplayPolicy': None,
            'compileDefines': {'__MAYDAN_ROOMS_URL__': json.dumps(self.origin), '__MAYDAN_GAMEPLAY_POLICY__': 'null',
                               '__MAYDAN_REWARDED_PREVIEW__': 'false', '__MAYDAN_AUDIO_PREVIEW__': 'false', '__MAYDAN_WARMTH_PREVIEW__': 'false'},
            'rewarded': {'mode': 'off', 'sdkProjectConfigured': False, 'configuration': None, 'packages': []},
            'audio': {'mode': 'standard', 'privatePreview': False, 'warmthPreview': False,
                      'bundledSelectedAudio': {'musicURL': 'audio/selected/music.m4a'},
                      'activeIntro': {'id': 'synthetic', 'url': 'audio/selected/music.m4a',
                                      'sha256': hashlib.sha256(self.read('www/audio/selected/music.m4a')).hexdigest(), 'seconds': 1}},
            'resources': [{'path': name, 'bytes': len(self.read(name)), 'sha256': hashlib.sha256(self.read(name)).hexdigest()} for name in files],
        }
        self.save_receipt()

    def write(self, name, data):
        target = self.app / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def read(self, name):
        return (self.app / name).read_bytes()

    def save_receipt(self):
        self.write('www/release-features.json', json.dumps(self.receipt).encode())

    def verify_app(self, env=None):
        bundle = Bundle(self.app)
        try:
            return verify(bundle, self.env if env is None else env)
        finally:
            bundle.close()

    def add_localization(self):
        packs = []
        for identity in ['ui', 'badeeha', 'beep', 'fabraka', 'jabeen', 'mamnoo', 'meenfina']:
            kind = 'ui' if identity == 'ui' else 'game'
            version = 'ui-en-v1' if identity == 'ui' else 'new-en'
            name = f'www/assets/brand/locale-en-{identity}-TEST1234.json'
            payload = {'schemaVersion': 1, 'id': identity, 'kind': kind, 'contentLocale': 'en',
                       'contentVersion': version, 'data': {'test': 'content'} if identity in ('ui', 'fabraka') else ['content']}
            data = json.dumps(payload).encode()
            self.write(name, data)
            evidence = {'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
            self.receipt['resources'].append(evidence)
            packs.append({'id': identity, 'kind': kind, 'contentLocale': 'en', 'contentVersion': version, **evidence})
        self.receipt['localization'] = {'schemaVersion': 1, 'uiLocales': ['ar', 'en'],
                                        'contentVersions': {'ar': 'legacy-ar', 'en': 'new-en'},
                                        'publicPacks': packs, 'privateContent': 'server-only'}
        html = self.read('www/index.html') + '\n'.join(Path(pack['path']).name for pack in packs).encode()
        self.write('www/index.html', html)
        self.receipt['resources'][0] = {'path': 'www/index.html', 'bytes': len(html), 'sha256': hashlib.sha256(html).hexdigest()}
        self.save_receipt()

    def test_same_receipt_verifies_prepared_app_and_exported_ipa(self):
        self.add_localization()
        self.assertEqual(verify(PreparedBundle(self.app), self.env, prepared=True)['build'], '57')
        self.assertEqual(self.verify_app()['version'], '1.9')
        ipa = Path(self.temp.name) / 'Maydan.ipa'
        with zipfile.ZipFile(ipa, 'w') as archive:
            for file in self.app.rglob('*'):
                if file.is_file():
                    archive.write(file, 'Payload/Maydan.app/' + file.relative_to(self.app).as_posix())
        with_bundle = Bundle(ipa)
        try:
            self.assertEqual(verify(with_bundle, self.env)['sourceCommit'], self.env['GITHUB_SHA'])
        finally:
            with_bundle.close()

    def test_complete_preview_requires_localization_even_when_legacy_compatibility_does_not(self):
        self.assertEqual(verify(PreparedBundle(self.app), self.env, prepared=True)['profile'], 'compatibility')
        env = {**self.env, 'IOS_RELEASE_PROFILE': 'complete-preview', 'IOS_RELEASE_ENVIRONMENT': 'mafia-preview',
               'MAYDAN_PRIVATE_AUDIO_PREVIEW': '1', 'MAYDAN_WARMTH_PREVIEW': '1',
               'MAYDAN_GAMEPLAY_ACCESS_POLICY': 'game-entry-ticket-v2', 'IOS_REWARDED_MODE': 'testflight-owned'}
        with self.assertRaisesRegex(ValueError, 'localization receipt'):
            verify(PreparedBundle(self.app), env, prepared=True)

    def test_localization_requires_exact_public_ids_versions_and_resource_evidence(self):
        self.add_localization()
        original = json.loads(json.dumps(self.receipt))
        changes = [
            lambda value: value['localization']['publicPacks'].pop(),
            lambda value: value['localization']['publicPacks'][0].update({'id': 'ersomha'}),
            lambda value: value['localization']['publicPacks'][0].update({'id': 'badeeha'}),
            lambda value: value['localization']['publicPacks'][0].update({'contentVersion': 'new-en'}),
            lambda value: value['localization']['publicPacks'][1].update({'kind': 'ui'}),
            lambda value: value['localization']['publicPacks'][1].update({'contentLocale': 'ar'}),
            lambda value: value['localization']['publicPacks'][1].update({'path': 'www/../private.json'}),
            lambda value: value['localization'].update({'uiLocales': ['en']}),
            lambda value: value['localization'].update({'contentVersions': {'ar': 'changed', 'en': 'new-en'}}),
            lambda value: value['localization'].update({'privateContent': 'public'}),
            lambda value: value['resources'].pop(),
        ]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                self.receipt = json.loads(json.dumps(original)); change(self.receipt)
                with self.assertRaises(ValueError):
                    verify_localization(PreparedBundle(self.app), self.receipt, required=True)

    def test_localization_checks_actual_bytes_and_rejects_stale_or_private_pack_files(self):
        self.add_localization()
        pack = self.receipt['localization']['publicPacks'][0]
        original = self.read(pack['path'])
        self.write(pack['path'], b'replaced')
        with self.assertRaisesRegex(ValueError, 'Actual English pack differs'):
            self.verify_app()
        self.write(pack['path'], original)
        for filename in ['locale-en-ui-OLDHASH.json', 'locale-en-ersomha-PRIVATE.json']:
            name = 'www/assets/brand/' + filename
            self.write(name, original)
            with self.assertRaisesRegex(ValueError, 'inventory contains'):
                self.verify_app()
            (self.app / name).unlink()

    def test_rehashed_wrong_locale_envelope_or_data_cannot_pass_and_html_must_reference_each_pack(self):
        self.add_localization()
        pack = self.receipt['localization']['publicPacks'][0]
        original = self.read(pack['path'])
        for change in [{'contentLocale': 'ar'}, {'contentVersion': 'wrong'}, {'kind': 'game'},
                       {'data': []}, {'data': {}}, {'id': 'ersomha'}]:
            payload = json.loads(original); payload.update(change)
            data = json.dumps(payload).encode(); self.write(pack['path'], data)
            pack.update({'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
            at = next(i for i, resource in enumerate(self.receipt['resources']) if resource['path'] == pack['path'])
            self.receipt['resources'][at] = {key: pack[key] for key in ('path', 'bytes', 'sha256')}
            with self.assertRaisesRegex(ValueError, 'Actual English pack (envelope|data)'):
                verify_localization(PreparedBundle(self.app), self.receipt, required=True)
        self.write(pack['path'], original)
        self.write('www/index.html', b'<html>no locale URLs</html>')
        with self.assertRaisesRegex(ValueError, 'does not reference'):
            verify_localization(PreparedBundle(self.app), self.receipt, required=True)

    def test_replaced_html_audio_or_api_cannot_reuse_prepared_evidence(self):
        for name in ['www/index.html', 'www/audio/selected/music.m4a', 'www/native-config.json']:
            original = self.read(name)
            self.write(name, b'changed')
            with self.assertRaises((ValueError, json.JSONDecodeError)):
                self.verify_app()
            self.write(name, original)

    def test_wrong_inputs_version_or_binary_ads_are_rejected(self):
        for changed in [{'MAYDAN_GAMEPLAY_ACCESS_POLICY': 'trial-ticket-v1'}, {'MAYDAN_WARMTH_PREVIEW': '1'},
                        {'IOS_RELEASE_PROFILE': 'complete-preview'}, {'IOS_VERSION': '1.8'}, {'IOS_BUILD': '56'},
                        {'GITHUB_SHA': 'b' * 40}, {'IOS_RELEASE_ENVIRONMENT': 'mafia-preview'}]:
            with self.assertRaises(ValueError):
                self.verify_app({**self.env, **changed})
        self.write('Info.plist', plistlib.dumps({'CFBundleIdentifier': 'Maydan', 'CFBundleShortVersionString': '1.9',
                                               'CFBundleVersion': '57', 'GADApplicationIdentifier': 'unexpected'}))
        with self.assertRaisesRegex(ValueError, 'Rewarded settings'):
            self.verify_app()

    def test_resource_inventory_cannot_skip_core_music_or_escape_bundle(self):
        original = json.loads(json.dumps(self.receipt))
        for changed in [[], self.receipt['resources'][:2], self.receipt['resources'] + [self.receipt['resources'][0]],
                        [{**self.receipt['resources'][0], 'path': 'www/../private.json'}] + self.receipt['resources'][1:]]:
            self.receipt['resources'] = changed
            self.save_receipt()
            with self.assertRaises(ValueError):
                self.verify_app()
            self.receipt = json.loads(json.dumps(original))

    def test_entry_policy_requires_complete_game_coverage_and_the_actual_bundled_gate(self):
        policy = 'game-entry-ticket-v2'
        env = {**self.env, 'MAYDAN_GAMEPLAY_ACCESS_POLICY': policy, 'IOS_REWARDED_MODE': 'live'}
        native = {'apiOrigin': self.origin, 'rewarded': {'mode': 'live', 'appId': 'fixture', 'adUnit': 'fixture'}}
        self.write('www/native-config.json', json.dumps(native).encode())
        art = json.loads((Path(__file__).resolve().parents[2] / 'assets/game-entry/manifest.json').read_text(encoding='utf-8'))
        self.write('www/' + art['url'], (Path(__file__).resolve().parents[2] / 'public' / art['url']).read_bytes())
        self.write('www/index.html', ('<main data-maydan-game-entry data-maydan-ticket-ui="' + art['id'] + '">' + policy + '</main>').encode())
        artwork = {'path': 'www/' + art['url'], 'bytes': art['bytes'], 'sha256': art['sha256']}
        self.receipt['resources'].append(artwork)
        self.receipt.update({
            'gameplayPolicy': policy,
            'gameEntry': {'policy': policy, 'surface': 'game-entry', 'consumption': 'match-start',
                          'games': ['badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina', 'ersomha', 'mafia'],
                          'ui': art['id'], 'artwork': artwork},
            'rewarded': {'mode': 'live', 'sdkProjectConfigured': True, 'configuration': native['rewarded'],
                         'packages': [{'identity': name} for name in ['swift-package-manager-google-mobile-ads',
                                                                    'swift-package-manager-google-user-messaging-platform']]},
        })
        self.receipt['compileDefines'].update({'__MAYDAN_GAMEPLAY_POLICY__': json.dumps(policy),
                                              '__MAYDAN_REWARDED_PREVIEW__': 'true'})

        def save_current_resources():
            self.receipt['resources'] = [{'path': entry['path'], 'bytes': len(self.read(entry['path'])),
                                          'sha256': hashlib.sha256(self.read(entry['path'])).hexdigest()}
                                         for entry in self.receipt['resources']]
            self.save_receipt()

        save_current_resources()
        self.assertEqual(verify(PreparedBundle(self.app), env, prepared=True)['gameEntry']['consumption'], 'match-start')
        original_ui = self.receipt['gameEntry'].pop('ui')
        self.save_receipt()
        with self.assertRaisesRegex(ValueError, 'designed ticket screen'):
            verify(PreparedBundle(self.app), env, prepared=True)
        self.receipt['gameEntry']['ui'] = original_ui
        self.receipt['gameEntry']['games'].pop()
        self.save_receipt()
        with self.assertRaisesRegex(ValueError, 'coverage differs'):
            verify(PreparedBundle(self.app), env, prepared=True)
        self.receipt['gameEntry']['games'].append('mafia')
        self.write('www/index.html', ('<main>' + policy + '</main>').encode())
        save_current_resources()
        with self.assertRaisesRegex(ValueError, 'before-mode entry gate'):
            verify(PreparedBundle(self.app), env, prepared=True)

    def test_warmth_verifier_rejects_receipt_omissions_and_unreferenced_files_against_pinned_source(self):
        manifest = expected_warmth()
        self.assertEqual(len(manifest['files']), 14)
        env = {**self.env, 'IOS_RELEASE_ENVIRONMENT': 'mafia-preview', 'MAYDAN_PRIVATE_AUDIO_PREVIEW': '1',
               'MAYDAN_WARMTH_PREVIEW': '1', 'IOS_REWARDED_MODE': 'testflight-owned'}
        native = {'apiOrigin': 'https://maydan-mafia-preview.mf103871.workers.dev',
                  'rewarded': {'mode': 'testflight-owned', 'appId': 'fixture', 'adUnit': 'fixture'}}
        self.write('www/native-config.json', json.dumps(native).encode())
        self.receipt.update({'environment': 'mafia-preview', 'apiOrigin': native['apiOrigin'],
                             'rewarded': {'mode': 'testflight-owned', 'sdkProjectConfigured': True, 'configuration': native['rewarded'],
                                          'packages': [{'identity': name} for name in ['swift-package-manager-google-mobile-ads', 'swift-package-manager-google-user-messaging-platform']]}})
        self.receipt['compileDefines'].update({'__MAYDAN_ROOMS_URL__': json.dumps(native['apiOrigin']),
                                              '__MAYDAN_AUDIO_PREVIEW__': 'true', '__MAYDAN_WARMTH_PREVIEW__': 'true',
                                              '__MAYDAN_REWARDED_PREVIEW__': 'true'})
        intro = manifest['runtimePack']['assets']['music-bossa']
        self.receipt['audio'].update({'mode': 'warmth-private-preview', 'privatePreview': True, 'warmthPreview': True,
                                      'activeHome': 'warmth-long',
                                      'activeIntro': {'id': intro['id'], 'url': 'audio-warmth-preview/' + intro['file']['url'],
                                                      'sha256': intro['file']['sha256'], 'seconds': intro['file']['durationSeconds']},
                                      'warmth': {'productionApproved': False, 'runtimePackSHA256': manifest['runtimePackSHA256'],
                                                 'sourceManifestSHA256': manifest['sourceManifestSHA256']}})
        files = [{'path': 'www/audio-warmth-preview/' + entry['url'], 'bytes': entry['bytes'], 'sha256': entry['sha256']}
                 for entry in manifest['files']]
        self.receipt['resources'] += files[1:]
        self.save_receipt()
        with self.assertRaisesRegex(ValueError, 'all fourteen'):
            verify(PreparedBundle(self.app), env, prepared=True)
        self.receipt['resources'] += files[:1]
        self.save_receipt()
        with self.assertRaisesRegex(ValueError, 'does not reference'):
            verify(PreparedBundle(self.app), env, prepared=True)
        self.write('www/index.html', '\n'.join(Path(entry['url']).name for entry in manifest['files']).encode())
        self.receipt['audio']['activeIntro']['seconds'] = 480
        self.save_receipt()
        with self.assertRaisesRegex(ValueError, 'introduction differs'):
            verify(PreparedBundle(self.app), env, prepared=True)


if __name__ == '__main__':
    unittest.main()
