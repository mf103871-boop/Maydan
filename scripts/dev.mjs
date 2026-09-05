// Dev loop: rebuild dist/ on every change under src/ and serve it. No bundler
// dev-server magic — the shipped artifact is one HTML file, so the dev page is
// exactly that file, regenerated.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { buildOnce, DIST, ROOT, fmtKB } from './lib.mjs';

const PORT = Number(process.env.PORT || 3000);
const serveOnly = process.argv.includes('--serve-only');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

let building = null;
async function rebuild(reason) {
  if (building) return building;
  building = (async () => {
    try {
      const r = await buildOnce({ minify: false });
      console.log(`[dev] built (${reason}) · ${fmtKB(r.bytes)}`);
    } catch (error) {
      console.error('[dev] build failed:', error.message || error);
    } finally {
      building = null;
    }
  })();
  return building;
}

if (!serveOnly) {
  await rebuild('start');
  let timer = null;
  watch(path.join(ROOT, 'src'), { recursive: true }, (_event, file) => {
    clearTimeout(timer);
    timer = setTimeout(() => rebuild(file || 'change'), 120);
  });
}

http
  .createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(DIST, p);
      if (!file.startsWith(DIST)) throw new Error('outside dist');
      const s = await stat(file);
      if (s.isDirectory()) throw new Error('dir');
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  })
  .listen(PORT, () => console.log(`[dev] http://localhost:${PORT}/`));
