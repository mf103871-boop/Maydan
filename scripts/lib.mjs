// Shared by build, dev and release: turns the esbuild bundle plus the template
// into the one self-contained HTML document the platform ships as.
import { build as esbuildBuild } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMedia, copyMedia, fmtMB } from './media.mjs';
import { fabrakaMediaManifest } from './fabraka-media.mjs';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = path.join(ROOT, 'dist');

export async function readPkg() {
  return JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
}

// esbuild options shared by the one-shot build and the dev watcher.
// نسخة لكل ملف وسائط (بصمة محتواه) بمفتاح `المجلد/الملف`: تُلحق بعنوانه كـ ?v= فيتجاوز
// المتصفح والعامل الخدمي النسخة المخزّنة حين يُصحَّح الملف بالاسم نفسه. البصمة لكل ملف
// لا لكل مجلد، وإلا أعاد تصحيحُ صورة واحدة تنزيل حزمتها كاملةً (١٩ ميغابايت أحيانًا).
export async function mediaVersions(root = ROOT) {
  const versions = {};
  for (const base of [path.join(root, 'media'), path.join(root, 'public/media')]) {
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    const packs = entries.filter((d) => d.isDirectory()).map((d) => d.name);
    for (const pack of packs.sort()) {
      const files = (await readdir(path.join(base, pack))).filter((f) => !f.startsWith('_') && !f.endsWith('.md')).sort();
      for (const f of files) {
        const info = await stat(path.join(base, pack, f));
        if (!info.isFile()) continue;
        versions[`${pack}/${f}`] = createHash('sha256').update(await readFile(path.join(base, pack, f))).digest('hex').slice(0, 6);
      }
    }
  }
  return versions;
}

export function esbuildOptions({ minify = true, version = '0.0.0', media = {} } = {}) {
  return {
    entryPoints: [path.join(ROOT, 'src/main.jsx')],
    outfile: path.join(DIST, 'bundle.js'),
    bundle: true,
    minify,
    format: 'iife',
    target: ['es2019', 'safari14'],
    jsx: 'automatic',
    // New files are JSX; the migrated trivia game is plain React.createElement
    // in .js and parses fine under the jsx loader too.
    loader: { '.js': 'jsx', '.css': 'text', '.json': 'json', '.webp': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
    define: {
      'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development'),
      __MAYDAN_VERSION__: JSON.stringify(version),
      __MAYDAN_MEDIA_VERSIONS__: JSON.stringify(media),
      __MAYDAN_ROOMS_URL__: JSON.stringify(process.env.MAYDAN_ROOMS_URL || ''),
    },
    legalComments: 'none',
    charset: 'utf8',
    write: false,
    logLevel: 'silent',
  };
}

// A bundle inlined into <script> must never contain a sequence the HTML
// parser would read as the end of the script.
export function escapeInlineScript(js) {
  return js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

export async function renderHtml(js, { version }) {
  const template = await readFile(path.join(ROOT, 'src/index.template.html'), 'utf8');
  const tokens = await readFile(path.join(ROOT, 'src/shared/theme/tokens.css'), 'utf8');
  return template
    .replace('<!--TOKENS_CSS-->', () => tokens)
    .replace('<!--BUNDLE_JS-->', () => escapeInlineScript(js))
    .replaceAll('<!--VERSION-->', version);
}

// buildId يدخل في اسم مخزن العامل الخدمي: الإصدار + بصمة المستند، فأي تغيير
// في index.html يبدّل المخزن ويصل التحديث للمثبّتين من أول فتحة.
export function buildId(version, html) {
  return `${version}-${createHash('sha256').update(html).digest('hex').slice(0, 8)}`;
}

// العامل الخدمي يتلقّى من البناء: معرّف الإصدار، صور فبركة، وأسماء ملفات المؤثرات (بأسمائها
// المبصومة من sample-bank.js) كي يبقى manifest المؤثرات المصدر الوحيد لقائمة التخزين المسبق.
export function renderServiceWorker(src, { id = 'dev', fabrakaImages = [], audioCues = [] } = {}) {
  return src.replaceAll('__BUILD_ID__', id)
    .replace('/*__FABRAKA_IMAGES__*/[]', JSON.stringify(fabrakaImages))
    .replace('/*__AUDIO_CUES__*/[]', JSON.stringify(audioCues));
}
export const audioCueAssets = () => Object.values(SAMPLE_BANK).map((entry) => `./${entry.url}`);

async function copyPublic({ id = 'dev', fabrakaImages = [] } = {}) {
  const pub = path.join(ROOT, 'public');
  try { await stat(pub); } catch { return; }
  for (const entry of await readdir(pub)) {
    await cp(path.join(pub, entry), path.join(DIST, entry), { recursive: true });
  }
  const sw = path.join(DIST, 'sw.js');
  try {
    const src = await readFile(sw, 'utf8');
    await writeFile(sw, renderServiceWorker(src, { id, fabrakaImages, audioCues: audioCueAssets() }), 'utf8');
  } catch { /* لا عامل خدمي في public */ }
}

export async function buildOnce({ minify = true } = {}) {
  const pkg = await readPkg();
  const versions = await mediaVersions(ROOT);
  const fabrakaImages = await fabrakaMediaManifest(ROOT, versions);
  let result;
  try {
    result = await esbuildBuild(esbuildOptions({ minify, version: pkg.version, media: versions }));
  } catch (error) {
    const messages = (error.errors || []).map((e) => `${e.location ? `${e.location.file}:${e.location.line}:${e.location.column} ` : ''}${e.text}`);
    throw new Error(messages.length ? messages.join('\n') : error.message);
  }
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const html = await renderHtml(js, { version: pkg.version });
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await copyPublic({ id: buildId(pkg.version, html), fabrakaImages });
  // الوسائط تُفحص قبل النسخ: سؤال يشير إلى ملف غير موجود يوقف البناء.
  const media = await checkMedia(ROOT);
  if (media.errors.length) {
    throw new Error(`وسائط ناقصة (${media.errors.length}):\n  ${media.errors.slice(0, 12).join('\n  ')}`);
  }
  const copied = await copyMedia(ROOT, DIST);
  const out = path.join(DIST, 'index.html');
  await writeFile(out, html, 'utf8');
  const bytes = Buffer.byteLength(html, 'utf8');
  const gzip = gzipSync(Buffer.from(html, 'utf8')).length;
  return { out, bytes, gzip, version: pkg.version, buildId: buildId(pkg.version, html), warnings: result.warnings, media: { packs: media.packs, files: copied.count, bytes: copied.total } };
}

export function fmtKB(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}
