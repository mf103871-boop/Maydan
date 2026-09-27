// مصادر الصوت الخارجية لميدان: سجلّ المزوّدين والمرشّحين (assets/audio/maydan-v3/sources.json)،
// تنزيلها إلى مخبأ خارج git، تثبيت بصماتها، ونصوص الرخص. لا يبني هذا الملف أي صوت؛ الفرز في
// screen.mjs والتصنيع في build.mjs / music.mjs.
//
//   node scripts/audio/sources.mjs --fetch [--only <id|provider>]   ينزّل الأرشيفات والملفات ويستخرج المرشّحين
//   node scripts/audio/sources.mjs --pin                            كـ --fetch ويثبّت sha256/bytes/retrieved في السجلّ
//   node scripts/audio/sources.mjs --licenses                       يكتب licenses/*.txt من الأرشيفات والصفحات المحفوظة
//   node scripts/audio/sources.mjs --capture-license mixkit-sfx     يلتقط نص رخصة Mixkit من نافذتها (Chromium)
//   node scripts/audio/sources.mjs --check                          فحص دون شبكة (CI)
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ffmpeg } from './engine.mjs';

// fetch المدمج في Node يتجاهل HTTPS_PROXY ما لم يُضبط NODE_USE_ENV_PROXY قبل الإقلاع.
const proxied = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxied && !process.env.NODE_USE_ENV_PROXY && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const child = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(child.status ?? 1);
}

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const assetsDir = path.join(root, 'assets/audio/maydan-v3');
export const registryFile = path.join(assetsDir, 'sources.json');
export const cacheDir = path.join(root, '.cache/audio-sources');
export const indexFile = path.join(cacheDir, 'index.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const today = () => new Date().toISOString().slice(0, 10);
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export async function loadRegistry() { return JSON.parse(await readFile(registryFile, 'utf8')); }
export async function saveRegistry(reg) { await writeFile(registryFile, `${JSON.stringify(reg, null, 2)}\n`, 'utf8'); }
export async function loadIndex() { try { return JSON.parse(await readFile(indexFile, 'utf8')); } catch { return { files: {} }; } }

// ── تنزيل بإعادة محاولة، ومضيفون مسموحون فقط (المزوّدون المسجَّلون + creativecommons) ─────────
const RETRY_MS = [0, 2500, 7000, 15000];
export async function download(url, { cap = 64 * 1024 * 1024, allowHosts = [] } = {}) {
  const host = new URL(url).hostname;
  if (!allowHosts.some((h) => host === h || host.endsWith(`.${h}`))) throw new Error(`host not allowed for downloads: ${host}`);
  let lastError;
  for (const wait of RETRY_MS) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: controller.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > cap) throw new Error(`file too large (${declared} bytes): ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > cap) throw new Error(`file too large: ${url}`);
      return buf;
    } catch (error) {
      lastError = error;
      if (!/HTTP (429|5\d\d)|fetch failed|abort|timeout|network|terminated|ECONN/i.test(String(error.message))) break;
    }
  }
  throw lastError;
}

// ── قارئ zip صغير (بلا اعتماديات): فهرس مركزي → مدخلات، طريقتا التخزين 0 و8 ───────────────
export function zipEntries(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(pos + 10), csize = buf.readUInt32LE(pos + 20), usize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28), extraLen = buf.readUInt16LE(pos + 30), commentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    entries.push({ name, method, csize, usize, local });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
export function zipRead(buf, entry) {
  const e = typeof entry === 'string' ? zipEntries(buf).find((x) => x.name === entry) : entry;
  if (!e) throw new Error(`zip entry missing: ${entry}`);
  const nameLen = buf.readUInt16LE(e.local + 26), extraLen = buf.readUInt16LE(e.local + 28);
  const start = e.local + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported zip method ${e.method} for ${e.name}`);
}

// ── بيانات الملف الأصلي (ffmpeg -i) ────────────────────────────────────────────────────
export function probe(file) {
  const out = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const text = out.stderr || '';
  const line = (text.split('\n').find((l) => /Audio: /.test(l)) || '');
  const stream = /Audio: ([a-z0-9_]+)[^\n]*?(\d+) Hz, ([a-z0-9.()]+)/i.exec(line);
  const kb = /(\d+) kb\/s/.exec(line);
  const dur = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(text);
  const codec = stream?.[1] || null;
  const depth = /pcm_s(\d+)/.exec(codec || '')?.[1] || (/pcm_f32/.test(codec || '') ? '32f' : null);
  const layout = stream?.[3] || '';
  return {
    codec, sampleRate: stream ? Number(stream[2]) : null,
    bitDepth: depth ? (depth === '32f' ? 32 : Number(depth)) : null,
    channels: /stereo/.test(layout) ? 2 : /mono/.test(layout) ? 1 : Number(/(\d+) channels/.exec(layout)?.[1]) || null,
    seconds: dur ? Number((Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])).toFixed(3)) : null,
    kbps: kb ? Number(kb[1]) : null,
    lossy: !!codec && !/^pcm_|^flac|^alac/.test(codec),
  };
}

export const localPath = (candidate) => path.join(cacheDir, candidate.provider, path.basename(candidate.path || new URL(candidate.url).pathname));
const archivePath = (key) => path.join(cacheDir, key, path.basename(new URL(key === '' ? '' : 'https://x/' + key).pathname));

async function ensureArchive(key, provider, { pin, allowHosts }) {
  const file = path.join(cacheDir, key, path.basename(new URL(provider.archive.url).pathname));
  await mkdir(path.dirname(file), { recursive: true });
  let buf;
  try { buf = await readFile(file); } catch { buf = null; }
  if (buf && provider.archive.sha256 && sha256(buf) !== provider.archive.sha256) buf = null;
  if (!buf) {
    console.log(`↓ ${provider.archive.url}`);
    buf = await download(provider.archive.url, { allowHosts });
    await writeFile(file, buf);
  }
  const digest = sha256(buf);
  if (provider.archive.sha256 && digest !== provider.archive.sha256) throw new Error(`${key}: archive sha256 changed (${digest})`);
  if (pin && !provider.archive.sha256) Object.assign(provider.archive, { sha256: digest, bytes: buf.length, retrieved: today() });
  return buf;
}

export async function fetchAll(reg, { only = null, pin = false } = {}) {
  const index = await loadIndex();
  const archives = new Map();
  const failures = [];
  const allowHosts = [...new Set(Object.values(reg.providers).flatMap((p) => p.hosts || []))];
  for (const c of reg.candidates) {
    if (only && c.id !== only && c.provider !== only) continue;
    const provider = reg.providers[c.provider];
    if (!provider) throw new Error(`${c.id}: unknown provider ${c.provider}`);
    const file = localPath(c);
    await mkdir(path.dirname(file), { recursive: true });
    let buf = null;
    try { buf = await readFile(file); } catch { /* not cached */ }
    if (buf && c.sha256 && sha256(buf) !== c.sha256) buf = null;
    if (!buf) {
      try {
        if (c.path) {
          if (!archives.has(c.provider)) archives.set(c.provider, await ensureArchive(c.provider, provider, { pin, allowHosts }));
          buf = zipRead(archives.get(c.provider), c.path);
        } else {
          console.log(`↓ ${c.url}`);
          buf = await download(c.url, { allowHosts });
        }
      } catch (error) {
        // ملف واحد لا يُسقط الجولة: يُسجَّل السبب في السجلّ ويتجاوزه الفرز.
        console.log(`✗ ${c.id}: ${error.message}`);
        failures.push(c.id);
        if (pin) c.unavailable = String(error.message).slice(0, 120);
        delete index.files[c.id];
        continue;
      }
      await writeFile(file, buf);
    }
    const digest = sha256(buf);
    if (c.sha256 && digest !== c.sha256) throw new Error(`${c.id}: sha256 changed (${digest})`);
    if (pin) { delete c.unavailable; if (!c.sha256) Object.assign(c, { sha256: digest, bytes: buf.length, retrieved: today() }); }
    index.files[c.id] = { path: path.relative(root, file).split(path.sep).join('/'), sha256: digest, bytes: buf.length, probe: probe(file) };
  }
  if (failures.length) console.log(`${failures.length} candidate(s) unavailable: ${failures.join(', ')}`);
  // الأرشيفات التي لا مرشّح لها بعد (مثل حزمة رخصة) تُثبَّت أيضًا.
  for (const [key, provider] of Object.entries(reg.providers)) {
    if (provider.archive && (!only || only === key) && !archives.has(key)) archives.set(key, await ensureArchive(key, provider, { pin, allowHosts }));
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(indexFile, `${JSON.stringify(index, null, 1)}\n`, 'utf8');
  if (pin) await saveRegistry(reg);
  return index;
}

// ── نصوص الرخص: من الأرشيفات والصفحات المحفوظة، بتاريخ الاسترجاع ─────────────────────────
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
async function writeLicense(name, header, body) {
  const file = path.join(assetsDir, 'licenses', name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${header.trim()}\n\n${body.trim()}\n`, 'utf8');
  console.log(`✓ licenses/${name}`);
}
export async function writeLicenses(reg) {
  const allowHosts = ['creativecommons.org', ...new Set(Object.values(reg.providers).flatMap((p) => p.hosts || []))];
  const get = async (url, cacheName) => {
    const file = path.join(cacheDir, 'licenses', cacheName);
    await mkdir(path.dirname(file), { recursive: true });
    try { return (await readFile(file)).toString('utf8'); } catch { /* fetch */ }
    const buf = await download(url, { allowHosts }); await writeFile(file, buf); return buf.toString('utf8');
  };
  const cc0 = await get('https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt', 'cc0-1.0-legalcode.txt');
  await writeLicense('cc0-1.0-legalcode.txt', `Creative Commons CC0 1.0 Universal — legal code.\nSource: https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt\nRetrieved ${today()}`, cc0);
  const ccby = await get('https://creativecommons.org/licenses/by/4.0/legalcode.txt', 'cc-by-4.0-legalcode.txt');
  await writeLicense('cc-by-4.0-legalcode.txt', `Creative Commons Attribution 4.0 International — legal code.\nSource: https://creativecommons.org/licenses/by/4.0/legalcode.txt\nRetrieved ${today()}`, ccby);
  for (const [key, provider] of Object.entries(reg.providers)) {
    if (!provider.archive) continue;
    const buf = await ensureArchive(key, provider, { pin: false, allowHosts });
    const entries = zipEntries(buf);
    const lic = entries.find((e) => /(^|\/)(license|licence|readme)[^/]*\.txt$/i.test(e.name));
    if (lic && provider.licenseFile && !/creativecommons|dustyroom|opengameart/.test(provider.licenseFile)) {
      await writeLicense(path.basename(provider.licenseFile), `${provider.name}\nSource: ${provider.url}\nArchive: ${provider.archive.url} (sha256 ${sha256(buf)})\nLicense file inside the archive: ${lic.name}\nRetrieved ${today()}`, zipRead(buf, lic).toString('utf8'));
    }
  }
  // Dustyroom: الصفحة تعلن CC0 وتحوي الحزمة license.pdf.
  const dusty = reg.providers.dustyroom;
  if (dusty) {
    const page = strip(await get(dusty.url, 'dustyroom-page.html'));
    const lines = page.split('\n').filter((l) => /CC0|CC Zero|Creative Commons|licen/i.test(l));
    const buf = await ensureArchive('dustyroom', dusty, { pin: false, allowHosts });
    const pdf = zipEntries(buf).find((e) => /license\.pdf$/i.test(e.name));
    await writeLicense('dustyroom-cc0.txt', `${dusty.name}\nSource page: ${dusty.url}\nArchive: ${dusty.archive.url} (sha256 ${sha256(buf)})\nRetrieved ${today()}`,
      `Statements on the source page:\n${lines.map((l) => `  "${l}"`).join('\n')}\n\nThe archive carries ${pdf ? `${pdf.name} (sha256 ${sha256(zipRead(buf, pdf))})` : 'no license file'}; CC0 1.0 legal code: licenses/cc0-1.0-legalcode.txt.`);
  }
  const oga = Object.entries(reg.providers).find(([, p]) => /opengameart/.test(p.url));
  if (oga) {
    const [, p] = oga;
    const page = strip(await get(p.sourcePage || p.url, 'oga-page.html'));
    const pick = (label) => { const i = page.indexOf(label); return i >= 0 ? page.slice(i, i + 160).split('\n').slice(0, 3).join(' ') : ''; };
    const buf = await ensureArchive(oga[0], p, { pin: false, allowHosts });
    const readme = zipEntries(buf).find((e) => /readme[^/]*\.txt$/i.test(e.name));
    await writeLicense(path.basename(p.licenseFile), `${p.name}\nSource page: ${p.sourcePage || p.url}\nArchive: ${p.archive.url} (sha256 ${sha256(buf)})\nRetrieved ${today()}`,
      `Page metadata:\n${pick('Author:')}\n${pick('License(s):')}\n${pick('Attribution Instructions:')}\n\n${readme ? `${readme.name} inside the archive:\n${zipRead(buf, readme).toString('utf8')}` : ''}\n\nCC0 1.0 legal code: licenses/cc0-1.0-legalcode.txt.`);
  }
  const inc = reg.providers.incompetech;
  if (inc) {
    const faq = strip(await get('https://incompetech.com/music/royalty-free/faq.html', 'incompetech-faq.html'));
    const start = faq.search(/attribution|credit/i);
    await writeLicense('incompetech-attribution.txt', `${inc.name}\nLicense: ${inc.license} (${inc.licenseUrl})\nAttribution guidance: https://incompetech.com/music/royalty-free/faq.html\nRetrieved ${today()}\n\nCredit line used by Maydan:\n  ${inc.creditLine}`,
      `Excerpt of the FAQ:\n${faq.slice(Math.max(0, start - 200), start + 1800)}`);
  }
}

// Mixkit يرسم نص الرخصة في نافذة تُجلب من /license/modal/<key>/ (انظر controllers bundle: displayLicenseModal).
export async function captureMixkitLicense(reg) {
  const provider = reg.providers['mixkit-sfx'];
  const allowHosts = provider.hosts || ['mixkit.co'];
  const html = (await download('https://mixkit.co/license/modal/sfxFree/', { allowHosts })).toString('utf8');
  const text = strip(html);
  if (text.length < 300 || !/licen/i.test(text)) throw new Error('license modal text too short; layout changed?');
  await writeLicense(path.basename(provider.licenseFile), `${provider.name}\nSource: https://mixkit.co/license/ — the "Sound Effects" free license, served for the modal at https://mixkit.co/license/modal/sfxFree/\nRetrieved ${today()}\nCaptured verbatim (HTML tags removed). providers["mixkit-sfx"].verified is set by hand only after reading this text.`, text);
}

export async function checkRegistry(reg) {
  const problems = [];
  for (const [key, p] of Object.entries(reg.providers)) {
    for (const field of ['name', 'url', 'license', 'licenseUrl', 'licenseFile']) if (!p[field]) problems.push(`${key}: missing ${field}`);
    if (p.licenseFile) {
      try { const text = await readFile(path.join(assetsDir, p.licenseFile), 'utf8'); if (!/Retrieved \d{4}-\d{2}-\d{2}/.test(text)) problems.push(`${key}: ${p.licenseFile} lacks a retrieval date`); } catch { problems.push(`${key}: ${p.licenseFile} missing`); }
    }
    if (p.archive && p.archive.sha256 && !/^[0-9a-f]{64}$/.test(p.archive.sha256)) problems.push(`${key}: bad archive sha256`);
  }
  const ids = new Set();
  for (const c of reg.candidates) {
    if (ids.has(c.id)) problems.push(`duplicate candidate ${c.id}`); ids.add(c.id);
    if (!reg.providers[c.provider]) problems.push(`${c.id}: unknown provider`);
    if (!c.path && !c.url) problems.push(`${c.id}: neither path nor url`);
    if (c.sha256 && !/^[0-9a-f]{64}$/.test(c.sha256)) problems.push(`${c.id}: bad sha256`);
    if (!Array.isArray(c.roles) || !c.roles.length) problems.push(`${c.id}: no roles`);
  }
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const reg = await loadRegistry();
  if (flag('--check')) {
    const problems = await checkRegistry(reg);
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
    console.log(`Sources verified: ${Object.keys(reg.providers).length} providers, ${reg.candidates.length} candidates`);
    return;
  }
  if (flag('--fetch') || flag('--pin')) {
    const index = await fetchAll(reg, { only: value('--only'), pin: flag('--pin') });
    console.log(`Fetched ${Object.keys(index.files).length} candidate files into ${path.relative(root, cacheDir)}`);
  }
  if (flag('--licenses')) await writeLicenses(reg);
  if (value('--capture-license') === 'mixkit-sfx') await captureMixkitLicense(reg);
  if (!args.length) console.log('usage: --fetch [--only id] | --pin | --licenses | --capture-license mixkit-sfx | --check');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
