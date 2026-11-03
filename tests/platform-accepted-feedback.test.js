import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcceptedFeedback } from '../src/shared/fx/accepted-feedback.js';

const setup = () => {
  const events = [], sound = { emit(type, options) { events.push({ type, ...options }); return true; } };
  const feedback = createAcceptedFeedback(); feedback.bind('synthetic-owner', sound); feedback.mount();
  return { events, sound, feedback };
};
test('accepted UI feedback is once-only with opaque IDs unique across screens', () => {
  const a = setup(), b = setup(), first = a.feedback.begin(), second = b.feedback.begin();
  assert.equal(first.confirm(), true); assert.equal(first.error(new Error('late')), false); assert.equal(second.confirm(), true);
  assert.equal(a.events.length, 1); assert.notEqual(a.events[0].id, b.events[0].id);
  assert.match(a.events[0].id, /^accepted:\d+$/); assert.deepEqual(Object.keys(a.events[0]).sort(), ['guard','id','type']);
});
test('owner replacement including A-B-A fences both callbacks and deferred playback', () => {
  const { feedback, sound, events } = setup(); const a = feedback.begin(); a.confirm();
  feedback.bind('second-owner', sound); feedback.bind('synthetic-owner', sound);
  assert.equal(a.current(), false); assert.equal(events[0].guard(), false); assert.equal(a.confirm(), false);
  const b = feedback.begin(); assert.equal(b.confirm(), true); assert.equal(events[1].guard(), true);
});
test('a new action and unmount retire accepted feedback awaiting bank unlock', () => {
  const { feedback, events } = setup(); const a = feedback.begin(); a.confirm(); const b = feedback.begin();
  assert.equal(events[0].guard(), false); assert.equal(a.error(new Error('old')), false);
  assert.equal(b.error(new Error('rejected')), true); feedback.dispose();
  assert.equal(events[1].guard(), false); assert.equal(b.current(), false);
});
test('cancel, pending entitlement and stale owner errors do not become failure cues', () => {
  const { feedback, events } = setup();
  for (const code of ['STALE','STALE_ACCOUNT','PURCHASE_CANCELLED','PURCHASE_PENDING','ACTIVATION_PENDING'])
    assert.equal(feedback.begin().error({ code }), false);
  assert.equal(feedback.begin().error({ name:'AbortError' }), false); assert.equal(events.length, 0);
  assert.equal(feedback.begin().error({ code:'NETWORK' }), true); assert.equal(events[0].type,'ui.error');
});
