"""Verify the approved icon pixels in a signed IPA, without extracting the IPA.

Apple's CgBI PNGs use raw DEFLATE and opaque BGRA pixels. Decode those for
inspection and compare with the same Sharp resize used by ios/prepare.mjs.
No private asset, credential or complete IPA is written to the proof folder.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import plistlib
import re
import struct
import subprocess
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[2]
APPROVED_ICON = '9899dd547c76c25f710f1c64779fe4a328f9b2826620abe2fc79247766ee7160'
SIGNATURE = b'\x89PNG\r\n\x1a\n'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def png_pixels(data):
    """Decode bounded non-interlaced, opaque 8-bit RGB/RGBA PNGs only."""
    require(isinstance(data, bytes) and data.startswith(SIGNATURE) and len(data) <= 8*1024*1024, 'Invalid icon PNG')
    offset, ihdr, compressed, cgbi, ended = 8, None, bytearray(), False, False
    while offset < len(data):
        require(offset+12 <= len(data), 'Truncated PNG chunk')
        length = struct.unpack('>I', data[offset:offset+4])[0]
        kind = data[offset+4:offset+8]
        end = offset+12+length
        require(end <= len(data), 'Truncated PNG payload')
        payload = data[offset+8:offset+8+length]
        crc = struct.unpack('>I', data[offset+8+length:end])[0]
        require(zlib.crc32(kind+payload) & 0xffffffff == crc, 'PNG checksum differs')
        if kind == b'CgBI':
            require(not cgbi and ihdr is None, 'Invalid CgBI order')
            cgbi = True
        elif kind == b'IHDR':
            require(ihdr is None and length == 13, 'Invalid PNG header')
            ihdr = struct.unpack('>IIBBBBB', payload)
        elif kind == b'IDAT':
            require(ihdr is not None, 'Missing PNG header')
            compressed.extend(payload)
        elif kind == b'IEND':
            require(length == 0 and end == len(data), 'Invalid PNG end')
            ended = True
            break
        elif kind and kind[0] & 32 == 0:
            raise ValueError('Unsupported critical PNG chunk')
        offset = end
    require(ended and ihdr is not None, 'Incomplete PNG')
    width, height, depth, color, compression, filtering, interlace = ihdr
    require(1 <= width == height <= 1024 and depth == 8 and color in (2, 6) and compression == filtering == interlace == 0, 'Unsupported icon PNG format')
    require(not cgbi or color == 6, 'Unexpected CgBI color type')
    channels = 4 if color == 6 else 3
    stride, expected = width*channels, (width*channels+1)*height
    decoder = zlib.decompressobj(-15 if cgbi else 15)
    raw = decoder.decompress(bytes(compressed), expected+1)
    require(len(raw) == expected and decoder.eof and not decoder.unconsumed_tail and not decoder.unused_data, 'Invalid PNG pixel stream')
    previous, rgb = bytearray(stride), bytearray()
    for row in range(height):
        start = row*(stride+1)
        method = raw[start]
        require(method in range(5), 'Unknown PNG filter')
        current = bytearray(raw[start+1:start+1+stride])
        for index in range(stride):
            left = current[index-channels] if index >= channels else 0
            up = previous[index]
            upper_left = previous[index-channels] if index >= channels else 0
            if method == 1: predictor = left
            elif method == 2: predictor = up
            elif method == 3: predictor = (left+up)//2
            elif method == 4:
                prediction = left+up-upper_left
                a, b, c = abs(prediction-left), abs(prediction-up), abs(prediction-upper_left)
                predictor = left if a <= b and a <= c else up if b <= c else upper_left
            else: predictor = 0
            current[index] = (current[index]+predictor) & 255
        for column in range(width):
            pixel = current[column*channels:(column+1)*channels]
            require(channels == 3 or pixel[3] == 255, 'App icon must be opaque')
            rgb.extend((pixel[2], pixel[1], pixel[0]) if cgbi else pixel[:3])
        previous = current
    return width, height, bytes(rgb)


def png_preview(side, rgb):
    require(len(rgb) == side*side*3, 'Invalid preview pixel count')
    def chunk(kind, payload):
        return struct.pack('>I', len(payload))+kind+payload+struct.pack('>I', zlib.crc32(kind+payload) & 0xffffffff)
    raw = b''.join(b'\0'+rgb[row*side*3:(row+1)*side*3] for row in range(side))
    return SIGNATURE+chunk(b'IHDR', struct.pack('>IIBBBBB', side, side, 8, 2, 0, 0, 0))+chunk(b'IDAT', zlib.compress(raw))+chunk(b'IEND', b'')


def expected_pixels(source, side, root=ROOT):
    script = "require('sharp')(process.argv[1]).resize(Number(process.argv[2]),Number(process.argv[2])).removeAlpha().raw().toBuffer().then(b=>process.stdout.write(b)).catch(()=>process.exit(1))"
    result = subprocess.run(['node', '-e', script, str(source), str(side)], cwd=root, capture_output=True, check=True)
    require(len(result.stdout) == side*side*3, 'Unexpected resized source pixels')
    return result.stdout


def inspect(ipa, version, build, source_commit, output, root=ROOT):
    require(re.fullmatch(r'\d+\.\d+(?:\.\d+)?', version) and re.fullmatch(r'[1-9]\d{0,3}', build), 'Explicit version and build required')
    require(re.fullmatch(r'[a-f0-9]{40}', source_commit) is not None, 'Frozen source commit required')
    master = root/'ios/Maydan/Assets.xcassets/AppIcon.appiconset/icon-1024.png'
    web = root/'public/icons/icon-1024.png'
    require(digest(master.read_bytes()) == digest(web.read_bytes()) == APPROVED_ICON, 'Approved icon source differs')
    size = ipa.stat().st_size
    require(0 < size <= 512*1024*1024, 'IPA exceeds bound')
    with ipa.open('rb') as stream:
        ipa_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    with zipfile.ZipFile(ipa) as archive:
        names = archive.namelist()
        require(0 < len(names) < 20000 and len(names) == len(set(names)), 'Invalid IPA entry inventory')
        require(sum(item.file_size for item in archive.infolist()) <= 800*1024*1024, 'Expanded IPA exceeds bound')
        for name in names:
            path = PurePosixPath(name)
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in name and ':' not in name and '\0' not in name, 'Noncanonical IPA path')
        plists = [name for name in names if name.startswith('Payload/') and name.endswith('.app/Info.plist') and name.count('/') == 2]
        require(len(plists) == 1 and archive.getinfo(plists[0]).file_size < 1024*1024, 'Ambiguous app plist')
        prefix = plists[0][:-len('Info.plist')]
        info = plistlib.loads(archive.read(plists[0]))
        require(info.get('CFBundleIdentifier') == 'Maydan' and info.get('CFBundleShortVersionString') == version and info.get('CFBundleVersion') == build, 'Wrong signed app identity')
        require(info.get('UIDeviceFamily') == [1], 'Public screenshot set requires iPhone-only app')
        primary = info.get('CFBundleIcons', {}).get('CFBundlePrimaryIcon', {})
        require(primary.get('CFBundleIconName') == 'AppIcon' and primary.get('CFBundleIconFiles') == ['AppIcon60x60'], 'Unexpected primary icon')
        icon_names = [name for name in names if name.startswith(prefix) and '/' not in name[len(prefix):] and name[len(prefix):].startswith('AppIcon') and name.endswith('.png')]
        require(any(re.fullmatch(r'AppIcon60x60@(?:2|3)x\.png', name[len(prefix):]) for name in icon_names), 'Missing iPhone icon rendition')
        rows, previews = [], []
        for name in sorted(icon_names):
            require(0 < archive.getinfo(name).file_size <= 8*1024*1024, 'Icon rendition exceeds bound')
            data = archive.read(name)
            width, height, rgb = png_pixels(data)
            label = name[len(prefix):]
            dimensions = re.fullmatch(r'AppIcon(\d+(?:\.\d+)?)x\1@([123])x(?:~ipad)?\.png', label)
            require(dimensions is not None and float(dimensions[1])*int(dimensions[2]) == width, 'Rendition size differs from icon slot')
            expected = expected_pixels(master, width, root)
            require(rgb == expected, 'Compiled icon pixels differ from approved resize: '+name[len(prefix):])
            rows.append({'path':label, 'width':width, 'height':height, 'pngSHA256':digest(data), 'pixelSHA256':digest(rgb), 'expectedPixelSHA256':digest(expected), 'matched':True})
            previews.append((label+'.decoded.png', png_preview(width, rgb)))
    output.mkdir(parents=True, exist_ok=False)
    for name, data in previews:
        (output/name).write_bytes(data)
    proof = {'schemaVersion':1, 'kind':'maydan-public-compiled-icon', 'sourceCommit':source_commit, 'version':version, 'build':build,
             'ipaSHA256':ipa_hash, 'ipaBytes':size, 'UIDeviceFamily':[1], 'primaryIconName':'AppIcon', 'approvedIconSHA256':APPROVED_ICON,
             'pixelComparison':'exact RGB pixels after Apple CgBI decoding, against the ios/prepare.mjs Sharp resize',
             'renditions':rows, 'passed':True, 'assetsCarPixelsVerified':False, 'completeIPAExtracted':False}
    (output/'icon-proof.json').write_text(json.dumps(proof, indent=2)+'\n', encoding='utf-8')
    return proof


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ipa', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--build', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = inspect(args.ipa, args.version, args.build, args.source, args.output)
    print(json.dumps({'passed':result['passed'], 'ipaSHA256':result['ipaSHA256'], 'renditions':len(result['renditions']), 'UIDeviceFamily':result['UIDeviceFamily']}))
