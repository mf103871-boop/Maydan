// Shared by build, dev and release: turns the esbuild bundle plus the template
// into the one self-contained HTML document the platform ships as.
import { build as esbuildBuild } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = path.join(ROOT, 'dist');

export async function readPkg() {
  return JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
}

// esbuild options shared by the one-shot build and the dev watcher.
export function esbuildOptions({ minify = true, version = '0.0.0' } = {}) {
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
    loader: { '.js': 'jsx', '.css': 'text', '.json': 'json', '.webp': 'dataurl', '.png': 'dataurl' },
    define: {
      'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development'),
      __MAYDAN_VERSION__: JSON.stringify(version),
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

async function copyPublic() {
  const pub = path.join(ROOT, 'public');
  try { await stat(pub); } catch { return; }
  for (const entry of await readdir(pub)) {
    await cp(path.join(pub, entry), path.join(DIST, entry), { recursive: true });
  }
}

export async function buildOnce({ minify = true } = {}) {
  const pkg = await readPkg();
  let result;
  try {
    result = await esbuildBuild(esbuildOptions({ minify, version: pkg.version }));
  } catch (error) {
    const messages = (error.errors || []).map((e) => `${e.location ? `${e.location.file}:${e.location.line}:${e.location.column} ` : ''}${e.text}`);
    throw new Error(messages.length ? messages.join('\n') : error.message);
  }
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const html = await renderHtml(js, { version: pkg.version });
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await copyPublic();
  const out = path.join(DIST, 'index.html');
  await writeFile(out, html, 'utf8');
  const bytes = Buffer.byteLength(html, 'utf8');
  const gzip = gzipSync(Buffer.from(html, 'utf8')).length;
  return { out, bytes, gzip, version: pkg.version, warnings: result.warnings };
}

export function fmtKB(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}
