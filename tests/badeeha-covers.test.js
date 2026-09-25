import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryCoverSource } from '../src/games/badeeha/covers.js';

test('unshipped covers keep the existing icon without requesting absent assets', () => {
  assert.equal(categoryCoverSource('general', ''), null);
  assert.equal(categoryCoverSource('general', null), null);
});

test('covers resolve inside root and GitHub Pages deployments and change with their content version', () => {
  const first = categoryCoverSource('general', 'abcdef12');
  const corrected = categoryCoverSource('general', 'fedcba98');
  assert.equal(new URL(first, 'https://example.test/').pathname, '/media/badeeha-covers/general.webp');
  assert.equal(new URL(first, 'https://example.test/Maydan/').pathname, '/Maydan/media/badeeha-covers/general.webp');
  assert.notEqual(first, corrected, 'a replaced cover cannot retain the old cache key');
  assert.equal(new URL(corrected, 'https://example.test/').searchParams.get('v'), 'fedcba98');
});

test('cover paths cannot be turned into external or question-media URLs', () => {
  for (const id of ['../answers', 'https://example.test/answer', 'general?answer=x', '/general', 'general.webp', '', null]) {
    assert.equal(categoryCoverSource(id, 'abcdef12'), null);
  }
  assert.equal(categoryCoverSource('general', '../answer'), null);
});
