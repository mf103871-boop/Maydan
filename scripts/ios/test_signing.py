"""Pure signing checks run on Windows/Linux too; these do not sign an app."""
import copy
import datetime
import hashlib
import unittest

from signing import BUNDLE_ID, TEAM_ID, export_options, validate_inputs, validate_profile


class SigningChecks(unittest.TestCase):
    def setUp(self):
        self.env = dict(IOS_VERSION='1.5', IOS_BUILD='2', IOS_UPLOAD='false',
                        IOS_DISTRIBUTION_P12_BASE64='placeholder', IOS_DISTRIBUTION_P12_PASSWORD='placeholder',
                        IOS_APP_STORE_PROFILE_BASE64='placeholder')
        self.identity = dict(bundleId=BUNDLE_ID, teamId=TEAM_ID)
        self.certificate = b'unit test certificate bytes, not a credential'
        self.fingerprint = hashlib.sha1(self.certificate).hexdigest().upper()
        self.identities = f'1) {self.fingerprint} "Apple Distribution: Test Name ({TEAM_ID})"\n'
        self.profile = dict(
            UUID='12345678-1234-1234-1234-123456789012', TeamIdentifier=[TEAM_ID],
            ApplicationIdentifierPrefix=['OLDPREFIX1'], Platform=['iOS'],
            DeveloperCertificates=[self.certificate], ExpirationDate=datetime.datetime(2099, 1, 1),
            Entitlements={
                'application-identifier': 'OLDPREFIX1.Maydan',
                'com.apple.developer.team-identifier': TEAM_ID,
                'get-task-allow': False, 'beta-reports-active': True,
                'com.apple.developer.applesignin': ['Default'],
            },
        )

    def test_explicit_inputs_and_upload_secrets(self):
        validate_inputs(self.env, self.identity)
        self.env['IOS_UPLOAD'] = 'true'
        with self.assertRaisesRegex(ValueError, 'Missing GitHub secrets: ASC_KEY_ID'):
            validate_inputs(self.env, self.identity)
        self.env.update(ASC_KEY_ID='ABCDE12345', ASC_ISSUER_ID=self.profile['UUID'], ASC_PRIVATE_KEY_BASE64='placeholder')
        validate_inputs(self.env, self.identity)

    def test_invalid_or_missing_build_values_and_identity_are_rejected(self):
        for field, value in [('IOS_BUILD', ''), ('IOS_BUILD', '0'), ('IOS_BUILD', '1;whoami'),
                             ('IOS_VERSION', '1.5\nNEXT=value'), ('IOS_UPLOAD', '')]:
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_inputs({**self.env, field: value}, self.identity)
        with self.assertRaises(ValueError):
            validate_inputs(self.env, {**self.identity, 'bundleId': 'another-app'})

    def test_profile_matches_certificate_and_preserves_legacy_app_prefix(self):
        self.assertEqual(validate_profile(self.profile, self.identities), (self.profile['UUID'], self.fingerprint))
        with self.assertRaisesRegex(ValueError, 'P12'):
            validate_profile(self.profile, self.identities.replace(self.fingerprint, 'A' * 40))

    def test_wrong_team_app_capability_and_profile_type_are_rejected(self):
        mutations = [
            ('TeamIdentifier', ['OTHERTEAM1']), ('ProvisionedDevices', ['device']), ('ProvisionsAllDevices', True),
            ('ExpirationDate', datetime.datetime(2000, 1, 1)), ('UUID', '../bad'),
        ]
        for key, value in mutations:
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_profile({**self.profile, key: value}, self.identities)
        for key, value in [('application-identifier', 'OLDPREFIX1.*'), ('get-task-allow', True),
                           ('com.apple.developer.applesignin', []), ('com.apple.developer.team-identifier', 'OTHERTEAM1')]:
            profile = copy.deepcopy(self.profile)
            profile['Entitlements'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_profile(profile, self.identities)

    def test_export_is_local_by_default_and_never_allocates_build_numbers(self):
        options = export_options(self.profile['UUID'], self.fingerprint)
        self.assertEqual(options['destination'], 'export')
        self.assertIs(options['manageAppVersionAndBuildNumber'], False)
        self.assertEqual(options['provisioningProfiles'], {BUNDLE_ID: self.profile['UUID']})
        self.assertEqual(export_options(self.profile['UUID'], self.fingerprint, 'upload')['destination'], 'upload')


if __name__ == '__main__':
    unittest.main()
