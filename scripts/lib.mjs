// Shared by build, dev and release: turns the esbuild bundle plus the template
// into the one self-contained HTML document the platform ships as.
import { build as esbuildBuild, transform } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMedia, copyMedia, fmtMB } from './media.mjs';
import { fabrakaMediaManifest } from './fabraka-media.mjs';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';
import { LIVEKIT_VERSION, LIVEKIT_MODULE } from '../src/social/media-version.js';
import { privateAudioBuild, verifyMaterialized } from './audio/private-preview.mjs';
import { CANDIDATE_EFFECTS } from '../src/shared/fx/audio-candidate-catalog.js';

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

// assets: 'inline' embeds the brand art and fonts as data: URLs (pages served under
// another path, like the studio previews, and the test harnesses that serve only the
// document). 'files' emits them as content-hashed files under assets/brand/ next to
// index.html: the game document stops carrying ~730 KB of base64, and a release that
// does not touch the art lets browsers keep the files they already have.
export const BRAND_ASSET_DIR = 'assets/brand';

// CSS is injected by React as text, so the JS minifier cannot remove its source
// comments or whitespace. Parse it as CSS first without rewriting declarations,
// identifiers, vendor prefixes or browser features. Development keeps exact text.
export function minifiedCssTextPlugin() {
  return {
    name: 'minified-css-text',
    setup(build) {
      build.onLoad({ filter: /\.css$/, namespace: 'file' }, async ({ path: file }) => {
        const source = await readFile(file, 'utf8');
        const result = await transform(source, { sourcefile: file, loader: 'css',
          minifyWhitespace: true, minifySyntax: false, minifyIdentifiers: false,
          charset: 'utf8', legalComments: 'none' });
        return { contents: result.code, loader: 'text', resolveDir: path.dirname(file),
          watchFiles: [file], warnings: result.warnings };
      });
    },
  };
}

export function esbuildOptions({ minify = true, version = '0.0.0', media = {}, assets = 'inline' } = {}) {
  const art = assets === 'files' ? 'file' : 'dataurl';
  return {
    entryPoints: [path.join(ROOT, 'src/main.jsx')],
    outfile: path.join(DIST, 'bundle.js'),
    bundle: true,
    minify,
    format: 'iife',
    target: ['es2019', 'safari14'],
    jsx: 'automatic',
    alias: { 'react/jsx-runtime': path.join(ROOT, 'src/design/jsx-runtime.js') },
    // New files are JSX; the migrated trivia game is plain React.createElement
    // in .js and parses fine under the jsx loader too.
    loader: { '.js': 'jsx', '.css': 'text', '.json': 'json', '.webp': art, '.png': art, '.woff2': art },
    ...(minify ? { plugins: [minifiedCssTextPlugin()] } : {}),
    ...(assets === 'files' ? { assetNames: `${BRAND_ASSET_DIR}/[name]-[hash]` } : {}),
    define: {
      'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development'),
      __MAYDAN_VERSION__: JSON.stringify(version),
      __MAYDAN_MEDIA_VERSIONS__: JSON.stringify(media),
      __MAYDAN_ROOMS_URL__: JSON.stringify(process.env.MAYDAN_ROOMS_URL || ''),
      __MAYDAN_AUDIO_PREVIEW__: JSON.stringify(privateAudioBuild()),
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

// The splash art and the two fonts are needed for the first frame: preloading them
// lets their download start while the inline script is still being parsed.
const PRELOAD = [
  { pattern: /\/(world|game-icons|avatars)-[^/]+\.webp$/, tag: (href) => `<link rel="preload" as="image" href="${href}">` },
  { pattern: /\/(arabic|latin)-[^/]+\.woff2$/, tag: (href) => `<link rel="preload" as="font" type="font/woff2" href="${href}" crossorigin>` },
];
export function preloadLinks(assets = []) {
  return assets.flatMap((href) => PRELOAD.filter((rule) => rule.pattern.test(href)).map((rule) => rule.tag(href))).join('\n');
}

export async function renderHtml(js, { version, assets = [] }) {
  const template = await readFile(path.join(ROOT, 'src/index.template.html'), 'utf8');
  const tokens = await readFile(path.join(ROOT, 'src/shared/theme/tokens.css'), 'utf8');
  return template
    .replace('<!--PRELOAD-->', () => preloadLinks(assets))
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
export function renderServiceWorker(src, { id = 'dev', fabrakaImages = [], audioCues = [], brandAssets = [] } = {}) {
  return src.replaceAll('__BUILD_ID__', id)
    .replace('/*__FABRAKA_IMAGES__*/[]', JSON.stringify(fabrakaImages))
    .replace('/*__AUDIO_CUES__*/[]', JSON.stringify(audioCues))
    .replace('/*__BRAND_ASSETS__*/[]', JSON.stringify(brandAssets));
}
export const audioCueAssets = () => [...new Set([
  ...Object.values(SAMPLE_BANK).map((entry) => `./${entry.url}`),
  ...(privateAudioBuild() ? Object.values(CANDIDATE_EFFECTS).map((entry) => `./${entry.url}`) : []),
])];

async function copyPublic({ id = 'dev', fabrakaImages = [], brandAssets = [] } = {}) {
  const pub = path.join(ROOT, 'public');
  try { await stat(pub); } catch { return; }
  for (const entry of await readdir(pub)) {
    await cp(path.join(pub, entry), path.join(DIST, entry), { recursive: true,
      filter: (source) => privateAudioBuild() || !path.relative(pub, source).split(path.sep).join('/').match(/^audio\/candidates(?:\/|$)/) });
  }
  const sw = path.join(DIST, 'sw.js');
  try {
    const src = await readFile(sw, 'utf8');
    await writeFile(sw, renderServiceWorker(src, { id, fabrakaImages, audioCues: audioCueAssets(), brandAssets }), 'utf8');
  } catch { /* لا عامل خدمي في public */ }
}

export async function buildOnce({ minify = true, includeStudio = true } = {}) {
  if (privateAudioBuild()) await verifyMaterialized(ROOT);
  const pkg = await readPkg();
  const versions = await mediaVersions(ROOT);
  const fabrakaImages = await fabrakaMediaManifest(ROOT, versions);
  let result;
  try {
    result = await esbuildBuild(esbuildOptions({ minify, version: pkg.version, media: versions, assets: 'files' }));
  } catch (error) {
    const messages = (error.errors || []).map((e) => `${e.location ? `${e.location.file}:${e.location.line}:${e.location.column} ` : ''}${e.text}`);
    throw new Error(messages.length ? messages.join('\n') : error.message);
  }
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const art = result.outputFiles.filter((f) => !f.path.endsWith('.js'));
  const brandAssets = art.map((f) => `./${path.relative(DIST, f.path).split(path.sep).join('/')}`).sort();
  if (!brandAssets.every((url) => url.startsWith(`./${BRAND_ASSET_DIR}/`))) throw new Error(`Unexpected bundle output: ${brandAssets.join(', ')}`);
  const html = await renderHtml(js, { version: pkg.version, assets: brandAssets });
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  for (const file of art) {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
  }
  await copyPublic({ id: buildId(pkg.version, html), fabrakaImages, brandAssets });
  if (pkg.dependencies['livekit-client'] !== LIVEKIT_VERSION) throw new Error('Update the versioned LiveKit module filename with its pinned dependency.');
  await esbuildBuild({ stdin: { contents: "export { Room, RoomEvent, Track } from 'livekit-client';", resolveDir: ROOT, sourcefile: 'lamma-web-audio.js' },
    outfile: path.join(DIST, LIVEKIT_MODULE), bundle: true, format: 'esm', target: ['es2020', 'safari14'], minify: true,
    define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof', logLevel: 'silent' });
  // الوسائط تُفحص قبل النسخ: سؤال يشير إلى ملف غير موجود يوقف البناء.
  const media = await checkMedia(ROOT);
  if (media.errors.length) {
    throw new Error(`وسائط ناقصة (${media.errors.length}):\n  ${media.errors.slice(0, 12).join('\n  ')}`);
  }
  const copied = await copyMedia(ROOT, DIST);
  const out = path.join(DIST, 'index.html');
  await writeFile(out, html, 'utf8');
  if (includeStudio) {
    const { buildStudio } = await import('./studio-build.mjs');
    const { buildDesignPreview } = await import('./design-preview-build.mjs');
    await buildStudio({ outdir: path.join(DIST, 'studio'), minify });
    await buildDesignPreview({ outdir: DIST, minify, version: pkg.version, media: versions });
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  const gzip = gzipSync(Buffer.from(html, 'utf8')).length;
  return { out, bytes, gzip, version: pkg.version, buildId: buildId(pkg.version, html), warnings: result.warnings, brandAssets, media: { packs: media.packs, files: copied.count, bytes: copied.total } };
}

export function fmtKB(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}
