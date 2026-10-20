"""Compile and execute the production audio policy without UIKit or live calls."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    compiler = ["xcrun", "swiftc"] if sys.platform == "darwin" else ["swiftc"]
    if shutil.which(compiler[0]) is None:
        raise SystemExit("A Swift compiler is required for native audio policy checks.")
    with tempfile.TemporaryDirectory(prefix="maydan-audio-policy-") as folder:
        executable = Path(folder) / ("audio-policy.exe" if sys.platform == "win32" else "audio-policy")
        subprocess.run(compiler + [
            str(ROOT / "ios/Maydan/NativeAudioPolicy.swift"),
            str(ROOT / "tests/native/audio-policy.swift"),
            "-o", str(executable),
        ], check=True, cwd=ROOT)
        subprocess.run([str(executable)], check=True, cwd=ROOT)


if __name__ == "__main__":
    main()
