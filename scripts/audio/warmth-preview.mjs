// Packaging only for the explicitly authorized isolated iPhone preview. Audio
// is embedded as part of the game; no public download of standalone recordings.
import { readFile, writeFile, mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, seal, unseal, dataKey, privateAudioBuild, PREVIEW_ORIGIN, ROOT } from './private-preview.mjs';

export const SOURCE_MANIFEST_SHA256 = '26a1737edc78602489fc7a746c1ee199d65066614312b621648da24f1f207c56';
export const RUNTIME_PACK_SHA256 = '7286f0eee8f45affac5701c502766ddbe9b64ea2669f42675a138768f9ec1940';
export const WARMTH_BUNDLE_ID = 'maydan-warmth-20261103-private-v1';
export const WARMTH_DIRECTORY = 'assets/audio-warmth-preview';
export const WARMTH_PUBLIC_DIRECTORY = 'public/audio-warmth-preview';
const MAX_BYTES = 80 * 1024 * 1024;
const FILE_URL = /^audio\/[a-z][a-z0-9-]{0,79}-[a-f0-9]{12}\.m4a$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pending = value => value && ['listeningApproved', 'deviceTested', 'productionApproved', 'loopApproved'].every(key => value[key] === false);
const capsule = { magic: 'MAYDAN-WARMTH-1\n', filename: 'warmth-preview.json.gz' };
const aad = manifest => ({ schemaVersion: 1, appId: '6808385717', environment: 'mafia-preview', kind: 'warmth-audio', bundleId: WARMTH_BUNDLE_ID, sourceManifestSHA256: SOURCE_MANIFEST_SHA256, runtimePackSHA256: manifest.runtimePackSHA256 });

export function warmthAudioBuild(env = process.env) {
  if (env.MAYDAN_WARMTH_PREVIEW !== '1') return false;
  if (!privateAudioBuild(env) || env.MAYDAN_ROOMS_URL !== PREVIEW_ORIGIN) throw new Error('Warmth audio requires private audio and the named isolated preview environment.');
  return true;
}
async function safeDirectory(root, relative) {
  let current = path.resolve(root);
  for (const part of ['', ...relative.split('/')]) {
    current = path.join(current, part);
    const info = await lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error('Warmth audio directory must not traverse links or files.');
  }
}
async function checkedFile(root, relative, spec) {
  const absoluteRoot = await realpath(root), filename = path.resolve(root, relative);
  const actual = await realpath(filename), escaped = path.relative(absoluteRoot, actual);
  if (escaped.startsWith('..') || path.isAbsolute(escaped) || !(await lstat(filename)).isFile()) throw new Error('Warmth audio file escaped its root.');
  const bytes = await readFile(filename);
  if (bytes.length !== spec.bytes || hash(bytes) !== spec.sha256) throw new Error('Warmth audio content differs from its approved fingerprint.');
  return bytes;
}
export function projectWarmthPack(source) {
  if (source?.schemaVersion !== 1 || source.localPreviewOnly !== true || !pending(source.approval) || source.productionActivated !== false) throw new Error('Invalid approved source pack.');
  const suite = source.musicSuites?.['warmth-long'], direction = source.musicDirections?.bossaAlternative;
  if (!suite || canonical(suite.trackIds) !== canonical(['music-bossa', 'music-warmth-a', 'music-warmth-b', 'music-warmth-c']) || suite.introTrackId !== 'music-bossa' || suite.repeat !== true || !direction || direction.home !== 'warmth-long' || direction.lobby !== 'warmth-long' || direction.creativeSetup !== 'warmth-long' || direction.mafiaLobby !== null || direction.mafiaNight !== null) throw new Error('Warmth direction or chapters changed.');
  const active = new Set(suite.trackIds);
  for (const map of [source.cueMap, source.mafiaCueMap, source.mafiaPublicSpecialCueMap]) for (const choice of Object.values(map || {})) {
    if (choice.decision === 'candidate') { if (choice.rate !== 1) throw new Error('Approved effects must keep original playback rate.'); active.add(choice.assetId); }
    else if (choice.decision !== 'silence') throw new Error('Every effect requires an explicit candidate or silence decision.');
  }
  const assets = Object.fromEntries([...active].sort().map(id => {
    const entry = source.assets?.[id];
    if (!entry || !pending(entry.approval) || entry.loop !== false || entry.localPreviewOnly !== true || !['effect', 'music'].includes(entry.kind) || !/^https:\/\/pixabay\.com\//.test(entry.source?.pageUrl || '')) throw new Error('Missing approved asset or source evidence.');
    return [id, { id, kind: entry.kind, title: entry.title, titleAr: entry.titleAr, source: { title: entry.source.title, author: entry.source.author, pageUrl: entry.source.pageUrl }, localPreviewOnly: true, approval: source.approval, loop: false, file: { ...entry.file } }];
  }));
  return { schemaVersion: 1, bundleId: WARMTH_BUNDLE_ID, sourceManifestSHA256: SOURCE_MANIFEST_SHA256, localPreviewOnly: true, testFlightPreviewOnly: true,
    // The historical asset flags stay unchanged. The user approval is recorded
    // separately and is not confused with device or public release approval.
    approval: source.approval, assets, cueMap: source.cueMap, mafiaCueMap: source.mafiaCueMap,
    mafiaPublicSpecialCueMap: source.mafiaPublicSpecialCueMap, musicSuites: { 'warmth-long': suite }, musicDirections: { bossaAlternative: direction } };
}
export function validateWarmthManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.bundleId !== WARMTH_BUNDLE_ID || manifest.sourceManifestSHA256 !== SOURCE_MANIFEST_SHA256 || manifest.previewOnly !== true || manifest.deviceTested !== false || manifest.productionApproved !== false || manifest.userListeningApproved !== true || !/^[a-f0-9]{64}$/.test(manifest.approvalEvidenceSHA256 || '') || !Array.isArray(manifest.files) || manifest.files.length < 4 || manifest.files.length > 24) throw new Error('Invalid warmth preview manifest.');
  const pack = manifest.runtimePack;
  if (!pack || pack.sourceManifestSHA256 !== SOURCE_MANIFEST_SHA256 || pack.testFlightPreviewOnly !== true || !pending(pack.approval) || manifest.runtimePackSHA256 !== RUNTIME_PACK_SHA256 || hash(Buffer.from(canonical(pack))) !== manifest.runtimePackSHA256) throw new Error('Warmth runtime configuration integrity mismatch.');
  const seen = new Set(); let total = 0;
  for (const file of manifest.files) {
    if (!FILE_URL.test(file.url || '') || seen.has(file.url) || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || !file.url.endsWith(`-${file.sha256.slice(0,12)}.m4a`) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 32 * 1024 * 1024) throw new Error('Invalid warmth resource index.');
    seen.add(file.url); total += file.bytes;
  }
  if (total > MAX_BYTES || total !== manifest.bytes) throw new Error('Warmth audio size budget or total mismatch.');
  const indexed = Object.values(pack.assets || {}).map(entry => ({ url: entry.file.url, sha256: entry.file.sha256, bytes: entry.file.bytes })).sort((a,b) => a.url.localeCompare(b.url));
  const files = manifest.files.map(({url,sha256,bytes}) => ({url,sha256,bytes})).sort((a,b) => a.url.localeCompare(b.url));
  if (canonical(indexed) !== canonical(files)) throw new Error('Warmth runtime assets differ from resource index.');
  return manifest;
}
export async function readWarmthManifest(root = ROOT) {
  return validateWarmthManifest(JSON.parse(await readFile(path.join(root, WARMTH_DIRECTORY, 'manifest.json'), 'utf8')));
}
export async function prepareWarmthPack(sourceRoot, { root = ROOT, approvalPath } = {}) {
  const raw = await readFile(path.join(sourceRoot, 'manifest.json'));
  if (hash(raw) !== SOURCE_MANIFEST_SHA256) throw new Error('The approved warmth manifest changed.');
  const approval = await readFile(approvalPath);
  if (!approval.toString('utf8').includes(SOURCE_MANIFEST_SHA256) || !approval.toString('utf8').includes('User approved current audio')) throw new Error('Missing pinned user listening approval.');
  const source = JSON.parse(raw), runtimePack = projectWarmthPack(source);
  const files = Object.values(runtimePack.assets).map(({id,file}) => ({ id, url: file.url, sha256: file.sha256, bytes: file.bytes }));
  for (const file of files) await checkedFile(sourceRoot, file.url, file);
  const manifest = validateWarmthManifest({ schemaVersion: 1, bundleId: WARMTH_BUNDLE_ID, sourceManifestSHA256: SOURCE_MANIFEST_SHA256,
    previewOnly: true, userListeningApproved: true, deviceTested: false, productionApproved: false,
    approvalEvidenceSHA256: hash(approval), runtimePackSHA256: hash(Buffer.from(canonical(runtimePack))), runtimePack,
    files, bytes: files.reduce((sum,file) => sum + file.bytes, 0), sources: files.map(file => { const entry = source.assets[file.id]; return {id:file.id,source:entry.source,evidence:entry.evidence}; }) });
  await safeDirectory(root, WARMTH_DIRECTORY); await mkdir(path.join(root, WARMTH_DIRECTORY), { recursive: true });
  await writeFile(path.join(root, WARMTH_DIRECTORY, 'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  return { files: files.length, bytes: manifest.bytes, sourceManifestSHA256: SOURCE_MANIFEST_SHA256, runtimePackSHA256: manifest.runtimePackSHA256, deviceTested: false, productionApproved: false };
}
export async function sealWarmthAssets(sourceRoot, { root = ROOT, key = dataKey() } = {}) {
  const manifest = await readWarmthManifest(root), files = [];
  for (const file of manifest.files) files.push({ url: file.url, data: (await checkedFile(sourceRoot, file.url, file)).toString('base64') });
  const payload = gzipSync(Buffer.from(JSON.stringify({schemaVersion:1,files})), {level:6});
  const result = seal(payload, {key, aad:aad(manifest), ...capsule});
  await safeDirectory(root,WARMTH_DIRECTORY);
  await writeFile(path.join(root,WARMTH_DIRECTORY,'private-warmth.enc'),result.encrypted);
  await writeFile(path.join(root,WARMTH_DIRECTORY,'receipt.json'),JSON.stringify(result.receipt,null,2)+'\n');
  return {files:files.length,bytes:manifest.bytes,cipherSHA256:result.receipt.cipherSHA256,cipherBytes:result.encrypted.length};
}
export async function verifyWarmthMaterialized(root = ROOT) {
  const manifest = await readWarmthManifest(root);
  await safeDirectory(root,WARMTH_PUBLIC_DIRECTORY+'/audio');
  const publicRoot = path.join(root,WARMTH_PUBLIC_DIRECTORY);
  const names=(await readdir(path.join(publicRoot,'audio'))).sort();
  if (canonical(names)!==canonical(manifest.files.map(file=>path.basename(file.url)).sort())) throw new Error('Missing or unexpected warmth audio file.');
  for(const file of manifest.files) await checkedFile(publicRoot,file.url,file);
  const receipt=JSON.parse(await readFile(path.join(publicRoot,'pack-receipt.json'),'utf8'));
  if(receipt.sourceManifestSHA256!==SOURCE_MANIFEST_SHA256||receipt.runtimePackSHA256!==manifest.runtimePackSHA256) throw new Error('Warmth materialization receipt mismatch.');
  return {files:manifest.files.length,bytes:manifest.bytes,sourceManifestSHA256:SOURCE_MANIFEST_SHA256,runtimePackSHA256:manifest.runtimePackSHA256};
}
export async function unpackWarmthAssets({root=ROOT,env=process.env,key=dataKey(env)}={}) {
  if(!warmthAudioBuild(env)) throw new Error('Warmth assets cannot be materialized for this build.');
  const manifest=await readWarmthManifest(root);
  const encrypted=await readFile(path.join(root,WARMTH_DIRECTORY,'private-warmth.enc'));
  const receipt=JSON.parse(await readFile(path.join(root,WARMTH_DIRECTORY,'receipt.json'),'utf8'));
  const zipped=unseal(encrypted,receipt,{key,aad:aad(manifest),...capsule});
  const document=JSON.parse(gunzipSync(zipped,{maxOutputLength:160*1024*1024}).toString('utf8'));
  if(document.schemaVersion!==1||!Array.isArray(document.files)||document.files.length!==manifest.files.length) throw new Error('Malformed warmth capsule.');
  const decoded=new Map();
  for(const entry of document.files){
    const spec=manifest.files.find(file=>file.url===entry.url);
    if(!spec||decoded.has(entry.url)||typeof entry.data!=='string'||entry.data.length>44*1024*1024) throw new Error('Unexpected warmth capsule entry.');
    const bytes=Buffer.from(entry.data,'base64');
    if(bytes.length!==spec.bytes||hash(bytes)!==spec.sha256) throw new Error('Warmth capsule content integrity failed.');
    decoded.set(entry.url,bytes);
  }
  await safeDirectory(root,WARMTH_PUBLIC_DIRECTORY+'/audio');
  const destination=path.join(root,WARMTH_PUBLIC_DIRECTORY);
  const exists=await lstat(destination).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(exists) return verifyWarmthMaterialized(root);
  await mkdir(path.join(destination,'audio'),{recursive:true});
  for(const [url,bytes]of decoded) await writeFile(path.join(destination,url),bytes,{flag:'wx',mode:0o644});
  await writeFile(path.join(destination,'pack-receipt.json'),JSON.stringify({schemaVersion:1,bundleId:WARMTH_BUNDLE_ID,sourceManifestSHA256:SOURCE_MANIFEST_SHA256,runtimePackSHA256:manifest.runtimePackSHA256,previewOnly:true,deviceTested:false,productionApproved:false},null,2)+'\n',{flag:'wx',mode:0o644});
  return verifyWarmthMaterialized(root);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const command=process.argv[2];
  const result=command==='prepare'?await prepareWarmthPack(process.argv[3],{approvalPath:process.argv[4]}):command==='seal-assets'?await sealWarmthAssets(process.argv[3]):command==='unpack'?await unpackWarmthAssets():command==='verify'?await verifyWarmthMaterialized():null;
  if(!result)throw new Error('Use prepare <source-assets> <approval-file>, seal-assets <source-assets>, unpack, or verify.');
  console.log(JSON.stringify(result));
}
