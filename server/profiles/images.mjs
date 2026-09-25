import { fail } from '../room-model.mjs';

export const IMAGE_LIMITS = Object.freeze({ avatar: 96 * 1024, cover: 220 * 1024 });
const invalid = () => fail('IMAGE_INVALID', 400);
const JFIF = new Uint8Array([255,224,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0]);
const word = (bytes, at) => (bytes[at] << 8) | bytes[at + 1];
export function imageKind(value) {
  if (value !== 'avatar' && value !== 'cover') invalid();
  return value;
}
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function base64ToBytes(value) {
  let binary;
  try { binary = atob(value); } catch { invalid(); }
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function dimensions(kind, width, height) {
  if (!width || !height) invalid();
  if (kind === 'avatar' && (width !== height || width > 512)) invalid();
  if (kind === 'cover' && (width !== 3 * height || width > 1200 || height > 400)) invalid();
}
function huffman(bytes, start, end, tables) {
  let at = start;
  while (at < end) {
    if (at + 17 > end) invalid();
    const spec = bytes[at++]; const type = spec >> 4; const id = spec & 15;
    if (type > 1 || id > 3) invalid();
    const counts = bytes.subarray(at, at + 16); at += 16;
    const count = counts.reduce((sum, n) => sum + n, 0);
    if (!count || count > 256 || at + count > end) invalid();
    const levels = Array.from({ length: 17 }, () => new Map());
    const seen = new Set(); let code = 0;
    for (let length = 1; length <= 16; length++) {
      // JPEG reserves the all-ones code for padding; oversubscribed trees fail.
      if (code + counts[length - 1] >= 2 ** length) invalid();
      for (let n = 0; n < counts[length - 1]; n++) {
        const symbol = bytes[at++];
        if (seen.has(symbol)) invalid();
        seen.add(symbol);
        if ((!type && symbol > 11) || (type && ((symbol & 15) > 10 || (!(symbol & 15) && symbol !== 0 && symbol !== 240)))) invalid();
        levels[length].set(code++, symbol);
      }
      code *= 2;
    }
    tables.set(`${type}:${id}`, levels);
  }
  if (at !== end) invalid();
}
function validateScan(entropy, frame, scan) {
  let bit = 0;
  const read = (count) => {
    if (bit + count > entropy.length * 8) invalid();
    let value = 0;
    for (let n = 0; n < count; n++, bit++) value = (value << 1) | ((entropy[bit >> 3] >> (7 - (bit & 7))) & 1);
    return value;
  };
  const decode = (tree) => {
    let code = 0;
    for (let length = 1; length <= 16; length++) {
      code = (code << 1) | read(1);
      const symbol = tree[length].get(code);
      if (symbol !== undefined) return symbol;
    }
    invalid();
  };
  const columns = Math.ceil(frame.width / (8 * frame.maxH));
  const rows = Math.ceil(frame.height / (8 * frame.maxV));
  for (let mcu = 0; mcu < columns * rows; mcu++) {
    for (const component of scan) for (let block = 0; block < component.h * component.v; block++) {
      read(decode(component.dc));
      let coefficient = 1;
      while (coefficient < 64) {
        const symbol = decode(component.ac); const size = symbol & 15; const run = symbol >> 4;
        if (!size) {
          if (!run) break;
          coefficient += 16;
          if (coefficient > 64) invalid();
        } else {
          coefficient += run;
          if (coefficient >= 64) invalid();
          read(size); coefficient++;
        }
      }
    }
  }
  if (entropy.length * 8 - bit > 7) invalid();
  while (bit < entropy.length * 8) if (read(1) !== 1) invalid();
}

// Bounded baseline JPEG validator for canvas-reencoded uploads. It checks the
// entropy stream as well as marker lengths; no decompressed pixel buffer is made.
// Syntax: ITU-T T.81 Annex B/F; fixed JFIF header replaces every APPn/COM segment.
// https://www.itu.int/rec/T-REC-T.81
// https://www.w3.org/Graphics/JPEG/jfif.pdf
export function sanitizeJpeg(bytes, kind) {
  imageKind(kind);
  if (!(bytes instanceof Uint8Array) || bytes.length > IMAGE_LIMITS[kind]) fail('IMAGE_TOO_LARGE', 413);
  if (bytes.length < 32 || bytes[0] !== 255 || bytes[1] !== 216) invalid();
  const chunks = [new Uint8Array([255,216]), JFIF];
  const quantization = new Set(); const tables = new Map();
  let frame = null; let scanned = false; let ended = false; let at = 2; let segments = 0;
  while (at < bytes.length) {
    if (++segments > 256 || bytes[at] !== 255) invalid();
    const markerStart = at++;
    while (bytes[at] === 255) at++;
    if (at >= bytes.length) invalid();
    const marker = bytes[at++];
    if (marker === 217) {
      if (!scanned || at !== bytes.length) invalid();
      chunks.push(new Uint8Array([255,217])); ended = true; break;
    }
    if (marker === 0 || marker === 216 || marker === 1 || (marker >= 208 && marker <= 215) || at + 2 > bytes.length) invalid();
    const length = word(bytes, at); const start = at + 2; const end = at + length;
    if (length < 2 || end > bytes.length) invalid();
    at = end;
    if ((marker >= 224 && marker <= 239) || marker === 254) continue;
    if (scanned) invalid();
    if (marker === 219) {
      let q = start;
      while (q < end) {
        const spec = bytes[q++];
        if (spec >> 4 || (spec & 15) > 3 || q + 64 > end) invalid();
        for (let n = 0; n < 64; n++) if (!bytes[q++]) invalid();
        quantization.add(spec & 15);
      }
      if (q !== end) invalid();
    } else if (marker === 196) huffman(bytes, start, end, tables);
    else if (marker === 192) {
      if (frame || length < 11 || bytes[start] !== 8) invalid();
      const height = word(bytes, start + 1); const width = word(bytes, start + 3); const count = bytes[start + 5];
      if (![1,3].includes(count) || length !== 8 + 3 * count) invalid();
      dimensions(kind, width, height);
      const components = new Map(); let maxH = 0; let maxV = 0; let blocks = 0;
      for (let n = 0; n < count; n++) {
        const offset = start + 6 + 3 * n; const id = bytes[offset]; const h = bytes[offset + 1] >> 4; const v = bytes[offset + 1] & 15; const quant = bytes[offset + 2];
        if (components.has(id) || h < 1 || h > 4 || v < 1 || v > 4 || quant > 3 || (count === 1 && (h !== 1 || v !== 1))) invalid();
        components.set(id, { h, v, quant }); maxH = Math.max(maxH, h); maxV = Math.max(maxV, v); blocks += h * v;
      }
      if (blocks > 10 || [...components.values()].some(c => maxH % c.h || maxV % c.v)) invalid();
      frame = { width, height, components, maxH, maxV };
    } else if (marker === 221) {
      // Browser canvas output needs no restart markers. Reject this optional mode.
      if (length !== 4 || word(bytes, start) !== 0) invalid();
    } else if (marker === 218) {
      if (!frame || scanned) invalid();
      const count = bytes[start];
      if (count !== frame.components.size || length !== 6 + 2 * count || bytes[end - 3] !== 0 || bytes[end - 2] !== 63 || bytes[end - 1] !== 0) invalid();
      const scan = []; const ids = new Set();
      for (let n = 0; n < count; n++) {
        const id = bytes[start + 1 + 2 * n]; const spec = bytes[start + 2 + 2 * n];
        const component = frame.components.get(id); const dc = tables.get(`0:${spec >> 4}`); const ac = tables.get(`1:${spec & 15}`);
        if (!component || ids.has(id) || !dc || !ac || !quantization.has(component.quant)) invalid();
        ids.add(id); scan.push({ ...component, dc, ac });
      }
      const entropy = []; const entropyStart = at;
      while (at < bytes.length) {
        const byte = bytes[at++];
        if (byte !== 255) entropy.push(byte);
        else if (bytes[at] === 0) { at++; entropy.push(255); }
        else { at--; break; }
      }
      if (!entropy.length || at >= bytes.length) invalid();
      validateScan(entropy, frame, scan);
      chunks.push(bytes.subarray(markerStart, end), bytes.subarray(entropyStart, at)); scanned = true; continue;
    } else invalid(); // Reject progressive/arithmetic/lossless and unknown markers.
    chunks.push(bytes.subarray(markerStart, end));
  }
  if (!ended) invalid();
  const size = chunks.reduce((n, chunk) => n + chunk.length, 0);
  if (size > IMAGE_LIMITS[kind]) fail('IMAGE_TOO_LARGE', 413);
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return { bytes: result, width: frame.width, height: frame.height };
}
export async function imageFromDataUrl(value, kind) {
  imageKind(kind);
  if (typeof value !== 'string') invalid();
  if (value.length > 23 + Math.ceil(IMAGE_LIMITS[kind] / 3) * 4) fail('IMAGE_TOO_LARGE', 413);
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4) invalid();
  const decoded = base64ToBytes(match[1]);
  if (bytesToBase64(decoded) !== match[1]) invalid();
  const sanitized = sanitizeJpeg(decoded, kind);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', sanitized.bytes));
  return { ...sanitized, base64: bytesToBase64(sanitized.bytes), version: [...hash].map(n => n.toString(16).padStart(2,'0')).join('') };
}
