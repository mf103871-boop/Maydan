"""Compile production route/lease policy on macOS CI; Windows source tests do not replace it."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class DrawingOrientationPolicyTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('xcrun'), 'Requires the macOS Swift compiler')
    def test_production_lease_policy(self):
        with tempfile.TemporaryDirectory(prefix='maydan-drawing-orientation-') as folder:
            target = Path(folder) / 'orientation-policy'
            subprocess.run(['xcrun', 'swiftc', str(ROOT / 'ios/Maydan/DrawingOrientationPolicy.swift'),
                            str(ROOT / 'tests/native/drawing-orientation.swift'), '-o', str(target)], check=True, cwd=ROOT)
            subprocess.run([str(target)], check=True, cwd=ROOT)

if __name__ == '__main__':
    unittest.main()
