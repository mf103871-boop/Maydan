import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { privacyPageResponse } from '../server/legal/privacy.mjs';
import fullWorker from '../server/full-worker.mjs';

const root = new URL('../', import.meta.url);
const plainText = value => value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

test('production entry serves privacy inside the existing worker-first API route', async () => {
  const env = { ASSETS: { fetch() { throw new Error('privacy must not use stale SPA assets'); } } };
  for (const path of ['/api/legal/privacy', '/api/legal/privacy/']) for (const method of ['GET', 'HEAD']) {
    const response = await fullWorker.fetch(new Request(`https://maydan.test${path}`, { method }), env);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    const body = await response.text();
    if (method === 'HEAD') assert.equal(body, '');
    else assert.match(body, /LiveKit/);
  }
});

test('privacy paths need no new asset routing and reject other methods through the existing origin guard', async () => {
  const config = await readFile(new URL('wrangler.jsonc', root), 'utf8');
  const routes = JSON.parse(config.match(/"run_worker_first"\s*:\s*(\[[^\]]+\])/)[1]);
  assert.deepEqual(routes, ['/api', '/api/*', '/health']);
  const response = await fullWorker.fetch(new Request('https://maydan.test/api/legal/privacy', { method: 'POST' }), {});
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'ORIGIN' });
  const html = await privacyPageResponse().text();
  assert.ok(html.includes('<link rel="canonical" href="https://maydan-game.mf103871.workers.dev/api/legal/privacy/">'));
});

test('public privacy includes every current native policy paragraph and the same date/contact', async () => {
  const [legal, config] = await Promise.all([
    readFile(new URL('src/platform/screens/Legal.jsx', root), 'utf8'),
    readFile(new URL('src/shared/account/config.js', root), 'utf8'),
  ]);
  const nativePrivacy = legal.slice(legal.indexOf('export function Privacy()'));
  const paragraphs = [...nativePrivacy.matchAll(/<p className="card-muted">([\s\S]*?)<\/p>/g)].map(match => plainText(match[1]));
  assert.ok(paragraphs.length >= 20, 'must compare the full native policy');
  const html = await privacyPageResponse().text();
  const renderedText = plainText(html);
  for (const paragraph of paragraphs) assert.ok(renderedText.includes(paragraph), `missing policy paragraph: ${paragraph}`);
  const date = config.match(/export const LEGAL_UPDATED = '([^']+)'/)[1];
  const email = config.match(/export const SUPPORT_EMAIL = '([^']+)'/)[1];
  assert.ok(html.includes(`<time datetime="${date}" dir="ltr">${date}</time>`));
  assert.ok(html.includes(`href="mailto:${email}"`));
});

test('public privacy covers exactly the 13 declared data types', async () => {
  const manifest = await readFile(new URL('ios/Maydan/PrivacyInfo.xcprivacy', root), 'utf8');
  const expected = [...manifest.matchAll(/<key>NSPrivacyCollectedDataType<\/key>\s*<string>NSPrivacyCollectedDataType(\w+)<\/string>/g)].map(match => match[1]).sort();
  const html = await privacyPageResponse().text();
  const actual = [...html.matchAll(/data-privacy-type="([^"]+)"/g)].map(match => match[1]).sort();
  assert.equal(expected.length, 13);
  assert.deepEqual(actual, expected);
  assert.ok(html.includes('لا نستورد دفتر عناوين جهازك أو نصل إليه'));
  assert.ok(html.includes('لا تتوفر ميزة رفع الفيديو'));
});

test('GET and HEAD share safe HTML headers and need no assets, scripts or account session', async () => {
  const get = privacyPageResponse('GET');
  const head = privacyPageResponse('HEAD');
  assert.equal(get.status, 200);
  assert.deepEqual([...head.headers], [...get.headers]);
  assert.equal(await head.text(), '');
  assert.equal(get.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(get.headers.get('content-language'), 'ar');
  assert.equal(get.headers.get('set-cookie'), null);
  assert.match(get.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(get.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await get.text();
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /<main aria-labelledby="privacy-title">/);
  assert.doesNotMatch(html, /<script\b|<iframe\b|<img\b|\bsrc=|@import|url\(/i);
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    assert.ok(href.startsWith('https://maydan-game.mf103871.workers.dev/') || href === 'mailto:mf103871@gmail.com', `unexpected link: ${href}`);
  }
});
