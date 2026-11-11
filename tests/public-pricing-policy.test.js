import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../public/pricing/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/pricing/policy.js', import.meta.url), 'utf8');
const baseline = Object.fromEntries([...html.matchAll(/data-gameplay-copy="([a-z]+)"[^>]*>([^<]*)</g)].map(match => [match[1], match[2]]));
const flush = () => new Promise(resolve => setImmediate(resolve));

async function render({ config, status = 200, failure = false } = {}) {
  const nodes = Object.fromEntries(Object.entries(baseline).map(([key, textContent]) => [key, { textContent }]));
  const requests = [];
  let cleared = false;
  vm.runInNewContext(script, {
    document: { querySelector(selector) { return nodes[/data-gameplay-copy="([a-z]+)"/.exec(selector)?.[1]]; } },
    AbortController,
    setTimeout(callback, timeout) { assert.equal(timeout, 5000); return 'timer'; },
    clearTimeout(timer) { assert.equal(timer, 'timer'); cleared = true; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (failure) throw new Error('offline');
      return { ok: status === 200, json: async () => config };
    },
  });
  await flush(); await flush();
  assert.equal(cleared, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/billing/config');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.method, undefined, 'public copy performs only a GET');
  return Object.fromEntries(Object.entries(nodes).map(([key, node]) => [key, node.textContent]));
}

test('pricing v2 covers all packs and one full match; entry and waiting rooms never consume it', async () => {
  const copy = await render({ config: { gameplay: { access: 'trial-ticket', policy: 'game-entry-ticket-v2' } } });
  assert.match(copy.lead, /أول مباراة كاملة لكل حساب في كل لعبة مجانية/);
  assert.match(copy.matches, /جميع جولات المباراة التالية وجميع حزم بديهة/);
  assert.match(copy.rooms, /قبل اختيار النمط.*انضمام الضيوف.*مجاني/);
  assert.match(copy.details, /عند بدء المباراة الفعلي فقط/);
  assert.match(copy.details, /غير المكتمل لا يمنح تذكرة/);
  assert.match(copy.plus, /طوال استحقاق بلس/);
  assert.doesNotMatch(Object.values(copy).join(' '), /عشر حزم|كل.*المباريات مجانية في هذه النسخة/);
});

test('pricing retains v1 compatibility without asserting the v2 entry gate', async () => {
  const copy = await render({ config: { gameplay: { access: 'trial-ticket', policy: 'trial-ticket-v1' } } });
  assert.match(copy.matches, /عشر حزم بديهة الأساسية مجانية دائمًا/);
  assert.doesNotMatch(copy.rooms, /قبل اختيار النمط/);
});

test('pricing declares free play only after an explicit current free server response', async () => {
  const copy = await render({ config: { gameplay: { access: 'free', policy: null } } });
  assert.match(copy.lead, /كل ألعاب ميدان وحزمها وغرفها مجانية في هذه النسخة/);
  assert.match(copy.rooms, /إنشاء الغرف وإعادة اللعب والانضمام مجانية/);
  assert.match(copy.plus, /بلس للمظهر والتخصيص/);
});

test('offline, malformed, contradictory and unknown policies retain neutral copy instead of promising free matches', async () => {
  for (const input of [
    { failure: true }, { status: 404 }, { config: {} },
    { config: { gameplay: { access: 'free', policy: 'game-entry-ticket-v2' } } },
    { config: { gameplay: { access: 'trial-ticket', policy: 'future-policy' } } },
  ]) {
    const copy = await render(input);
    assert.equal(copy.lead, baseline.lead);
    assert.equal(copy.matches, baseline.matches);
    assert.match(copy.status, /تعذّر التحقق/);
    assert.doesNotMatch(Object.values(copy).join(' '), /كل ألعاب ميدان وحزمها وغرفها مجانية|عشر حزم|تم التحقق/);
  }
});

test('pricing keeps existing web price, products and a neutral no-script presentation', () => {
  assert.match(html, /<span class="price-number">5<\/span>/);
  assert.match(html, /سعر.*اشتراك الويب/);
  assert.match(html, /شراء اشتراك الويب الحقيقي غير متاح حاليًا/);
  assert.match(html, /<script src="\.\/policy\.js" defer><\/script>/);
  assert.doesNotMatch(html, /كل ألعاب ميدان وحزمها وغرفها مجانية|ثيمات غرف يختارها|حفظ عشر جلسات/);
  const unknown = Object.values(baseline).join(' ');
  assert.match(unknown, /تعتمد على سياسة هذه النسخة/);
  assert.doesNotMatch(unknown, /كل فئات.*مجانًا|المباريات مجانية/);
});
