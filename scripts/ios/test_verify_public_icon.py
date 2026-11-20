import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import zlib

spec = importlib.util.spec_from_file_location('public_icon', Path(__file__).with_name('verify_public_icon.py'))
icon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icon)


def chunk(kind, data):
    return struct.pack('>I', len(data))+kind+data+struct.pack('>I', zlib.crc32(kind+data) & 0xffffffff)


def test_png(width, raw, color=2, depth=8, interlace=0):
    return icon.SIGNATURE+chunk(b'IHDR', struct.pack('>IIBBBBB', width, width, depth, color, 0, 0, interlace))+chunk(b'IDAT', zlib.compress(raw))+chunk(b'IEND', b'')


class IconTests(unittest.TestCase):
    def test_real_apple_cgbi_rendition_matches_approved_master_pixels(self):
        fixture = icon.ROOT/'tests/fixtures/ios/appicon-approved-cgbi-120.png'
        data = fixture.read_bytes()
        self.assertEqual(icon.digest(data), 'ccb89dcd0281b80125c3716391b7d3f0189f1f9e8036991a7095258768ea7f85')
        width, height, pixels = icon.png_pixels(data)
        self.assertEqual((width, height), (120, 120))
        self.assertEqual(icon.digest(pixels), 'bf27b25ce95a663089d4153df9abaf0f48746c27e8fc8ffe547b0a67fdcf0762')
        self.assertEqual(pixels, icon.expected_pixels(icon.ROOT/'ios/Maydan/Assets.xcassets/AppIcon.appiconset/icon-1024.png', 120))

    def test_independent_fixed_vectors_for_every_png_filter(self):
        expected = bytes([12,34,56,78,90,123,45,67,89,101,130,156])
        encoded = [
            ([12,34,56,78,90,123], [45,67,89,101,130,156]),
            ([12,34,56,66,56,67], [45,67,89,56,63,67]),
            ([12,34,56,78,90,123], [33,33,33,23,40,33]),
            ([12,34,56,72,73,95], [39,50,61,40,52,50]),
            ([12,34,56,66,56,67], [33,33,33,23,40,33]),
        ]
        for method, (first, second) in enumerate(encoded):
            with self.subTest(method=method):
                self.assertEqual(icon.png_pixels(test_png(2, bytes([method]+first+[method]+second)))[2], expected)
        upper_left = test_png(2, bytes([4,100,100,100,176,176,176,4,100,100,100,50,50,50]))
        self.assertEqual(icon.png_pixels(upper_left)[2], bytes([100]*3+[20]*3+[200]*3+[150]*3))

    def test_corrupt_truncated_and_unsupported_pngs_fail(self):
        normal = icon.png_preview(1, b'\x01\x02\x03')
        invalid = [normal[:-1], normal[:-1]+bytes([normal[-1]^1]), normal+b'junk',
                   test_png(1,b'\0\x01\x02\x03',interlace=1), test_png(1,b'\0\x01',color=3),
                   test_png(1,b'\0\x01\x02\x03',depth=16), test_png(1,b'\x05\x01\x02\x03'),
                   test_png(1,b'\0\x01\x02\x03\x80',color=6), test_png(1,b'\0'+b'x'*10000)]
        for data in invalid:
            with self.subTest(size=len(data)):
                with self.assertRaises(ValueError): icon.png_pixels(data)

    def fixture(self, base, **overrides):
        root = base/'repo'
        master = root/'ios/Maydan/Assets.xcassets/AppIcon.appiconset/icon-1024.png'
        master.parent.mkdir(parents=True)
        master.write_bytes(b'fixture-approved-source')
        web = root/'public/icons/icon-1024.png'; web.parent.mkdir(parents=True); web.write_bytes(master.read_bytes())
        info = {'CFBundleIdentifier':'Maydan','CFBundleShortVersionString':'1.9','CFBundleVersion':'62','UIDeviceFamily':[1],
                'CFBundleIcons':{'CFBundlePrimaryIcon':{'CFBundleIconName':'AppIcon','CFBundleIconFiles':['AppIcon60x60']}}}
        info.update(overrides)
        ipa = base/'Maydan.ipa'
        pixels = bytes([10,20,30])*120*120
        with zipfile.ZipFile(ipa, 'w') as archive:
            archive.writestr('Payload/Maydan.app/Info.plist', plistlib.dumps(info))
            archive.writestr('Payload/Maydan.app/AppIcon60x60@2x.png', icon.png_preview(120,pixels))
        return root, master, ipa, pixels

    def test_signed_ipa_proof_records_exact_pixels_family_and_hash_without_extracting_app(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder); root, master, ipa, pixels = self.fixture(base)
            output = base/'proof'
            with patch.object(icon,'APPROVED_ICON',icon.digest(master.read_bytes())), patch.object(icon,'expected_pixels',return_value=pixels):
                proof = icon.inspect(ipa,'1.9','62','a'*40,output,root)
            self.assertTrue(proof['passed']); self.assertEqual(proof['UIDeviceFamily'],[1])
            self.assertEqual(proof['ipaSHA256'],hashlib.sha256(ipa.read_bytes()).hexdigest())
            self.assertTrue(proof['renditions'][0]['matched'])
            self.assertEqual({x.name for x in output.iterdir()}, {'icon-proof.json','AppIcon60x60@2x.png.decoded.png'})
            self.assertFalse(proof['completeIPAExtracted'])
            self.assertEqual(json.loads((output/'icon-proof.json').read_bytes()),proof)

    def test_wrong_bundle_build_family_source_and_pixels_fail_before_proof(self):
        variations = [{'CFBundleIdentifier':'Other'}, {'CFBundleVersion':'61'}, {'UIDeviceFamily':[1,2]},
                      {'CFBundleIcons':{}}, {}]
        for index, changes in enumerate(variations):
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as folder:
                base = Path(folder); root, master, ipa, pixels = self.fixture(base,**changes)
                with patch.object(icon,'APPROVED_ICON',icon.digest(master.read_bytes())), patch.object(icon,'expected_pixels',return_value=pixels if index<4 else bytes(len(pixels))):
                    with self.assertRaises(ValueError): icon.inspect(ipa,'1.9','62','a'*40,base/'proof',root)
                self.assertFalse((base/'proof').exists())
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder); root,master,ipa,pixels=self.fixture(base)
            with self.assertRaises(ValueError): icon.inspect(ipa,'1.9','62','a'*40,base/'proof',root)
            self.assertFalse((base/'proof').exists())


if __name__ == '__main__': unittest.main()
