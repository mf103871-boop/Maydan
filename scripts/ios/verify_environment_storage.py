"""Execute the real native configuration's storage-origin contract; no Keychain IO."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    compiler = ['xcrun', 'swiftc'] if sys.platform == 'darwin' else ['swiftc']
    if shutil.which(compiler[0]) is None:
        raise SystemExit('A Swift compiler is required for native environment storage checks.')
    with tempfile.TemporaryDirectory(prefix='maydan-environment-storage-') as directory:
        executable = Path(directory) / ('environment-storage.exe' if sys.platform == 'win32' else 'environment-storage')
        subprocess.run(compiler + [str(ROOT / 'ios/Maydan/NativeConfig.swift'),
            str(ROOT / 'tests/native/environment-storage.swift'), '-o', str(executable)], check=True, cwd=ROOT)
        subprocess.run([str(executable)], check=True, cwd=ROOT)


if __name__ == '__main__':
    main()
