import test from 'node:test';
import assert from 'node:assert/strict';
import { supportPageResponse } from '../server/legal/support.mjs';
import fullWorker from '../server/full-worker.mjs';

test('support is standalone public GET/HEAD through the existing worker-first API routes', async () => {
  const env = new Proxy({}, { get() { throw new Error('Support must not load assets, sessions or storage'); } });
  for (const path of ['/api/legal/support', '/api/legal/support/']) for (const method of ['GET', 'HEAD']) {
    const response = await fullWorker.fetch(new Request(`https://maydan.test${path}`, { method }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-language'), 'ar');
    assert.equal(response.headers.has('set-cookie'), false);
    const body = await response.text();
    if (method === 'HEAD') assert.equal(body, ''); else assert.match(body, /الدعم|مساعدتك/);
  }
});

test('support covers purchases, deletion, call recovery, notification controls and real contact', async () => {
  const response = supportPageResponse(); const html = await response.text();
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /<main aria-labelledby="support-title">/);
  for (const value of ['استعادة المشتريات', 'حذف الحساب', 'لا يلغي اشتراك Apple تلقائيًا', 'TestFlight', 'Bluetooth', 'الميكروفون', 'الإشعارات', 'لا نسجّل محتوى المكالمات', 'mailto:mf103871@gmail.com', '/api/legal/privacy/', '/#/terms']) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /<script\b|<iframe\b|<img\b|\bsrc=|@import|url\(/i);
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) assert.ok(href.startsWith('https://maydan-game.mf103871.workers.dev/') || href === 'mailto:mf103871@gmail.com');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.deepEqual([...supportPageResponse('HEAD').headers], [...response.headers]);
});

test('support refuses write methods without touching accounts, storage or game APIs', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await fullWorker.fetch(new Request('https://maydan.test/api/legal/support/', { method }), {});
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD'); assert.equal(await response.text(), '');
  }
});
