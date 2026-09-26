// فشل مزوّد خارجي كان يصل العميل 502 بلا تفسير. `detail` يحمل رمز خطأ المزوّد القصير فقط
// (invalid_grant، invalid_client…) وسطر السجل يذكر المضيف والحالة والرمز — لا جسمًا ولا رمزًا
// ولا سرًّا ولا وصفًا.
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerDetail, providerJson } from '../server/accounts/jwt.mjs';
import * as google from '../server/accounts/google.mjs';
import { errorResponse } from '../server/protocol.mjs';
import { RoomError } from '../server/room-model.mjs';

const capture = (t) => {
  const lines = [];
  t.mock.method(console, 'warn', (...args) => { lines.push(args.map(String).join(' ')); });
  return lines;
};

test('providerDetail: رمز المزوّد يمرّ بعد تنقيته، وما عداه يصير http_/network/timeout/malformed', (t) => {
  const lines = capture(t);
  assert.equal(providerDetail('https://oauth2.googleapis.com/token', { status: 400, data: { error: 'invalid_grant', error_description: 'Bad Request SECRET-STUFF' } }), 'invalid_grant');
  assert.equal(providerDetail('https://x.test/', { status: 401, data: { error: 'Invalid_Client' } }), 'invalid_client');
  assert.equal(providerDetail('https://x.test/', { status: 400, data: { error: { code: 'validation_error' } } }), 'validation_error', 'شكل Paddle');
  assert.equal(providerDetail('https://x.test/', { status: 404, data: { errorCode: 4040010 } }), 'code_4040010', 'شكل App Store');
  assert.equal(providerDetail('https://x.test/', { status: 400, data: { error: 'a'.repeat(60) } }), 'http_400', 'رمز طويل لا يمرّ');
  assert.equal(providerDetail('https://x.test/', { status: 400, data: { error: 'bad code <script>' } }), 'http_400', 'محارف غريبة لا تمرّ');
  assert.equal(providerDetail('https://x.test/', { status: 503 }), 'http_503');
  assert.equal(providerDetail('https://x.test/', { status: 200, malformed: true }), 'malformed_200');
  assert.equal(providerDetail('https://x.test/', { network: Object.assign(new Error('x'), { name: 'TimeoutError' }) }), 'timeout');
  assert.equal(providerDetail('https://x.test/', { network: new TypeError('fetch failed') }), 'network');
  assert.equal(providerDetail('not a url', { status: 500 }), 'http_500');
  assert.ok(lines.length >= 11, 'سطر سجل لكل فشل');
  assert.ok(lines.every((l) => l.startsWith('[maydan] provider ')));
  assert.ok(lines.some((l) => l.includes('oauth2.googleapis.com 400 invalid_grant')));
  assert.ok(!lines.some((l) => /SECRET-STUFF|Bad Request|error_description/.test(l)), 'الوصف لا يصل السجل');
});

test('errorResponse: detail يظهر لأخطاء المزوّد فقط ولا يغيّر شكل الأخطاء الأخرى', async () => {
  assert.deepEqual(await errorResponse(new RoomError('PROVIDER', 502, 'invalid_grant')).json(), { error: 'PROVIDER', detail: 'invalid_grant' });
  assert.deepEqual(await errorResponse(new RoomError('STATE', 400)).json(), { error: 'STATE' });
  assert.equal(errorResponse(new RoomError('PROVIDER', 502, 'x')).status, 502);
  assert.deepEqual(await errorResponse(new Error('boom')).json(), { error: 'INTERNAL' });
});

test('google.exchangeCode: رفض جوجل يصل كـ PROVIDER مع رمزها، والسر ووصفها لا يُسجَّلان', async (t) => {
  const lines = capture(t);
  const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'super-secret' };
  let body = '';
  t.mock.method(globalThis, 'fetch', async (_url, init) => { body = String(init.body); return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Malformed auth code.' }), { status: 400, headers: { 'content-type': 'application/json' } }); });
  await assert.rejects(google.exchangeCode(env, { code: 'used', redirectUri: 'https://app.test/cb' }), (error) => error.code === 'PROVIDER' && error.status === 502 && error.detail === 'invalid_grant');
  assert.ok(body.includes('client_secret=super-secret'), 'الطلب نفسه يحمل السر كالمعتاد');
  assert.ok(lines.length === 1 && !/super-secret|Malformed/.test(lines[0]), 'السجل بلا سر ولا وصف');
  t.mock.method(globalThis, 'fetch', async () => new Response('{"access_token":"a"}', { status: 200, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(google.exchangeCode(env, { code: 'c', redirectUri: 'https://app.test/cb' }), (error) => error.detail === 'malformed_200', 'رد بلا id_token');
  t.mock.method(globalThis, 'fetch', async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); });
  await assert.rejects(providerJson('https://slow.test/', {}), (error) => error.code === 'PROVIDER' && error.detail === 'timeout');
});
