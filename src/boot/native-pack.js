// Both origins are served from the installed app, including when the device is
// offline. A hosted preview must never accidentally enter the native path.
export function isBundledNative(url = globalThis.location) {
  if (!url) return false;
  if (url.protocol === 'maydan:') return url.host === 'app';
  return url.protocol === 'https:' && url.host === 'appassets.androidplatform.net' && url.pathname.startsWith('/game/');
}

const invalid = () => new Error('NATIVE_PACK_INVALID');

function interruptible(start, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || new Error('PACK_ABORTED')); return; }
    const abort = () => finish(reject, signal.reason || new Error('PACK_ABORTED'));
    const timer = setTimeout(() => finish(reject, new Error('NATIVE_PACK_TIMEOUT')), 30000);
    function finish(callback, value) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      callback(value);
    }
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(start).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

async function localResponse(url, signal) {
  return fetch(url, { signal, cache: 'no-store', redirect: 'error', credentials: 'omit' });
}

function validFile(file) {
  return typeof file === 'string' && file.split('/').every(part =>
    part && part !== '.' && part !== '..' && !/[\\:%?#]/.test(part));
}

// An older shell paired with newer bundled HTML may lack the native verifier.
// Read its signed local assets directly, one at a time. New shells always use
// their background SHA-256 verifier. Require Web Crypto on a legacy origin
// rather than accepting equal-length but damaged files.
async function legacyReader(signal) {
  if (!globalThis.crypto?.subtle) throw new Error('NATIVE_PACK_UNAVAILABLE');
  const base = new URL('./', globalThis.location.href);
  const response = await localResponse(new URL('native-game-pack.json', base), signal);
  if (!response.ok) throw invalid();
  const manifest = await response.json();
  if (manifest?.schema !== 1 || !Array.isArray(manifest.groups)) throw invalid();
  return async batch => {
    const group = manifest.groups[batch];
    if (!Array.isArray(group) || !group.length) throw invalid();
    let bytes = 0;
    for (const entry of group) {
      if (!validFile(entry.file) || !Number.isSafeInteger(entry.bytes) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw invalid();
      const url = new URL(entry.file.split('/').map(encodeURIComponent).join('/'), base);
      const file = await localResponse(url, signal);
      if (!file.ok) throw invalid();
      const data = await file.arrayBuffer();
      if (data.byteLength !== entry.bytes) throw invalid();
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data));
      if (Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') !== entry.sha256) throw invalid();
      bytes += data.byteLength;
    }
    return { batch, batches: manifest.groups.length, files: group.length, bytes,
      totalFiles: manifest.totalFiles, totalBytes: manifest.totalBytes };
  };
}

export async function prepareNativePack({ onProgress = () => {}, signal } = {}) {
  if (!isBundledNative()) throw new Error('NATIVE_PACK_UNAVAILABLE');
  const ios = globalThis.location.protocol === 'maydan:';
  const bridge = globalThis.webkit?.messageHandlers?.maydanInstalledPack;
  let readBatch = ios && bridge ? index => bridge.postMessage(index) : null;
  if (!ios) {
    readBatch = async index => {
      const response = await localResponse(new URL('./__installed_pack__/' + index, globalThis.location.href), signal);
      if (!index && response.status === 404) {
        readBatch = await legacyReader(signal);
        return readBatch(index);
      }
      if (!response.ok) throw invalid();
      return response.json();
    };
  }
  if (!readBatch) readBatch = await interruptible(() => legacyReader(signal), signal);
  let completedBytes = 0, completedFiles = 0, totals;
  for (let batch = 0; ; batch++) {
    const row = await interruptible(() => readBatch(batch), signal);
    if (!row || !['batch', 'batches', 'bytes', 'files', 'totalBytes', 'totalFiles'].every(key => Number.isSafeInteger(row[key]))
      || row.batch !== batch || row.batches <= batch || row.batches > row.totalFiles || row.bytes < 0 || row.files <= 0
      || row.totalBytes <= 0 || row.totalFiles <= 0) throw invalid();
    if (totals && (totals.batches !== row.batches || totals.totalFiles !== row.totalFiles || totals.totalBytes !== row.totalBytes)) throw invalid();
    totals = row;
    completedBytes += row.bytes;
    completedFiles += row.files;
    const done = batch + 1 === row.batches;
    if (completedFiles > row.totalFiles || completedBytes > row.totalBytes
      || done && (completedFiles !== row.totalFiles || completedBytes !== row.totalBytes)) throw invalid();
    const progress = { phase: done ? 'ready' : 'verify', source: row.receipt === 1 ? 'installed-receipt' : 'installed-scan', completedFiles, completedBytes,
      totalBytes: row.totalBytes, totalFiles: row.totalFiles };
    onProgress(progress);
    if (done) return progress;
  }
}
