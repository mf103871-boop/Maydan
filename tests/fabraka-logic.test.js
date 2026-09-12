import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, reduce, currentActor, standings, createQuestionSource, normalizeOptions, validateLie, sameAnswer, matchesTruth, scoreRound, votersFor, TRUTH_ID, turnKey, buildDeck, questionPool, canVoteFor, restoreSession, awards, bestLies, multiplier, SAVE_KEY } from '../src/games/fabraka/logic.js';
import { saveSession, loadSession, loadResult, SEEN_KEY } from '../src/games/fabraka/persistence.js';
import { createStorage } from '../src/shared/lib/storage.js';
import { seeded } from './helpers.js';

const players = [
  { id: 'a', name: 'أحمد', emoji: '🦁' },
  { id: 'b', name: 'سارة', emoji: '🐼' },
  { id: 'c', name: 'ليان', emoji: '🦊' },
];
const deck = Array.from({ length: 24 }, (_, i) => ({ id: `q${i}`, factId: `q${i}`, text: `في السؤال ${i} الإجابة هي ___.`, answer: '8', aliases: ['ثمانية'], decoys: ['11', '13', '17', '19', '21', '23', '25', '27'], explanation: 'شرح', category: 'x', curious: true, kind: 'text' }));
const make = (options = {}, people = players) => initialState(people, { rounds: 3, writeSeconds: 0, discussionSeconds: 0, ...options }, { deck, seed: 42, sessionId: 'test-session' });
const action = (s, type, extra = {}) => ({ type, round: s.round, key: turnKey(s), playerId: currentActor(s)?.id, ...extra });
const go = (s, type, extra) => reduce(s, action(s, type, extra));
const ready = (s) => go(s, 'READY');
function begin(s) {
  s = go(s, 'BEGIN');
  if (s.phase === 'host') { s = ready(s); s = go(s, 'DRAFT', { text: '8' }); s = go(s, 'SUBMIT_TRUTH'); }
  return go(s, 'START_WRITING');
}
function write(s, texts = ['9', '10', '12']) {
  let i = 0;
  while (s.phase === 'write') {
    s = ready(s);
    if (texts[i]) { s = go(s, 'DRAFT', { text: texts[i] }); s = go(s, 'SUBMIT_LIE'); }
    else s = go(s, 'SKIP_WRITE');
    i++;
  }
  return s.phase === 'discussion' ? go(s, 'START_VOTE') : s;
}
function vote(s, choices, funny = {}) {
  while (s.phase === 'vote') {
    s = ready(s); const id = currentActor(s).id;
    s = go(s, 'VOTE', { optionId: choices[id] ?? null, funnyId: funny[id] ?? null });
  }
  return s;
}
function reveal(s) {
  s = go(s, 'START_REVEAL');
  while (s.phase === 'reveal') { s = go(s, 'REVEAL'); s = go(s, 'REVEAL_NEXT'); }
  return s;
}
const data = (name) => JSON.parse(readFileSync(`src/data/games/fabraka/${name}.json`, 'utf8'));

test('normalize settings and disallow doubled friend rounds', () => {
  assert.equal(normalizeOptions({ rounds: 4, writeSeconds: 8 }).rounds, 3);
  assert.equal(normalizeOptions({ rounds: 7, writeSeconds: 30 }).writeSeconds, 30);
  assert.equal(normalizeOptions({ mode: 'friends', finalDouble: true }).finalDouble, false);
  assert.equal(normalizeOptions({ mode: 'missing' }).mode, 'classic');
  assert.deepEqual(normalizeOptions({ categories: ['فضاء', 'فضاء', null] }).categories, ['فضاء']);
  assert.throws(() => initialState([...players, players[0]], {}));
  assert.throws(() => initialState(players.slice(0, 2), {}));
});

test('writing validates syntax only: no truth or duplicate oracle', () => {
  const context = { truth: 'القاهرة', taken: ['دمشق'] };
  for (const text of ['القاهرة', 'قاهره', 'دمشق', 'دِمَشق', 'ثمانية', '8']) assert.equal(validateLie(text, context).ok, true);
  for (const text of ['', '  ', '!!!', 'x'.repeat(61)]) assert.equal(validateLie(text).ok, false);
  assert.equal(validateLie(' بغداد   الجديدة ').text, 'بغداد الجديدة');
});

test('equivalent numbers, spelling and aliases merge without losing signs/decimals', () => {
  for (const [a,b] of [['8','٨'], ['8','۸'], ['8','ثمانية'], ['9','تسعة'], ['21','واحد وعشرين'], ['206','مئتان وستة'], ['1.30','١٫٣'], ['-8','سالب ثمانية'], ['القَاهِرَة','قاهره']]) assert.equal(sameAnswer(a,b), true, `${a} / ${b}`);
  for (const [a,b] of [['8','-8'], ['1.3','13'], ['1','1000'], ['8','80'], ['كبسة','مكرونة']]) assert.equal(sameAnswer(a,b), false);
  assert.equal(matchesTruth('كوفي', { answer: 'قهوة', aliases: ['كوفي'] }), true);
});

test('a complete round: points apply once, after the final reveal', () => {
  let s = write(begin(make()));
  s = vote(s, { a: TRUTH_ID, b: 'lie-a', c: 'lie-a' });
  assert.equal(s.phase, 'gather');
  assert.deepEqual(s.scores, { a: 0, b: 0, c: 0 });
  assert.deepEqual(scoreRound(s), { a: 2000, b: 0, c: 0 });
  assert.deepEqual(votersFor(s, 'lie-a').map((p) => p.id), ['b','c']);
  s = reveal(s);
  assert.equal(s.phase, 'roundEnd'); assert.equal(s.scores.a, 2000);
  assert.equal(s.history.length, 1);
  assert.equal(go(s, 'REVEAL_NEXT'), s, 'cannot score twice');
  s = go(s, 'NEXT_ROUND');
  assert.equal(s.round, 2); assert.deepEqual(s.lies, []);
  s = begin(s); assert.deepEqual(s.order, ['b','c','a']);
});

test('shared wrong answers produce one option, block all owners, and credit both', () => {
  let s = write(begin(make()), ['9', 'تسعة', '10']);
  const shared = s.options.find((o) => o.text === '9');
  assert.deepEqual(shared.owners, ['a','b']); assert.deepEqual(shared.earners, ['a','b']);
  assert.equal(s.options.filter((o) => sameAnswer(o.text, '9')).length, 1);
  assert.ok(s.options.length >= 4);
  assert.equal(canVoteFor(s, 'a', shared.id), false); assert.equal(canVoteFor(s, 'b', shared.id), false);
  s = reveal(vote(s, { a: TRUTH_ID, b: TRUTH_ID, c: shared.id }));
  assert.deepEqual(s.scores, { a: 1500, b: 1500, c: 0 });
});

test('writing truth awards it once; a knowledgeable vote cannot boost a lie', () => {
  let s = write(begin(make()), ['ثمانية', '9', '10']);
  assert.deepEqual(s.truthWriters, ['a']);
  assert.equal(canVoteFor(s, 'a', TRUTH_ID), false);
  s = reveal(vote(s, { a: 'lie-b', b: TRUTH_ID, c: 'lie-b' }));
  assert.deepEqual(s.scores, { a: 1000, b: 1500, c: 0 });
  assert.equal(s.breakdown.a.byWriting, true);
  assert.equal(s.breakdown.b.fooled, 1);
});

test('everyone writes truth: one truth option, enough decoys, equal credit', () => {
  let s = write(begin(make()), ['8', 'ثمانية', '٨']);
  assert.equal(s.options.filter((o) => o.id === TRUTH_ID).length, 1);
  assert.equal(s.options.length, 4);
  s = reveal(vote(s, {}));
  assert.deepEqual(s.scores, { a: 1000, b: 1000, c: 1000 });
  assert.equal(awards(s).find((x) => x.stat === 'truths').players.length, 3);
});

test('help is once per game, survives editing, and cannot earn deception/laugh points', () => {
  let s = ready(begin(make()));
  s = go(s, 'HELP'); assert.equal(s.assisted, true);
  assert.deepEqual(s.helpUsed, ['a']);
  assert.equal(go(s, 'HELP'), s);
  s = go(s, 'DRAFT', { text: '9' }); s = go(s, 'SUBMIT_LIE');
  s = write(s, ['10','12']);
  assert.deepEqual(s.options.find((o) => o.id === 'lie-a').earners, []);
  s = reveal(vote(s, { a: TRUTH_ID, b: 'lie-a', c: 'lie-a' }, { b: 'lie-a', c: 'lie-a' }));
  assert.equal(s.scores.a, 1000); assert.equal(s.stats.a.fooled, 0); assert.equal(s.stats.a.laughs, 0);
  s = begin(go(s, 'NEXT_ROUND'));
  for (let i=0; i<2; i++) s = go(ready(s), 'SKIP_WRITE');
  s = ready(s); assert.equal(currentActor(s).id, 'a'); assert.equal(go(s, 'HELP'), s);
});

test('funniest-lie votes are optional, independent, and excluded for the truth', () => {
  let s = write(begin(make()));
  s = reveal(vote(s, { a: TRUTH_ID, b: TRUTH_ID, c: TRUTH_ID }, { a: TRUTH_ID, b: 'lie-a', c: 'lie-a' }));
  assert.deepEqual(s.scores, { a: 1000, b: 1000, c: 1000 });
  assert.equal(s.stats.a.laughs, 2); assert.equal(s.stats.b.laughs, 0);
  assert.equal(awards(s).find((x) => x.stat === 'laughs').players[0].id, 'a');
  assert.equal(bestLies(s)[0].text, '9');
  let disabled = ready(write(begin(make({ funnyVote: false }))));
  assert.equal(go(disabled, 'VOTE', { optionId: TRUTH_ID, funnyId: 'lie-b' }), disabled);
});

test('invalid, own, foreign-player, premature and stale actions are ignored', () => {
  let s = begin(make());
  assert.equal(go(s, 'SUBMIT_LIE'), s, 'gate closed');
  assert.equal(go(s, 'READY', { playerId: 'b' }), s);
  s = ready(s); s = go(s, 'DRAFT', { text: '9' });
  const old = action(s, 'SUBMIT_LIE'); s = reduce(s, old);
  assert.equal(reduce(s, old), s, 'double tap cannot submit for next player');
  s = write(s, ['10','12']); s = ready(s);
  for (const optionId of ['lie-a','unknown',undefined]) assert.equal(go(s, 'VOTE', { optionId }), s);
  assert.equal(go(s, 'VOTE', { optionId: TRUTH_ID, playerId: 'c' }), s);
  assert.equal(go(s, 'VOTE', { optionId: TRUTH_ID, funnyId: 'lie-a' }), s);
  assert.equal(reduce(s, { ...action(s, 'VOTE', { optionId: TRUTH_ID }), round: 2 }), s);
});

test('timer only runs while writing is open, pauses, and submits a draft at timeout', () => {
  let s = begin(make({ writeSeconds: 30 }));
  assert.equal(go(s, 'TICK', { remaining: 0 }), s);
  s = ready(s); s = go(s, 'DRAFT', { text: '9' }); s = go(s, 'TICK', { remaining: 12 });
  assert.equal(go(s, 'TICK', { remaining: 20 }), s);
  assert.equal(go(s, 'TIMEOUT'), s);
  s = go(s, 'PAUSE'); assert.equal(s.ready, false); assert.equal(go(s, 'TICK', { remaining: 0 }), s);
  s = go(s, 'RESUME'); assert.equal(s.remaining, 12); assert.equal(s.ready, false);
  s = ready(s); s = go(s, 'TICK', { remaining: 0 }); const timeout = action(s, 'TIMEOUT');
  s = reduce(s, timeout); assert.equal(s.lies[0].text, '9'); assert.equal(s.ready, false); assert.equal(s.remaining, 30);
  assert.equal(reduce(s, timeout), s);
  s = ready(s); s = go(s, 'TICK', { remaining: 0 }); s = go(s, 'TIMEOUT'); assert.equal(s.lies[1].text, '');
  const untimed = ready(begin(make())); assert.equal(go(untimed, 'TIMEOUT'), untimed);
});

test('discussion lasts configured time or can end early; next voter is hidden', () => {
  let s = begin(make({ discussionSeconds: 20 }));
  for (let i=0; i<3; i++) s = go(ready(s), 'SKIP_WRITE');
  assert.equal(s.phase, 'discussion'); assert.equal(s.remaining, 20);
  assert.equal(go(s, 'TIMEOUT'), s);
  assert.equal(go(s, 'START_VOTE').phase, 'vote');
  s = go(s, 'TICK', { remaining: 0 }); s = go(s, 'TIMEOUT');
  assert.equal(s.phase, 'vote'); assert.equal(s.ready, false);
});

test('all options reveal once; truth and the most convincing lie are the last pair', () => {
  const s = vote(write(begin(make())), { a: 'lie-b', b: 'lie-a', c: 'lie-a' });
  assert.deepEqual(new Set(s.revealGroups.at(-1)), new Set([TRUTH_ID, 'lie-a']));
  assert.deepEqual(new Set(s.revealGroups.flat()), new Set(s.options.map((o) => o.id)));
  assert.equal(s.revealGroups.flat().length, s.options.length);
  let revealState = go(s, 'START_REVEAL');
  assert.equal(go(revealState, 'REVEAL_NEXT'), revealState);
  revealState = go(revealState, 'REVEAL');
  assert.equal(go(revealState, 'REVEAL'), revealState);
});

for (const count of [3,8]) for (const cycles of [1,2]) test(`friends: ${count} players × ${cycles} cycles, equal chances and host exclusion`, () => {
  const people = Array.from({length:count}, (_,i)=>({id:`p${i}`,name:`لاعب ${i}`}));
  let s = make({ mode: 'friends', friendCycles: cycles, finalDouble: true }, people);
  const hosted = Object.fromEntries(people.map((p)=>[p.id,0]));
  assert.equal(s.rounds, count*cycles);
  for (let round=1;round<=count*cycles;round++) {
    s = go(s,'BEGIN'); hosted[s.hostId]++;
    assert.equal(s.phase,'host'); assert.ok(!s.order.includes(s.hostId)); assert.equal(multiplier(s),1);
    s=ready(s); s=go(s,'DRAFT',{text:'8'}); s=go(s,'SUBMIT_TRUTH'); s=go(s,'START_WRITING');
    s=write(s, []);
    assert.equal(canVoteFor(s, s.hostId, TRUTH_ID),false);
    s=reveal(vote(s,Object.fromEntries(s.order.map(id=>[id,TRUTH_ID]))));
    assert.equal(s.roundScores[s.hostId],0);
    assert.ok(restoreSession(s));
    s=go(s,'NEXT_ROUND');
  }
  assert.equal(s.phase,'over');
  for (const p of people) { assert.equal(hosted[p.id],cycles); assert.equal(s.scores[p.id],(count-1)*cycles*1000); }
});

test('friend prompt replacement uses spare prompts without stealing future turns', () => {
  let s = ready(go(make({mode:'friends',friendCycles:2}),'BEGIN'));
  const reserved = s.deck.slice(1,s.rounds).map(q=>q.id);
  const first = s.question.id;
  s=go(s,'SKIP_PROMPT'); assert.notEqual(s.question.id,first);
  assert.deepEqual(s.deck.slice(1,s.rounds).map(q=>q.id), reserved);
  const seen = new Set(s.usedQuestions);
  for (let i=0;i<30;i++) { const next=go(s,'SKIP_PROMPT'); if(next===s) break; assert.ok(!seen.has(next.question.id)); seen.add(next.question.id); s=next; }
  assert.equal(s.round,1); assert.equal(s.hostId,'a');
});

test('optional final double multiplies truth and deception only on the last round', () => {
  let s=make({finalDouble:true});
  for(let r=1;r<=3;r++) {
    s=write(begin(s));
    const owner=s.options.find(o=>o.owners.includes('a')).id;
    s=reveal(vote(s,{a:TRUTH_ID,b:owner,c:owner}));
    assert.equal(s.roundScores.a,r===3?4000:2000);
    s=go(s,'NEXT_ROUND');
  }
  assert.equal(s.phase,'over'); assert.equal(standings(s)[0].score,8000);
});

test('snapshots recover every phase with privacy closed and stable question/option order', () => {
  let s=make({discussionSeconds:20,writeSeconds:30});
  const check=()=>{
    const restored=restoreSession(JSON.parse(JSON.stringify(s)));
    assert.ok(restored, `restore ${s.phase}`);
    assert.equal(restored.ready,false);
    for(const k of ['scores','stats','question','options','draft','remaining','history','deck','revealGroups']) assert.deepEqual(restored[k],s[k],k);
  };
  check(); s=go(s,'BEGIN');check();s=go(s,'START_WRITING');check();
  for(let i=0;i<3;i++) {s=ready(s);s=go(s,'DRAFT',{text:`جواب ${i}`});s=go(s,'TICK',{remaining:12});check();s=go(s,'SUBMIT_LIE');check();}
  s=go(s,'START_VOTE');check();
  while(s.phase==='vote') {s=ready(s);s=go(s,'VOTE',{optionId:TRUTH_ID});check();}
  s=go(s,'START_REVEAL');check();
  while(s.phase==='reveal') {s=go(s,'REVEAL');check();s=go(s,'REVEAL_NEXT');check();}
  s=go(s,'NEXT_ROUND');check();
  let host=ready(go(make({mode:'friends'}),'BEGIN'));
  host=go(host,'DRAFT',{text:'بيتزا'});host=go(host,'ALIASES',{text:'البيتزا؛ بيتسا'});
  assert.equal(restoreSession(host).draft,'بيتزا');assert.equal(restoreSession(host).ready,false);
});

test('malformed/obsolete snapshots are rejected instead of crashing or resuming bad votes', () => {
  const original=write(begin(make()));
  const changes=[s=>s.schemaVersion=1,s=>s.players[0].name={},s=>s.options=null,s=>s.question=null,s=>s.order.push('unknown'),s=>s.votes.a='unknown',s=>s.seed='random',s=>s.remaining=-1,s=>s.phase='oops',s=>s.settings.mode='oops',s=>s.deck=[],s=>s.scores.a=NaN,s=>s.revealed='true',s=>s.history.push({})];
  for(const change of changes) {const s=structuredClone(original);change(s);assert.equal(restoreSession(s),null);}
  assert.equal(restoreSession(null),null);
});

test('save consumes displayed facts immediately, keeps drafts, and distinguishes memory/failure', () => {
  const items=new Map();
  const backend={getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};
  const storage=createStorage('fabraka-test',backend);
  let s=make(); assert.equal(saveSession(storage,s,100),true);assert.deepEqual(storage.get(SEEN_KEY),{});
  s=ready(begin(s));s=go(s,'DRAFT',{text:'مسودة سرية'});
  assert.equal(saveSession(storage,s,101),true);
  assert.equal(storage.get(SEEN_KEY).q0,101);assert.equal(storage.get(SEEN_KEY).q1,undefined);
  assert.equal(loadSession(storage).draft,'مسودة سرية');assert.equal(loadSession(storage).ready,false);
  saveSession(storage,s,200);assert.equal(storage.get(SEEN_KEY).q0,101);
  assert.equal(saveSession({...storage,set:()=>false},s),false);
  assert.equal(saveSession({...storage,persistent:false},s),false);
  storage.set(SAVE_KEY,{schemaVersion:1});assert.equal(loadSession(storage),null);
  s=make();for(let i=0;i<3;i++){s=reveal(vote(write(begin(s)),{}));s=go(s,'NEXT_ROUND');}
  saveSession(storage,s);assert.equal(loadSession(storage),null);assert.equal(loadResult(storage).phase,'over');
});

test('question sources deduplicate facts, migrate retired IDs, and prefer unseen content', () => {
  const list=[{...deck[0],previousIds:['retired']},{...deck[0],id:'duplicate'},deck[1],deck[2]];
  const source=createQuestionSource(list,{random:seeded(1),seen:{retired:1}});
  assert.equal(source.total,3);
  const drawn=Array.from({length:3},()=>source.next());
  assert.equal(drawn.at(-1).factId,'q0');assert.equal(source.next(),null);
  const q=data('questions'),p=data('pictures'),f=data('personal');
  for(const mode of ['classic','mixed','pictures','friends']) {
    const d=buildDeck({questions:q,pictures:p,personal:f,options:{mode,rounds:7},random:seeded(4)});
    assert.equal(new Set(d.map(x=>x.factId)).size,d.length);
    if(mode==='classic') assert.ok(d.every(x=>x.kind==='text'&&x.curious));
    if(mode==='pictures') assert.equal(d.filter(x=>x.kind==='picture').length,7);
    if(mode==='mixed') assert.deepEqual(d.map(x=>x.kind),['text','text','picture','text','text','picture','text']);
    if(mode==='friends') assert.equal(d.length,24);
  }
  const first=buildDeck({questions:q,personal:f,options:{mode:'friends'},random:seeded(4)});
  const seen=Object.fromEntries(first.slice(0,8).map(x=>[x.factId,1]));
  const second=buildDeck({questions:q,personal:f,options:{mode:'friends'},seen,random:seeded(4)});
  assert.ok(second.slice(0,16).every(x=>!seen[x.factId]));
  assert.ok(questionPool(q,{categories:['فضاء']}).every(x=>x.category==='فضاء'&&x.curious));
});

test('all content has distinct facts, usable aliases/decoys, accessible images, and spare friend prompts', () => {
  const q=data('questions'),p=data('pictures'),f=data('personal'),all=[...q,...p,...f];
  assert.ok(q.length>=149);assert.ok(q.filter(x=>x.curious).length>=79);assert.ok(p.length>=12);assert.ok(f.length>16);
  assert.equal(new Set(all.map(x=>x.id)).size,all.length);assert.equal(new Set(all.map(x=>x.factId)).size,all.length);
  assert.equal(q.flatMap(x=>x.previousIds||[]).length,11);
  for(const item of all){
    assert.equal(item.text.split('___').length,2,item.id);
    assert.ok(item.aliases.every(x=>validateLie(x).ok),item.id);
    const decoys=item.decoys.filter((x,i,a)=>!matchesTruth(x,item)&&!a.slice(0,i).some(y=>sameAnswer(x,y)));
    assert.ok(decoys.length>=3,item.id);
    if(item.kind==='friend') {assert.ok(item.text.includes('{name}'));assert.ok(decoys.length>=8);}
    else assert.ok(validateLie(item.answer).ok,item.id);
    if(item.kind==='picture') {assert.ok(item.imageDescription);assert.ok(item.illustration);assert.ok(!item.imageDescription.includes(item.answer));}
  }
});
