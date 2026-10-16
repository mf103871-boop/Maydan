"""Check Mach-O dependencies in a device/simulator .app or exported device .ipa.

Runs without Xcode and never extracts or changes the bundle. In particular,
an embedded framework does not count as loadable unless the executable's
runpath chain can resolve its install name.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import plistlib
import posixpath
import struct
import sys
import zipfile

ARM64 = 0x0100000C
X86_64 = 0x01000007
STRONG_LOADS = {0xC, 0x8000001F, 0x80000023, 0x20}
SYSTEM_PREFIXES = ('/System/Library/', '/usr/lib/')


class ValidationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ValidationError(message)


@dataclass
class Image:
    cpu: int
    subtype: int
    filetype: int
    platform: int | None
    rpaths: list[str]
    dependencies: list[str]


def macho_images(data, label):
    """Read supported device/simulator slices from thin or universal Mach-O."""
    require(len(data) >= 8, f'{label}: truncated Mach-O header')
    fat = {b'\xca\xfe\xba\xbe': ('>', False), b'\xbe\xba\xfe\xca': ('<', False),
           b'\xca\xfe\xba\xbf': ('>', True), b'\xbf\xba\xfe\xca': ('<', True)}
    if data[:4] in fat:
        endian, wide = fat[data[:4]]
        count = struct.unpack_from(endian + 'I', data, 4)[0]
        stride = 32 if wide else 20
        require(0 < count <= 64 and 8 + count * stride <= len(data), f'{label}: invalid universal header')
        images = []
        for index in range(count):
            row = 8 + index * stride
            cpu = struct.unpack_from(endian + 'I', data, row)[0]
            offset, length = struct.unpack_from(endian + ('QQ' if wide else 'II'), data, row + 8)
            require(offset >= 8 + count * stride and length > 0 and offset + length <= len(data),
                    f'{label}: invalid universal slice bounds')
            if cpu in (ARM64, X86_64):
                images.extend(macho_images(data[offset:offset + length], label))
        require(images, f'{label}: no arm64 or x86_64 slice')
        return images
    require(data[:4] == b'\xcf\xfa\xed\xfe' and len(data) >= 32, f'{label}: not a 64-bit Mach-O binary')
    _, cpu, subtype, filetype, count, command_bytes, _, _ = struct.unpack_from('<8I', data)
    require(cpu in (ARM64, X86_64), f'{label}: no arm64 or x86_64 slice')
    require(command_bytes <= len(data) - 32 and count <= command_bytes // 8, f'{label}: invalid load command bounds')
    end, offset = 32 + command_bytes, 32
    image = Image(cpu, subtype & 0xFFFFFF, filetype, None, [], [])
    for _ in range(count):
        require(offset + 8 <= end, f'{label}: truncated load command')
        command, size = struct.unpack_from('<II', data, offset)
        require(size >= 8 and offset + size <= end, f'{label}: invalid load command size')
        if command == 0x8000001C or command in STRONG_LOADS:
            minimum = 12 if command == 0x8000001C else 24
            require(size >= minimum, f'{label}: truncated dependency command')
            start = struct.unpack_from('<I', data, offset + 8)[0]
            require(minimum <= start < size, f'{label}: invalid dependency name offset')
            name = data[offset + start:offset + size].split(b'\0', 1)
            require(len(name) == 2, f'{label}: unterminated dependency name')
            try:
                value = name[0].decode('utf-8')
            except UnicodeDecodeError as error:
                raise ValidationError(f'{label}: invalid UTF-8 dependency name') from error
            (image.rpaths if command == 0x8000001C else image.dependencies).append(value)
        elif command == 0x32:
            require(size >= 24, f'{label}: truncated build-version command')
            image.platform = struct.unpack_from('<I', data, offset + 8)[0]
        elif command == 0x25:  # Older iOS frameworks precede LC_BUILD_VERSION.
            image.platform = 7 if cpu == X86_64 else 2
        offset += size
    require(offset == end, f'{label}: inconsistent load command count')
    return [image]


class Bundle:
    def __init__(self, path):
        self.path = Path(path)
        self.archive = None
        if self.path.is_file() and self.path.suffix.lower() == '.ipa':
            self.archive = zipfile.ZipFile(self.path)
            names = self.archive.namelist()
            roots = [name[:-len('Info.plist')] for name in names
                     if name.startswith('Payload/') and name.count('/') == 2
                     and name.endswith('.app/Info.plist')]
            require(len(roots) == 1, 'IPA must contain exactly one main Payload/*.app/Info.plist')
            self.prefix = roots[0]
            self.names = set(names)
        else:
            require(self.path.is_dir() and self.path.suffix.lower() == '.app', 'Pass an existing .app directory or .ipa file')
            self.path = self.path.resolve()

    def close(self):
        if self.archive:
            self.archive.close()

    def exists(self, name):
        if name.startswith('/') or name == '..' or name.startswith('../'):
            return False
        if self.archive:
            return self.prefix + name in self.names
        target = (self.path / name).resolve()
        return target.is_relative_to(self.path) and target.is_file()

    def read(self, name):
        require(self.exists(name), f'Missing bundle file: {name}')
        return self.archive.read(self.prefix + name) if self.archive else (self.path / name).read_bytes()


def expand_path(value, loader):
    if value == '@executable_path' or value.startswith('@executable_path/'):
        return posixpath.normpath('.' + value[len('@executable_path'):])
    if value == '@loader_path' or value.startswith('@loader_path/'):
        return posixpath.normpath((posixpath.dirname(loader) or '.') + value[len('@loader_path'):])
    return value


def validate(path):
    bundle = Bundle(path)
    try:
        info = plistlib.loads(bundle.read('Info.plist'))
        main = info.get('CFBundleExecutable', '')
        require(main and '/' not in main and '\\' not in main, 'Info.plist has an invalid CFBundleExecutable')
        cache, verified, dependencies = {}, set(), set()

        def images(name):
            if name not in cache:
                cache[name] = macho_images(bundle.read(name), name)
            return cache[name]

        def visit(name, cpu, subtype, platform, inherited, chain):
            if name in chain:  # Already checked on this dependency chain.
                return
            available = images(name)
            image = next((item for item in available if item.cpu == cpu and item.subtype == subtype), None)
            fallback = {(ARM64, 2): 0, (X86_64, 8): 3}.get((cpu, subtype))
            if image is None and fallback is not None:
                image = next((item for item in available if item.cpu == cpu and item.subtype == fallback), None)
            architecture = 'arm64' if cpu == ARM64 else 'x86_64'
            require(image is not None, f'{name}: no compatible {architecture} subtype {subtype} slice')
            require(image.platform == platform, f'{name}: expected iOS {"device" if platform == 2 else "simulator"} platform {platform}, found {image.platform}')
            require(image.filetype == (2 if name == main else 6), f'{name}: expected {"executable" if name == main else "dynamic library"} Mach-O type')
            runpaths = tuple(dict.fromkeys([expand_path(item, name) for item in image.rpaths] + list(inherited)))
            key = (name, cpu, subtype, platform, runpaths)
            if key in verified:
                return
            verified.add(key)
            for install_name in image.dependencies:
                if install_name.startswith(SYSTEM_PREFIXES):
                    continue
                if install_name.startswith('@rpath/'):
                    suffix = install_name[len('@rpath/'):]
                    candidates = [posixpath.normpath(base + '/' + suffix) for base in runpaths]
                else:
                    candidates = [expand_path(install_name, name)]
                resolved = next((item for item in candidates if bundle.exists(item)), None)
                if resolved is None:
                    # Swift runtime libraries may be supplied by iOS itself.
                    system_swift = any(item.startswith('/usr/lib/swift/libswift') and item.endswith('.dylib') for item in candidates)
                    if system_swift:
                        continue
                    hint = ' Add $(inherited) and @executable_path/Frameworks to LD_RUNPATH_SEARCH_PATHS and embed the framework.' if install_name.startswith('@rpath/') else ''
                    raise ValidationError(f'{name}: cannot resolve required dependency {install_name}; searched {candidates or "no runpaths"}.{hint}')
                dependencies.add((name, resolved))
                visit(resolved, cpu, subtype, platform, runpaths, chain + (name,))

        main_images = images(main)
        platforms = {image.platform for image in main_images}
        require(len(platforms) == 1 and platforms <= {2, 7}, f'{main}: expected one iOS device or simulator platform, found {platforms}')
        for image in main_images:
            if bundle.archive or image.platform == 2:
                require(image.platform == 2 and image.cpu == ARM64, f'{main}: exported IPA/device app requires an arm64 iOS device slice')
            visit(main, image.cpu, image.subtype, image.platform, (), ())
        return {'ok': True, 'bundleId': info.get('CFBundleIdentifier'), 'version': info.get('CFBundleShortVersionString'),
                'build': info.get('CFBundleVersion'), 'binariesChecked': len(cache),
                'platform': 'ios' if main_images[0].platform == 2 else 'simulator',
                'architectures': sorted({'arm64' if item.cpu == ARM64 else 'x86_64' for item in main_images}),
                'embeddedDependencyEdges': len(dependencies), 'mainRunpaths': main_images[0].rpaths}
    finally:
        bundle.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', help='Archived .app directory or exported .ipa file')
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.bundle)))
    except (ValidationError, OSError, ValueError, zipfile.BadZipFile, plistlib.InvalidFileException) as error:
        print(f'Runtime dependency check failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
