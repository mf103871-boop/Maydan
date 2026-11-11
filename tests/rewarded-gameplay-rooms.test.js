import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { RoomClient, newCredentials } from '../src/online/client.js';
import { ROOM_CAPABILITIES } from '../src/online/shared.js';
import { FREE_PACKS } from '../src/shared/account/config.js';
import { TICKET_POLICY, ENTRY_TICKET_POLICY } from '../src/shared/account/gameplay-policy.mjs';
import { freeQuestionManifest } from '../scripts/badeeha-free-manifest.mjs';
import freeManifest from '../server/data/badeeha-free-manifest.json' with { type: 'json' };
import { freeBadeehaRoom } from '../server/rewarded/badeeha-free.mjs';

const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function until(predicate) {
  const until = Date.now() + 5000;
  while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Expected room state was not reached');
}
const error = code => value => value.code === code;
function badeehaSettings(free = false) {
  const categories = free ? FREE_PACKS.slice(0, 6) : ['c1','c2','c3','c4','c5','c6'];
  const deck = Object.fromEntries(categories.map(id => [id, []]));
  for (let n = 0; n < 20; n++) {
    const category = categories[n % 6];
    deck[category].push({ qid: free ? freeManifest[category][Math.floor(n / 6)] : `q-${n}`, p: 200 });
  }
  return { mode: 'standard', roundSize: 20, timer: 60, categories, deck };
}
async function setup(t, policy = true) {
  const app = await startLocalServer({ port: 0, origins: ORIGIN, vars: {
    APP_ORIGIN: ORIGIN, AUTH_DEV_FAKE: '1', REWARDED_ENV: 'local',
    REWARDED_PREVIEW_ENABLED: '1', REWARDED_ADS_ENABLED: '1', MAFIA_ENABLED: '1', ONLINE_PUBLIC_DIRECTORY_ENABLED: '1',
    ...(policy ? { GAMEPLAY_ACCESS_POLICY: typeof policy === 'string' ? policy : TICKET_POLICY } : {}),
  } });
  const clients = [];
  t.after(async () => { clients.forEach(client => client.stop()); await app.close(); });
  const db = app.env.DB;
  async function account(id = crypto.randomUUID()) {
    const now = Date.now();
    await db.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(id, id, now, now).run();
    return { id, authorization: 'Bearer ' + (await issueSession(app.env, id)).token };
  }
  async function post(endpoint, input, auth) {
    const response = await fetch(app.url + endpoint, { method: 'POST', headers: { origin: ORIGIN,
      'content-type': 'application/json', ...(auth ? { authorization: auth.authorization || auth } : {}) }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  }
  async function lobby(game = 'meenfina', { owner, free = false, visibility = 'private', input = {} } = {}) {
    owner ||= await account();
    const count = game === 'mafia' ? 6 : game === 'meenfina' ? 3 : 2;
    const members = Array.from({ length: count }, (_, n) => ({ ...newCredentials(), name: `لاعب ${n}`, avatar: n % 4,
      game, rounds: 5, capabilities: ROOM_CAPABILITIES }));
    const auth = [owner];
    for (let n = 1; n < count; n++) auth.push(['mafia','ersomha'].includes(game) || visibility === 'public' ? await account() : null);
    const created = await post('/api/rooms', { ...members[0],
      ...(game === 'mafia' ? { settings: { mode: 'classic', capacity: 6, visibility, voiceMode: 'off' } }
        : { directory: { visibility, name: visibility === 'public' ? 'مجلس اختبار' : '' },
          ...(game === 'badeeha' ? { settings: badeehaSettings(free) } : {}) }), ...input }, owner);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const code = created.body.code;
    for (let n = 1; n < count; n++) assert.equal((await post(`/api/rooms/${code}/join`, members[n], auth[n])).status, 200);
    const group = members.map((session, n) => new RoomClient({ server: app.url, code, session,
      getAccountAuthorization: () => auth[n]?.authorization, WebSocketImpl: BrowserSocket }));
    clients.push(...group); group.forEach(client => client.start());
    await until(() => group.every(client => client.state?.members.length === count && client.state.members.every(member => member.connected)));
    await Promise.all(group.slice(1).map(client => client.command('ready', { ready: true })));
    const item = app.rooms.get(code);
    return { code, owner, auth, members, group, host: group[0], item,
      start: (fields = {}, index = 0) => group[index].command('start', { accountAuthorization: auth[index]?.authorization, ...fields }) };
  }
  async function ticket(owner, game, offer = `${game}-online`) {
    const id = crypto.randomUUID(), now = Date.now();
    // SSV authenticity is covered by rewarded-server.test. Only verified rows
    // may exercise the room's atomic reserve/commit contract here.
    await db.prepare(`INSERT INTO rewarded_attempts(id,environment,user_id,offer,custom_hash,ad_unit,reward_item,state,created_at,expires_at,verified_at,transaction_id)
      VALUES(?,?,?,?,?,'unit','match','verified',?,?,?,?)`).bind(id, app.env.REWARDED_ENV, owner.id, offer, id, now, now + 30_000, now, id).run();
    return id;
  }
  const claims = async () => (await db.prepare("SELECT offer,user_id,source,state,ticket_id FROM rewarded_match_claims WHERE state!='released' ORDER BY updated_at,match_id").all()).results;
  return { app, db, account, post, lobby, ticket, claims };
}

test('free-pack server manifest matches the exact public bank and rejects forged category labels', async () => {
  assert.deepEqual(freeManifest, await freeQuestionManifest());
  assert.equal(Object.keys(freeManifest).length, 10);
  const settings = badeehaSettings(true);
  assert.equal(freeBadeehaRoom(settings), true);
  settings.deck[settings.categories[0]][0].qid = 'paid-pack-question';
  assert.equal(freeBadeehaRoom(settings), false);
  assert.equal(JSON.stringify(freeManifest).includes('"a"'), false, 'the Worker manifest contains no answers');
});

for (const game of ['meenfina','fabraka','badeeha','ersomha','mafia']) {
  test(`${game}: v2 game-entry ticket starts the real engine in its concrete mode and guests never pay`, async t => {
    const env=await setup(t,ENTRY_TICKET_POLICY),owner=await env.account();
    await env.db.prepare('INSERT INTO trials(user_id,game,created_at) VALUES(?,?,?)').bind(owner.id,game,Date.now()).run();
    const ticketId=await env.ticket(owner,game,`${game}-entry-v2`);
    const room=await env.lobby(game,{owner,free:game==='badeeha'});
    assert.equal(room.host.state.rewardedOffer,`${game}-online`);
    assert.deepEqual(await env.claims(),[],'opening/creating/joining/readiness does not consume entry rights');
    await room.start();assert.ok(!['lobby','over','closed'].includes(room.host.state.phase));
    assert.deepEqual(await env.claims(),[{offer:`${game}-online`,user_id:owner.id,source:'ticket',state:'committed',ticket_id:ticketId}]);
    assert.equal(room.item.instance.room.gameplayPolicy,ENTRY_TICKET_POLICY);
  });
}

test('v2 protects a basic-pack Badeeha match and rejects old creation capability before allocating a seat',async t=>{
  const env=await setup(t,ENTRY_TICKET_POLICY),owner=await env.account();
  const oldCapabilities={...ROOM_CAPABILITIES};delete oldCapabilities.gameplayAccess;
  const before=env.app.rooms.size;
  const rejected=await env.post('/api/rooms',{...newCredentials(),name:'قديمة',avatar:0,game:'meenfina',rounds:5,capabilities:oldCapabilities},owner);
  assert.equal(rejected.status,409);assert.equal(rejected.body.error,'UPDATE_REQUIRED');assert.equal(env.app.rooms.size,before);
  const first=await env.lobby('badeeha',{owner,free:true});await first.start();
  assert.equal((await env.claims())[0].source,'trial');
  const second=await env.lobby('badeeha',{owner,free:true});await assert.rejects(second.start(),error('REWARDED_REQUIRED'));
  assert.equal((await env.claims()).length,1,'the former ten basic packs are covered by one full-match trial, not a bypass');
});

test('v2 entry-status works through HTTP/CORS with the explicit capability header and consumes no start',async t=>{
  const env=await setup(t,ENTRY_TICKET_POLICY),owner=await env.account();env.app.env.APP_ORIGIN=env.app.url;
  const headers={origin:ORIGIN,authorization:owner.authorization,'x-maydan-gameplay-capability':'2'};
  const preflight=await fetch(env.app.url+'/api/rewarded/entry-status?game=badeeha',{method:'OPTIONS',headers:{origin:ORIGIN,
    'access-control-request-method':'GET','access-control-request-headers':'Authorization, X-Maydan-Gameplay-Capability'}});
  assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers'),/X-Maydan-Gameplay-Capability/i);
  const response=await fetch(env.app.url+'/api/rewarded/entry-status?game=badeeha',{headers});assert.equal(response.status,200);
  const status=await response.json();assert.equal(status.offer,'badeeha-entry-v2');assert.equal(status.access,'trial');
  assert.deepEqual(status.modeAccess,{local:'trial',online:'trial'});assert.deepEqual(await env.claims(),[]);
});

test('a v1 lobby requires v2 capability at its next start without consuming rights; updated client can continue it',async t=>{
  const env=await setup(t),room=await env.lobby('badeeha',{free:true});
  for(const socket of room.item.instance.sockets()){const a=socket.deserializeAttachment();delete a.gameplayAccess;socket.serializeAttachment(a);}
  const original=room.host.ws.send.bind(room.host.ws);
  room.host.ws.send=data=>{let message;try{message=JSON.parse(data);}catch{return original(data);}
    if(message.type==='start')delete message.gameplayCapability;return original(JSON.stringify(message));};
  env.app.env.GAMEPLAY_ACCESS_POLICY=ENTRY_TICKET_POLICY;
  await assert.rejects(room.start(),error('UPDATE_REQUIRED'));assert.deepEqual(await env.claims(),[]);
  room.host.ws.send=original;await room.start();assert.equal((await env.claims())[0].source,'trial');
});

test('v2 activation does not interrupt an already playing legacy free-pack match',async t=>{
  const env=await setup(t),room=await env.lobby('badeeha',{free:true});await room.start();assert.deepEqual(await env.claims(),[]);
  env.app.env.GAMEPLAY_ACCESS_POLICY=ENTRY_TICKET_POLICY;
  await room.host.command('open',{categoryId:room.item.instance.room.settings.categories[0],index:0});
  assert.equal(room.host.state.phase,'question');assert.deepEqual(await env.claims(),[]);
});

for (const game of ['meenfina', 'fabraka', 'badeeha', 'ersomha', 'mafia']) {
  test(`${game}: an omitted offer cannot bypass the server-derived first-match gate; joining is free`, async t => {
    const env = await setup(t), room = await env.lobby(game);
    assert.equal(room.host.state.rewardedOffer, `${game}-online`);
    assert.ok(room.group.slice(1).every(client => !client.state.rewardedOffer));
    assert.deepEqual(await env.claims(), [], 'neither lobby creation, joining nor ready spends anything');
    await assert.rejects(room.start({ accountAuthorization: null }), error('AUTH_REQUIRED'));
    const before = Date.now();
    await room.start();
    assert.notEqual(room.host.state.phase, 'lobby');
    assert.notEqual(room.host.state.phase, 'over', 'a paid/trial start must be a playable match');
    assert.equal(Number.isFinite(room.host.state.deadlineAt) || game === 'badeeha', true, 'preserve each engine timing');
    if (room.host.state.deadlineAt) assert.ok(room.host.state.deadlineAt > before, 'no Meenfina-only deadline overwrite');
    assert.deepEqual(await env.claims(), [{ offer: `${game}-online`, user_id: room.owner.id, source: 'trial', state: 'committed', ticket_id: null }]);
    await assert.rejects(room.start({ matchId: 0 }), error('STALE'));
    assert.equal((await env.claims()).length, 1, 'repeated start cannot double-spend');
  });

  test(`${game}: exhausted trials reject before secret preparation; a verified full-match ticket starts exactly once`, async t => {
    const env = await setup(t), owner = await env.account();
    await env.db.prepare('INSERT INTO trials(user_id,game,created_at) VALUES(?,?,?)').bind(owner.id, game, Date.now()).run();
    const room = await env.lobby(game, { owner });
    await assert.rejects(room.start(), error('REWARDED_REQUIRED'));
    assert.equal(room.host.state.phase, 'lobby');
    assert.deepEqual(await env.claims(), []);
    if (game === 'ersomha') {
      assert.equal((await env.db.prepare('SELECT COUNT(*) AS n FROM ersomha_seen').first()).n, 0, 'failed access cannot burn words');
      assert.equal(room.item.instance.room.ersomhaLease == null, true);
    }
    if (game === 'mafia') assert.deepEqual(room.item.instance.room.roleStates, {}, 'failed access cannot deal secret roles');
    const ticket = await env.ticket(owner, game);
    env.app.env.REWARDED_ADS_ENABLED = '0'; // No-fill never grants credit; already earned credit still works.
    await room.start();
    assert.deepEqual(await env.claims(), [{ offer: `${game}-online`, user_id: owner.id, source: 'ticket', state: 'committed', ticket_id: ticket }]);
  });
}

test('policy is off by default and fake client reward markers cannot turn it on', async t => {
  const env = await setup(t, false), owner = await env.account();
  const input = { ...newCredentials(), game: 'meenfina', name: 'مضيف', avatar: 0, rounds: 5 };
  assert.equal((await env.post('/api/rooms', { ...input, rewardedOffer: 'meenfina-online' }, owner)).body.error, 'REWARDED_UNAVAILABLE');
  const room = await env.lobby('meenfina', { owner });
  assert.equal(room.host.state.rewardedOffer, undefined);
  await room.host.command('start');
  assert.deepEqual(await env.claims(), []);
});

test('actual room creation/start honors trial, earned ticket and Plus during production ad-configuration outage', async t => {
  const env = await setup(t,false), oldOwner = await env.account();
  const old = await env.lobby('meenfina',{owner:oldOwner});
  Object.assign(env.app.env,{GAMEPLAY_ACCESS_POLICY:TICKET_POLICY,AUTH_DEV_FAKE:'0',REWARDED_ENV:'production',
    REWARDED_ORIGIN:'https://maydan-game.mf103871.workers.dev',REWARDED_PRODUCTION_ENABLED:'0',REWARDED_IOS_AD_UNIT:undefined});
  async function identity(owner) {
    await env.db.prepare("INSERT INTO identities(provider,subject,user_id,created_at) VALUES('google',?,?,?)").bind(owner.id,owner.id,Date.now()).run();
  }
  await identity(oldOwner);
  await old.start();
  assert.equal(old.host.state.phase,'vote','an old lobby starts its first actual match while new ads are disabled');
  for(const source of ['trial','ticket','plus']) {
    const owner=await env.account(); await identity(owner);
    if(source!=='trial')await env.db.prepare('INSERT INTO trials(user_id,game,created_at) VALUES(?,?,?)').bind(owner.id,'meenfina',Date.now()).run();
    if(source==='ticket')await env.ticket(owner,'meenfina');
    if(source==='plus')await env.db.prepare("INSERT INTO subscriptions(source,external_id,user_id,status,until,environment,updated_at) VALUES('apple',?,?,'active',?,'Production',?)").bind(crypto.randomUUID(),owner.id,Date.now()+86_400_000,Date.now()).run();
    const room=await env.lobby('meenfina',{owner});
    await room.start();
    assert.equal(room.host.state.phase,'vote',source+' must not depend on current ad availability');
    const result=(await env.claims()).find(row=>row.user_id===owner.id);
    assert.equal(result?.source,source);
  }
});

test('policy refuses offer substitution, forged identity and anonymous protected hosts before allocating', async t => {
  const env = await setup(t), owner = await env.account();
  const input = { ...newCredentials(), game: 'meenfina', name: 'مضيف', avatar: 0, rounds: 5 };
  for (const rewardedOffer of ['meenfina-demo','fabraka-online','badeeha-local'])
    assert.equal((await env.post('/api/rooms', { ...input, rewardedOffer }, owner)).body.error, 'REWARDED_UNAVAILABLE');
  assert.equal((await env.post('/api/rooms', { ...input, accountUserId: owner.id })).body.error, 'AUTH_REQUIRED');
  assert.equal(env.app.rooms.size, 0);
});

test('ten free Badeeha packs require no account or trial; forged free decks get the actual gate', async t => {
  const env = await setup(t);
  const input = { ...newCredentials(), game: 'badeeha', name: 'مضيف', avatar: 0, capabilities: ROOM_CAPABILITIES, settings: badeehaSettings(true) };
  const free = await env.post('/api/rooms', input);
  assert.equal(free.status, 201);
  assert.equal(env.app.rooms.get(free.body.code).instance.room.rewardedOffer, undefined);
  const forged = structuredClone(input); forged.id = newCredentials().id; forged.token = newCredentials().token;
  forged.settings.deck.general[0].qid = 'private-pack-question';
  assert.equal((await env.post('/api/rooms', forged)).body.error, 'AUTH_REQUIRED');
  assert.deepEqual(await env.claims(), []);
});

test('public lobbies use the same gate, and real server-side Plus starts without spending trial or a guest ticket', async t => {
  const env = await setup(t), owner = await env.account();
  await env.db.prepare(`INSERT INTO subscriptions(source,external_id,user_id,status,until,environment,updated_at)
    VALUES('apple','sub',?,'active',?,'Production',?)`).bind(owner.id, Date.now() + 86_400_000, Date.now()).run();
  const room = await env.lobby('meenfina', { owner, visibility: 'public' });
  await room.start();
  assert.deepEqual(await env.claims(), [{ offer: 'meenfina-online', user_id: owner.id, source: 'plus', state: 'committed', ticket_id: null }]);
  assert.equal((await env.db.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 0);
});

test('an actual full-match rematch requires a fresh ticket, never a lobby/reconnect allowance', async t => {
  const env = await setup(t), room = await env.lobby('meenfina');
  await room.start();
  for (let round = 1; round <= room.host.state.rounds; round++) {
    await until(() => room.group.every(client => client.state.phase === 'vote' && client.state.round === round));
    await Promise.all(room.group.map(client => client.command('vote', { targetId: room.members[0].id })));
    await until(() => room.host.state.phase === 'result');
    await room.host.command('next');
  }
  await until(() => room.host.state.phase === 'over');
  await room.host.command('restart');
  await until(() => room.group.every(client => client.state.phase === 'lobby'));
  await Promise.all(room.group.slice(1).map(client => client.command('ready', { ready: true })));
  await assert.rejects(room.start(), error('REWARDED_REQUIRED'));
  assert.equal((await env.claims()).length, 1);
  const ticket = await env.ticket(room.owner, 'meenfina');
  await room.start();
  assert.equal((await env.claims()).filter(claim => claim.ticket_id === ticket).length, 1);
  const guest = room.group[1]; guest.stop();
  await until(() => !room.host.state.members.find(member => member.id === room.members[1].id).connected);
  guest.start();
  await until(() => guest.connectionStatus === 'connected' && guest.state.phase === 'vote');
  assert.equal((await env.claims()).length, 2, 'reconnection restores the match rather than spending again');
});

test('real offer concurrency admits one of two simultaneous room starts per earned ticket', async t => {
  const env = await setup(t), owner = await env.account();
  await env.db.prepare('INSERT INTO trials(user_id,game,created_at) VALUES(?,?,?)').bind(owner.id, 'meenfina', Date.now()).run();
  const first = await env.lobby('meenfina', { owner }), second = await env.lobby('meenfina', { owner });
  const ticket = await env.ticket(owner, 'meenfina');
  const starts = await Promise.allSettled([first.start(), second.start()]);
  assert.equal(starts.filter(start => start.status === 'fulfilled').length, 1);
  assert.ok(starts.filter(start => start.status === 'rejected').every(start => ['REWARDED_BUSY','REWARDED_REQUIRED'].includes(start.reason.code)));
  assert.equal((await env.claims()).filter(claim => claim.ticket_id === ticket && claim.state === 'committed').length, 1);
});

test('Mafia handover checks the new host account at actual start and leaves guest accounts untouched', async t => {
  const env = await setup(t), owner = await env.account();
  await env.db.prepare('INSERT INTO trials(user_id,game,created_at) VALUES(?,?,?)').bind(owner.id, 'mafia', Date.now()).run();
  const room = await env.lobby('mafia', { owner });
  await room.host.command('host', { targetId: room.members[1].id });
  await until(() => room.group[1].state.hostId === room.members[1].id && room.group[1].state.rewardedOffer === 'mafia-online');
  assert.equal(room.host.state.rewardedOffer, undefined);
  assert.deepEqual(await env.claims(), []);
  await assert.rejects(room.start(), error('HOST_ONLY'));
  await room.start({}, 1);
  assert.deepEqual(await env.claims(), [{ offer: 'mafia-online', user_id: room.auth[1].id, source: 'trial', state: 'committed', ticket_id: null }]);
});

test('a lobby created before policy activation cannot bypass its newly required start check', async t => {
  const env = await setup(t, false), room = await env.lobby('meenfina');
  env.app.env.GAMEPLAY_ACCESS_POLICY = TICKET_POLICY;
  await assert.rejects(room.host.command('start'), error('AUTH_REQUIRED'));
  assert.equal(room.host.state.phase, 'lobby');
  await room.start();
  assert.equal((await env.claims())[0].source, 'trial');
});
