import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../src/shared/lib/storage.js';
import { LocalGameplayAccess } from '../src/shared/account/local-gameplay-access.mjs';
import { GAMEPLAY_OFFERS, TICKET_POLICY, badeehaFreeSelection, resolveGameplayPolicy } from '../src/shared/account/gameplay-policy.mjs';
import { FREE_PACKS } from '../src/shared/account/config.js';
import { gameAccess, lockedPack } from '../src/shared/account/entitlements.js';

function setup(game = 'beep') {
  const records = new Map();
  const backend = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const storage = createStorage('test-access', backend);
  let calls = [], trial = false, account = { gameplayPolicy: TICKET_POLICY, signedIn: true, user: { id: 'a' },
    markTrial: () => { trial = true; }, gameAccess: () => trial ? 'locked' : 'trial', refresh() {} };
  let next = async (id) => ({ matchId: id, state: 'committed', source: 'trial' });
  const gate = new LocalGameplayAccess({ game, storage, getAccount: () => account,
    start: async (user, id, offer) => { calls.push({ owner: user.user.id, id, offer }); return next(id); } });
  return { gate, storage, calls, account, switchAccount(value) { account = value; }, reply(fn) { next = fn; } };
}

test('explicit default-off retains all existing free paths; all eight games have exact policy offers', async () => {
  assert.deepEqual([...new Set(GAMEPLAY_OFFERS.map(offer => offer.game))], ['badeeha','beep','mamnoo','jabeen','fabraka','meenfina','ersomha','mafia']);
  assert.equal(GAMEPLAY_OFFERS.length, 11);
  for (const offer of GAMEPLAY_OFFERS.filter(offer => offer.mode === 'local')) {
    const env = setup(offer.game); env.account.gameplayPolicy = null;
    assert.equal((await env.gate.authorize()).ready, true);
    assert.equal(env.calls.length, 0);
  }
  assert.equal(gameAccess({ trials: { beep: true } }, { beep: true }, 'beep'), 'free');
  assert.equal(gameAccess({ trials: { beep: true } }, {}, 'beep', TICKET_POLICY), 'locked');
  assert.equal(lockedPack('worldcup', false), false);
  assert.equal(lockedPack('worldcup', false, TICKET_POLICY), true);
});

test('a cached free release cannot bypass an enabled native build on startup or outage', () => {
  assert.equal(resolveGameplayPolicy({ build: TICKET_POLICY, me: { gameplay: { access: 'free', allPacks: true } } }), TICKET_POLICY);
  assert.equal(resolveGameplayPolicy({ build: TICKET_POLICY, billing: {}, me: null }), TICKET_POLICY);
  assert.equal(resolveGameplayPolicy({ build: TICKET_POLICY, billing: { gameplay: { access: 'free', allPacks: true } } }), null);
  assert.equal(resolveGameplayPolicy({ me: { gameplay: { policy: TICKET_POLICY } } }), TICKET_POLICY);
  assert.equal(gameAccess({ gameplay:{policy:TICKET_POLICY},trials:{beep:true} },{},'beep',null),'free','fresh explicit policy-off overrides a cached gated /me');
  assert.equal(resolveGameplayPolicy({}), null);
});

test('exactly ten basic Badeeha packs remain unlimited without a trial, account, ticket or Plus', async () => {
  assert.equal(FREE_PACKS.length, 10);
  const env = setup('badeeha');
  env.account.signedIn = false; env.account.gameAccess = () => 'locked';
  assert.equal(badeehaFreeSelection([]), false);
  assert.equal(badeehaFreeSelection(['general','invented']), false);
  for (let index = 0; index < 3; index++) {
    assert.equal((await env.gate.authorize({ categories: FREE_PACKS.slice(index, index + 6) })).ready, true);
    env.gate.activate(); env.gate.complete();
  }
  assert.equal(env.calls.length, 0);
  assert.equal((await env.gate.authorize({ categories: ['worldcup'] })).reason, 'signin');
});

test('local preparation and rematch use one full-match claim each; active resume reuses its exact ID', async () => {
  const env = setup();
  assert.equal((await env.gate.authorize()).ready, true);
  const first = env.gate.snapshot(); env.gate.activate();
  assert.equal(env.storage.get('pending:a'), null);
  env.reply(async () => { throw Object.assign(new Error(),{code:'OFFLINE'}); });
  assert.equal((await env.gate.authorize({ resume: { profileSession: { gameplayAccess: first } } })).ready, true);
  assert.equal(env.calls.length, 1, 'acknowledged full match resumes offline without another start call');
  env.gate.complete();
  assert.equal((await env.gate.authorize({ resume: { profileSession: { gameplayAccess: first } } })).reason, 'completed');
  env.reply(async id => ({ matchId: id, state: 'committed', source: 'ticket' }));
  assert.equal((await env.gate.authorize()).ready, true);
  assert.notEqual(env.gate.snapshot().matchId, first.matchId);
});

test('lost response, reload and double tap preserve one prepared claim; no-fill never grants access', async () => {
  const env = setup();
  let release;
  env.reply(id => new Promise(resolve => { release = () => resolve({ matchId: id, state: 'committed', source: 'trial' }); }));
  const a = env.gate.authorize(), b = env.gate.authorize();
  assert.equal(env.calls.length, 1); release();
  assert.equal((await a).ready, true); assert.equal((await b).ready, true);
  env.gate.activate(); env.gate.complete();
  env.reply(async () => { throw Object.assign(new Error(), { code: 'NETWORK' }); });
  assert.equal((await env.gate.authorize()).reason, 'pending');
  const id = env.storage.get('pending:a').matchId;
  env.reply(async () => { throw Object.assign(new Error(), { code: 'REWARDED_REQUIRED' }); });
  env.gate.clear();
  assert.equal((await env.gate.authorize()).reason, 'required');
  assert.equal(env.calls.at(-1).id, id);
  assert.equal(env.gate.snapshot(), null);
});

test('account switch fences delayed replies and saved grants; legacy saved matches are preserved', async () => {
  const env = setup(); let resolve;
  env.reply(id => new Promise(done => { resolve = () => done({ matchId: id, state: 'committed', source: 'ticket' }); }));
  const pending = env.gate.authorize();
  env.switchAccount({ ...env.account, user: { id: 'b' } }); env.gate.clear(); resolve();
  assert.equal((await pending).reason, 'account');
  assert.equal(env.gate.snapshot(), null);
  assert.equal((await env.gate.authorize({ resume: { profileSession: { gameplayAccess: { version: 1, owner: 'a', offer: 'beep-local' } } } })).reason, 'account');
  assert.equal((await env.gate.authorize({ resume: { phase: 'play' } })).ready, true);
  assert.equal(env.gate.snapshot().source, 'legacy');
});

test('guest gets one local trial and may resume it; another match needs account and no ad auto-opens', async () => {
  const env = setup(); env.account.signedIn = false;
  assert.equal((await env.gate.authorize()).ready, true);
  const marker = env.gate.snapshot(); env.gate.activate();
  assert.equal(marker.source, 'guest-trial');
  assert.equal((await env.gate.authorize({ resume: { profileSession: { gameplayAccess: marker } } })).ready, true);
  env.gate.complete();
  assert.equal((await env.gate.authorize()).reason, 'signin');
  assert.equal(env.calls.length, 0);
});
