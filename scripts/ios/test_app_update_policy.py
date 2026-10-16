"""Execute the production Swift policy decisions, not a mirrored implementation."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class AppUpdatePolicyTests(unittest.TestCase):
    def test_compiled_swift_policy_decisions(self):
        compiler = shutil.which('swiftc')
        if not compiler and sys.platform != 'darwin':
            self.skipTest('Swift compiler is unavailable on this host; macOS release CI must run these decisions.')
        self.assertIsNotNone(compiler, 'The macOS release gate requires swiftc.')
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / ('policy-tests.exe' if sys.platform == 'win32' else 'policy-tests')
            result = subprocess.run([compiler, str(root / 'ios/Maydan/AppUpdatePolicy.swift'),
                                     str(root / 'tests/ios/AppUpdatePolicyTests.swift'), '-o', str(binary)],
                                    capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('native app-update decisions', result.stdout)
            print(result.stdout.strip())


if __name__ == '__main__':
    unittest.main()
