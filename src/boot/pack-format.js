// Only shipped game resources are eligible for bulk fetching. An unexpected
// manifest must never turn the loader into a client for live/private routes.
export function isPackFile(file) {
  if (typeof file !== 'string' || !file || /[\\:?#%\u0000-\u001f]/.test(file) ||
      file.split('/').some(part => !part || part.startsWith('.'))) return false;
  if (/^(?:index\.html|sw\.js|manifest(?:\.en)?\.webmanifest)$/.test(file)) return true;
  return /^(?:opening|art|assets|audio|icons|media|screenshots)\//.test(file) &&
    !file.startsWith('audio/candidates/') &&
    /\.(?:css|js|json|woff2?|webp|png|jpe?g|gif|avif|svg|ico|m4a|wav|mp3|mp4|webm|ogg)$/i.test(file);
}

export function parsePack(data, id) {
  if (data?.schema !== 2 || data.id !== id || !Array.isArray(data.files) || !Array.isArray(data.chunks) ||
      (data.transport !== undefined && data.transport !== 'chunks-v1') ||
      !data.files.length || data.files.length !== data.totalFiles) throw new Error('Invalid game inventory');
  const names = new Set();
  let bytes = 0;
  for (const item of data.files) {
    if (!item || !isPackFile(item.file) || names.has(item.file) ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f\d]{64}$/.test(item.sha256))
      throw new Error('Invalid game resource');
    names.add(item.file);
    bytes += item.bytes;
  }
  if (!Number.isSafeInteger(bytes) || bytes !== data.totalBytes || !names.has('index.html') || !names.has('sw.js'))
    throw new Error('Incomplete game inventory');
  let first = 0;
  for (const chunk of data.chunks) {
    if (!chunk || chunk.first !== first || !Number.isInteger(chunk.count) || chunk.count < 1 || chunk.count > 96 ||
        !/^[a-f\d]{64}$/.test(chunk.sha256)) throw new Error('Invalid game chunk');
    first += chunk.count;
    if (first > data.totalFiles || chunk.bytes !== data.files.slice(chunk.first, first).reduce((sum,f) => sum + f.bytes, 0))
      throw new Error('Invalid chunk size');
  }
  if (first !== data.totalFiles) throw new Error('Incomplete game chunks');
  return data;
}
