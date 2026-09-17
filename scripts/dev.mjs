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
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
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

const server = http
  .createServer(async (req, res) => {
    try {
      const requested = new URL(req.url, 'http://x');
      let p = decodeURIComponent(requested.pathname);
      // This preview serves files only. Never present a missing OAuth endpoint
      // as a working login service, or silently proxy real account requests.
      if (p === '/api' || p.startsWith('/api/')) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'PREVIEW_ONLY' }));
        return;
      }
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(DIST, p);
      const relative = path.relative(DIST, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('outside dist');
      const s = await stat(file);
      if (s.isDirectory()) {
        res.writeHead(308, { Location: requested.pathname + '/' + requested.search });
        res.end();
        return;
      }
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
  .listen(PORT, () => console.log(`[dev] http://localhost:${server.address().port}/`));
