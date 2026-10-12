import plistlib
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

from verify_runtime_dependencies import ARM64, X86_64, ValidationError, macho_images, validate


def string_command(command, value, header_size):
    name = value.encode() + b'\0'
    size = (header_size + len(name) + 7) & ~7
    return struct.pack('<III', command, size, header_size) + bytes(header_size - 12) + name + bytes(size - header_size - len(name))


def binary(*, dependencies=(), rpaths=(), weak=(), platform=2, cpu=ARM64, subtype=0, executable=False):
    commands = [struct.pack('<6I', 0x32, 24, platform, 0x100400, 0x1A0200, 0)]
    commands += [string_command(0x8000001C, item, 12) for item in rpaths]
    commands += [string_command(0xC, item, 24) for item in dependencies]
    commands += [string_command(0x80000018, item, 24) for item in weak]
    body = b''.join(commands)
    return struct.pack('<8I', 0xFEEDFACF, cpu, subtype, 2 if executable else 6, len(commands), len(body), 0, 0) + body


def universal(slices):
    offset = 8 + 20 * len(slices)
    table, body = [], []
    for cpu, data in slices:
        table.append(struct.pack('>5I', cpu, 0, offset, len(data), 0))
        body.append(data)
        offset += len(data)
    return struct.pack('>2I', 0xCAFEBABE, len(slices)) + b''.join(table + body)


class RuntimeDependenciesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / 'Maydan.app'
        self.app.mkdir()
        (self.app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable': 'Maydan', 'CFBundleIdentifier': 'Maydan'}))

    def put(self, name, data):
        target = self.app / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def standard(self, rpaths=('@executable_path/Frameworks',)):
        self.put('Maydan', binary(executable=True, rpaths=rpaths,
                 dependencies=('@rpath/LiveKitWebRTC.framework/LiveKitWebRTC', '@rpath/RustLiveKitUniFFI.framework/RustLiveKitUniFFI')))
        self.put('Frameworks/LiveKitWebRTC.framework/LiveKitWebRTC', binary())
        self.put('Frameworks/RustLiveKitUniFFI.framework/RustLiveKitUniFFI', binary())

    def test_reproduces_build10_present_frameworks_but_missing_app_runpath(self):
        self.standard(('/usr/lib/swift',))
        with self.assertRaisesRegex(ValidationError, 'cannot resolve required dependency.*LiveKitWebRTC.*LD_RUNPATH_SEARCH_PATHS'):
            validate(self.app)

    def test_correct_runpath_resolves_both_embedded_frameworks(self):
        self.standard(('/invalid', '@executable_path/Frameworks'))
        result = validate(self.app)
        self.assertEqual(result['binariesChecked'], 3)
        self.assertEqual(result['embeddedDependencyEdges'], 2)

    def test_loader_path_in_main_is_relative_to_app(self):
        self.standard(('@loader_path/Frameworks',))
        self.assertTrue(validate(self.app)['ok'])

    def test_missing_embedded_framework_fails_even_with_correct_runpath(self):
        self.standard()
        (self.app / 'Frameworks/RustLiveKitUniFFI.framework/RustLiveKitUniFFI').unlink()
        with self.assertRaisesRegex(ValidationError, 'cannot resolve required dependency.*RustLiveKitUniFFI'):
            validate(self.app)

    def test_transitive_dependency_inherits_executable_runpath(self):
        self.standard()
        self.put('Frameworks/LiveKitWebRTC.framework/LiveKitWebRTC', binary(dependencies=('@rpath/Transport.framework/Transport',)))
        with self.assertRaisesRegex(ValidationError, 'LiveKitWebRTC.*cannot resolve.*Transport'):
            validate(self.app)
        self.put('Frameworks/Transport.framework/Transport', binary())
        self.assertEqual(validate(self.app)['binariesChecked'], 4)

    def test_loader_relative_path_uses_framework_directory_and_handles_cycles(self):
        self.standard()
        self.put('Frameworks/LiveKitWebRTC.framework/LiveKitWebRTC', binary(rpaths=('@loader_path/..',), dependencies=('@rpath/Transport.framework/Transport',)))
        self.put('Frameworks/Transport.framework/Transport', binary(dependencies=('@loader_path/../LiveKitWebRTC.framework/LiveKitWebRTC',)))
        self.assertEqual(validate(self.app)['binariesChecked'], 4)

    def test_device_framework_cannot_be_replaced_by_simulator_slice(self):
        self.standard()
        self.put('Frameworks/LiveKitWebRTC.framework/LiveKitWebRTC', binary(platform=7))
        with self.assertRaisesRegex(ValidationError, 'expected iOS device platform 2, found 7'):
            validate(self.app)

    def test_arm64_app_rejects_x86_only_and_arm64e_only_dependency(self):
        self.standard()
        for substitute in (binary(cpu=0x1000007), binary(subtype=2)):
            self.put('Frameworks/LiveKitWebRTC.framework/LiveKitWebRTC', substitute)
            with self.assertRaisesRegex(ValidationError, 'arm64'):
                validate(self.app)

    def test_universal_framework_uses_arm64_device_slice(self):
        self.standard()
        self.put('Frameworks/LiveKitWebRTC.framework/LiveKitWebRTC', universal([(0x1000007, binary(cpu=0x1000007, platform=7)), (ARM64, binary())]))
        self.assertTrue(validate(self.app)['ok'])

    def simulator(self, cpu):
        self.put('Maydan', binary(executable=True, cpu=cpu, platform=7, rpaths=('@executable_path/Frameworks',), dependencies=('@rpath/Media.framework/Media',)))
        self.put('Frameworks/Media.framework/Media', binary(cpu=cpu, platform=7))

    def test_intel_and_apple_silicon_simulator_apps(self):
        for cpu, architecture in [(X86_64, 'x86_64'), (ARM64, 'arm64')]:
            with self.subTest(architecture=architecture):
                self.simulator(cpu)
                result = validate(self.app)
                self.assertEqual(result['platform'], 'simulator')
                self.assertEqual(result['architectures'], [architecture])

    def test_simulator_rejects_device_framework_and_wrong_cpu(self):
        self.simulator(ARM64)
        self.put('Frameworks/Media.framework/Media', binary(platform=2))
        with self.assertRaisesRegex(ValidationError, 'expected iOS simulator platform 7, found 2'):
            validate(self.app)
        self.simulator(X86_64)
        self.put('Frameworks/Media.framework/Media', binary(platform=7))
        with self.assertRaisesRegex(ValidationError, 'no compatible x86_64'):
            validate(self.app)

    def test_simulator_cannot_pass_as_exported_device_ipa(self):
        self.simulator(ARM64)
        with self.assertRaisesRegex(ValidationError, 'exported IPA/device app requires an arm64 iOS device slice'):
            validate(self.make_ipa())

    def test_system_and_missing_weak_dependencies_are_allowed(self):
        self.put('Maydan', binary(executable=True, dependencies=('/usr/lib/libSystem.B.dylib', '/System/Library/Frameworks/UIKit.framework/UIKit'), weak=('@rpath/Optional.framework/Optional',)))
        self.assertTrue(validate(self.app)['ok'])

    def make_ipa(self):
        ipa = self.app.parent / 'Maydan.ipa'
        with zipfile.ZipFile(ipa, 'w') as archive:
            for file in self.app.rglob('*'):
                if file.is_file():
                    archive.write(file, 'Payload/Maydan.app/' + file.relative_to(self.app).as_posix())
        return ipa

    def test_ipa_is_checked_without_extracting(self):
        self.standard()
        ipa = self.make_ipa()
        self.assertEqual(validate(ipa), validate(self.app))
        self.assertFalse((self.app.parent / 'Payload').exists())

    def test_path_escaping_bundle_does_not_resolve_host_file(self):
        self.put('Maydan', binary(executable=True, dependencies=('@executable_path/../outside.dylib',)))
        (self.app.parent / 'outside.dylib').write_bytes(binary())
        with self.assertRaisesRegex(ValidationError, 'cannot resolve required dependency'):
            validate(self.app)

    def test_malformed_binary_reports_actionable_error(self):
        malformed = bytearray(binary(executable=True))
        struct.pack_into('<I', malformed, 36, 0xFFFFFFFF)
        with self.assertRaisesRegex(ValidationError, 'invalid load command size'):
            macho_images(bytes(malformed), 'Maydan')


if __name__ == '__main__':
    unittest.main()
