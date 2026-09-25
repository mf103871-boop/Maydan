const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
export const IMAGE_LIMITS = { avatar: { width: 512, height: 512, bytes: 96 * 1024 }, cover: { width: 1200, height: 400, bytes: 220 * 1024 } };
const invalid = () => new Error('اختر صورة JPG أو PNG أو WebP صالحة.');
const ascii = (bytes, start, count) => String.fromCharCode(...bytes.slice(start, start + count));
// Inspect dimensions before asking the browser to decode a potentially huge bitmap.
// WebP layout: https://developers.google.com/speed/webp/docs/riff_container
export function imageDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && ascii(bytes, 1, 3) === 'PNG' && view.getUint32(0) === 0x89504e47 && ascii(bytes, 12, 4) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20), mime: 'image/png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 0xff) throw invalid();
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) throw invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        return { width: view.getUint16(at + 5), height: view.getUint16(at + 3), mime: 'image/jpeg' };
      }
      at += length;
    }
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const format = ascii(bytes, 12, 4);
    if (format === 'VP8X') {
      if (bytes[20] & 2) throw new Error('اختر صورة ثابتة بدل الصورة المتحركة.');
      const uint24 = index => bytes[index] + (bytes[index + 1] << 8) + (bytes[index + 2] << 16);
      return { width: uint24(24) + 1, height: uint24(27) + 1, mime: 'image/webp' };
    }
    if (format === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, mime: 'image/webp' };
    }
    if (format === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, mime: 'image/webp' };
    }
  }
  throw invalid();
}
function checkDimensions({ width, height }) {
  if (!width || !height || width * height > MAX_PIXELS || Math.max(width, height) > 12000) {
    throw new Error('الصورة كبيرة جدًا. اختر نسخة أصغر من 24 ميغابكسل.');
  }
}
export async function decodeProfileImage(file) {
  if (!file || !file.size || file.size > MAX_BYTES) throw new Error('اختر صورة حجمها أقل من 12 ميغابايت.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = imageDimensions(bytes); checkDimensions(dimensions);
  const url = URL.createObjectURL(new Blob([bytes], { type: dimensions.mime }));
  const element = new Image(); element.decoding = 'async';
  try {
    await new Promise((resolve, reject) => {
      element.onload = resolve; element.onerror = () => reject(invalid()); element.src = url;
    });
    checkDimensions({ width: element.naturalWidth, height: element.naturalHeight });
    return { url, width: element.naturalWidth, height: element.naturalHeight, element, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
const clamp = (value, low, high) => Math.min(high, Math.max(low, Number.isFinite(Number(value)) ? Number(value) : 0));
export function cropRect(image, { kind, zoom = 1, offsetX = 0, offsetY = 0 }) {
  const target = IMAGE_LIMITS[kind]; if (!target) throw invalid();
  checkDimensions(image);
  const ratio = target.width / target.height;
  const width = Math.min(image.width, image.height * ratio) / clamp(zoom, 1, 3);
  const height = width / ratio;
  return { x: (image.width - width) * (clamp(offsetX, -1, 1) + 1) / 2,
    y: (image.height - height) * (clamp(offsetY, -1, 1) + 1) / 2, width, height };
}
export async function cropProfileImage(image, options) {
  const limit = IMAGE_LIMITS[options.kind]; if (!limit) throw invalid();
  const crop = cropRect(image, options);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d'); if (!context) throw new Error('تعذّر تجهيز الصورة في هذا المتصفح.');
  for (const scale of [1, 0.75, 0.5]) {
    canvas.width = Math.round(limit.width * scale); canvas.height = Math.round(limit.height * scale);
    context.fillStyle = '#fffaf0'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image.element, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.76, 0.64, 0.52, 0.40]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob || blob.type !== 'image/jpeg') throw invalid();
      if (blob.size > limit.bytes) continue;
      return await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(invalid()); reader.readAsDataURL(blob);
      });
    }
  }
  throw new Error('تعذّر ضغط الصورة. جرّب صورة أخرى أقل تفاصيل.');
}
