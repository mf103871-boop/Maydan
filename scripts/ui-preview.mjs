// Local review only. No .dev.vars, provider credentials, deploy or remote database.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession, me } from '../server/accounts/session.mjs';
import { buildOnce, DIST, ROOT } from './lib.mjs';
import { GAME_MODE_SUPPORT } from '../src/shared/game-mode-support.mjs';
import { createLocalPreviewRooms } from './ui-preview/rooms.mjs';

export function localRequestAllowed(request, port) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!allowed.has(request.headers.host)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try { return ['http:'].includes(new URL(origin).protocol) && allowed.has(new URL(origin).host); } catch { return false; }
}
export function localAssetPath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  // URL asset paths use forward slashes on every host. Reject encoded Windows
  // separators explicitly so the same confinement holds on macOS/Linux CI.
  if (decoded.includes('\\') || decoded.includes('\0')) throw Error('Invalid local asset path');
  const file = path.resolve(root, '.' + decoded);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Outside local assets');
  return file;
}
const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

export async function startUIReview({ port = 4178, apiPort = 8789, build = true, watchSource = true } = {}) {
  if (![port, apiPort].every(x => Number.isInteger(x) && x > 1024 && x < 65536) || port === apiPort) throw Error('Choose distinct local ports');
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://127.0.0.1:${apiPort}`];
  const backend = await startLocalServer({ port: apiPort, host: '127.0.0.1', origins: origins.join(','), vars: {
    SESSION_SECRET: randomBytes(32).toString('hex'), AUTH_DEV_FAKE: '1', PADDLE_ENV: 'sandbox',
    APP_ORIGIN: origins[0], MAFIA_ENABLED: '1', MAFIA_ACCEPT_NEW_MATCHES: '1',
    MAFIA_PROGRESS_ENABLED: '1', MAFIA_MAX_ACTIVE_ROOMS: '8', MAFIA_MAX_VOICE_PARTICIPANTS: '80',
    ONLINE_PUBLIC_DIRECTORY_ENABLED: '1', IOS_UPDATE_POLICY_ENABLED: '0',
    // Real provider audio is intentionally absent; this preview never contacts LiveKit.
  } });
  const actors = new Map(), roomLab = createLocalPreviewRooms(backend, origins[0]);
  const names = ['ليان', 'عمر', 'سارة', 'آدم', 'نور', 'يزن', 'فريق اللمّة', 'أصحاب السهرة', 'مضيف الاختبار', 'راوي الاختبار', 'صاحب المجلس', 'الفريق الأزرق', 'الفريق البنفسجي', 'الفريق الذهبي', 'نجم الفرق', 'رفيق الفرق', 'رسّام الشلّة', 'مخمّن الشلّة', 'راوي فبركة', 'صاحب فبركة', 'أصحاب الجمعة', 'رفيق الجمعة', 'نجم الجمعة', 'مضيف الخاصّة'];
  async function actor(index) {
    if (!Number.isInteger(index) || index < 0 || index >= names.length) throw Error('Invalid local actor');
    if (!actors.has(index)) {
      // Reserve the persona before the first await: two review tabs must get
      // the same account, including while its initial session is being created.
      const pending = (async () => {
        const user = await createUser(backend.env, { name: `${names[index]} · تجريبي`, email: `ui-review-${index}@example.test` });
        const session = await issueSession(backend.env, user.id, 'web');
        // The first account read materializes its profile. Complete that once
        // before concurrent tabs issue their normal fresh reads.
        await me(backend.env, user);
        return { user, session };
      })();
      actors.set(index, pending);
      pending.catch(() => { if (actors.get(index) === pending) actors.delete(index); });
    }
    const record = await actors.get(index);
    return { session: { token: record.session.token, expiresAt: record.session.expiresAt }, me: await me(backend.env, record.user), label: names[index], localOnly: true };
  }
  let building = null, dirty = false, revision = 0, buildError = null;
  async function rebuild() {
    dirty = true;
    if (building) return building;
    building = (async () => {
      while (dirty) {
        dirty = false;
        process.env.MAYDAN_ROOMS_URL = 'same-origin';
        process.env.MAYDAN_UI_PREVIEW = '1';
        // Keep the licensed TestFlight-only candidate packaging guard intact.
        // UI review uses the existing normal sound bus and its shipped effects.
        process.env.MAYDAN_PRIVATE_AUDIO_PREVIEW = '0';
        try { await buildOnce({ minify: false, includeStudio: false }); revision++; buildError = null; console.log(`[ui-review] local build ${revision}`); }
        catch (error) { buildError = error.message; console.error('[ui-review] build:', error.message); }
      }
    })().finally(() => { building = null; });
    return building;
  }
  if (build) await rebuild();
  let timer, observer;
  if (watchSource) observer = watch(path.join(ROOT, 'src'), { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(() => void rebuild(), 500); });
  async function bodyOf(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 8192) throw Error('Body too large'); chunks.push(chunk); }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  }
  function proxy(req, res) {
    const upstream = http.request({ hostname: '127.0.0.1', port: apiPort, method: req.method, path: req.url, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', () => { if (!res.headersSent) json(res, { error: 'LOCAL_API_UNAVAILABLE' }, 503); else res.destroy(); }); req.pipe(upstream);
  }
  const server = http.createServer(async (req, res) => {
    if (!localRequestAllowed(req, port)) return json(res, { error: 'LOCAL_ONLY' }, 403);
    try {
      const url = new URL(req.url, origins[0]);
      if (!origins.slice(0, 2).includes(url.origin)) return json(res, { error: 'LOCAL_ONLY' }, 403);
      if (url.pathname === '/__preview__/meta' && req.method === 'GET') return json(res, { localOnly: true, phoneAccessible: false, origin: origins[0], revision, building: !!building, buildError, modeSupport: GAME_MODE_SUPPORT, actors: names.slice(0, 8), providerVoice: false });
      if (url.pathname === '/__preview__/login' && req.method === 'POST') return json(res, await actor(Number((await bodyOf(req)).index ?? 0)));
      if (url.pathname === '/__preview__/seed' && req.method === 'POST') { await bodyOf(req); return json(res, await roomLab.seed(actor)); }
      if (url.pathname === '/__preview__/room-action' && req.method === 'POST') return json(res, await roomLab.action(await bodyOf(req)));
      if (url.pathname === '/__preview__/checks' && req.method === 'GET') {
        try { return json(res, JSON.parse(await readFile(path.join(ROOT, 'docs/ui-rebuild-20261030/verification.json'), 'utf8'))); }
        catch { return json(res, { status: 'in-progress', physicalIPhone: false }); }
      }
      if (url.pathname.startsWith('/api/') || url.pathname === '/health') return proxy(req, res);
      // The installed product worker caches navigation as its game document.
      // In this loopback review it would replace the dashboard with the game.
      // A no-fetch, self-unregistering worker also retires an older local worker;
      // the shipped public/sw.js and production offline behavior stay unchanged.
      if (url.pathname === '/sw.js') {
        res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store', 'service-worker-allowed': '/' });
        return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim().then(()=>self.registration.unregister())));");
      }
      let file;
      if (['/__preview__/', '/__preview__', '/__preview__/index.html'].includes(url.pathname)) file = path.join(ROOT, 'scripts/ui-preview/index.html');
      else if (['/__preview__/review.js', '/__preview__/review.css'].includes(url.pathname)) file = path.join(ROOT, 'scripts/ui-preview', path.basename(url.pathname));
      else { if (building) await building; file = localAssetPath(DIST, url.pathname === '/__preview__/scene' || url.pathname === '/' ? '/index.html' : url.pathname); }
      const info = await stat(file); if (!info.isFile()) throw Error('Not a file');
      let content = await readFile(file);
      // Bundled art/fonts/audio use ./assets and ./audio. The review scene is
      // nested under /__preview__/; keep their real root-relative base intact.
      if (url.pathname === '/__preview__/scene') content = Buffer.from(content.toString('utf8').replace('<head>', '<head><base href="/">'));
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-maydan-preview': 'local-only' }); res.end(content);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      return json(res, { error: 'LOCAL_PREVIEW_ERROR', message: error.code === 'ENOENT' ? 'Local asset not found' : 'Local request failed' }, 400);
    }
  });
  server.on('upgrade', (req, socket, head) => {
    if (!localRequestAllowed(req, port) || !req.url.startsWith('/api/')) { socket.destroy(); return; }
    const upstream = net.connect({ host: '127.0.0.1', port: apiPort }, () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${req.rawHeaders.reduce((text, value, i) => text + (i % 2 ? `${value}\r\n` : `${value}: `), '')}\r\n`);
      if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: origins[0] + '/__preview__/', server, backend, actor, rebuild,
    async close() { observer?.close(); clearTimeout(timer); roomLab.close(); await backend.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startUIReview({ port: Number(process.env.UI_REVIEW_PORT || 4178), apiPort: Number(process.env.UI_REVIEW_API_PORT || 8789), build: !process.argv.includes('--no-build') });
  console.log(`[ui-review] ${app.url} — loopback only; isolated in-memory accounts and rooms; no provider voice.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
