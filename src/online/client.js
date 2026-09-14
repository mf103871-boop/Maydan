import { PROTOCOL, FABRAKA_PROTOCOL, validateServerUrl } from './shared.js';
export class ClientError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const memory = new Map();
function key(server, name) { return `maydan:online:${server}:${name}`; }
export function readSaved(server, name) {
  const k = key(server, name);
  try { return JSON.parse(localStorage.getItem(k)) ?? memory.get(k) ?? null; } catch { return memory.get(k) ?? null; }
}
export function save(server, name, value) {
  const k = key(server, name); memory.set(k, value);
  try { localStorage.setItem(k, JSON.stringify(value)); return true; } catch { return false; }
}
export function clearSession(server, code) {
  memory.delete(key(server, code));
  try { localStorage.removeItem(key(server, code)); } catch { /* private browsing */ }
  if (readSaved(server, 'lastRoom') === code) save(server, 'lastRoom', null);
}
export function newCredentials() {
  const hex = (length) => Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => b.toString(16).padStart(2, '0')).join('');
  return { id: hex(16), token: hex(32) };
}
export async function post(server, path, data, fetchImpl = fetch) {
  if (!validateServerUrl(server)) throw new ClientError('CONFIG');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(`${server}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data), signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    let result;
    try { result = await response.json(); } catch { throw new ClientError('NETWORK'); }
    if (!response.ok) throw new ClientError(result.error || 'NETWORK');
    return result;
  } catch (error) { throw error instanceof ClientError ? error : new ClientError('NETWORK'); }
  finally { clearTimeout(timeout); }
}
export class RoomClient {
  constructor({ server, code, session, onState = () => {}, onStatus = () => {}, onError = () => {}, WebSocketImpl = WebSocket }) {
    Object.assign(this, { server, code, session, onState, onStatus, onError, WebSocketImpl });
    this.pending = new Map(); this.stopped = true; this.attempt = 0; this.counter = 0; this.state = null;
  }
  start() { this.stopped = false; this.attempt = 0; this.connect(); }
  status(value) { this.connectionStatus = value; this.onStatus(value); }
  connect() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer); clearTimeout(this.openTimer); clearInterval(this.heartbeat);
    this.status(this.attempt ? 'reconnecting' : 'connecting');
    const url = new URL(`${this.server}/api/rooms/${this.code}/socket`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = this.ws = new this.WebSocketImpl(url.toString());
    this.lastReceived = Date.now();
    this.openTimer = setTimeout(() => ws.close(), 12_000);
    ws.onopen = () => {
      if (ws !== this.ws || this.stopped) return;
      ws.send(JSON.stringify({ type: 'auth', ...this.session }));
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastReceived > 40_000) { ws.close(); return; }
        if (ws.readyState === 1) ws.send('ping');
      }, 15_000);
    };
    ws.onmessage = (event) => {
      if (ws !== this.ws || this.stopped) return;
      this.lastReceived = Date.now();
      if (event.data === 'pong') return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'state') {
        const protocol = message.state.game === 'fabraka' ? FABRAKA_PROTOCOL : PROTOCOL;
        // A version mismatch can never be retried: end the session so the screen
        // offers the way out instead of a reconnect button that cannot work.
        if (message.state.protocol !== protocol) { this.onError('CONFIG'); this.stop('ended'); return; }
        if (this.state && message.state.revision < this.state.revision) return;
        clearTimeout(this.openTimer); this.attempt = 0;
        this.state = message.state; this.clockOffset = message.state.serverNow - Date.now();
        this.status('connected'); this.onState(this.state);
      } else if (message.type === 'ack') {
        const pending = this.pending.get(message.requestId);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(message.requestId); message.ok ? pending.resolve() : pending.reject(new ClientError(message.error)); }
      } else if (message.type === 'error') {
        this.onError(message.error);
        if (['AUTH', 'NOT_FOUND', 'EXPIRED', 'REMOVED'].includes(message.error)) this.stop('ended');
      }
    };
    ws.onerror = () => {}; // onclose owns reconnection, avoiding duplicate sockets.
    ws.onclose = (event) => {
      if (ws !== this.ws) return;
      clearInterval(this.heartbeat); clearTimeout(this.openTimer);
      this.rejectPending('DISCONNECTED');
      if (this.stopped) return;
      if (event.code === 4409) { this.onError('REPLACED'); this.stop('replaced'); return; }
      if ([4401, 4404].includes(event.code)) { this.onError(event.reason || 'AUTH'); this.stop('ended'); return; }
      this.status('reconnecting');
      this.retryTimer = setTimeout(() => this.connect(), Math.min(800 * 2 ** this.attempt++, 10_000) + Math.random() * 200);
    };
  }
  wake() {
    if (this.stopped) return;
    if (this.ws?.readyState === 1 && Date.now() - this.lastReceived < 30_000) { this.ws.send('ping'); return; }
    this.ws?.close();
  }
  command(type, fields = {}) {
    if (this.connectionStatus !== 'connected' || this.ws?.readyState !== 1 || !this.state) return Promise.reject(new ClientError('DISCONNECTED'));
    // UI commands belong to the round the player saw, even if a newer snapshot
    // arrived before React rendered it. Protocol scripts default to current state.
    const { matchId = this.state.matchId, round = this.state.round, ...payload } = fields;
    const requestId = `${Date.now()}-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new ClientError('TIMEOUT')); }, 10_000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ type, ...payload, requestId, matchId, round })); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(new ClientError('DISCONNECTED')); }
    });
  }
  rejectPending(code) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new ClientError(code)); }
    this.pending.clear();
  }
  stop(status = 'disconnected') {
    this.stopped = true; clearTimeout(this.retryTimer); clearTimeout(this.openTimer); clearInterval(this.heartbeat);
    this.rejectPending('DISCONNECTED'); this.ws?.close(); this.status(status);
  }
}
