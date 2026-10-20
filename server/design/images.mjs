import { fail } from '../room-model.mjs';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const invalid = () => fail('IMAGE_INVALID', 400);
const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
const u16 = (bytes, at) => (bytes[at] << 8) | bytes[at + 1];
const u24le = (bytes, at) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
const u32be = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
const u32le = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);
const dimensions = (width, height) => { if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) invalid(); return { width, height }; };
const join = chunks => { const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0)); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; } return bytes; };
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function png(bytes) {
  if (bytes.length < 57 || ![137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) invalid();
  const chunks = [bytes.subarray(0, 8)]; let at = 8, size, data = 0, ended = false, seenHeader = false;
  while (at + 12 <= bytes.length) {
    const length = u32be(bytes, at), type = ascii(bytes, at + 4, 4), end = at + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(at + 4, end - 4)) !== u32be(bytes, end - 4)) invalid();
    if (!seenHeader && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (seenHeader || length !== 13) invalid();
      seenHeader = true; size = dimensions(u32be(bytes, at + 8), u32be(bytes, at + 12));
      const depth = bytes[at + 16], colour = bytes[at + 17];
      if (!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]})[colour]?.includes(depth) || bytes[at + 18] || bytes[at + 19] || bytes[at + 20] > 1) invalid();
    } else if (type === 'IDAT') data += length;
    else if (type === 'IEND') { if (length || end !== bytes.length || !data) invalid(); ended = true; }
    else if (['acTL','fcTL','fdAT'].includes(type) || /^[A-Z]/.test(type) && !['PLTE'].includes(type)) invalid();
    // Strip user metadata (EXIF, comments, GPS, profiles); retain rendering data.
    if (['IHDR','PLTE','tRNS','IDAT','IEND'].includes(type)) chunks.push(bytes.subarray(at, end));
    at = end; if (ended) break;
  }
  if (!ended || at !== bytes.length) invalid();
  return { bytes: join(chunks), ...size };
}
function jpeg(bytes) {
  if (bytes.length < 20 || bytes[0] !== 255 || bytes[1] !== 216) invalid();
  const chunks = [bytes.subarray(0, 2)]; let at = 2, size, scans = 0, ended = false;
  while (at < bytes.length) {
    const start = at;
    if (bytes[at++] !== 255) invalid();
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 217) { if (!size || !scans || at !== bytes.length) invalid(); chunks.push(bytes.subarray(start, at)); ended = true; break; }
    if (marker === undefined || [0,1,216].includes(marker) || marker >= 208 && marker <= 215 || at + 2 > bytes.length) invalid();
    const length = u16(bytes, at), end = at + length;
    if (length < 2 || end > bytes.length) invalid();
    if (marker >= 192 && marker <= 207 && ![196,200,204].includes(marker)) {
      if (![192,193,194].includes(marker) || size || length < 11 || bytes[at + 2] !== 8) invalid();
      size = dimensions(u16(bytes, at + 5), u16(bytes, at + 3));
    }
    if (!(marker >= 224 && marker <= 239) && marker !== 254) chunks.push(bytes.subarray(start, end));
    at = end;
    if (marker === 218) {
      if (!size) invalid(); scans++; const scanStart = at;
      while (at < bytes.length) {
        if (bytes[at] !== 255) { at++; continue; }
        if (bytes[at + 1] === 0 || bytes[at + 1] >= 208 && bytes[at + 1] <= 215) { at += 2; continue; }
        if (bytes[at + 1] === 255) { at++; continue; }
        break;
      }
      if (at <= scanStart) invalid(); chunks.push(bytes.subarray(scanStart, at));
    }
  }
  if (!ended) invalid();
  return { bytes: join(chunks), ...size };
}
function webp(bytes) {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || u32le(bytes, 4) + 8 !== bytes.length) invalid();
  const chunks = []; let at = 12, size, image = false;
  while (at + 8 <= bytes.length) {
    const type = ascii(bytes, at, 4), length = u32le(bytes, at + 4), data = at + 8, end = data + length + (length & 1);
    if (end > bytes.length || ['ANIM','ANMF'].includes(type)) invalid();
    if (type === 'VP8X') {
      if (length !== 10 || chunks.length || bytes[data] & 2) invalid();
      size = dimensions(1 + u24le(bytes, data + 4), 1 + u24le(bytes, data + 7));
      const chunk = bytes.slice(at, end); chunk[8] &= 0x10; chunks.push(chunk);
    } else if (type === 'VP8 ') {
      if (image || length < 10 || bytes[data] & 1 || ascii(bytes, data + 3, 3) !== '\x9d\x01\x2a') invalid();
      const measured = dimensions((bytes[data + 6] | bytes[data + 7] << 8) & 0x3fff, (bytes[data + 8] | bytes[data + 9] << 8) & 0x3fff);
      if (size && (size.width !== measured.width || size.height !== measured.height)) invalid();
      size = measured; image = true; chunks.push(bytes.subarray(at, end));
    } else if (type === 'VP8L') {
      if (image || length < 5 || bytes[data] !== 0x2f || bytes[data + 4] >> 5) invalid();
      const measured = dimensions(1 + (bytes[data + 1] | (bytes[data + 2] & 0x3f) << 8), 1 + ((bytes[data + 2] >> 6) | bytes[data + 3] << 2 | (bytes[data + 4] & 15) << 10));
      if (size && (size.width !== measured.width || size.height !== measured.height)) invalid();
      size = measured; image = true; chunks.push(bytes.subarray(at, end));
    } else if (type === 'ALPH') chunks.push(bytes.subarray(at, end));
    else if (!['EXIF','XMP ','ICCP'].includes(type)) invalid();
    at = end;
  }
  if (!image || !size || at !== bytes.length) invalid();
  const output = join([bytes.subarray(0, 12), ...chunks]); new DataView(output.buffer).setUint32(4, output.length - 8, true);
  return { bytes: output, ...size };
}
export function sanitizeStudioImage(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_IMAGE_BYTES) fail('IMAGE_TOO_LARGE', 413);
  if (!['image/png','image/jpeg','image/webp'].includes(mime)) fail('IMAGE_TYPE', 415);
  return { ...(mime === 'image/png' ? png(bytes) : mime === 'image/jpeg' ? jpeg(bytes) : webp(bytes)), mime };
}
export async function readImageBody(request) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_IMAGE_BYTES)) fail('IMAGE_TOO_LARGE', 413);
  const reader = request.body?.getReader(); if (!reader) invalid();
  const chunks = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_IMAGE_BYTES) { await reader.cancel(); fail('IMAGE_TOO_LARGE', 413); } chunks.push(value); }
  return join(chunks);
}
