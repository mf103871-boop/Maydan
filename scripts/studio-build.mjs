import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildStudio({ outdir = path.join(ROOT, 'dist', 'studio'), minify = true, define = {} } = {}) {
  await mkdir(outdir, { recursive: true });
  const result = await build({ entryPoints: [path.join(ROOT, 'src/studio/main.jsx')], outfile: path.join(outdir, 'studio.js'), bundle: true, minify, write: false, metafile: true, format: 'iife', target: ['es2022', 'safari16.4'], jsx: 'automatic', loader: { '.css': 'text', '.woff2': 'dataurl' }, define: { 'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development'), ...define }, legalComments: 'none' });
  const script = result.outputFiles.find((file) => file.path.endsWith('.js'));
  await writeFile(path.join(outdir, 'studio.js'), script.contents);
  const html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="same-origin"><meta name="theme-color" content="#fff7e7"><title>استوديو ميدان — صمّم تجربتك</title></head><body><div id="studio-root"></div><noscript>فعّل JavaScript لفتح محرّر ميدان.</noscript><script src="/api/studio/studio.js" defer></script></body></html>';
  await writeFile(path.join(outdir, 'index.html'), html);
  return { outdir, bytes: script.contents.length, files: ['index.html', 'studio.js'], warnings: result.warnings, metafile: result.metafile };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildStudio(); console.log(`Studio: ${result.bytes} bytes → ${result.outdir}`);
}
