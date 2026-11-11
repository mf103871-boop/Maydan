"""Verify the prepared receipt against the actual .app or exported IPA bytes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re

from verify_runtime_dependencies import Bundle, require
from verify_rewarded_bundle import verify as verify_rewarded

ORIGINS = {
    'production': 'https://maydan-game.mf103871.workers.dev',
    'mafia-preview': 'https://maydan-mafia-preview.mf103871.workers.dev',
}
WARMTH_RUNTIME_SHA256 = '7286f0eee8f45affac5701c502766ddbe9b64ea2669f42675a138768f9ec1940'
WARMTH_SOURCE_SHA256 = '26a1737edc78602489fc7a746c1ee199d65066614312b621648da24f1f207c56'
TICKET_POLICIES = ('trial-ticket-v1', 'game-entry-ticket-v2')
ENTRY_GAMES = {'badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina', 'ersomha', 'mafia'}


def expected_warmth():
    source = Path(__file__).resolve().parents[2] / 'assets/audio-warmth-preview/manifest.json'
    manifest = json.loads(source.read_text(encoding='utf-8'))
    runtime = json.dumps(manifest['runtimePack'], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    require(manifest.get('runtimePackSHA256') == WARMTH_RUNTIME_SHA256
            == hashlib.sha256(runtime).hexdigest() and manifest.get('sourceManifestSHA256') == WARMTH_SOURCE_SHA256
            and len(manifest['files']) == 14, 'Source Warmth inventory fingerprint differs')
    return manifest


class PreparedBundle:
    def __init__(self, path):
        self.path = Path(path).resolve()

    def read(self, name):
        target = (self.path / name).resolve()
        require(target.is_relative_to(self.path) and target.is_file(), 'Missing prepared bundle resource')
        return target.read_bytes()


def verify(bundle, env, prepared=False):
    receipt = json.loads(bundle.read('www/release-features.json'))
    require(receipt.get('schemaVersion') == 1, 'Unknown release feature receipt schema')
    environment = env.get('IOS_RELEASE_ENVIRONMENT') or 'production'
    profile = env.get('IOS_RELEASE_PROFILE') or 'compatibility'
    policy = env.get('MAYDAN_GAMEPLAY_ACCESS_POLICY') or 'free'
    mode = env.get('IOS_REWARDED_MODE') or 'off'
    private = env.get('MAYDAN_PRIVATE_AUDIO_PREVIEW') == '1'
    warmth = env.get('MAYDAN_WARMTH_PREVIEW') == '1'
    require(environment in ORIGINS and profile in ('compatibility', 'complete-preview')
            and policy in ('free', *TICKET_POLICIES), 'Invalid release feature input')
    require(mode in ('off', 'testflight', 'testflight-owned', 'live')
            and (policy == 'free' or mode != 'off'), 'Ticket policy requires configured ads')
    require(not private or environment == 'mafia-preview', 'Private audio requires isolation')
    require(not warmth or private, 'Warmth requires private audio')
    require(profile != 'complete-preview' or environment == 'mafia-preview' and private and warmth
            and policy in TICKET_POLICIES and mode == 'testflight-owned', 'Incomplete complete-preview profile')
    native = json.loads(bundle.read('www/native-config.json'))
    require(receipt.get('environment') == environment and receipt.get('apiOrigin') == ORIGINS[environment]
            == native.get('apiOrigin') and receipt.get('profile') == profile,
            'Prepared API or profile differs from the release inputs')
    expected_policy = None if policy == 'free' else policy
    require(receipt.get('gameplayPolicy') == expected_policy, 'Prepared gameplay policy differs')
    if policy == 'game-entry-ticket-v2':
        entry = receipt.get('gameEntry', {})
        require(entry.get('policy') == policy and entry.get('surface') == 'game-entry'
                and entry.get('consumption') == 'match-start' and len(entry.get('games', [])) == 8
                and set(entry['games']) == ENTRY_GAMES, 'Prepared entry gate coverage differs')
        html = bundle.read('www/index.html')
        require(b'data-maydan-game-entry' in html and policy.encode() in html,
                'The actual bundle does not contain the before-mode entry gate')
        art = json.loads((Path(__file__).resolve().parents[2] / 'assets/game-entry/manifest.json').read_text(encoding='utf-8'))
        expected_art = {'path': 'www/' + art['url'], 'bytes': art['bytes'], 'sha256': art['sha256']}
        require(entry.get('ui') == art['id'] and entry.get('artwork') == expected_art
                and expected_art in receipt.get('resources', [])
                and b'data-maydan-ticket-ui' in html and art['id'].encode() in html,
                'The designed ticket screen or its artwork evidence differs')
    expected_defines = {
        '__MAYDAN_ROOMS_URL__': json.dumps(ORIGINS[environment]),
        '__MAYDAN_GAMEPLAY_POLICY__': json.dumps(expected_policy),
        '__MAYDAN_REWARDED_PREVIEW__': json.dumps(mode != 'off'),
        '__MAYDAN_AUDIO_PREVIEW__': json.dumps(private),
        '__MAYDAN_WARMTH_PREVIEW__': json.dumps(warmth),
    }
    require(receipt.get('compileDefines') == expected_defines, 'Prepared compile definitions differ')
    ads = receipt.get('rewarded', {})
    require(ads.get('mode') == mode and ads.get('sdkProjectConfigured') is (mode != 'off')
            and ads.get('configuration') == native.get('rewarded'), 'Prepared native ads differ')
    packages = ads.get('packages', [])
    expected_packages = {'swift-package-manager-google-mobile-ads', 'swift-package-manager-google-user-messaging-platform'} if mode != 'off' else set()
    require(len(packages) == len(expected_packages) and {item.get('identity') for item in packages} == expected_packages,
            'Prepared advertising SDK package inventory differs')
    audio = receipt.get('audio', {})
    expected_audio = 'warmth-private-preview' if warmth else 'private-candidates' if private else 'standard'
    require(audio.get('mode') == expected_audio and audio.get('privatePreview') is private
            and audio.get('warmthPreview') is warmth, 'Prepared audio selection differs')
    require(not warmth or audio.get('activeHome') == 'warmth-long'
            and audio.get('warmth', {}).get('productionApproved') is False,
            'Warmth preview identity or approval differs')
    if env.get('GITHUB_SHA'):
        require(receipt.get('sourceCommit') == env['GITHUB_SHA'], 'Prepared source commit differs')
    if env.get('IOS_VERSION'):
        require(receipt.get('version') == env['IOS_VERSION'], 'Prepared app version differs')
    require(receipt.get('build') == (env.get('IOS_BUILD') or None), 'Prepared build number differs')
    resources = receipt.get('resources', [])
    require(isinstance(resources, list) and 2 <= len(resources) <= 128, 'Invalid feature resource inventory')
    if warmth:
        manifest = expected_warmth()
        require(audio.get('warmth', {}).get('runtimePackSHA256') == WARMTH_RUNTIME_SHA256
                and audio['warmth'].get('sourceManifestSHA256') == WARMTH_SOURCE_SHA256,
                'Bundled Warmth runtime fingerprint differs')
        expected = [{'path': 'www/audio-warmth-preview/' + entry['url'], 'sha256': entry['sha256'], 'bytes': entry['bytes']}
                    for entry in manifest['files']]
        actual = [entry for entry in resources if entry.get('path', '').startswith('www/audio-warmth-preview/')]
        require(sorted(actual, key=lambda item: item['path']) == sorted(expected, key=lambda item: item['path']),
                'Bundled Warmth inventory must match all fourteen source files')
        html = bundle.read('www/index.html').decode('utf-8')
        require(all(Path(entry['url']).name in html for entry in manifest['files']),
                'Prepared HTML does not reference the complete Warmth inventory')
        intro = manifest['runtimePack']['assets']['music-bossa']
        require(audio.get('activeIntro') == {'id': intro['id'], 'url': 'audio-warmth-preview/' + intro['file']['url'],
                                           'sha256': intro['file']['sha256'], 'seconds': intro['file']['durationSeconds']},
                'Active Warmth introduction differs')
    seen = set()
    for entry in resources:
        name = entry.get('path', '')
        require(re.fullmatch(r'www/[A-Za-z0-9/_-]+\.(?:html|json|m4a|wav|mp3|ogg|webp)', name)
                and name not in seen and re.fullmatch(r'[a-f0-9]{64}', entry.get('sha256', '')),
                'Invalid or duplicate feature resource')
        seen.add(name)
        data = bundle.read(name)
        require(len(data) == entry.get('bytes') and hashlib.sha256(data).hexdigest() == entry['sha256'],
                f'Actual bundle resource differs from prepared receipt: {name}')
    require({'www/index.html', 'www/native-config.json'}.issubset(seen), 'Missing core feature resources')
    selected_music = audio.get('bundledSelectedAudio', {}).get('musicURL', '')
    require('www/' + selected_music in seen, 'Missing selected audio resource')
    active_intro = audio.get('activeIntro', {})
    require(any(entry['path'] == 'www/' + active_intro.get('url', '') and entry['sha256'] == active_intro.get('sha256')
                for entry in resources) and isinstance(active_intro.get('seconds'), (int, float)) and active_intro['seconds'] > 0,
            'Missing active introduction resource or duration')
    if not prepared:
        info = plistlib.loads(bundle.read('Info.plist'))
        require(info.get('CFBundleShortVersionString') == receipt.get('version')
                and info.get('CFBundleVersion') == receipt.get('build'), 'Actual binary version differs from prepared receipt')
        verify_rewarded(bundle, env)
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepared', action='store_true')
    parser.add_argument('bundle')
    args = parser.parse_args()
    bundle = PreparedBundle(args.bundle) if args.prepared else Bundle(args.bundle)
    try:
        receipt = verify(bundle, os.environ, args.prepared)
        print(json.dumps({'verified': True, 'sourceCommit': receipt['sourceCommit'], 'version': receipt['version'],
                          'build': receipt['build'], 'profile': receipt['profile'], 'gameplayPolicy': receipt['gameplayPolicy'],
                          'rewardedMode': receipt['rewarded']['mode'], 'audioMode': receipt['audio']['mode']}))
    finally:
        if not args.prepared:
            bundle.close()


if __name__ == '__main__':
    main()
