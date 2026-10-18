// Controlled local workerd benchmark. No production accounts, media or writes.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket, WebSocketServer } from 'ws';
import { RoomClient, newCredentials } from '../src/online/client.js';
import { ROOM_CAPABILITIES } from '../src/online/shared.js';
import { migrationSql } from '../server/local-d1.mjs';
import { bundleErsomhaWorker } from './ersomha-release.mjs';
import { getBackendProvenance } from './lib/lamma-provenance.mjs';

const ORIGIN = 'http://localhost:3000';
const weakNetwork = process.argv.includes('--weak-network');
const ONE_WAY_MS = weakNetwork ? 240 : 60, BATCH_MS = 80, SAMPLES = 60, WARMUP = 5;
const output = path.resolve(process.argv[2] || '.cache/ersomha-latency.json');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'maydan-ersomha-latency-'));
const clients = [], sockets = new Set(), timers = new Set();
let mf, proxy, wss;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 15_000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { if (await predicate()) return; await wait(10); }
  throw new Error(`Timed out: ${label}`);
}
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
try {
  const scriptPath = path.join(temporary, 'worker.mjs');
  const provenance = await getBackendProvenance(process.cwd(), { requireClean: true });
  const frozen = await bundleErsomhaWorker('maydan-rooms');
  await writeFile(scriptPath, frozen.bytes);
  mf = new Miniflare(convertV4MiniflareOptions({ rootPath: temporary, name: 'ersomha-latency', modules: true, scriptPath,
    compatibilityDate: '2026-09-01', durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
    d1Databases: { DB: 'latency-db' }, bindings: { ALLOWED_ORIGINS: ORIGIN, APP_ORIGIN: ORIGIN, AUTH_DEV_FAKE: '1', SESSION_SECRET: 'latency-fixture-only' }, host: '127.0.0.1', port: 0, cf: false }));
  const server = (await mf.ready).origin, DB = await mf.getD1Database('DB'); await DB.exec(migrationSql());
  const api = async (endpoint, body, token) => {
    const response = await fetch(server + endpoint, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const result = await response.json(); assert.ok(response.ok, `${endpoint}: ${response.status} ${result.error || ''}`); return result;
  };
  proxy = http.createServer((request, response) => { response.writeHead(404); response.end(); });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const proxyAddress = `ws://127.0.0.1:${proxy.address().port}`;
  wss = new WebSocketServer({ server: proxy });
  const later = (target, data) => {
    const timer = setTimeout(() => { timers.delete(timer); if (target.readyState === 1) target.send(data, { binary: false }); }, ONE_WAY_MS);
    timers.add(timer);
  };
  wss.on('connection', (downstream, request) => {
    const upstream = new WebSocket(server.replace(/^http/, 'ws') + request.url, { origin: ORIGIN });
    sockets.add(downstream); sockets.add(upstream); const queue = [];
    downstream.on('message', data => { if (upstream.readyState === 0) queue.push(data); else later(upstream, data); });
    upstream.on('open', () => queue.splice(0).forEach(data => later(upstream, data)));
    upstream.on('message', data => later(downstream, data));
    for (const [source, target] of [[upstream, downstream], [downstream, upstream]]) {
      source.on('error', () => target.close()); source.on('close', () => { sockets.delete(source); if (target.readyState < 2) target.close(); });
    }
  });
  class DelayedSocket extends WebSocket { constructor(url) { super(proxyAddress + new URL(url).pathname); } }
  const accounts = await Promise.all(Array.from({ length: 8 }, (_, index) => api('/api/auth/dev', { subject: `latency-${index}`, name: `لاعب ${index + 1}` })));
  const seats = accounts.map((_, index) => ({ ...newCredentials(), name: `لاعب ${index + 1}`, avatar: index % 4, capabilities: ROOM_CAPABILITIES }));
  const { code } = await api('/api/rooms', { ...seats[0], game: 'ersomha', settings: { cycles: 1, difficulty: 'medium' }, deviceId: 'f'.repeat(32) }, accounts[0].session.token);
  for (let index = 1; index < 8; index++) await api(`/api/rooms/${code}/join`, seats[index], accounts[index].session.token);
  for (const [index, session] of seats.entries()) { const client = new RoomClient({ server, code, session, WebSocketImpl: DelayedSocket, getAccountAuthorization: () => `Bearer ${accounts[index].session.token}` }); clients.push(client); client.start(); }
  await until(() => clients.every(client => client.state?.members.filter(member => member.connected).length === 8), 'eight delayed peers');
  for (const client of clients.slice(1)) await client.command('ready', { ready: true });
  await clients[0].command('start');
  await until(() => clients[0].state?.phase === 'select', 'select');
  const drawer = clients.find(client => client.session.id === clients[0].state.drawerId);
  await drawer.command('select_word', { choiceId: drawer.state.myChoices[0].id });
  await until(() => clients.every(client => client.state?.phase === 'draw'), 'drawing');
  const startTimes = new Map(), received = new Map(), samples = [];
  const receivers = clients.filter(client => client !== drawer);
  receivers.forEach((client, receiver) => client.subscribeDrawing(event => {
    const stroke = event.op?.strokeId;
    if (event.kind !== 'append' || !startTimes.has(stroke)) return;
    const id = `${receiver}:${stroke}`;
    if (received.has(id)) return;
    const latency = performance.now() - startTimes.get(stroke); received.set(id, latency);
    if (Number(stroke.split('-').at(-1)) >= WARMUP) samples.push(latency);
  }));
  const acknowledgements = [];
  for (let index = 0; index < SAMPLES; index++) {
    const strokeId = `latency-sample-${index}`;
    startTimes.set(strokeId, performance.now());
    await wait(BATCH_MS); // Include the actual specified point-batching delay.
    acknowledgements.push(drawer.command('drawing_batch', { epoch: drawer.state.drawing.epoch, strokeId,
      tool: 'pen', color: '#118d96', width: 6, points: [[0.1 + index / 100, 0.5]], end: true }));
  }
  await Promise.all(acknowledgements);
  await until(() => received.size === SAMPLES * 7, 'every committed batch delivered exactly once');
  const p95 = percentile(samples, .95), p50 = percentile(samples, .5);
  const report = { schemaVersion: 1, finishedAt: new Date().toISOString(), ...provenance, testedModuleSHA256: frozen.sha256,
    scope: 'Real local Cloudflare workerd, SQLite Durable Object, D1 and eight authenticated WebSocket clients through a controlled delay proxy; no physical screen or LiveKit audio latency claim',
    peers: 8, network: { profile: weakNetwork ? 'weak-480ms-rtt' : 'target-120ms-rtt', injectedRoundTripMs: ONE_WAY_MS * 2, implementation: `${ONE_WAY_MS} ms delay each direction; local loopback adds its measured scheduling overhead`, packetLossSimulated: false },
    pointBatchDelayMs: BATCH_MS, sentBatches: SAMPLES, observedRemoteDeliveries: received.size, expectedRemoteDeliveries: SAMPLES * 7,
    warmupBatchesExcluded: WARMUP, measuredRemoteDeliveries: samples.length,
    remotePointToDeliveryMs: { p50: Number(p50.toFixed(2)), p95: Number(p95.toFixed(2)), maximum: Number(Math.max(...samples).toFixed(2)) },
    targetP95Ms: weakNetwork ? null : 250, targetApplies: !weakNetwork,
    passed: received.size === SAMPLES * 7 && (weakNetwork || p95 <= 250), physicalDeviceTrialCompleted: false };
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
} finally {
  clients.forEach(client => client.stop());
  timers.forEach(timer => clearTimeout(timer)); sockets.forEach(socket => socket.terminate());
  await new Promise(resolve => wss ? wss.close(resolve) : resolve());
  await new Promise(resolve => proxy ? proxy.close(resolve) : resolve());
  if (mf) await mf.dispose(); await rm(temporary, { recursive: true, force: true });
}
