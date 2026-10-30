// Private test assets and signed artifacts use a disposable data key, never an
// Apple/signing credential. The public repository holds authenticated ciphertext.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PREVIEW_ORIGIN = 'https://maydan-mafia-preview.mf103871.workers.dev';
export const BUNDLE_ID = 'pixabay-candidates-20261030-v1';
const ASSET_DIR = 'assets/audio-preview';
const MAX_BYTES = 80 * 1024 * 1024;
const FILE_URL = /^audio\/candidates\/[a-z0-9-]+-[a-f0-9]{12}\.m4a$/;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function directoryChain(root, relative) {
  let current = path.resolve(root);
  for (const segment of ['', ...relative.split('/')]) {
    current = path.join(current, segment);
    const info = await lstat(current).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
    if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error('Private audio directory must not traverse symlinks or non-directories.');
  }
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function privateAudioBuild(env = process.env) {
  if (env.MAYDAN_PRIVATE_AUDIO_PREVIEW !== '1') return false;
  if (env.IOS_RELEASE_ENVIRONMENT !== 'mafia-preview' || env.MAYDAN_ROOMS_URL !== PREVIEW_ORIGIN) throw new Error('Private audio requires the named isolated preview environment.');
  return true;
}
export function dataKey(env = process.env) {
  const encoded = env.MAYDAN_AUDIO_PREVIEW_KEY_BASE64 || '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('A valid private audio data key is required.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('Invalid private audio data key.');
  return key;
}
export function seal(payload, { key, aad, magic, filename }) {
  if (!Buffer.isBuffer(payload) || payload.length > 512 * 1024 * 1024) throw new Error('Invalid private payload.');
  const metadata = Buffer.from(canonical({ schemaVersion: 1, payloadSHA256: sha(payload), payloadBytes: payload.length, filename }));
  const size = Buffer.alloc(4); size.writeUInt32BE(metadata.length);
  const capsule = Buffer.concat([Buffer.from(magic), size, metadata, payload]);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(canonical(aad)));
  const encrypted = Buffer.concat([cipher.update(capsule), cipher.final(), cipher.getAuthTag()]);
  return { encrypted, receipt: { schemaVersion: 1, algorithm: 'AES-256-GCM', nonceBase64: nonce.toString('base64'), aad, cipherSHA256: sha(encrypted), cipherBytes: encrypted.length } };
}
export function unseal(encrypted, receipt, { key, aad, magic, filename }) {
  if (receipt?.schemaVersion !== 1 || receipt.algorithm !== 'AES-256-GCM' || receipt.cipherBytes !== encrypted.length || receipt.cipherSHA256 !== sha(encrypted) || canonical(receipt.aad) !== canonical(aad)) throw new Error('Private payload identity or ciphertext mismatch.');
  const nonce = Buffer.from(receipt.nonceBase64 || '', 'base64');
  if (nonce.length !== 12 || encrypted.length < 16) throw new Error('Malformed private payload.');
  const cipher = createDecipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(canonical(aad)));
  cipher.setAuthTag(encrypted.subarray(-16));
  const decoded = Buffer.concat([cipher.update(encrypted.subarray(0, -16)), cipher.final()]);
  const prefix = Buffer.from(magic);
  if (!decoded.subarray(0, prefix.length).equals(prefix) || decoded.length < prefix.length + 4) throw new Error('Invalid private payload capsule.');
  const length = decoded.readUInt32BE(prefix.length);
  if (length < 2 || length > 4096 || decoded.length < prefix.length + 4 + length) throw new Error('Invalid private metadata length.');
  const metadata = JSON.parse(decoded.subarray(prefix.length + 4, prefix.length + 4 + length).toString('utf8'));
  const payload = decoded.subarray(prefix.length + 4 + length);
  if (metadata.schemaVersion !== 1 || metadata.filename !== filename || metadata.payloadBytes !== payload.length || metadata.payloadSHA256 !== sha(payload)) throw new Error('Private payload integrity mismatch.');
  return payload;
}
export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.bundleId !== BUNDLE_ID || !/^[a-f0-9]{64}$/.test(manifest.catalogSHA256 || '') || !Array.isArray(manifest.files) || manifest.files.length < 24 || manifest.files.length > 64) throw new Error('Invalid private audio manifest.');
  const seen = new Set(); let total = 0;
  for (const file of manifest.files) {
    if (!FILE_URL.test(file.url || '') || seen.has(file.url) || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || !file.url.endsWith(`-${file.sha256.slice(0, 12)}.m4a`) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 20 * 1024 * 1024) throw new Error('Invalid or duplicate private audio file.');
    seen.add(file.url); total += file.bytes;
  }
  if (total > MAX_BYTES) throw new Error('Private audio pack exceeds its size budget.');
  return manifest;
}
export async function readManifest(root = ROOT) {
  const manifest = validateManifest(JSON.parse(await readFile(path.join(root, ASSET_DIR, 'manifest.json'), 'utf8')));
  const catalog = await readFile(path.join(root, 'src/shared/fx/audio-candidate-catalog.js'));
  if (sha(catalog) !== manifest.catalogSHA256) throw new Error('Private audio catalog changed after sealing.');
  const moduleURL = pathToFileURL(path.join(root, 'src/shared/fx/audio-candidate-catalog.js'));
  moduleURL.searchParams.set('sha256', manifest.catalogSHA256);
  const { CANDIDATE_FILES } = await import(moduleURL.href);
  if (!Array.isArray(CANDIDATE_FILES)) throw new Error('Private audio catalog has no file registry.');
  const ordered = (files) => files.map(({ url, sha256, bytes }) => ({ url, sha256, bytes })).sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  if (canonical(ordered(manifest.files)) !== canonical(ordered(CANDIDATE_FILES))) throw new Error('Private audio manifest differs from the complete catalog.');
  return manifest;
}
const assetAAD = (manifest) => ({ schemaVersion: 1, appId: '6808385717', environment: 'mafia-preview', kind: 'assets', bundleId: BUNDLE_ID, catalogSHA256: manifest.catalogSHA256 });
const assetMagic = 'MAYDAN-ASSETS-1\n';
const assetFilename = 'candidate-audio.json.gz';
export async function sealAssets(source, { root = ROOT, key = dataKey() } = {}) {
  const manifest = await readManifest(root);
  await directoryChain(root, ASSET_DIR);
  const sourceRoot = await realpath(source);
  const files = [];
  for (const file of manifest.files) {
    const resolved = path.resolve(source, file.url);
    const actual = await realpath(resolved);
    const relative = path.relative(sourceRoot, actual);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Private audio source escaped its supplied root.');
    if (!(await lstat(resolved)).isFile()) throw new Error('Private audio source must be a regular file.');
    const bytes = await readFile(resolved);
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error('Private audio source differs from its reviewed manifest.');
    files.push({ url: file.url, data: bytes.toString('base64') });
  }
  const payload = gzipSync(Buffer.from(JSON.stringify({ schemaVersion: 1, files })), { level: 6 });
  const result = seal(payload, { key, aad: assetAAD(manifest), magic: assetMagic, filename: assetFilename });
  await writeFile(path.join(root, ASSET_DIR, 'private-candidates.enc'), result.encrypted);
  await writeFile(path.join(root, ASSET_DIR, 'receipt.json'), `${JSON.stringify(result.receipt, null, 2)}\n`);
  return { files: files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), cipherSHA256: result.receipt.cipherSHA256, cipherBytes: result.encrypted.length };
}
export async function verifyMaterialized(root = ROOT) {
  const manifest = await readManifest(root);
  await directoryChain(root, 'public/audio/candidates');
  const folder = path.join(root, 'public/audio/candidates');
  const names = (await readdir(folder)).sort();
  if (canonical(names) !== canonical(manifest.files.map((file) => path.basename(file.url)).sort())) throw new Error('Unexpected or missing private audio files.');
  for (const file of manifest.files) {
    const filename = path.join(root, 'public', file.url);
    if (!(await lstat(filename)).isFile()) throw new Error('Private audio must be regular files.');
    const bytes = await readFile(filename);
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error('Private audio materialization integrity failed.');
  }
  return { files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
}
export async function unpackAssets({ root = ROOT, env = process.env, key = dataKey(env) } = {}) {
  if (!privateAudioBuild(env)) throw new Error('Private assets cannot be materialized for this build.');
  const manifest = await readManifest(root);
  const receipt = JSON.parse(await readFile(path.join(root, ASSET_DIR, 'receipt.json'), 'utf8'));
  const encrypted = await readFile(path.join(root, ASSET_DIR, 'private-candidates.enc'));
  const zipped = unseal(encrypted, receipt, { key, aad: assetAAD(manifest), magic: assetMagic, filename: assetFilename });
  const document = JSON.parse(gunzipSync(zipped, { maxOutputLength: 160 * 1024 * 1024 }).toString('utf8'));
  if (document.schemaVersion !== 1 || !Array.isArray(document.files) || document.files.length !== manifest.files.length) throw new Error('Malformed private audio content.');
  const decoded = new Map();
  for (const entry of document.files) {
    const spec = manifest.files.find((file) => file.url === entry.url);
    if (!spec || decoded.has(entry.url) || typeof entry.data !== 'string' || entry.data.length > 28 * 1024 * 1024) throw new Error('Unexpected private audio entry.');
    const bytes = Buffer.from(entry.data, 'base64');
    if (bytes.length !== spec.bytes || sha(bytes) !== spec.sha256) throw new Error('Private audio content integrity failed.');
    decoded.set(entry.url, bytes);
  }
  // Validate everything before writing anything. Never overwrite an unexpected
  // local file or follow an existing symlink left in the materialized folder.
  await directoryChain(root, 'public/audio/candidates');
  const folder = path.join(root, 'public/audio/candidates');
  const folderInfo = await lstat(folder).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
  if (folderInfo?.isSymbolicLink() || (folderInfo && !folderInfo.isDirectory())) throw new Error('Invalid private audio destination.');
  if (folderInfo) return verifyMaterialized(root);
  await mkdir(folder, { recursive: true });
  // These are packaged app resources, not credentials. Keep normal resource
  // permissions so the installed iOS app can read them after ownership changes.
  for (const [url, bytes] of decoded) await writeFile(path.join(root, 'public', url), bytes, { flag: 'wx', mode: 0o644 });
  return verifyMaterialized(root);
}
export async function sealIPA({ root = ROOT, env = process.env, key = dataKey(env) } = {}) {
  if (!privateAudioBuild(env) || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') || !/^\d+\.\d+(?:\.\d+)?$/.test(env.IOS_VERSION || '') || !/^[1-9]\d{0,3}$/.test(env.IOS_BUILD || '')) throw new Error('A pinned isolated iOS release is required.');
  const folder = path.join(root, 'ios/build/export');
  const names = (await readdir(folder)).filter((file) => file.endsWith('.ipa'));
  if (names.length !== 1) throw new Error('Expected exactly one signed IPA.');
  const payload = await readFile(path.join(folder, names[0]));
  const aad = { schemaVersion: 1, appId: '6808385717', sourceCommit: env.GITHUB_SHA, environment: 'mafia-preview', version: env.IOS_VERSION, build: env.IOS_BUILD, kind: 'ipa' };
  const result = seal(payload, { key, aad, magic: 'MAYDAN-IPA-1\n', filename: 'Maydan.ipa' });
  const destination = path.join(root, 'ios/build/private-artifact');
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'Maydan.ipa.enc'), result.encrypted, { flag: 'wx' });
  await writeFile(path.join(destination, 'receipt.json'), `${JSON.stringify(result.receipt, null, 2)}\n`, { flag: 'wx' });
  return { cipherSHA256: result.receipt.cipherSHA256, cipherBytes: result.receipt.cipherBytes };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const result = command === 'seal-assets' && process.argv[3] ? await sealAssets(path.resolve(process.argv[3]))
    : command === 'unpack' ? await unpackAssets()
      : command === 'verify' ? await verifyMaterialized()
        : command === 'seal-ipa' ? await sealIPA() : null;
  if (!result) throw new Error('Use seal-assets <private-source-directory>, unpack, verify, or seal-ipa.');
  console.log(JSON.stringify(result));
}
