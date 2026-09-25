"""Validate release inputs/profile and write deterministic manual export options.

No Apple account is contacted here and no version/build number is allocated.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import sys

BUNDLE_ID = 'Maydan'
TEAM_ID = '96WJBK2MB2'
UUID = r'[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_inputs(env, identity):
    require(re.fullmatch(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?', env.get('IOS_VERSION', '')),
            'Provide an explicit version such as 1.5 or 1.5.0.')
    require(re.fullmatch(r'[1-9]\d{0,3}', env.get('IOS_BUILD', '')),
            'Provide an explicit unused build number from 1 through 9999.')
    require(env.get('IOS_UPLOAD') in ('true', 'false'), 'IOS_UPLOAD must explicitly be true or false.')
    require(identity.get('bundleId') == BUNDLE_ID and identity.get('teamId') == TEAM_ID,
            'App identity must remain Maydan / 96WJBK2MB2.')
    secrets = ['IOS_DISTRIBUTION_P12_BASE64', 'IOS_DISTRIBUTION_P12_PASSWORD', 'IOS_APP_STORE_PROFILE_BASE64']
    if env['IOS_UPLOAD'] == 'true':
        secrets += ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_PRIVATE_KEY_BASE64']
    missing = [name for name in secrets if not env.get(name, '').strip()]
    require(not missing, 'Missing GitHub secrets: ' + ', '.join(missing))
    if env['IOS_UPLOAD'] == 'true':
        require(re.fullmatch(r'[A-Z0-9]{10}', env['ASC_KEY_ID']), 'ASC_KEY_ID must be the App Store Connect team API key ID.')
        require(re.fullmatch(UUID, env['ASC_ISSUER_ID']), 'ASC_ISSUER_ID must be the App Store Connect issuer UUID.')


def validate_profile(profile, identities, now=None):
    entitlements = profile.get('Entitlements', {})
    require(TEAM_ID in profile.get('TeamIdentifier', [])
            and entitlements.get('com.apple.developer.team-identifier') == TEAM_ID,
            'The provisioning profile belongs to a different developer team.')
    # Legacy App ID prefixes may legitimately differ from the developer team ID.
    expected_ids = [prefix + '.' + BUNDLE_ID for prefix in profile.get('ApplicationIdentifierPrefix', [])]
    require(entitlements.get('application-identifier') in expected_ids,
            'The provisioning profile must target the explicit Maydan App ID.')
    require('ProvisionedDevices' not in profile and not profile.get('ProvisionsAllDevices')
            and entitlements.get('get-task-allow') is False
            and entitlements.get('beta-reports-active') is True,
            'Use an App Store distribution profile, not development, ad hoc, or enterprise.')
    require('iOS' in profile.get('Platform', []), 'An iOS provisioning profile is required.')
    require('Default' in entitlements.get('com.apple.developer.applesignin', []),
            'The provisioning profile must enable Sign in with Apple.')
    expires = profile.get('ExpirationDate')
    require(isinstance(expires, datetime.datetime), 'The provisioning profile has no expiration date.')
    expires = expires.replace(tzinfo=datetime.timezone.utc) if expires.tzinfo is None else expires
    require(expires > (now or datetime.datetime.now(datetime.timezone.utc)), 'The provisioning profile has expired.')
    uuid = profile.get('UUID', '')
    require(re.fullmatch(UUID, uuid), 'The provisioning profile UUID is invalid.')
    allowed = {hashlib.sha1(certificate).hexdigest().upper() for certificate in profile.get('DeveloperCertificates', [])}
    pattern = rf'\b([A-Fa-f0-9]{{40}}) "(?:Apple Distribution|iPhone Distribution): [^"\n]+ \({TEAM_ID}\)"'
    matches = [fingerprint.upper() for fingerprint in re.findall(pattern, identities) if fingerprint.upper() in allowed]
    require(bool(matches), 'The P12 must contain a valid distribution identity included in this provisioning profile.')
    return uuid, matches[0]


def export_options(uuid, certificate, destination='export'):
    require(destination in ('export', 'upload'), 'Unsupported export destination.')
    return {
        'method': 'app-store-connect', 'destination': destination,
        'teamID': TEAM_ID, 'signingStyle': 'manual', 'signingCertificate': certificate,
        'provisioningProfiles': {BUNDLE_ID: uuid},
        'manageAppVersionAndBuildNumber': False, 'uploadSymbols': True,
    }


def main():
    command = sys.argv[1]
    if command == 'preflight':
        identity = json.loads(Path('ios/app-store.json').read_text(encoding='utf-8'))
        validate_inputs(os.environ, identity)
        print('Release inputs and required secret names checked; build-number availability still requires App Store Connect review.')
    elif command == 'profile':
        folder = Path(sys.argv[2])
        profile = plistlib.loads((folder / 'profile.plist').read_bytes())
        uuid, certificate = validate_profile(profile, (folder / 'identities.txt').read_text())
        (folder / 'profile-uuid.txt').write_text(uuid, encoding='utf-8')
        for destination, filename in [('export', 'ExportOptions.plist'), ('upload', 'UploadOptions.plist')]:
            (folder / filename).write_bytes(plistlib.dumps(export_options(uuid, certificate, destination)))
        with open(os.environ['GITHUB_ENV'], 'a') as out:
            out.write(f'IOS_PROFILE_UUID={uuid}\nIOS_SIGNING_IDENTITY={certificate}\n')
        print('Distribution identity, profile, App ID and required capability verified.')
    elif command == 'archive':
        info = plistlib.loads(Path(sys.argv[2]).read_bytes())
        require(info.get('CFBundleIdentifier') == BUNDLE_ID, 'Archived bundle ID differs from Maydan.')
        require(info.get('CFBundleShortVersionString') == os.environ['IOS_VERSION'], 'Archived version differs from the explicit input.')
        require(info.get('CFBundleVersion') == os.environ['IOS_BUILD'], 'Archived build differs from the explicit input.')
        print('Archived app identity, version and build verified.')
    else:
        raise ValueError('Unsupported signing check.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError) as error:
        raise SystemExit(str(error)) from None
