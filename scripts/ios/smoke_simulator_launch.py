#!/usr/bin/env python3
"""Launch a Release .app on a temporary iPhone simulator and retain diagnostics.

This checks startup survival, not UI correctness or physical-device behavior.
Run after the simulator build; upload --output-dir even when this command fails.
"""

import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import time
import uuid


class SmokeFailure(RuntimeError):
    pass


class LaunchSmoke:
    def __init__(self, app, output):
        self.app = app.resolve()
        self.output = output.resolve()
        self.output.mkdir(parents=True, exist_ok=True)
        self.device = None
        self.installed_app = None
        self.bundle = None
        self.executable = None
        self.pids = set()
        self.started = time.time()
        self.crashes = set()
        self.report = {
            "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "passed": False,
            "launches": [],
            "crashReports": [],
            "diagnosticWarnings": [],
            "limits": [
                "Checks simulator process survival and launch crash reports only.",
                "Does not certify rendered UI, device-only code, or exported IPA packaging.",
            ],
        }

    def command(self, args, *, timeout=45, label=None, check=True):
        try:
            result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            if label:
                self.save_output(label, error.stdout, error.stderr)
            raise SmokeFailure(f"Timed out after {timeout}s: {' '.join(args[:4])}") from error
        if label:
            self.save_output(label, result.stdout, result.stderr)
        if check and result.returncode:
            raise SmokeFailure(
                f"Command exited {result.returncode}: {' '.join(args[:4])}; "
                f"see {label or 'diagnostic'} output."
            )
        return result

    def save_output(self, label, stdout, stderr):
        for kind, value in (("stdout", stdout), ("stderr", stderr)):
            if isinstance(value, bytes):
                value = value.decode("utf-8", errors="replace")
            (self.output / f"{label}.{kind}.log").write_text(value or "", encoding="utf-8")

    def simctl(self, *args, **kwargs):
        return self.command(["xcrun", "simctl", *args], **kwargs)

    def prepare(self):
        if sys.platform != "darwin":
            raise SmokeFailure("This launch gate requires macOS with Xcode and an iOS simulator runtime.")
        if not self.app.is_dir() or self.app.suffix != ".app":
            raise SmokeFailure("--app must be the built simulator .app directory.")
        with (self.app / "Info.plist").open("rb") as source:
            info = plistlib.load(source)
        self.bundle = info.get("CFBundleIdentifier")
        self.executable = info.get("CFBundleExecutable")
        if not isinstance(self.bundle, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", self.bundle):
            raise SmokeFailure("The built app has no valid bundle identifier.")
        if not isinstance(self.executable, str) or Path(self.executable).name != self.executable:
            raise SmokeFailure("The built app has no valid executable name.")
        executable = self.app / self.executable
        if not executable.is_file():
            raise SmokeFailure("The built app executable is missing.")
        digest = hashlib.sha256()
        with executable.open("rb") as binary:
            for chunk in iter(lambda: binary.read(1024 * 1024), b""):
                digest.update(chunk)
        self.report.update({
            "bundleIdentifier": self.bundle,
            "version": info.get("CFBundleShortVersionString"),
            "build": info.get("CFBundleVersion"),
            "executableSha256": digest.hexdigest(),
        })
        inventory = json.loads(self.simctl("list", "--json", label="simulator-inventory").stdout)
        runtimes = {
            item["identifier"]: item for item in inventory.get("runtimes", [])
            if item.get("isAvailable") and ".iOS-" in item.get("identifier", "")
        }
        candidates = []
        for runtime_id, devices in inventory.get("devices", {}).items():
            runtime = runtimes.get(runtime_id)
            if not runtime:
                continue
            version = tuple(int(part) for part in re.findall(r"\d+", runtime.get("version", "")))
            for device in devices:
                kind = device.get("deviceTypeIdentifier", "")
                if device.get("isAvailable") and ".iPhone-" in kind:
                    candidates.append((version, device.get("name", ""), runtime_id, kind))
        if not candidates:
            raise SmokeFailure("No available iPhone simulator with an installed iOS runtime; startup testing cannot be skipped.")
        _, name, runtime_id, kind = max(candidates)
        # A dedicated device gives a real first launch without erasing, installing
        # over, or shutting down any pre-existing simulator or physical device.
        created = self.simctl(
            "create", f"Maydan startup smoke {uuid.uuid4()}", kind, runtime_id,
            label="simulator-create",
        ).stdout.strip()
        if not re.fullmatch(r"[0-9A-Fa-f-]{36}", created):
            raise SmokeFailure("simctl create did not return a simulator UUID.")
        self.device = str(uuid.UUID(created))
        self.report.update({"simulatorUdid": self.device, "simulatorModel": name, "runtime": runtime_id})
        self.simctl("boot", self.device, timeout=60, label="simulator-boot")
        self.simctl("bootstatus", self.device, "-b", timeout=180, label="simulator-bootstatus")
        self.simctl("install", self.device, str(self.app), timeout=90, label="simulator-install")
        self.installed_app = Path(self.simctl(
            "get_app_container", self.device, self.bundle, "app", label="installed-app"
        ).stdout.strip()).resolve()
        if not (self.installed_app / self.executable).is_file():
            raise SmokeFailure("The installed simulator executable could not be found.")

    def process_is_app(self, pid):
        # A successful launch response is not sufficient: dyld can terminate the
        # process immediately afterwards. Also reject zombies and PID reuse.
        result = self.command(["/bin/ps", "-ww", "-p", str(pid), "-o", "pid=,stat=,comm="], check=False)
        fields = result.stdout.strip().split(None, 2)
        if result.returncode or len(fields) != 3 or fields[0] != str(pid) or "Z" in fields[1]:
            return False
        return Path(fields[2]).resolve() == (self.installed_app / self.executable).resolve()

    def launch(self, name, duration):
        result = self.simctl(
            "launch", "--terminate-running-process",
            f"--stdout={self.output / (name + '-app.stdout.log')}",
            f"--stderr={self.output / (name + '-app.stderr.log')}",
            self.device, self.bundle, timeout=45, label=f"{name}-launch",
        )
        match = re.search(rf"^{re.escape(self.bundle)}:\s*(\d+)\s*$", result.stdout, re.MULTILINE)
        if not match:
            raise SmokeFailure(f"{name}: simctl did not report the launched application's PID.")
        pid = int(match.group(1))
        self.pids.add(pid)
        record = {"name": name, "pid": pid, "requiredSeconds": duration, "passed": False}
        self.report["launches"].append(record)
        print(f"Monitoring {name} launch for {duration}s (PID {pid}).", flush=True)
        started = time.monotonic()
        while True:
            if not self.process_is_app(pid):
                record["observedSeconds"] = round(time.monotonic() - started, 2)
                raise SmokeFailure(f"{name}: the exact app process exited, became a zombie, or changed identity.")
            elapsed = time.monotonic() - started
            if elapsed >= duration:
                break
            time.sleep(min(1, duration - elapsed))
        record.update({"observedSeconds": round(elapsed, 2), "passed": True})
        self.screenshot(name)
        self.collect_crashes()
        if self.crashes:
            raise SmokeFailure("A matching application crash report was created during startup testing.")

    def screenshot(self, name):
        try:
            self.simctl("io", self.device, "screenshot", str(self.output / f"{name}.png"),
                        timeout=20, label=f"{name}-screenshot")
        except (OSError, SmokeFailure) as error:
            self.report["diagnosticWarnings"].append(str(error))

    def collect_crashes(self):
        if not self.device or not self.executable:
            return
        roots = [Path.home() / "Library/Logs/DiagnosticReports",
                 Path.home() / "Library/Developer/CoreSimulator/Devices" / self.device / "data/Library/Logs"]
        for root in roots:
            if not root.is_dir():
                continue
            for source in root.rglob("*"):
                if source.suffix not in {".ips", ".crash"} or source in self.crashes:
                    continue
                try:
                    stat = source.stat()
                    if stat.st_mtime < self.started - 1 or stat.st_size > 10 * 1024 * 1024:
                        continue
                    data = source.read_text(encoding="utf-8", errors="replace")
                    same_device = self.device.lower() in data.lower()
                    same_pid = any(re.search(rf'"pid"\s*:\s*{pid}\b|^Process:\s+.*\[{pid}\]', data, re.MULTILINE)
                                   for pid in self.pids)
                    same_app = self.executable in source.name or f'"procName" : "{self.executable}"' in data
                    if not same_app or not (same_device or same_pid):
                        continue
                    self.crashes.add(source)
                    destination = self.output / f"crash-{len(self.crashes)}-{source.name}"
                    destination.write_text(data, encoding="utf-8")
                    self.report["crashReports"].append(destination.name)
                except OSError as error:
                    self.report["diagnosticWarnings"].append(f"Could not read crash report: {error}")

    def finish(self):
        if self.device:
            # Crash reporting is asynchronous. Keep the test device alive briefly
            # after a failure to let DiagnosticReports write the useful evidence.
            if not self.report["passed"]:
                time.sleep(2)
            try:
                self.collect_crashes()
                self.screenshot("final-state")
                predicate = f'process == "{self.executable}" OR eventMessage CONTAINS[c] "{self.bundle}"'
                self.simctl("spawn", self.device, "log", "show", "--style", "compact", "--last", "5m",
                            "--predicate", predicate, timeout=30, label="simulator-unified-log")
            except (OSError, SmokeFailure) as error:
                self.report["diagnosticWarnings"].append(str(error))
            finally:
                # Only the UUID created by this invocation may be removed.
                for action in ("shutdown", "delete"):
                    try:
                        self.simctl(action, self.device, timeout=30, label=f"simulator-{action}")
                    except (OSError, SmokeFailure) as error:
                        self.report["diagnosticWarnings"].append(str(error))
        if self.crashes:
            self.report["passed"] = False
            self.report.setdefault("error", "A matching application crash report was created during startup testing.")
        self.report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        (self.output / "summary.json").write_text(json.dumps(self.report, indent=2) + "\n", encoding="utf-8")

    def run(self):
        try:
            self.prepare()
            self.launch("cold", 45)
            self.simctl("terminate", self.device, self.bundle, label="cold-terminate")
            self.launch("relaunch", 15)
            self.report["passed"] = True
        except (OSError, ValueError, SmokeFailure) as error:
            self.report["error"] = str(error)
        finally:
            self.finish()
        print(f"{'PASS' if self.report['passed'] else 'FAIL'} simulator startup; diagnostics: {self.output}", flush=True)
        if not self.report["passed"]:
            print(self.report.get("error", "Startup failed."), file=sys.stderr)
        return 0 if self.report["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", required=True, type=Path, help="Built Release-iphonesimulator .app")
    parser.add_argument("--output-dir", required=True, type=Path, help="Startup logs, screenshots and summary directory")
    args = parser.parse_args()
    return LaunchSmoke(args.app, args.output_dir).run()


if __name__ == "__main__":
    raise SystemExit(main())
