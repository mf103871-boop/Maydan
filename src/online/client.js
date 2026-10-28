import { GAME_PROTOCOLS, ROOM_CAPABILITIES, validateServerUrl } from './shared.js';
export class ClientError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const WAKE_PROBE_MS = 3_000;
const MAX_PENDING_COMMANDS = 32;
const MAX_BUFFERED_BYTES = 64 * 1024;
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
// معرّف جهاز ثابت لاحتساب الغرفة المجانية لغير المسجّلين على الخادم؛ ليس سرًّا ولا هوية.
const DEVICE_KEY = 'maydan:online:device';
export function deviceId() {
  try { const saved = localStorage.getItem(DEVICE_KEY); if (/^[a-f0-9]{32}$/.test(saved || '')) return saved; } catch { /* private browsing */ }
  const fresh = memory.get(DEVICE_KEY) || Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  memory.set(DEVICE_KEY, fresh);
  try { localStorage.setItem(DEVICE_KEY, fresh); } catch { /* memory only */ }
  return fresh;
}
export function newCredentials() {
  const hex = (length) => Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => b.toString(16).padStart(2, '0')).join('');
  return { id: hex(16), token: hex(32) };
}
// الوسيط الرابع يقبل دالة fetch (كما كان) أو { headers, fetchImpl }: الترويسات
// تحمل Bearer الحساب لإنشاء الغرف والدخول إليها دون تغيير المستدعين القدامى.
export async function post(server, path, data, options = fetch) {
  const asFunction = typeof options === 'function';
  const fetchImpl = asFunction ? options : (options && options.fetchImpl) || fetch;
  const extraHeaders = asFunction ? null : options && options.headers;
  if (!validateServerUrl(server)) throw new ClientError('CONFIG');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(`${server}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(extraHeaders || {}) },
      body: JSON.stringify(data), signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    let result;
    try { result = await response.json(); } catch { throw new ClientError('NETWORK'); }
    if (!response.ok) throw new ClientError(result.error || 'NETWORK');
    return result;
  } catch (error) { throw error instanceof ClientError ? error : new ClientError('NETWORK'); }
  finally { clearTimeout(timeout); }
}
export class RoomClient {
  constructor({ server, code, session, getAccountAuthorization = () => null, onState = () => {}, onStatus = () => {}, onError = () => {}, WebSocketImpl = WebSocket }) {
    Object.assign(this, { server, code, session, getAccountAuthorization, onState, onStatus, onError, WebSocketImpl });
    this.pending = new Map(); this.drawingListeners = new Set(); this.reactionListeners = new Set(); this.stopped = true; this.attempt = 0; this.counter = 0; this.state = null;
  }
  start() { if (!this.stopped) { this.wake(); return; } this.stopped = false; this.attempt = 0; this.connect(); }
  status(value) { this.connectionStatus = value; this.onStatus(value); }
  clearConnectionTimers() {
    clearTimeout(this.retryTimer); clearTimeout(this.openTimer); clearInterval(this.heartbeat); clearTimeout(this.wakeTimer);
    this.retryTimer = null; this.wakeTimer = null;
  }
  reconnectNow() {
    if (this.stopped) return;
    this.clearConnectionTimers();
    // Detach before closing: a suspended mobile socket may never deliver close,
    // or may deliver it after the replacement has already authenticated.
    const old = this.ws; this.ws = null;
    this.rejectPending('DISCONNECTED');
    try { old?.close(); } catch { /* replacement does not depend on close */ }
    this.attempt = Math.max(1, this.attempt); this.connect();
  }
  reconnectLater() {
    if (this.stopped) return;
    this.status('reconnecting');
    this.retryTimer = setTimeout(() => this.connect(), Math.min(800 * 2 ** Math.min(this.attempt++, 8), 10_000) + Math.random() * 200);
  }
  accountAuthorization() {
    let authorization;
    try { authorization = this.getAccountAuthorization(); } catch { /* unavailable account */ }
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) return authorization;
    this.onError('AUTH_REQUIRED'); this.stop('ended'); return null;
  }
  connect() {
    if (this.stopped) return;
    this.clearConnectionTimers();
    this.status(this.attempt ? 'reconnecting' : 'connecting');
    const url = new URL(`${this.server}/api/rooms/${this.code}/socket`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try { ws = this.ws = new this.WebSocketImpl(url.toString()); }
    catch { this.ws = null; this.reconnectLater(); return; }
    this.lastReceived = Date.now();
    this.openTimer = setTimeout(() => { if (ws === this.ws) this.reconnectNow(); }, 12_000);
    ws.onopen = () => {
      if (ws !== this.ws || this.stopped) return;
      // A prior authenticated state tells us this seat needs an account. Read
      // its current bearer again, saving one round trip during reconnection.
      const accountAuthorization = ['ersomha','mafia'].includes(this.state?.game) ? this.accountAuthorization() : undefined;
      if (this.stopped) return;
      try { ws.send(JSON.stringify({ type: 'auth', ...this.session, capabilities: ROOM_CAPABILITIES, ...(accountAuthorization ? { accountAuthorization } : {}) })); }
      catch { this.reconnectNow(); return; }
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastReceived > 40_000) { this.reconnectNow(); return; }
        try { if (ws.readyState === 1) ws.send('ping'); } catch { this.reconnectNow(); }
      }, 15_000);
    };
    ws.onmessage = (event) => {
      if (ws !== this.ws || this.stopped) return;
      this.lastReceived = Date.now();
      clearTimeout(this.wakeTimer); this.wakeTimer = null;
      if (event.data === 'pong') return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'account-auth' && ['ersomha','mafia'].includes(message.game)) {
        // Read the account at challenge time, including on reconnect. Never
        // persist the bearer with the seat or place it in the WebSocket URL.
        const authorization = this.accountAuthorization();
        if (!authorization) return;
        try { ws.send(JSON.stringify({ type: 'auth', ...this.session, capabilities: ROOM_CAPABILITIES, accountAuthorization: authorization })); }
        catch { this.reconnectNow(); }
      } else if (message.type === 'state') {
        if(this.session?.scope==='observer'&&message.state?.scope!=='observer'){this.onError('AUTH');this.stop('ended');return;}
        const protocol = GAME_PROTOCOLS[message.state.game || 'meenfina'];
        // The room server was updated under this open page (or speaks a game this
        // copy does not know). Retrying the socket cannot help, but the seat is
        // still valid: stop as 'outdated' and keep the stored credentials, so the
        // newer version reconnects to the same room and seat after a reload.
        if (!protocol || (message.state.game === 'mafia' ? ![1, protocol].includes(message.state.protocol) : message.state.protocol !== protocol)) { this.onError('ROOM_OUTDATED'); this.stop('outdated'); return; }
        if (this.state && message.state.revision < this.state.revision) return;
        clearTimeout(this.openTimer); this.attempt = 0;
        this.state = message.state; this.clockOffset = message.state.serverNow - Date.now();
        this.status('connected'); this.onState(this.state);
      } else if (message.type === 'drawing') {
        if (this.state?.game !== 'ersomha' || message.matchId !== this.state.matchId || message.round !== this.state.round) return;
        for (const listener of this.drawingListeners) listener(message);
      } else if (message.type === 'reaction') {
        if (typeof message.seatId !== 'string' || typeof message.emoji !== 'string') return;
        for (const listener of this.reactionListeners) listener(message);
      } else if (message.type === 'ack') {
        const pending = this.pending.get(message.requestId);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(message.requestId); message.ok ? pending.resolve(message) : pending.reject(new ClientError(message.error)); }
      } else if (message.type === 'error') {
        this.onError(message.error);
        if (['AUTH', 'NOT_FOUND', 'EXPIRED', 'REMOVED'].includes(message.error)) this.stop('ended');
      }
    };
    ws.onerror = () => {}; // onclose owns reconnection, avoiding duplicate sockets.
    ws.onclose = (event) => {
      if (ws !== this.ws) return;
      this.clearConnectionTimers();
      this.rejectPending('DISCONNECTED');
      if (this.stopped) return;
      if (event.code === 4409) { this.onError('REPLACED'); this.stop('replaced'); return; }
      if ([4401, 4404].includes(event.code)) { this.onError(event.reason || 'AUTH'); this.stop('ended'); return; }
      this.reconnectLater();
    };
  }
  wake() {
    if (this.stopped) return;
    // The socket can be OPEN while account authentication still awaits D1.
    // Plain ping is valid only after its first state; the handshake has its own
    // bounded timeout and must not race a foreground probe.
    if (this.ws?.readyState === 1 && this.connectionStatus !== 'connected') return;
    if (this.ws?.readyState === 1 && Date.now() - this.lastReceived < 30_000) {
      if (this.wakeTimer) return;
      const ws = this.ws;
      this.wakeTimer = setTimeout(() => { this.wakeTimer = null; if (ws === this.ws) this.reconnectNow(); }, WAKE_PROBE_MS);
      try { ws.send('ping'); } catch { this.reconnectNow(); }
      return;
    }
    if (this.ws?.readyState === 0 && Date.now() - this.lastReceived < 12_000) return;
    this.reconnectNow();
  }
  subscribeDrawing(listener) { this.drawingListeners.add(listener); return () => this.drawingListeners.delete(listener); }
  subscribeReactions(listener) { this.reactionListeners.add(listener); return () => this.reactionListeners.delete(listener); }
  react(emoji) { return this.command('react', { emoji }); }
  reactCosmetic(reactionId) { return this.command('react', { reactionId, accountAuthorization: this.getAccountAuthorization() }); }
  command(type, fields = {}) {
    if(this.session?.scope==='observer')return Promise.reject(new ClientError('WAITING'));
    if (this.connectionStatus !== 'connected' || this.ws?.readyState !== 1 || !this.state) return Promise.reject(new ClientError('DISCONNECTED'));
    if (this.pending.size >= MAX_PENDING_COMMANDS || (this.ws.bufferedAmount || 0) > MAX_BUFFERED_BYTES) {
      // Never build an unbounded queue of stale game actions. Reconcile from
      // the durable room state; uncertain commands are not automatically replayed.
      this.reconnectNow(); return Promise.reject(new ClientError('DISCONNECTED'));
    }
    // UI commands belong to the round the player saw, even if a newer snapshot
    // arrived before React rendered it. Protocol scripts default to current state.
    const { matchId = this.state.matchId, round = this.state.round, phaseId = this.state.phaseId, ...payload } = fields;
    const requestId = `${Date.now()}-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new ClientError('TIMEOUT')); }, 10_000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ type, ...payload, requestId, matchId, round, ...(this.state.game === 'mafia' ? { phaseId } : {}) })); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(new ClientError('DISCONNECTED')); }
    });
  }
  rejectPending(code) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new ClientError(code)); }
    this.pending.clear();
  }
  stop(status = 'disconnected') {
    this.stopped = true; this.clearConnectionTimers();
    // A command still in flight when the server turns out newer must report the
    // same reason; DISCONNECTED would replace the update notice with a wrong one.
    this.rejectPending(status === 'outdated' ? 'ROOM_OUTDATED' : 'DISCONNECTED'); this.ws?.close(); this.status(status);
  }
}

// Public directory is always read from the server; an empty list is not an offline room.
export function getPublicRooms(server, filters = 'all', options = {}) {
  const value = typeof filters === 'string' ? {mode:filters} : filters;
  const query = new URLSearchParams({game:'mafia',mode:['classic','shadow'].includes(value.mode)?value.mode:'all',voice:['optional','off'].includes(value.voice)?value.voice:'all',status:['waiting','playing','finished'].includes(value.status)?value.status:'all'});
  if(value.cursor) query.set('cursor',value.cursor);
  return getRoomResource(server,`/api/rooms/public?${query}`,options);
}
// Invalidations carry no room data. HTTP remains authoritative; visible-tab polling
// survives proxy/socket failures. Teardown fences every late callback.
export function subscribePublicRooms(server,{getAccountAuthorization,onInvalidate,WebSocketImpl=globalThis.WebSocket}={}) {
  if(!validateServerUrl(server)||!WebSocketImpl)return()=>{};
  let closed=false,socket=null,retry=null,ping=null,debounce=null,attempt=0,lastRevision=null;
  const clear=()=>{clearTimeout(retry);clearInterval(ping);clearTimeout(debounce);retry=null;ping=null;debounce=null;};
  const open=()=>{
    if(closed||globalThis.document?.hidden)return;
    const url=new URL('/api/rooms/public/stream',server);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    let current;try{current=new WebSocketImpl(url.toString());socket=current;}catch{return;}
    current.onopen=()=>{if(closed||socket!==current)return;const auth=getAccountAuthorization?.();if(!auth){current.close();return;}current.send(JSON.stringify({type:'auth',accountAuthorization:auth}));ping=setInterval(()=>{if(!closed&&socket===current&&current.readyState===1)current.send(JSON.stringify({type:'ping'}));},25000);};
    current.onmessage=event=>{if(closed||socket!==current)return;let message;try{message=JSON.parse(event.data);}catch{return;}if(message.type==='directory-ready'){attempt=0;lastRevision=message.revision;return;}if(message.type==='directory-invalidated'&&message.revision!==lastRevision){lastRevision=message.revision;clearTimeout(debounce);debounce=setTimeout(()=>{if(!closed&&!globalThis.document?.hidden)onInvalidate?.();},180);}};
    current.onerror=()=>{};
    current.onclose=()=>{if(closed||socket!==current)return;clearInterval(ping);socket=null;retry=setTimeout(open,Math.min(15000,1000*2**Math.min(attempt++,4)));};
  };
  const wake=()=>{if(globalThis.document?.hidden){clear();const old=socket;socket=null;old?.close();}else if(!socket){onInvalidate?.();open();}};
  globalThis.document?.addEventListener('visibilitychange',wake);globalThis.window?.addEventListener('online',wake);open();
  return()=>{closed=true;clear();const old=socket;socket=null;old?.close();globalThis.document?.removeEventListener('visibilitychange',wake);globalThis.window?.removeEventListener('online',wake);};
}
export const getMafiaHistory = (server,options = {}) => getRoomResource(server,'/api/mafia/history',options);
async function getRoomResource(server, path, { headers = {}, signal } = {}) {
  if (!validateServerUrl(server)) throw new ClientError('CONFIG');
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted) controller.abort();
  const timeout = setTimeout(abort,15000);
  try {
    const response = await fetch(`${server}${path}`, { headers, signal: controller.signal, credentials:'omit', cache:'no-store' });
    const result = await response.json();
    if(!response.ok) throw new ClientError(result.error || 'NETWORK');
    return result;
  } catch(error) { throw error instanceof ClientError ? error : new ClientError('NETWORK'); }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort',abort); }
}
