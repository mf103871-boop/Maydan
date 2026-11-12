import test from 'node:test';
import assert from 'node:assert/strict';
import { initialUiLocale, localeDirection, translate, setUiLocale, getUiLocale, subscribeLocale } from '../src/shared/i18n/core.js';

test('existing accounts stay Arabic while a new installation may follow English', () => {
  assert.equal(initialUiLocale({}, 'en-US'), 'ar');
  assert.equal(initialUiLocale({ uiLocale: 'en' }, 'ar-JO'), 'en');
  assert.equal(initialUiLocale(null, 'en-GB'), 'en');
  assert.equal(initialUiLocale(null, 'fr'), 'ar');
  assert.equal(initialUiLocale({ uiLocale: 'invalid' }, 'en'), 'ar');
});
test('authored translations interpolate values without changing player-supplied names', () => {
  assert.equal(translate('العب', {}, 'en'), 'Play');
  assert.equal(translate('{count} رسالة غير مقروءة', { count: 4 }, 'en'), '4 unread messages');
  assert.equal(translate('العب', {}, 'ar'), 'العب');
  assert.equal(localeDirection('ar'), 'rtl');
  assert.equal(localeDirection('en'), 'ltr');
});
test('language subscriptions update mounted views without remounting them', () => {
  let calls = 0;
  const unsubscribe = subscribeLocale(() => calls++);
  setUiLocale('en'); setUiLocale('en');
  assert.equal(getUiLocale(), 'en'); assert.equal(calls, 1);
  unsubscribe(); setUiLocale('ar'); assert.equal(calls, 1);
});
