import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../server/game-model.mjs';
import { buildFabrakaDeck } from '../server/fabraka-content.mjs';

const q = { id: 'truth-fixture', kind: 'text', text: 'السؤال فيه ___؟', answer: '206', aliases: ['مئتان وستة'],
  explanation: 'PRIVATE_EXPLANATION', sourceUrl: 'https://example.com/private-source', decoys: ['190', '218', '230'], curious: true };
function fixture(settings = {}, count = 3, source = q) {
  let now = 1000;
  const players = Array.from({ length: count }, (_, n) => ({ id: String(n + 1).padStart(32, '0'), tokenHash: String(n + 1).repeat(64), name: `لاعب ${n + 1}`, avatar: n % 4 }));
  const room = game.createRoom('123456', { ...players[0], game: 'fabraka', settings: { rounds: 3, discussionSeconds: 0, ...settings } }, now);
  for (const player of players.slice(1)) game.joinRoom(room, player, now);
  const act = (n, type, fields = {}) => game.action(room, players[n].id, { type, matchId: room.matchId, round: room.round, ...fields }, now,
    Array.from({ length: 24 }, (_, i) => ({ ...source, id: `${source.id}-${i}`, factId: `${source.id}-${i}` })));
  for (const [n, player] of players.entries()) { game.connected(room, player.id, true, now); act(n, 'ready', { ready: true }); }
  const view = (n = 0) => game.snapshot(room, players[n].id, now);
  const expire = () => { now = room.deadlineAt; game.tick(room, now); };
  const reveal = () => { while (room.phase === 'reveal') act(0, room.fab.groupShown ? 'next_reveal' : 'reveal'); };
  const option = (answer) => room.fab.options.find((o) => o.text === answer).id;
  return { room, players, act, view, expire, reveal, option, time: (value) => { now = value; } };
}
const error = (code) => (e) => e.code === code;

test('rooms dispatch games and preserve legacy rooms without a game field', () => {
  const p = { id: '1'.repeat(32), tokenHash: '2'.repeat(64), name: 'أحمد', avatar: 0, rounds: 5 };
  const original = game.createRoom('123456', p, 1000);
  delete original.game;
  assert.equal(game.snapshot(original, p.id, 1001).protocol, 1);
  assert.equal(game.snapshot(original, p.id, 1001).game, 'meenfina');
  assert.equal(fixture().view().protocol, 2);
  assert.throws(() => game.createRoom('123456', { ...p, game: 'unknown' }, 1000), error('GAME'));
  const { room, players } = fixture({}, 8);
  assert.equal(game.joinRoom(room, players[1], 1002).id, players[1].id);
  assert.throws(() => game.joinRoom(room, { ...p, id: '9'.repeat(32) }, 1002), error('FULL_FABRAKA'));
});
test('truth, aliases, decoys, drafts and authors stay private until the staged reveal', () => {
  const { room, players, act, view, option, reveal } = fixture();
  act(0, 'start');
  assert.equal(room.phase, 'write');
  assert.deepEqual(view(1).question, { text: q.text, kind: 'text' });
  act(0, 'lie', { text: 'خدعة ألف' });
  assert.equal(view(0).mySubmission.text, 'خدعة ألف');
  assert.equal(view(1).mySubmission.submitted, false);
  assert.equal(JSON.stringify(view(1)).includes('خدعة ألف'), false);
  assert.equal(JSON.stringify(view(1)).includes(q.answer), false);
  assert.throws(() => act(0, 'lie', { text: q.answer }), error('SUBMITTED'));
  act(0, 'lie', { text: 'خدعة ألف' });
  act(1, 'lie', { text: 'خدعة باء' }); act(2, 'lie', { text: 'خدعة جيم' });
  assert.equal(room.phase, 'vote');
  for (let i = 0; i < players.length; i++) {
    assert.deepEqual(view(i).question, { text: q.text, kind: 'text' });
    for (const o of view(i).options) {
      assert.deepEqual(Object.keys(o).sort(), ['id', 'mine', 'text']);
      assert.match(o.id, /^[0-9a-f-]{36}$/);
      assert.ok(!players.some((p) => o.id.includes(p.id)));
    }
    for (const secret of [q.explanation, q.aliases[0], q.sourceUrl]) assert.equal(JSON.stringify(view(i)).includes(secret), false);
  }
  assert.throws(() => act(0, 'vote', { optionId: option('خدعة ألف') }), error('OWN_ANSWER'));
  act(0, 'vote', { optionId: option('خدعة باء'), funnyId: option('خدعة جيم') });
  assert.equal(view(2).myVote.submitted, false); assert.equal(view(2).submittedCount, 1);
  assert.ok(view(2).options.every((o) => !('voters' in o)));
  act(1, 'vote', { optionId: option(q.answer) }); act(2, 'vote', { optionId: option(q.answer) });
  assert.equal(room.phase, 'reveal');
  assert.ok(view().members.every((m) => m.score === 0));
  assert.throws(() => act(1, 'reveal'), error('HOST_ONLY'));
  while (!room.fab.groupShown && room.fab.revealIndex < room.fab.revealGroups.length - 1) {
    act(0, 'reveal');
    assert.equal(view().question.answer, undefined);
    assert.ok(view().options.filter((o) => !room.fab.revealedIds.includes(o.id)).every((o) => !('truth' in o) && !('owners' in o)));
    act(0, 'next_reveal');
  }
  reveal();
  assert.equal(room.phase, 'result'); assert.equal(view().question.answer, q.answer);
  assert.deepEqual(view().members.map((m) => m.score), [0, 1500, 1000]);
  assert.equal(view().members[2].stats.laughs, 1);
  assert.ok(view().options.every((o) => typeof o.truth === 'boolean'));
  const scores = structuredClone(room.scores);
  assert.throws(() => act(0, 'reveal'), error('PHASE'));
  assert.deepEqual(room.scores, scores);
});
test('Arabic duplicate lies share credit, own votes are blocked, and final scores double', () => {
  const { room, act, view, option, reveal } = fixture({ finalDouble: true }, 4);
  act(0, 'start');
  room.round = room.rounds; // Exercise the last-round rule without repeating identical rounds.
  for (const [i, value] of ['1000', 'ألف', 'كذبة ثانية', 'كذبة ثالثة'].entries()) act(i, 'lie', { text: value });
  assert.equal(room.fab.options.filter((o) => o.text === '1000').length, 1);
  assert.equal(room.fab.options.find((o) => o.text === '1000').owners.length, 2);
  assert.throws(() => act(1, 'vote', { optionId: option('1000') }), error('OWN_ANSWER'));
  act(0, 'vote', { optionId: option(q.answer) }); act(1, 'vote', { optionId: option(q.answer) });
  act(2, 'vote', { optionId: option('1000') }); act(3, 'vote', { optionId: option('1000') });
  reveal();
  assert.deepEqual(view().members.map((m) => m.score), [4000, 4000, 0, 0]);
});
test('writing a truth alias awards it once and removes that writer from deception scoring', () => {
  const { act, view, option, reveal } = fixture(); act(0, 'start');
  act(0, 'lie', { text: 'مئتان وستة' }); act(1, 'lie', { text: 'كذبة' }); act(2, 'lie', { text: 'كذبة أخرى' });
  assert.throws(() => act(0, 'vote', { optionId: option(q.answer) }), error('OWN_ANSWER'));
  act(0, 'vote', { optionId: option('كذبة') }); act(1, 'vote', { optionId: option(q.answer) }); act(2, 'vote', { optionId: option(q.answer) });
  reveal(); assert.deepEqual(view().members.map((m) => m.score), [1000, 1000, 1000]);
  assert.equal(view().members[1].stats.fooled, 0);
});
test('help remains spent after editing and reconnection but later independent lies can earn', () => {
  const { room, act, view, option, reveal } = fixture(); act(0, 'start'); act(0, 'help');
  const suggestion = view(0).myHelp;
  act(0, 'help'); assert.equal(view(0).myHelp, suggestion); assert.equal(view(1).myHelp, null);
  act(0, 'lie', { text: 'اقتراح معدّل' }); act(1, 'lie', { text: 'اقتراح باء' }); act(2, 'lie', { text: 'اقتراح جيم' });
  act(0, 'vote', { optionId: option(q.answer) }); act(1, 'vote', { optionId: option('اقتراح معدّل'), funnyId: option('اقتراح معدّل') }); act(2, 'vote', { optionId: null });
  reveal(); assert.equal(view().members[0].score, 1000); assert.equal(view().members[0].stats.fooled, 0); assert.equal(view().members[0].stats.laughs, 0);
  act(0, 'next'); assert.equal(view(0).helpAvailable, false);
  assert.throws(() => act(0, 'help'), error('HELP_USED'));
  act(0, 'lie', { text: 'كذبة مستقلة' }); act(1, 'lie', { text: 'اقتراح باء' }); act(2, 'lie', { text: 'اقتراح جيم' });
  act(0, 'vote', { optionId: null }); act(1, 'vote', { optionId: option('كذبة مستقلة') }); act(2, 'vote', { optionId: null });
  const restored = JSON.parse(JSON.stringify(room));
  assert.deepEqual(game.snapshot(restored, room.participants[0], 1001).options, view().options);
  reveal(); assert.equal(view().members[0].score, 1500);
});
test('server deadlines advance missing writes, discussion and votes and reject late actions', () => {
  const { room, act, view, expire, time, reveal } = fixture({ writeSeconds: 30, discussionSeconds: 15 }); act(0, 'start');
  act(0, 'lie', { text: 'كذبة' });
  time(room.deadlineAt);
  assert.throws(() => act(1, 'lie', { text: q.answer }), error('STALE'));
  expire(); assert.equal(room.phase, 'discussion'); assert.equal(view(1).mySubmission.skipped, true);
  expire(); assert.equal(room.phase, 'vote'); expire(); assert.equal(room.phase, 'reveal');
  reveal(); assert.ok(view().members.every((m) => m.score === 0));
  const free = fixture({ writeSeconds: 0 }); free.act(0, 'start');
  assert.equal(free.room.deadlineAt, null);
  assert.throws(() => free.act(1, 'finish_writing'), error('HOST_ONLY'));
  free.act(0, 'finish_writing'); assert.equal(free.room.phase, 'vote');
});
test('friends truth stays private, rotates separately from the room host and excludes its owner', () => {
  const personal = { ...q, id: 'friend', kind: 'friend', text: 'يحب {name} ___', answer: '', aliases: [] };
  const { room, players, act, view, option, reveal } = fixture({ mode: 'friends', finalDouble: true }, 3, personal);
  act(0, 'start'); assert.equal(room.phase, 'host'); assert.equal(room.settings.finalDouble, false);
  assert.equal(view().truthHostId, players[0].id); assert.ok(view().canSkipPrompt);
  assert.throws(() => act(1, 'truth', { text: 'سر' }), error('TRUTH_OWNER'));
  act(0, 'skip_prompt'); act(0, 'truth', { text: 'كبسة', aliases: ['الكبسة'] });
  assert.equal(view(0).myTruth, 'كبسة'); assert.equal(view(1).myTruth, null);
  assert.equal(JSON.stringify(view(1)).includes('كبسة'), false);
  assert.throws(() => act(0, 'lie', { text: 'شيء' }), error('TRUTH_OWNER'));
  act(1, 'lie', { text: 'مكرونة' }); act(2, 'lie', { text: 'عدس' });
  assert.throws(() => act(0, 'vote', { optionId: option('كبسة') }), error('TRUTH_OWNER'));
  act(1, 'vote', { optionId: option('كبسة') }); act(2, 'vote', { optionId: option('كبسة') }); reveal();
  assert.deepEqual(view().members.map((m) => m.score), [0, 1000, 1000]);
  act(0, 'next'); assert.equal(view().truthHostId, players[1].id); assert.equal(room.hostId, players[0].id);
  assert.throws(() => act(0, 'truth', { text: 'إجابة' }), error('TRUTH_OWNER'));
});
test('an absent truth owner and departing players cannot leave a room stuck or expose an unfinished truth', () => {
  const personal = { ...q, id: 'friend', kind: 'friend', text: '{name} يحب ___', answer: '' };
  const idle = fixture({ mode: 'friends' }, 3, personal); idle.act(0, 'start'); idle.expire();
  assert.equal(idle.room.phase, 'result'); assert.equal(idle.view().roundReason, 'truth_timeout');
  assert.equal(idle.view().question.answer, undefined); assert.ok(idle.view().members.every((m) => m.score === 0));
  const left = fixture({ mode: 'friends' }, 4, personal); left.act(0, 'start');
  game.leaveRoom(left.room, left.players[0].id, 1001);
  assert.equal(left.room.phase, 'result'); assert.equal(left.room.hostId, left.players[1].id);
  assert.equal(left.view(1).roundReason, 'owner_left');
  const writing = fixture(); writing.act(0, 'start'); writing.act(0, 'lie', { text: q.answer });
  game.leaveRoom(writing.room, writing.players[2].id, 1001);
  assert.equal(writing.room.phase, 'over'); assert.equal(writing.view(1).question.answer, undefined);
  assert.equal(JSON.stringify(writing.view(1)).includes(q.answer), false);
  assert.ok(writing.view(1).members.every((m) => m.score === 0));
});
test('all four game modes build server decks and pictures expose only display data', () => {
  for (const mode of ['classic', 'mixed', 'pictures', 'friends']) {
    const f = fixture({ mode, rounds: 7 });
    const deck = buildFabrakaDeck(f.room); assert.ok(deck.length >= 7);
    if (mode === 'mixed') { assert.equal(deck[2].kind, 'picture'); assert.equal(deck[5].kind, 'picture'); }
    if (mode === 'pictures') {
      game.action(f.room, f.players[0].id, { type: 'start', matchId: 0 }, 1001, deck);
      const exposed = f.view().question;
      assert.ok(Number.isInteger(exposed.visualIndex)); assert.equal(exposed.illustration, undefined);
      for (const field of ['answer', 'aliases', 'decoys', 'sourceUrl', 'id', 'factId']) assert.equal(exposed[field], undefined);
    }
  }
});
