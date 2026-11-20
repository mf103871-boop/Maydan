"""Bind the signed internal TestFlight resources to the reviewed visual build."""
import argparse
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import zipfile

PINS_SHA = "f959bd812f15c1bf420b99f89f501691a68c448fa84c7212864188f592d42479"
ORIGIN = "https://maydan-mafia-preview.mf103871.workers.dev"
def SHA(data):
    return hashlib.sha256(data).hexdigest()


def require(test, message):
    if not test:
        raise ValueError(message)


def artifact(path, prepared, stack):
    if prepared:
        require(path.is_dir(), "Expected a prepared www directory")
        files = [p.relative_to(path).as_posix() for p in path.rglob("*") if p.is_file()]
        return files, lambda key: (path / key).read_bytes(), None
    if path.suffix == ".app" and path.is_dir():
        files, read, _ = artifact(path / "www", True, stack)
        return files, read, plistlib.loads((path / "Info.plist").read_bytes())
    require(path.suffix == ".ipa", "Expected a signed IPA or .app")
    archive = stack.enter_context(zipfile.ZipFile(path))
    names = [item.filename for item in archive.infolist() if not item.is_dir()]
    require(len(names) == len(set(names)), "Duplicate archive entry")
    roots = [name for name in names if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", name)]
    require(len(roots) == 1, "Expected one signed application")
    prefix = roots[0].removesuffix("Info.plist") + "www/"
    return ([name[len(prefix):] for name in names if name.startswith(prefix)],
            lambda key: archive.read(prefix + key), plistlib.loads(archive.read(roots[0])))


def verify(args):
    pins = Path(__file__).with_name("visual-v4.json").read_bytes()
    require(SHA(pins.replace(b"\r\n", b"\n")) == PINS_SHA, "Changed frozen visual reference")
    reference = json.loads(pins)
    require(re.fullmatch("[a-f0-9]{40}", args.source) or (args.prepared and args.source == "uncommitted"),
            "Expected the immutable Git commit")
    with ExitStack() as stack:
        names, read, info = artifact(args.artifact, args.prepared, stack)
        if info is not None:
            require((info.get("CFBundleIdentifier"), info.get("CFBundleShortVersionString"), info.get("CFBundleVersion"))
                    == ("Maydan", args.version, args.build), "Incorrect native application identity")
        require(all(not name.startswith("/") and "\\" not in name and not set(name.split("/")) & {"", ".", ".."}
                    for name in names), "Invalid resource path")
        inventory_bytes = read("native-game-pack.json")
        inventory = json.loads(inventory_bytes)
        groups = inventory["groups"]
        require(inventory["schema"] == 1 and groups and all(groups), "Invalid installed game inventory")
        rows = [row for group in groups for row in group]
        file_map = {row["file"]: row for row in rows}
        require(len(file_map) == len(rows) == inventory["totalFiles"] and
                set(file_map) == set(names) - {"native-game-pack.json"}, "Installed inventory does not cover www exactly")
        require(sum(row["bytes"] for row in rows) == inventory["totalBytes"], "Invalid installed byte total")
        for row in rows:
            data = read(row["file"])
            require(len(data) == row["bytes"] and SHA(data) == row["sha256"], "Installed file mismatch: " + row["file"])

        features = json.loads(read("release-features.json"))
        expected_source = None if args.source == "uncommitted" else args.source
        require(features.get("sourceCommit") == expected_source and features.get("version") == args.version
                and features.get("build") == args.build and features.get("profile") == args.profile
                and features.get("environment") == "mafia-preview" and features.get("apiOrigin") == ORIGIN,
                "Prepared source, build, profile or preview origin differs")
        config = json.loads(read("native-config.json"))
        require(config.get("apiOrigin") == ORIGIN and config.get("authCallback") == "maydan://auth", "Wrong native environment")
        require(features["audio"]["warmthPreview"] == (args.profile == "complete-preview"), "Wrong audio profile")
        for row in features["resources"]:
            name = row["path"].removeprefix("www/")
            require(name in file_map and (row["bytes"], row["sha256"]) ==
                    (file_map[name]["bytes"], file_map[name]["sha256"]), "Feature receipt mismatch: " + name)

        html = read("index.html").decode("utf8")
        markers = ["fab-stat-player", "fab-stat-label", "data-stacked", "mamnoo-live-tally", "mafia-role-disclosure",
                   "native-game-pack", "InstalledPack", ORIGIN]
        require(all(marker in html for marker in markers), "Visual/native markers missing from installed HTML")
        match = re.search(r'<meta name="maydan-game-pack" content="\./(game-pack/([a-f0-9]{64})\.json)">', html)
        require(match, "Missing native target game pack")
        manifest_name, pack_id = match.groups()
        if args.profile == "complete-preview":
            # The source and pack IDs are injected after the reviewed application is built.
            # Verify those two independently, then compare every other byte of the HTML/JS.
            source_tags = re.findall(r'<meta name="maydan-source" content="([a-f0-9]{40})">', html)
            require(source_tags == ([expected_source] if expected_source else []), "Wrong HTML source")
            template = html.replace(match.group(0), "", 1)
            if expected_source:
                template = template.replace(f'<meta name="maydan-source" content="{expected_source}">', "", 1)
            require(SHA(template.replace("\r\n", "\n").encode("utf8")) == reference["reviewedTemplate"],
                    "Installed interface differs from the reviewed application")
        pack = json.loads(read(manifest_name))
        require(pack["id"] == pack_id and pack["schema"] == 2 and "transport" not in pack and
                len(pack["files"]) == len({row["file"] for row in pack["files"]}) == pack["totalFiles"],
                "Wrong native target game pack")
        require(sum(row["bytes"] for row in pack["files"]) == pack["totalBytes"] and
                {"index.html", "sw.js"} <= {row["file"] for row in pack["files"]}, "Incomplete pack")
        for row in pack["files"]:
            require(file_map.get(row["file"]) == row, "Game and native inventories disagree: " + row["file"])
        static = reference["sha256"]
        private = reference["warmth"] if args.profile == "complete-preview" else {}
        generated = {manifest_name, "sw.js", "index.html", "migrate.html", "native-config.json", "release-features.json"}
        if private:
            audio_receipt = "audio-warmth-preview/pack-receipt.json"
            generated.add(audio_receipt)
            require(file_map[audio_receipt]["sha256"] == "a65dbd8dd4445a34e3b65930075d93153f9c5a457a99210598541f982a3f6bf3",
                    "Changed private audio materialization receipt")
        expected = set(static) | set(private) | generated
        require(set(file_map) == expected, "Frozen file set differs: " + str(sorted(set(file_map) ^ expected)[:12]))
        alternate = reference["lfAlternatives"]
        endings = 0
        for name, digest in (static | private).items():
            actual = file_map[name]["sha256"]
            if actual != digest:
                require(actual == alternate.get(name), "Frozen bytes changed: " + name)
                endings += 1
        return dict(mode="prepared" if args.prepared else "artifact", source=args.source, version=args.version,
                    build=args.build, profile=args.profile, apiOrigin=ORIGIN, reviewHTML=reference["reviewedHTML"],
                    nativeHTML=SHA(html.encode("utf8")), installedInventory=SHA(inventory_bytes),
                    installedFiles=len(rows), staticFiles=len(static), staticLFVariants=endings, warmthFiles=len(private),
                    appIdentityChecked=info is not None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--source", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build", required=True)
    parser.add_argument("--profile", required=True, choices=["complete-preview", "compatibility"])
    parser.add_argument("--prepared", action="store_true", help="Local preflight only: input is a prepared www folder")
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    receipt = verify(args)
    text = json.dumps(receipt, sort_keys=True)
    if args.receipt:
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(text + "\n", encoding="utf8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf8") as summary:
            summary.write("\n### Visual v4 package verification\n\n```json\n" + text + "\n```\n")
    print(text)


if __name__ == "__main__":
    main()
