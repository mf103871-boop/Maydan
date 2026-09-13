// Local-only transport adapter. Production uses Cloudflare's SQLite storage,
// alarms and hibernating WebSockets; this adapter keeps data in memory.
import http from 'node:http';
import { Readable } from 'node:stream';
import { WebSocketServer } from 'ws';
import { Room, RequestLimiter, routeRequest } from './worker.mjs';
import { json } from './protocol.mjs';

export class MemoryStorage {
  constructor(onAlarm = () => {}) { this.data = new Map(); this.onAlarm = onAlarm; this.alarmAt = null; this.chain = Promise.resolve(); }
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { this.data.set(key, structuredClone(value)); }
  async deleteAll() { this.data.clear(); await this.deleteAlarm(); }
  async getAlarm() { return this.alarmAt; }
  async setAlarm(at) { this.alarmAt = Number(at); if (!this.inTransaction) this.schedule(); }
  async deleteAlarm() { this.alarmAt = null; clearTimeout(this.timer); }
  schedule() {
    clearTimeout(this.timer);
    if (this.alarmAt === null) return;
    this.timer = setTimeout(() => { this.alarmAt = null; Promise.resolve(this.onAlarm()).catch((e) => console.error('Local alarm failed:', e.code || e.name)); }, Math.max(1, this.alarmAt - Date.now()));
    this.timer.unref();
  }
  transaction(fn) {
    const task = this.chain.then(async () => {
      const previous = structuredClone(this.data); const oldAlarm = this.alarmAt;
      this.inTransaction = true;
      try { const result = await fn(this); this.inTransaction = false; this.schedule(); return result; }
      catch (error) { this.data = previous; this.alarmAt = oldAlarm; this.inTransaction = false; this.schedule(); throw error; }
    });
    this.chain = task.catch(() => {}); return task;
  }
  dispose() { clearTimeout(this.timer); }
}
export function localEnvironment({ origins = 'http://localhost:3000,http://127.0.0.1:3000' } = {}) {
  const rooms = new Map(); const limiters = new Map();
  const env = { ALLOWED_ORIGINS: origins };
  function record(map, id, Class) {
    if (!map.has(id)) {
      const item = { sockets: new Set() };
      item.storage = new MemoryStorage(() => item.instance.alarm());
      item.ctx = { storage: item.storage, blockConcurrencyWhile: (fn) => fn(),
        acceptWebSocket: (ws) => item.sockets.add(ws),
        getWebSockets: () => [...item.sockets].filter((ws) => ws.readyState === 1),
        setWebSocketAutoResponse() {},
      };
      item.instance = new Class(item.ctx, env); map.set(id, item);
    }
    return map.get(id);
  }
  env.ROOMS = { idFromName: (name) => name, get: (id) => ({ fetch: async (request) => {
    const item = record(rooms, id, Room);
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      return item.instance.serial(async () => { await item.instance.advance();
        if (!item.instance.room) return json({ error: 'NOT_FOUND' }, 404);
        if (item.ctx.getWebSockets().length >= 32) return json({ error: 'RATE_LIMIT' }, 429);
        return json({ upgradeAllowed: true });
      });
    }
    return item.instance.fetch(request);
  } }) };
  env.LIMITERS = { idFromName: (name) => name, get: (id) => ({ fetch: (request) => record(limiters, id, RequestLimiter).instance.fetch(request) }) };
  return { env, rooms, limiters,
    rehydrate(code) { const item = rooms.get(code); item.instance = new Room(item.ctx, env); return item.instance.ready; },
    dispose() { for (const item of [...rooms.values(), ...limiters.values()]) { item.storage.dispose(); for (const ws of item.sockets) ws.terminate(); } },
  };
}
export async function startLocalServer({ port = 8787, host = '127.0.0.1', origins } = {}) {
  const runtime = localEnvironment({ origins });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  let closing = false;
  function requestOf(req) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    headers.set('cf-connecting-ip', req.socket.remoteAddress || 'local');
    return new Request(`http://localhost${req.url}`, { method: req.method, headers,
      ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
  }
  const server = http.createServer(async (req, res) => {
    try {
      const response = await routeRequest(requestOf(req), runtime.env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"INTERNAL"}'); }
  });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const response = await routeRequest(requestOf(req), runtime.env);
      if (response.status !== 200 || !(await response.json()).upgradeAllowed) {
        socket.end(`HTTP/1.1 ${response.status} Rejected\r\nConnection: close\r\n\r\n`); return;
      }
      const code = req.url.match(/\/rooms\/(\d{6})\/socket/)?.[1];
      const item = runtime.rooms.get(code);
      wss.handleUpgrade(req, socket, head, (ws) => {
        let attachment = {};
        ws.serializeAttachment = (value) => { attachment = structuredClone(value); };
        ws.deserializeAttachment = () => structuredClone(attachment);
        // Install listeners before accepting/authenticating the first frame.
        ws.on('message', (data, binary) => { if (!closing) item.instance.webSocketMessage(ws, binary ? data : data.toString()).catch(() => ws.close(1011)); });
        ws.on('close', () => { item.sockets.delete(ws); if (!closing) item.instance.webSocketClose(ws).catch(() => {}); });
        ws.on('error', () => { if (!closing) item.instance.webSocketError(ws).catch(() => {}); });
        item.instance.serial(() => item.instance.acceptSocket(ws)).catch(() => ws.close(1011));
      });
    } catch { socket.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { ...runtime, url: `http://${host}:${server.address().port}`, server,
    async close() { closing = true; runtime.dispose(); wss.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}
