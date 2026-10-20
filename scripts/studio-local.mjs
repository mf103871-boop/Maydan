// Isolated development/test server. All accounts, SQLite data and object bytes
// are disposable. Never reads .dev.vars or contacts Cloudflare/Apple/LiveKit.
import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createLocalD1 } from '../server/local-d1.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeDesign } from '../server/design/router.mjs';
import { errorResponse } from '../server/protocol.mjs';
import {studioMediaResponse} from '../server/design/site.mjs';
import {readStudioMedia} from './studio-media.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav' };
export async function startStudioLocal({ port = 0, assetsDir = path.join(ROOT, 'dist'), publishEnabled = false, legacyServiceWorker = false } = {}) {
  const DB = createLocalD1(), objects = new Map();
  const release='studio-local-public-media',staticMedia=new Map((await readStudioMedia()).map(entry=>[`studio-site/${release}/${entry.keySuffix}`,entry.data]));
  const legacyWorker = legacyServiceWorker ? (await readFile(path.join(ROOT, 'public/sw.js'), 'utf8')).replaceAll('__BUILD_ID__', 'studio-legacy-e2e') : null;
  const env = { DB, DESIGN_STUDIO_RELEASE:release, DESIGN_EDITOR_USER_IDS: 'studio-test-owner', DESIGN_PUBLISH_ENABLED: publishEnabled ? '1' : '0', SOCIAL_AUDIO: {
    async put(key, value) { objects.set(key, new Uint8Array(value)); },
    async get(key) { const bytes = objects.get(key)||staticMedia.get(key); return bytes ? {body:bytes,size:bytes.length,arrayBuffer:async()=>bytes} : null; },
    async delete(key) { objects.delete(key); },
  } };
  const sessions = {};
  for (const id of ['studio-test-owner', 'studio-test-player']) {
    await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(id, id === 'studio-test-owner' ? 'مالك تجريبي' : 'لاعب تجريبي', Date.now(), Date.now()).run();
    sessions[id] = await issueSession(env, id);
  }
  let origin;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin || 'http://127.0.0.1');
      if (legacyWorker && url.pathname === '/__studio_legacy_sw.js') { response.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store', 'service-worker-allowed': '/' }); response.end(legacyWorker); return; }
      if (legacyWorker && url.pathname === '/__studio_sw_probe') { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' }); response.end('<!doctype html><html><body><main>Isolated old worker probe</main><script>navigator.serviceWorker.register("/__studio_legacy_sw.js",{scope:"/"});</script></body></html>'); return; }
      if(url.pathname.startsWith('/api/studio/media/')){const result=await studioMediaResponse(new Request(url,{method:request.method}),env);response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));return;}
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/studio/')) {
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 6 * 1024 * 1024) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        const input = new Request(url, { method: request.method, headers, ...(!['GET', 'HEAD'].includes(request.method) ? { body: Buffer.concat(chunks) } : {}) });
        const output = await routeDesign(input, env);
        if (!output) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{"error":"NOT_FOUND"}'); return; }
        response.writeHead(output.status, Object.fromEntries(output.headers)); response.end(Buffer.from(await output.arrayBuffer())); return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const decoded = decodeURIComponent(url.pathname).replace(/^\/api\/studio\//, '/studio/');
      let file = path.resolve(assetsDir, `.${decoded}`);
      if (file !== path.resolve(assetsDir) && !file.startsWith(`${path.resolve(assetsDir)}${path.sep}`)) { response.writeHead(403); response.end(); return; }
      let info = await stat(file).catch(() => null);
      if(!info && decoded.startsWith('/media/'))for(const base of [path.join(ROOT,'public/media'),path.join(ROOT,'media')]){
        const candidate=path.resolve(base,decoded.slice('/media/'.length));
        if(!candidate.startsWith(path.resolve(base)+path.sep))continue;
        const fallback=await stat(candidate).catch(()=>null);if(fallback?.isFile()){file=candidate;info=fallback;break;}
      }
      if (info?.isDirectory()) file = path.join(file, 'index.html');
      const bytes = await readFile(file);
      response.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }); response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (error.code === 'ENOENT') { response.writeHead(404); response.end(); }
      else { const result = errorResponse(error); response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text()); }
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, env, DB, sessions, objects, legacyWorkerSha256: legacyWorker ? createHash('sha256').update(legacyWorker).digest('hex') : null, async close() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); DB.close(); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await startStudioLocal({ port: 3044 }); console.log(`Isolated Studio: ${runtime.origin}/studio/`);
  const close = () => runtime.close().finally(() => process.exit(0)); process.on('SIGINT', close); process.on('SIGTERM', close);
}
