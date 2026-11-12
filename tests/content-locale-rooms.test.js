import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContentIdentity, contentVersionFor } from '../src/shared/content-locale.mjs';
import * as game from '../server/game-model.mjs';
import { Room, meenfinaDeck } from '../server/room.mjs';
import { MemoryStorage } from '../server/local.mjs';
import { normalizeMafiaSettings } from '../src/online/mafia-shared.js';
import { selectRankedGroup } from '../server/mafia-matchmaking.mjs';
import { getErsomhaPool, matchesErsomhaAnswer, buildErsomhaChoices, ERSOMHA_BANK, ERSOMHA_ENGLISH_BANK } from '../server/ersomha-content.mjs';
import { buildErsomhaTurnPlan } from '../server/ersomha-history.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { advanceObserverStream, observerView, OBSERVER_DELAY } from '../server/mafia-observers.mjs';
import {post,RoomClient} from '../src/online/client.js';
import {routeRequest} from '../server/worker.mjs';
import {badeehaContentStorage} from '../src/online/badeeha-storage.js';
import {contentSettings} from '../src/online/content-settings.js';
import {normalizeContentOptions} from '../src/games/fabraka/content.js';
import * as drawing from '../server/ersomha-model.mjs';

const error = code => value => value.code === code;
const seat = n => ({ id: String(n).padStart(32, '0'), tokenHash: String(n).repeat(64), name: `Player ${n}`, avatar: n % 4, capabilities: { localizedContent: 1 } });
function fixture(contentLocale = 'ar') {
  const now = Date.now(), seats = [seat(1), seat(2), seat(3)];
  const room = game.createRoom('123456', { ...seats[0], game: 'meenfina', rounds: 12, contentLocale }, now);
  for (const player of seats.slice(1)) game.joinRoom(room, player, now);
  for (const player of seats) { game.connected(room, player.id, true, now); game.action(room, player.id, { type: 'ready', ready: true, matchId: room.matchId }, now); }
  return { room, seats, now };
}

test('legacy identity stays Arabic and unsupported locale/version never falls back', () => {
  assert.deepEqual(normalizeContentIdentity(), { contentLocale: 'ar', contentVersion: 'legacy-ar' });
  assert.equal(contentVersionFor('en'), 'new-en');
  assert.throws(() => normalizeContentIdentity({ contentLocale: 'fr' }), /CONTENT_LOCALE/);
  assert.throws(() => normalizeContentIdentity({ contentLocale: 'en', contentVersion: 'legacy-ar' }), /CONTENT_VERSION/);
  const host = { ...seat(1), capabilities: undefined, rounds: 12 };
  assert.equal(game.createRoom('123456', host, Date.now()).contentLocale, 'ar');
  assert.throws(() => game.createRoom('123456', { ...host, contentLocale: 'en' }, Date.now()), error('UPDATE_REQUIRED'));
});

test('English creation requires the server announcement before any mutating request; old servers keep Arabic', async () => {
  const seen=[],oldFetch=async(url,init)=>{seen.push({url,method:init.method});return Response.json({error:'NOT_FOUND'},{status:404});};
  await assert.rejects(post('http://localhost:3000','/api/rooms',{contentLocale:'en'},{fetchImpl:oldFetch}),error('CONTENT_UNAVAILABLE'));
  assert.equal(seen.length,1);assert.equal(seen[0].method,undefined);
  const requests=[];
  await post('http://localhost:3000','/api/rooms',{contentLocale:'en'}, {fetchImpl:async(url,init)=>{requests.push(init.method||'GET');return Response.json(init.method?{code:'123456'}:{localizedContent:1,contentVersions:{ar:'legacy-ar',en:'new-en'}});}});
  assert.deepEqual(requests,['GET','POST']);
  const arabic=[];
  await post('http://localhost:3000','/api/rooms',{}, {fetchImpl:async(url,init)=>{arabic.push(init.method);return Response.json({code:'123456'});}});
  assert.deepEqual(arabic,['POST']);
  const client=new RoomClient({server:'http://localhost:3000',code:'123456',session:{},WebSocketImpl:class {}});
  await assert.rejects(client.command('content_locale',{contentLocale:'en'}),error('CONTENT_UNAVAILABLE'));
});

test('worker content announcement is browser readable and English history leaves old Arabic slots intact', async () => {
  const origin='https://maydan-preview.example',response=await routeRequest(new Request('https://worker.example/api/content/capabilities',{headers:{origin}}),{ALLOWED_ORIGINS:origin});
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.equal((await response.json()).contentVersions.en,'new-en');
  const memory=new Map([['maydan:badeeha:history','old-ar']]),backend={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
  badeehaContentStorage({contentLocale:'en'},backend).setItem('maydan:badeeha:history','new-en');
  assert.equal(memory.get('maydan:badeeha:history'),'old-ar');
  assert.equal(memory.get('maydan:badeeha:history:en:new-en'),'new-en');
});

test('changing or reopening a saved English settings draft replaces its entire content identity', () => {
  const saved=normalizeContentOptions({contentLocale:'en',contentVersion:'new-en',timer:90});
  const arabic=normalizeContentOptions(contentSettings(saved,'ar'));
  assert.equal(arabic.contentLocale,'ar');assert.equal(arabic.contentVersion,'legacy-ar');
  const english=normalizeContentOptions(contentSettings(arabic,'en'));
  assert.equal(english.contentLocale,'en');assert.equal(english.contentVersion,'new-en');
  assert.equal(normalizeContentOptions(contentSettings(saved)).contentVersion,'legacy-ar');
  assert.equal(saved.contentVersion,'new-en','reading a draft must not mutate the stored source');
});

test('English rollout stop blocks new Room creation and starts, while Arabic and English in play continue', async t => {
  const env={ENGLISH_CONTENT_ENABLED:'0',ALLOWED_ORIGINS:'https://maydan-preview.example'},off=await routeRequest(new Request('https://worker.example/api/content/capabilities',{headers:{origin:'https://maydan-preview.example'}}),env);
  assert.equal((await off.json()).contentVersions.en,undefined);
  const storage=new MemoryStorage();t.after(()=>storage.dispose());
  const messages=[],socket={readyState:1,attachment:{id:seat(1).id,seenAt:Date.now(),windowAt:Date.now(),count:1},deserializeAttachment(){return this.attachment;},serializeAttachment(value){this.attachment=value;},send(raw){messages.push(JSON.parse(raw));},close(){this.readyState=3;}};
  const ctx={storage,blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[socket]},owner=new Room(ctx,env);await owner.ready;
  const create=async contentLocale=>owner.fetch(new Request('https://internal/create?code=123456',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...seat(1),token:'1'.repeat(64),game:'meenfina',rounds:12,contentLocale})}));
  const refused=await create('en');assert.equal(refused.status,409);assert.equal((await refused.json()).error,'CONTENT_UNAVAILABLE');assert.equal(owner.room,null);
  assert.equal((await create('ar')).status,201);
  const english=fixture('en');await owner.commit(english.room);
  await owner.webSocketMessage(socket,JSON.stringify({requestId:'stopped-start',type:'start',matchId:english.room.matchId}));
  assert.equal(messages.find(message=>message.requestId==='stopped-start').error,'CONTENT_UNAVAILABLE');
  assert.equal(owner.room.phase,'lobby');assert.equal(owner.stateFor(seat(1).id).capabilities.newEnglishContent,false);
  game.action(english.room,seat(1).id,{type:'start',matchId:english.room.matchId},Date.now(),meenfinaDeck(english.room));
  await owner.commit(english.room);
  await owner.webSocketMessage(socket,JSON.stringify({requestId:'active-vote',type:'vote',matchId:english.room.matchId,round:english.room.round,targetId:seat(2).id}));
  assert.equal(messages.find(message=>message.requestId==='active-vote').ok,true);
  assert.equal((await storage.get('room')).contentLocale,'en');
});

test('only the host changes lobby content, every guest readies again, start locks language', () => {
  const { room, seats, now } = fixture();
  const command = { type: 'content_locale', matchId: 0, contentLocale: 'en', contentVersion: 'new-en' };
  assert.throws(() => game.action(room, seats[1].id, command, now), error('HOST_ONLY'));
  game.action(room, seats[0].id, command, now);
  assert.deepEqual(room.members.map(member => member.ready), [true, false, false]);
  const english = meenfinaDeck(room);
  assert.ok(english.length >= 10);
  assert.ok(english.every(question => question.contentLocale === 'en'));
  assert.throws(() => game.action(room, seats[0].id, { type: 'start', matchId: room.matchId }, now, english));
  for (const player of seats) game.action(room, player.id, { type: 'ready', ready: true, matchId: room.matchId }, now);
  game.action(room, seats[0].id, { type: 'start', matchId: room.matchId }, now, english);
  assert.equal(room.phase, 'vote');
  assert.throws(() => game.action(room, seats[0].id, { type: 'content_locale', matchId: room.matchId, contentLocale: 'ar' }, now), error('PHASE'));
  for (const player of seats) {
    const view = game.snapshot(room, player.id, now);
    assert.equal(view.contentLocale, 'en'); assert.equal(view.contentVersion, 'new-en');
    assert.equal(view.question.text, game.snapshot(room, seats[0].id, now).question.text);
  }
});

test('English admission and a language change refuse old controlling clients', () => {
  const { room, seats, now } = fixture('en');
  assert.throws(() => game.joinRoom(room, { ...seat(4), capabilities: undefined }, now), error('UPDATE_REQUIRED'));
  const legacy = fixture(); legacy.room.members[1].localizedContent = false;
  assert.throws(() => game.action(legacy.room, seats[0].id, { type: 'content_locale', matchId: 0, contentLocale: 'en' }, now), error('UPDATE_REQUIRED'));
  assert.equal(legacy.room.contentLocale, 'ar');
});

test('real Room commits locale before publishing and restores it after reconstruction', async t => {
  const { room: state, seats } = fixture();
  const storage = new MemoryStorage(); t.after(() => storage.dispose());
  await storage.put('room', state);
  const socket = {
    readyState: 1, messages: [], attachment: { id: seats[0].id, seenAt: Date.now(), windowAt: Date.now(), count: 1 },
    deserializeAttachment() { return this.attachment; }, serializeAttachment(value) { this.attachment = value; },
    send(raw) { const value = JSON.parse(raw); if (value.type === 'state' && value.state.contentLocale === 'en') assert.equal(storage.data.get('room').contentLocale, 'en'); this.messages.push(value); },
    close() { this.readyState = 3; },
  };
  const ctx = { storage, blockConcurrencyWhile: fn => fn(), getWebSockets: () => [socket] };
  const owner = new Room(ctx, {}); await owner.ready;
  await owner.webSocketMessage(socket, JSON.stringify({ requestId: 'locale-1', matchId: 0, type: 'content_locale', contentLocale: 'en', contentVersion: 'new-en' }));
  assert.equal(socket.messages.find(message => message.requestId === 'locale-1')?.ok, true);
  assert.equal((await storage.get('room')).contentLocale, 'en');
  const resumed = new Room(ctx, {}); await resumed.ready;
  assert.equal(game.snapshot(resumed.room, seats[1].id, Date.now()).contentVersion, 'new-en');
  assert.equal(resumed.room.members[1].ready, false);
});

test('English Ersomha covers all categories and tiers with exact aliases', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const pool = getErsomhaPool({ contentLocale: 'en', difficulty });
    assert.ok(pool.length >= 192);
    assert.equal(new Set(pool.map(card => card.category)).size, 12);
    const categories = ['animals', 'food', 'home'];
    const plan = buildErsomhaTurnPlan(getErsomhaPool({ contentLocale: 'en', difficulty, categories }), 16, { seen: [], allowReplay: false });
    assert.equal(plan.length, 16); assert.ok(plan.every(cards => cards.length === 3));
    assert.equal(new Set(plan.flat().map(card => card.familyId)).size, 48);
  }
  const choices = buildErsomhaChoices({ contentLocale: 'en', difficulty: 'easy' });
  assert.ok(choices.every(card => card.contentLocale === 'en'));
  const card = getErsomhaPool({ contentLocale: 'en', difficulty: 'easy' }).find(entry => entry.answer === 'football');
  assert.ok(matchesErsomhaAnswer('  SOCCER  ', card));
  assert.equal(matchesErsomhaAnswer('football player', card), false);
  assert.equal(matchesErsomhaAnswer('footbal', card), false);
  assert.equal(matchesErsomhaAnswer('كرة القدم', card), false);
  assert.throws(() => getErsomhaPool({ contentLocale: 'en', contentVersion: 'legacy-ar' }), /CONTENT_VERSION/);
});

test('all private legacy concepts keep the same IDs, families and tiers in English; history crosses languages', () => {
  const translations=new Map(ERSOMHA_ENGLISH_BANK.filter(card=>card.conceptOrigin==='legacy-ar').map(card=>[card.id,card]));
  assert.equal(translations.size,ERSOMHA_BANK.length);
  for(const arabic of ERSOMHA_BANK){
    const english=translations.get(arabic.id);
    assert.equal(english.conceptId,arabic.conceptId);assert.equal(english.familyId,arabic.familyId);
    assert.equal(english.category,arabic.category);assert.equal(english.difficulty,arabic.difficulty);
    assert.ok(!/[\u0600-\u06ff]/u.test([english.answer,...english.aliases].join(' ')));
  }
  const known=getErsomhaPool({difficulty:'easy'}).find(card=>card.familyId==='animal-cat');
  const pool=getErsomhaPool({contentLocale:'en',difficulty:'easy'});
  const seen=[{family_id:known.familyId,concept_id:known.conceptId,seen_at:Date.now()}];
  const plan=buildErsomhaTurnPlan(pool,16,{seen,allowReplay:false});
  assert.ok(plan.flat().every(card=>card.familyId!==known.familyId&&card.conceptId!==known.conceptId));
  const choices=buildErsomhaChoices({contentLocale:'en',difficulty:'easy',excludedConceptIds:[known.conceptId],excludedFamilyIds:[known.familyId]});
  assert.ok(choices.every(card=>card.familyId!==known.familyId));
});

test('English drawing uses the actual secret projection and exact guess path with unchanged scoring', () => {
  const now=1000,players=[seat(1),seat(2),seat(3)],room=game.createRoom('123456',{...players[0],game:'ersomha',contentLocale:'en',settings:{difficulty:'easy'}},now);
  for(const player of players.slice(1))game.joinRoom(room,player,now);
  for(const player of players){game.connected(room,player.id,true,now);room.members.find(m=>m.id===player.id).accountUserId=`synthetic-${player.id}`;game.action(room,player.id,{type:'ready',ready:true,matchId:0},now);}
  game.action(room,players[0].id,{type:'start',matchId:0},now);
  const pool=getErsomhaPool({contentLocale:'en',difficulty:'easy'}),word=pool.find(card=>card.answer==='football'),others=pool.filter(card=>card.id!==word.id).slice(0,2);
  drawing.setErsomhaChoices(room,[word,...others],now);
  const command=(id,type,fields,at)=>game.action(room,id,{type,matchId:room.matchId,round:room.round,...fields},at);
  command(room.draw.drawerId,'select_word',{choiceId:word.id},1100);
  const guessers=players.filter(player=>player.id!==room.draw.drawerId);
  const hidden=game.snapshot(room,guessers[0].id,1150);assert.equal(hidden.myWord,null);assert.deepEqual(hidden.myChoices,[]);
  for(const key of ['aliases','conceptId','familyId'])assert.ok(!JSON.stringify(hidden).includes(`"${key}"`));
  command(guessers[0].id,'guess',{text:'كرة القدم'},1200);assert.equal(room.draw.correct[guessers[0].id],undefined);
  command(guessers[0].id,'guess',{text:'SOCCER'},1300);assert.equal(game.snapshot(room,guessers[1].id,1300).recentGuesses.at(-1).text,null);
  command(guessers[1].id,'guess',{text:'football'},1400);assert.equal(room.phase,'result');
  assert.equal(room.scores[guessers[0].id],150);assert.equal(room.scores[guessers[1].id],150);assert.equal(room.scores[room.draw.drawerId],100);
  assert.equal(game.snapshot(room,guessers[1].id,1400).revealedWord,word.answer);
  for(const card of ERSOMHA_ENGLISH_BANK)assert.ok([card.answer,...card.aliases].some(answer=>Array.from(answer).length<=60),`Unreachable answer: ${card.id}`);
});

test('observer content identity follows the delayed snapshot, including old Arabic snapshots', () => {
  const host = {...seat(1), capabilities: {mafia:2, localizedContent:1}};
  const now=Date.now(), room=game.createRoom('123456',{...host,game:'mafia',settings:{visibility:'public'}},now);
  let stream=advanceObserverStream(null,room,now);
  stream=advanceObserverStream(stream,room,now+OBSERVER_DELAY);
  room.contentLocale='en';room.contentVersion='new-en';
  stream=advanceObserverStream(stream,room,now+OBSERVER_DELAY+1);
  assert.equal(observerView(room,stream,{id:'observer'},now+OBSERVER_DELAY+1).contentLocale,'ar');
  stream=advanceObserverStream(stream,room,now+2*OBSERVER_DELAY+1);
  assert.equal(observerView(room,stream,{id:'observer'},now+2*OBSERVER_DELAY+1).contentLocale,'en');
  delete stream.visible.contentLocale;delete stream.visible.contentVersion;
  assert.equal(observerView(room,stream,{id:'observer'},now+2*OBSERVER_DELAY+1).contentLocale,'ar');
});

test('ranked matching groups one language before allocation and preserves old Arabic candidates', () => {
  const now = Date.now();
  const rows = Array.from({ length: 16 }, (_, index) => ({ user_id: `user-${index}`, joined_at: now - 60000, rating: 1000, content_locale: index % 2 ? 'en' : 'ar' }));
  const match = selectRankedGroup(rows, [], now);
  assert.equal(match.members.length, 8);
  assert.equal(new Set(match.members.map(row => row.content_locale)).size, 1);
  assert.equal(selectRankedGroup(rows.slice(0, 8), [], now), null);
  assert.equal(selectRankedGroup(rows.slice(0, 8).map(({ content_locale, ...row }) => row), [], now).members.length, 8);
  assert.equal(normalizeMafiaSettings({ community: 'en' }).community, 'en');
});

test('additive local migration keeps Arabic defaults for old queue and directory writers', () => {
  const DB = createLocalD1();
  const queue = DB.prepare('PRAGMA table_info(mafia_ranked_queue)').all();
  const directory = DB.prepare('PRAGMA table_info(online_public_rooms)').all();
  return Promise.all([queue, directory]).then(([q, d]) => {
    assert.equal(q.results.find(column => column.name === 'content_locale').dflt_value, "'ar'");
    assert.equal(d.results.find(column => column.name === 'content_version').dflt_value, "'legacy-ar'");
    DB.close?.();
  });
});
