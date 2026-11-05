import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { presentationCssPlugin } from '../presentation-css.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const contentType = { '.woff2': 'font/woff2', '.webp': 'image/webp' };
const font = '@font-face{font-family:"Maydan Round";font-weight:400 800;font-display:swap;src:url("/fonts/latin.woff2") format("woff2")}@font-face{font-family:"Maydan Round";font-weight:400 800;font-display:swap;src:url("/fonts/arabic.woff2") format("woff2");unicode-range:U+0600-06FF,U+0750-077F,U+0870-089F,U+08A0-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFF}';
const HTML = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="icon" href="data:,"><title>معاينة بروفايل ميدان</title><style>'+font+'</style><script defer src="/preview.js"></script></head><body><div id="root"></div></body></html>';

export async function startProgressionPreview({ port = 4194 } = {}) {
  const manifest = JSON.parse(await readFile(path.join(HERE, 'asset-manifest.json'), 'utf8'));
  const files = new Map();
  for (const asset of manifest.assets) {
    if (typeof asset.path !== 'string' || !/^(public\/assets\/progression\/v1\/[a-z0-9-]+\.webp|scripts\/progression-preview\/art\/[a-z0-9-]+\.webp|src\/shared\/brand\/assets\/(?:latin|arabic)\.woff2)$/.test(asset.path)) continue;
    const file = await realpath(path.join(ROOT, asset.path));
    if (!path.relative(ROOT, file) || path.relative(ROOT, file).startsWith('..')) throw new Error('Preview asset outside checkout');
    const bytes = await readFile(file);
    if (asset.sha256 && createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Preview asset fingerprint changed: ' + asset.id);
    const url = asset.path.startsWith('public/') ? '/' + asset.path.slice(7)
      : (asset.path.startsWith('scripts/') ? '/fixture-art/' : '/fonts/') + path.basename(asset.path);
    files.set(url, [bytes, contentType[path.extname(file)]]);
  }
  for (const name of ['arabic', 'latin']) {
    const url = '/fonts/' + name + '.woff2';
    if (!files.has(url)) files.set(url, [await readFile(path.join(ROOT, 'src/shared/brand/assets', name + '.woff2')), 'font/woff2']);
  }
  const bundle = await build({
    absWorkingDir: ROOT, entryPoints: [path.join(HERE, 'main.jsx')], format: 'iife', bundle: true, write: false,
    jsx: 'automatic', target: ['es2022', 'safari16'], minify: true, logLevel: 'silent',
    loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [presentationCssPlugin()],
  });
  files.set('/preview.js', [bundle.outputFiles[0].contents, 'text/javascript; charset=utf-8']);
  files.set('/', [HTML, 'text/html; charset=utf-8']);
  const server = http.createServer((request, response) => {
    if (request.headers['sec-fetch-site'] === 'cross-site'
      || !['GET', 'HEAD'].includes(request.method)
      || !/^127\.0\.0\.1:\d+$/.test(request.headers.host || '')) {
      response.writeHead(403).end(); return;
    }
    const rawPath = request.url.split('?')[0];
    const value = files.get(rawPath);
    if (!value) { response.writeHead(404).end(); return; }
    response.writeHead(200, {
      'content-type': value[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; script-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    });
    response.end(request.method === 'HEAD' ? undefined : value[0]);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  return { url, close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = process.argv[2] === undefined ? 4194 : Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Specify an available local port from 1024 to 65535');
  const app = await startProgressionPreview({ port });
  console.log(app.url + ' — local synthetic board');
  console.log(app.url + '?view=phone — shared phone profile');
}
