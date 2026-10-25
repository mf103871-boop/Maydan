"""Execute the production migration watchdog with a deterministic clock."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    compiler = ['xcrun', 'swiftc'] if sys.platform == 'darwin' else ['swiftc']
    if shutil.which(compiler[0]) is None:
        raise SystemExit('A Swift compiler is required for storage migration policy checks.')
    with tempfile.TemporaryDirectory(prefix='maydan-storage-migration-') as directory:
        executable = Path(directory) / ('storage-migration.exe' if sys.platform == 'win32' else 'storage-migration')
        subprocess.run(compiler + [str(ROOT / 'ios/Maydan/StorageMigration.swift'),
            str(ROOT / 'tests/native/storage-migration.swift'), '-o', str(executable)], check=True, cwd=ROOT)
        subprocess.run([str(executable)], check=True, cwd=ROOT)


if __name__ == '__main__':
    main()
