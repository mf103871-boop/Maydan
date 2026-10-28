// Whole Mafia matches through the real room server: sockets, the local D1, voice
// grants per phase (provider mocked), public directory, results and a rematch.
// Unlike the model simulation, every command and phase change passes through
// room.mjs, and every voice grant is checked against each seat's role.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { newCredentials, RoomClient } from '../src/online/client.js';
import { decodeJws } from '../server/accounts/jwt.mjs';
import { tick, winningFaction } from '../server/mafia-model.mjs';
import { all } from '../server/lamma/common.mjs';

const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function until(fn, label = 'state', timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail(`Timed out: ${label}`);
}
// Deterministic choices so a failure reproduces.
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }

async function setup(t) {
  const app = await startLocalServer({ port: 0, vars: { MAFIA_ENABLED: '1', LIVEKIT_URL: 'wss://mafia-tests.livekit.cloud', LIVEKIT_API_KEY: 'fixture-key', LIVEKIT_API_SECRET: 'fixture-secret' } });
  const clients = [], nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => String(url).includes('mafia-tests.livekit.cloud') ? Response.json({}) : nativeFetch(url, options));
  t.after(async () => { clients.forEach(c => c.stop()); await app.close(); });
  const api = async (p, path, body, method = body === undefined ? 'GET' : 'POST') => {
    const r = await fetch(app.url + path, { method, headers: { origin: ORIGIN, ...(p ? { authorization: `Bearer ${p.authorization}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  async function user(n) {
    const u = await createUser(app.env, { name: `لاعب ${n}`, email: `${crypto.randomUUID()}@example.test` }), s = await issueSession(app.env, u.id);
    return { ...newCredentials(), accountId: u.id, authorization: s.token, name: `لاعب ${n}`, avatar: n % 4, game: 'mafia', capabilities: { mafia: 2 } };
  }
  function connect(p, code) {
    const c = new RoomClient({ server: app.url, code, session: { id: p.id, token: p.token }, getAccountAuthorization: () => `Bearer ${p.authorization}`, WebSocketImpl: BrowserSocket });
    clients.push(c); c.start(); return c;
  }
  // Ends the current phase at its deadline, exactly as the room alarm would. The
  // next deadline is then moved ten minutes out, so only the test advances phases
  // (an eight-second dawn must not race a slow machine).
  async function endPhase(code, { end = true } = {}) {
    const item = app.rooms.get(code);
    await item.instance.serial(async () => {
      const r = structuredClone(item.instance.room);
      if (end) { r.deadlineAt = Date.now() - 1; tick(r, Date.now()); }
      if (r.deadlineAt) r.deadlineAt = Date.now() + 600_000;
      await item.instance.commit(r);
    });
    return item.instance.room;
  }
  return { app, api, user, connect, endPhase, room: code => app.rooms.get(code).instance.room };
}

function voiceOf(response) {
  if (!response.body.connection) return { quiet: response.body.quiet, channel: null, canPublish: false };
  const grant = decodeJws(response.body.connection.token).payload.video;
  return { quiet: response.body.quiet, channel: grant.room, canPublish: grant.canPublish };
}

async function playMatch(h, { count, seed }) {
  const random = rng(seed), people = [];
  let clients = [];
  // The room closes a socket that sends more than 35 messages in ten seconds. Real
  // phases last 15–120 s; this compressed match keeps every seat under that limit.
  const sent = new Map();
  async function paced(id) {
    const recent = (sent.get(id) || []).filter(at => Date.now() - at < 10_000);
    if (recent.length >= 30) await new Promise(r => setTimeout(r, 10_050 - (Date.now() - recent[0])));
    sent.set(id, [...recent.filter(at => Date.now() - at < 10_000), Date.now()]);
  }
  const send = async (index, type, fields) => { await paced(people[index].id); return clients[index].command(type, fields); };
  for (let n = 0; n < count; n++) people.push(await h.user(n));
  const settings = { mode: count >= 9 ? 'shadow' : 'classic', capacity: count, visibility: 'public' };
  const created = await h.api(people[0], '/api/rooms', { ...people[0], settings });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const code = created.body.code;
  // Everyone but the host arrives through the public directory and quick join.
  for (const p of people.slice(1)) {
    const listed = await h.api(p, `/api/rooms/public?game=mafia&mode=${settings.mode}`);
    assert.ok(listed.body.rooms.some(r => r.code === code), 'the waiting room is listed while seats are free');
    const joined = await h.api(p, '/api/matchmaking/join', { ...p, mode: settings.mode });
    assert.equal(joined.status, 200, JSON.stringify(joined.body)); assert.equal(joined.body.code, code);
  }
  const outsider = await h.user(99);
  const fullCard=(await h.api(outsider, `/api/rooms/public?game=mafia&mode=${settings.mode}`)).body.rooms.find(r=>r.code===code);assert.equal(fullCard.full,true,'a full room remains visible for spectators');assert.equal(fullCard.status,'waiting');assert.equal((await h.api(outsider,'/api/matchmaking/join',{...outsider,mode:settings.mode})).body.error,'MAFIA_NO_ROOMS','quick join never allocates a spectator or overfills a room');
  clients = people.map(p => h.connect(p, code));
  await until(() => clients.every(c => c.state?.members.filter(m => m.connected).length === count), 'all connected');
  for (let i = 1; i < count; i++) await send(i, 'ready', { ready: true });
  await send(0, 'start');
  await h.endPhase(code, { end: false });
  await until(() => clients.every(c => c.state.phase === 'role'), 'roles dealt');

  const seen = new Set(), channelsByPhase = [], errors = [], chatted = new Map();
  let joined = false;
  for (let step = 0; step < 200; step++) {
    const room = h.room(code);
    if (room.phase === 'over') break;
    await until(() => clients.every(c => c.state.phaseId === room.phaseId), `snapshots for ${room.phase}`);
    seen.add(room.phase);
    // Every seat keeps one voice session; each phase must hand it the right audience.
    if (room.phase !== 'role' || joined) {
      joined = true;
      const channels = new Map();
      for (const [i, p] of people.entries()) {
        // Like the app, wait out a brief MAFIA_VOICE_TRANSITION (a revocation cutoff).
        let response;
        for (let tries = 0; tries < 30; tries++) {
          response = await h.api(p, `/api/rooms/${code}/voice`, { deviceId: `phone-${i}`, voiceSessionId: `fixture-session-${seed}-${i}`, operation: 'join' });
          if (response.body.error !== 'MAFIA_VOICE_TRANSITION') break;
          await new Promise(r => setTimeout(r, 200));
        }
        assert.equal(response.status, 200, `${room.phase} voice for ${i}: ${JSON.stringify(response.body)}`);
        const s = room.roleStates[p.id], voice = voiceOf(response);
        if (room.phase === 'dawn' || (room.phase === 'night' && (!s.alive || s.faction === 'town'))) {
          assert.equal(voice.quiet, true, `${room.phase}: ${s.roleId} alive=${s.alive} must be quiet`);
          assert.equal(voice.channel, null);
        } else {
          const key = room.phase === 'night' ? s.faction : 'public';
          assert.ok(voice.channel, `${room.phase}: ${s.roleId} needs a ${key} channel`);
          if (channels.has(key)) assert.equal(channels.get(key), voice.channel, `${key} is one channel`);
          channels.set(key, voice.channel);
          const speaker = s.alive && (room.phase !== 'defense' || p.id === room.nomineeId);
          assert.equal(voice.canPublish, speaker, `${room.phase}: ${s.roleId} alive=${s.alive} publish`);
          for (const member of response.body.call.participants) {
            const other = people.find(x => x.accountId === member.userId);
            if (room.phase === 'night') assert.equal(room.roleStates[other.id].faction, s.faction, 'night audiences never mix factions');
          }
        }
      }
      if (room.phase === 'night') assert.notEqual(channels.get('mafia'), channels.get('shadow'));
      channelsByPhase.push({ phase: room.phase, round: room.round, names: new Set(channels.values()) });
    }
    const alive = room.participants.filter(id => room.roleStates[id].alive);
    const clientOf = id => clients[people.findIndex(p => p.id === id)];
    const act = async (id, type, fields) => {
      await paced(id);
      try { await clientOf(id).command(type, fields); }
      catch (error) { errors.push(`${room.phase}/${type}: ${error.code}`); }
    };
    if (room.phase === 'night') {
      const targets = alive.filter(id => room.roleStates[id].faction !== 'mafia');
      const target = targets[Math.floor(random() * targets.length)];
      for (const id of alive) {
        const you = clientOf(id).state.you;
        for (const action of you.actions) {
          if (action.type === 'mafia_vote') await act(id, 'mafia_vote', { targetId: random() < 0.85 ? target : null });
          if (action.type === 'night_action' && action.targets.length >= action.count && random() < 0.8) {
            const pool = [...action.targets].sort(() => random() - 0.5);
            await act(id, 'night_action', action.count === 2 ? { targetIds: pool.slice(0, 2) } : { targetId: pool[0] });
          }
        }
      }
    }
    if (room.phase === 'discussion') {
      // Chat allows six messages per seat in ten seconds, and a whole compressed day
      // lasts milliseconds here: two different seats speak each day, and a seat that
      // already spoke five times in the window waits for a later day.
      for (const id of [alive[room.round % alive.length], alive[(room.round + 1) % alive.length]]) {
        const recent = (chatted.get(id) || []).filter(at => Date.now() - at < 10_000);
        if (recent.length >= 5) continue;
        chatted.set(id, [...recent, Date.now()]);
        await act(id, 'chat', { channel: 'public', text: 'من كان قلقًا البارحة؟', clientId: crypto.randomUUID() });
      }
      const herald = alive.find(id => clientOf(id).state.you.actions.some(a => a.type === 'herald'));
      if (herald && random() < 0.5) await act(herald, 'herald', {});
    }
    if (room.phase === 'nomination') {
      const suspect = alive[Math.floor(random() * alive.length)];
      for (const id of alive) await act(id, 'nominate', { targetId: random() < 0.8 ? suspect : null });
    }
    if (room.phase === 'verdict') for (const id of alive) await act(id, 'verdict', { approve: random() < 0.7 });
    await h.endPhase(code);
  }
  const room = h.room(code);
  assert.equal(room.phase, 'over', 'the match ends');
  assert.ok(seen.has('night') && seen.has('discussion'));
  assert.deepEqual(errors, [], 'every command a seat was offered is accepted');
  assert.equal(room.technicalAbort, undefined);
  if (room.outcome.reason === 'faction') assert.equal(room.outcome.faction, winningFaction(room));
  // A channel never outlives its night or its day, so an old grant cannot reach a
  // later audience. Within a day, discussion → nomination keeps the call, and the
  // defense (a speaking right changes) rotates it.
  const period = ({ phase, round }) => phase === 'night' ? `night-${round}` : `day-${round}`, owner = new Map();
  for (const entry of channelsByPhase) for (const name of entry.names) {
    if (owner.has(name)) assert.equal(owner.get(name), period(entry), `${name} crossed into ${entry.phase}`);
    owner.set(name, period(entry));
  }
  for (let i = 1; i < channelsByPhase.length; i++) {
    const [a, b] = [channelsByPhase[i - 1], channelsByPhase[i]];
    if (a.phase === 'discussion' && b.phase === 'nomination') assert.deepEqual([...b.names], [...a.names], 'nomination keeps the discussion call');
    if (b.phase === 'defense' || b.phase === 'verdict') assert.ok([...b.names].every(name => !a.names.has(name)), `${b.phase} rotates the public call`);
  }
  await until(() => clients.every(c => c.state.phase === 'over'), 'everyone sees the result');
  for (const c of clients) assert.equal(c.state.replay.players.length, count);
  assert.equal((await all(h.app.env,'SELECT user_id FROM mafia_results')).length,0,'results cannot bypass the spectator delay through match history');
  await until(async () => (await all(h.app.env, 'SELECT user_id FROM mafia_results')).length >= count, 'results stored after30s',45000);
  const history = await h.api(people[1], '/api/mafia/history');
  assert.equal(history.status, 200); assert.equal(history.body.matches.length >= 1, true);
  // Rematch: the room reopens its public seats and the same table can start again.
  await send(0, 'restart');
  await until(() => clients.every(c => c.state.phase === 'lobby'), 'back to the lobby');
  for (let i = 1; i < count; i++) await send(i, 'ready', { ready: true });
  await send(0, 'start');
  await until(() => clients.every(c => c.state.phase === 'role'), 'second match dealt');
  return room.outcome;
}

for (const [count, seed] of [[6, 1], [7, 2], [8, 3], [9, 4], [10, 5], [11, 6], [12, 7]]) {
  test(`${count} players: a whole public match through the room server keeps every voice audience right`, { timeout: 120_000 }, async t => {
    const h = await setup(t);
    const outcome = await playMatch(h, { count, seed });
    assert.ok(["town", "mafia", "shadow", "draw"].includes(outcome.faction));
    t.diagnostic(`${outcome.faction} by ${outcome.reason}`);
  });
}
