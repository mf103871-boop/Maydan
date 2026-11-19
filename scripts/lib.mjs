// Shared by build, dev and release: turns the esbuild bundle plus the template
// into the one self-contained HTML document the platform ships as.
import { build as esbuildBuild, transform } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm, readdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMedia, copyMedia, fmtMB } from './media.mjs';
import { fabrakaMediaManifest } from './fabraka-media.mjs';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';
import { LIVEKIT_VERSION, LIVEKIT_MODULE } from '../src/social/media-version.js';
import { privateAudioBuild, verifyMaterialized } from './audio/private-preview.mjs';
import { warmthAudioBuild, validateWarmthManifest, verifyWarmthMaterialized, WARMTH_DIRECTORY } from './audio/warmth-preview.mjs';
import { CANDIDATE_EFFECTS } from '../src/shared/fx/audio-candidate-catalog.js';
import { audioCatalogPackagingPlugin } from './audio/catalog-packaging.mjs';
import { designRuntimePackagingPlugin } from './design-runtime-packaging.mjs';
import { bankPackagingPlugin } from './lib/bank-packaging.mjs';
import { localePackagingPlugin } from './lib/locale-packaging.mjs';
import { writeWebGamePack } from './lib/web-game-pack.mjs';
import { presentationCssPlugin } from './presentation-css.mjs';
import { ticketPolicyEnabled } from '../src/shared/account/gameplay-policy.mjs';

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

// Adjacent sorted paths share most of their prefix. Keep every per-file hash,
// but store that prefix length rather than repeating complete media paths in
// the single HTML document. Noncanonical future keys fall back to the map.
export function encodeMediaVersions(media = {}) {
  const entries = Object.entries(media).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (!entries.length || entries.some(([key, hash]) => /[|:]/.test(key) || !/^[a-f0-9]{6}$/.test(hash))) return media;
  // p3 abbreviates only complete .webp tails. Prefix lengths still refer to
  // the original path. Literal ~ names retain the lossless p2 representation.
  const compactPaths = !entries.some(([key]) => key.includes('~'));
  let previous = '';
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-';
  return (compactPaths ? 'p3|' : 'p2|') + entries.map(([key, hash]) => {
    let prefix = 0;
    while (prefix < previous.length && prefix < key.length && previous[prefix] === key[prefix]) prefix++;
    const value = parseInt(hash, 16);
    const compactHash = [18, 12, 6, 0].map(shift => alphabet[(value >>> shift) & 63]).join('');
    const suffix = compactPaths ? key.slice(prefix).replace(/\.webp$/, '~') : key.slice(prefix);
    const row = `${prefix.toString(36)}:${suffix}:${compactHash}`;
    previous = key;
    return row;
  }).join('|');
}
export function esbuildOptions({ minify = true, version = '0.0.0', media = {}, assets = 'inline', outdir = DIST, rewardedPreview = false, rewardedSimulation = false, roomsUrl = process.env.MAYDAN_ROOMS_URL || '' } = {}) {
  const art = assets === 'files' ? 'file' : 'dataurl';
  const warmth = warmthAudioBuild();
  const warmthPack = warmth ? validateWarmthManifest(JSON.parse(readFileSync(path.join(ROOT, WARMTH_DIRECTORY, 'manifest.json'), 'utf8'))).runtimePack : null;
  return {
    entryPoints: [path.join(ROOT, 'src/main.jsx')],
    outfile: path.join(outdir, 'bundle.js'),
    bundle: true,
    minify,
    format: 'iife',
    // The signed native path can keep ES2020 syntax supported by its WebView.
    // Ordinary browser and simulation bundles retain their compatibility target.
    target: [rewardedPreview && !rewardedSimulation ? 'es2020' : 'es2019', 'safari14'],
    jsx: 'automatic',
    alias: { 'react/jsx-runtime': path.join(ROOT, 'src/design/jsx-runtime.js') },
    // New files are JSX; the migrated trivia game is plain React.createElement
    // in .js and parses fine under the jsx loader too.
    loader: { '.js': 'jsx', '.css': 'text', '.json': 'json', '.webp': art, '.png': art, '.woff2': art },
    plugins: [presentationCssPlugin({ assets, minify }), ...(assets === 'files' ? [localePackagingPlugin()] : []), ...(minify ? [minifiedCssTextPlugin(), audioCatalogPackagingPlugin(), designRuntimePackagingPlugin(), bankPackagingPlugin()] : [])],
    ...(assets === 'files' ? { assetNames: `${BRAND_ASSET_DIR}/[name]-[hash]` } : {}),
    define: {
      'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development'),
      __MAYDAN_VERSION__: JSON.stringify(version),
      __MAYDAN_MEDIA_VERSIONS__: JSON.stringify(encodeMediaVersions(media)),
      __MAYDAN_ROOMS_URL__: JSON.stringify(roomsUrl),
      __MAYDAN_REWARDED_PREVIEW__: JSON.stringify(rewardedPreview === true),
      __MAYDAN_REWARDED_SIMULATION__: JSON.stringify(rewardedPreview === true && rewardedSimulation === true),
      __MAYDAN_GAMEPLAY_POLICY__: JSON.stringify(ticketPolicyEnabled(process.env.MAYDAN_GAMEPLAY_ACCESS_POLICY) ? process.env.MAYDAN_GAMEPLAY_ACCESS_POLICY : null),
      __MAYDAN_AUDIO_PREVIEW__: JSON.stringify(privateAudioBuild()),
      __MAYDAN_WARMTH_PREVIEW__: JSON.stringify(warmth),
      __MAYDAN_WARMTH_PACK__: JSON.stringify(warmthPack),
      // The separate loopback audition entry overrides this explicitly. An
      // environment variable or runtime preference cannot enable it in a build.
      __MAYDAN_LOCAL_AUDIO_REVIEW__: 'false',
      // Local review tools are excluded from normal web/native builds.
      __MAYDAN_UI_PREVIEW__: JSON.stringify(process.env.MAYDAN_UI_PREVIEW === '1'),
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

// Preload the normal body and strongest heading faces in both scripts.
// Intermediate static weights load normally only when the page uses them.
const PRELOAD = [
  { pattern: /\.css$/, tag: (href) => `<link rel="preload" as="style" href="${href}">` },
  { pattern: /\/(world|game-icons|avatars)-[^/]+\.webp$/, tag: (href) => `<link rel="preload" as="image" href="${href}">` },
  { pattern: /\/(arabic|latin)-(400|800)-[^/]+\.woff2$/, tag: (href) => `<link rel="preload" as="font" type="font/woff2" href="${href}" crossorigin>` },
];
export function preloadLinks(assets = []) {
  return assets.flatMap((href) => PRELOAD.filter((rule) => rule.pattern.test(href)).map((rule) => rule.tag(href))).join('\n');
}

function openingFontFaces(assets) {
  const arabicRange = 'U+0600-06FF,U+0750-077F,U+0870-089F,U+08A0-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFF';
  const latin = [], arabic = [];
  for (const url of assets) {
    const match = /\/(arabic|latin)-(400|800)-[a-z0-9]+\.woff2$/i.exec(url);
    if (!match) continue;
    const rtl = match[1] === 'arabic';
    const range = rtl ? ';unicode-range:' + arabicRange : '';
    (rtl ? arabic : latin).push(`@font-face{font-family:'Maydan Opening';font-weight:${match[2]};font-display:swap;src:url('${url}') format('woff2')${range}}`);
  }
  return [...latin, ...arabic].join('');
}

export async function renderHtml(js, { version, assets = [], sourceCommit = process.env.GITHUB_SHA || '', roomsUrl = process.env.MAYDAN_ROOMS_URL || '' }) {
  if (sourceCommit && !/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Build source must be a complete Git commit SHA.');
  const template = (await readFile(path.join(ROOT, 'src/index.template.html'), 'utf8'))
    .replace(/>[\t \r]*\n[\t \r\n]*(?=<)/g, '>');
  const boot = await esbuildBuild({ entryPoints: [path.join(ROOT, 'src/boot-guard.js')],
    bundle: true, format: 'iife', write: false, minify: true, target: ['es2019', 'safari14'],
    define: { __MAYDAN_ROOMS_URL__: JSON.stringify(roomsUrl) }, charset: 'utf8', legalComments: 'none' });
  // Apply the same CSS compression to the critical styles delivered in HTML.
  const tokens = await readFile(path.join(ROOT, 'src/shared/theme/tokens.css'), 'utf8');
  const criticalStyle = /<style>([\s\S]*?)<\/style>/.exec(template)[1]
    .replace('<!--TOKENS_CSS-->', () => tokens)
    .replace('<!--OPENING_FONTS-->', () => openingFontFaces(assets));
  const styles = (await transform(criticalStyle, {
    loader: 'css', minify: true, legalComments: 'none',
  })).code;
  const recoveryArt = assets.find(url => /\/recovery-puzzle-v1-[a-z0-9]+\.webp$/i.test(url));
  return template
    .replace('</head>', () => `${sourceCommit ? `<meta name="maydan-source" content="${sourceCommit}">` : ''}</head>`)
    .replace('<!--PRELOAD-->', () => preloadLinks(assets))
    .replaceAll('<!--OPENING_RECOVERY_ART-->', () => recoveryArt ? `<img class="opening-recovery-art" width="140" height="120" alt="" src="${recoveryArt}">` : '')
    .replace(/<style>[\s\S]*?<\/style>/, () => '<style>' + styles + '</style>')
    .replace('<!--BOOT_GUARD_JS-->', () => escapeInlineScript(boot.outputFiles[0].text))
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
export function renderServiceWorker(src, { id = 'dev', fabrakaImages = [], audioCues = [], brandAssets = [], manifest = '' } = {}) {
  return src.replaceAll('__BUILD_ID__', id)
    .replace('/*__GAME_PACK__*/null', JSON.stringify(manifest || null))
    .replace('/*__FABRAKA_IMAGES__*/[]', JSON.stringify(fabrakaImages))
    .replace('/*__AUDIO_CUES__*/[]', JSON.stringify(audioCues))
    .replace('/*__BRAND_ASSETS__*/[]', JSON.stringify(brandAssets));
}
export const audioCueAssets = () => warmthAudioBuild()
  ? Object.values(validateWarmthManifest(JSON.parse(readFileSync(path.join(ROOT, WARMTH_DIRECTORY, 'manifest.json'), 'utf8'))).runtimePack.assets).filter(entry => entry.kind === 'effect').map(entry => `./audio-warmth-preview/${entry.file.url}`)
  : [...new Set([
  ...Object.values(SAMPLE_BANK).map((entry) => `./${entry.url}`),
  ...(privateAudioBuild() ? Object.values(CANDIDATE_EFFECTS).map((entry) => `./${entry.url}`) : []),
])];

async function copyPublic(outdir) {
  const pub = path.join(ROOT, 'public');
  try { await stat(pub); } catch { return; }
  for (const entry of await readdir(pub)) {
    await cp(path.join(pub, entry), path.join(outdir, entry), { recursive: true,
      filter: (source) => {
        const relative = path.relative(pub, source).split(path.sep).join('/');
        if (/^audio-warmth-preview(?:\/|$)/.test(relative)) return warmthAudioBuild();
        if (/^audio\/candidates(?:\/|$)/.test(relative)) return privateAudioBuild() && !warmthAudioBuild();
        return true;
      } });
  }
}

export async function buildOnce({ minify = true, includeStudio = true, includePackTransport = true, version: releaseVersion, outdir = DIST, rewardedPreview = false, rewardedSimulation = false, roomsUrl = process.env.MAYDAN_ROOMS_URL || '' } = {}) {
  if (warmthAudioBuild()) await verifyWarmthMaterialized(ROOT);
  else if (privateAudioBuild()) await verifyMaterialized(ROOT);
  const pkg = await readPkg();
  const version = releaseVersion ?? pkg.version;
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error('Explicit application version is invalid.');
  const versions = await mediaVersions(ROOT);
  const fabrakaImages = await fabrakaMediaManifest(ROOT, versions);
  let result;
  try {
    result = await esbuildBuild(esbuildOptions({ minify, version, media: versions, assets: 'files', outdir, rewardedPreview, rewardedSimulation, roomsUrl }));
  } catch (error) {
    const messages = (error.errors || []).map((e) => `${e.location ? `${e.location.file}:${e.location.line}:${e.location.column} ` : ''}${e.text}`);
    throw new Error(messages.length ? messages.join('\n') : error.message);
  }
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const art = result.outputFiles.filter((f) => !f.path.endsWith('.js'));
  const packagedAssets = art.map((f) => `./${path.relative(outdir, f.path).split(path.sep).join('/')}`).sort();
  if (!packagedAssets.every((url) => url.startsWith(`./${BRAND_ASSET_DIR}/`))) throw new Error(`Unexpected bundle output: ${packagedAssets.join(', ')}`);
  // Optional language packs are fetched on first use. They do not delay Arabic
  // startup or service-worker installation by precaching every English game.
  const brandAssets = packagedAssets.filter(url => !/\/locale-en-[^/]+\.json$/.test(url));
  const template = await renderHtml(js, { version, assets: brandAssets, roomsUrl });
  // An explicit destination is owned by its caller. Leave its other files
  // alone. The standard build retains its clean dist replacement.
  if (outdir === DIST) await rm(DIST, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  for (const file of art) {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
  }
  await copyPublic(outdir);
  if (pkg.dependencies['livekit-client'] !== LIVEKIT_VERSION) throw new Error('Update the versioned LiveKit module filename with its pinned dependency.');
  await esbuildBuild({ stdin: { contents: "export { Room, RoomEvent, Track } from 'livekit-client';", resolveDir: ROOT, sourcefile: 'lamma-web-audio.js' },
    outfile: path.join(outdir, LIVEKIT_MODULE), bundle: true, format: 'esm', target: ['es2020', 'safari14'], minify: true,
    define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof', logLevel: 'silent' });
  // الوسائط تُفحص قبل النسخ: سؤال يشير إلى ملف غير موجود يوقف البناء.
  const media = await checkMedia(ROOT);
  if (media.errors.length) {
    throw new Error(`وسائط ناقصة (${media.errors.length}):\n  ${media.errors.slice(0, 12).join('\n  ')}`);
  }
  const copied = await copyMedia(ROOT, outdir);
  const out = path.join(outdir, 'index.html');
  const pack = await writeWebGamePack({
    root: ROOT, outdir, template, includePackTransport, outputs: [...packagedAssets.map(file => file.slice(2)), LIVEKIT_MODULE],
    worker: await readFile(path.join(outdir, 'sw.js'), 'utf8'),
    renderWorker: (worker, manifest, html) => renderServiceWorker(worker, { id: buildId(version, html),
      fabrakaImages, audioCues: audioCueAssets(), brandAssets, manifest }),
  });
  const { html } = pack;
  if (includeStudio) {
    const { buildStudio } = await import('./studio-build.mjs');
    const { buildDesignPreview } = await import('./design-preview-build.mjs');
    await buildStudio({ outdir: path.join(outdir, 'studio'), minify });
    await buildDesignPreview({ outdir, minify, version, media: versions });
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  const gzip = gzipSync(Buffer.from(html, 'utf8')).length;
  return { out, bytes, gzip, version, buildId: buildId(version, html), warnings: result.warnings, brandAssets,
    gamePack: { manifest: pack.manifest, totalBytes: pack.totalBytes, totalFiles: pack.totalFiles },
    media: { packs: media.packs, files: copied.count, bytes: copied.total } };
}

export function fmtKB(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}
