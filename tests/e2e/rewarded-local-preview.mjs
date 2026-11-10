import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { startRewardedPreview } from '../../scripts/rewarded-preview/server.mjs';
import { installSession } from '../../scripts/e2e/plus-session.mjs';

const browserType = process.argv.includes('--webkit') ? webkit : chromium;
const port = browserType === webkit ? 4196 : 4197;
const origin = 'http://127.0.0.1:' + port;
const output = process.env.REWARDED_EVIDENCE_DIR;
const app = await startRewardedPreview({ port, apiPort: port + 4610 });
const browser = await browserType.launch();
const watched = 'شاهد إعلان والعب مباراة كاملة';
const details = '/#/game/badeeha?mode=local';
const report = [];
let errors = [];
let mainPage;
const shot = (page, name) => output && page.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled' });
const btn = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const read = (page, text) => page.getByText(text, { exact: true }).first().waitFor();

async function boot(group) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, reducedMotion: 'reduce' });
  if (group) {
    const response = await fetch(origin + '/__rewarded_lab__/actor', { method: 'POST',
      headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ group }) });
    assert.equal(response.status, 200);
    await installSession(context, (await response.json()).token);
  }
  await context.addInitScript(() => {
    localStorage.setItem('maydan:platform:settings', JSON.stringify({ splashSeen: true, soundOn: false, musicOn: false, hapticsOn: false }));
    // Recreate a returning browser whose startup cache is unavailable. The
    // offline assertion is about text play, independent of the 510-image sweep.
    localStorage.setItem('maydan:platform:startup-cache-unavailable', JSON.stringify(Date.now()));
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + details);
  await page.getByRole('heading', { name: 'طريقة اللعب', exact: true }).waitFor();
  return { context, page };
}
async function submitLocal(page) {
  await btn(page, 'إلى إعداد المباراة التجريبية').click();
  await page.getByText('تحدّي اللمّة التجريبي · الحزم الست مختارة').waitFor();
  await page.getByRole('button', { name: /عائلي/ }).first().click();
  await btn(page, '20 سؤالًا').click();
  await page.locator('.m-sticky-action').click();
}
async function scenario(page, value) {
  await page.getByText('مختبر الإعلانات · محلي', { exact: true }).click();
  await page.getByLabel('نتيجة المحاكاة').selectOption(value);
}
try {
  if (output) await mkdir(output, { recursive: true });
  const { context, page } = await boot('B');
  mainPage = page;
  await read(page, 'لك مباراة تجريبية كاملة مجانية.');
  assert.equal(await btn(page, watched).count(), 0);
  await submitLocal(page);
  await page.locator('.m-board-grid').waitFor();
  const total = await page.locator('.m-board-grid .m-tier').count();
  assert.ok(total >= 20);
  for (let i = 0; i < total; i++) {
    await page.locator('.m-board-grid .m-tier:not(.done)').first().click();
    await page.locator('.m-reveal-action').click();
    await page.locator('.m-judge-grid button').first().click();
    if (i + 1 < total) await page.locator('.m-board-grid').waitFor();
  }
  await read(page, 'اكتملت الجولة');
  await shot(page, '03-completed-badeeha');
  report.push(`completed actual Badeeha trial: ${total} scored questions`);
  await btn(page, 'إعادة بنفس الإعدادات').click();
  await read(page, 'تحتاج تذكرة جديدة لمباراة أخرى. ارجع إلى شاشة التحدّي.');
  assert.equal(await page.getByRole('dialog', { name: 'إعلان اختباري' }).count(), 0);
  await btn(page, 'العودة إلى تحدّي اللمّة').click();
  await btn(page, watched).waitFor();
  await shot(page, '01-rewarded-offer');
  if (browserType === chromium) {
    // The server creates an attempt, but its response arrives after the
    // player leaves. There was no presentation and the attempt is reusable.
    let committed, send;
    const attemptCommitted = new Promise(resolve => { committed = resolve; });
    const allowResponse = new Promise(resolve => { send = resolve; });
    await page.route('**/api/rewarded/attempt', async route => {
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      committed();
      await allowResponse;
      await route.fulfill({ response });
    }, { times: 1 });
    const cancelled = page.waitForResponse(response => /\/api\/rewarded\/attempt\/[^/]+\/cancel$/.test(response.url()));
    await btn(page, watched).click();
    await attemptCommitted;
    await page.evaluate(() => { location.hash = '#/settings?section=audio'; });
    await btn(page, watched).waitFor({ state: 'detached' });
    send();
    assert.equal((await cancelled).status(), 200);
    assert.equal(await page.getByRole('dialog', { name: 'إعلان اختباري' }).count(), 0);
    await page.goto(origin + details);
    await btn(page, watched).waitFor();
    report.push('navigating before ad presentation cancels only the unshown attempt');
  }
  await scenario(page, 'empty');
  await btn(page, watched).click();
  await read(page, 'لا يوجد إعلان متاح الآن. يمكنك متابعة اللعب المجاني.');
  await scenario(page, 'skip');
  await btn(page, watched).click();
  await btn(page, 'تخطّي').click();
  await read(page, 'أُغلق الإعلان قبل اكتماله. لا توجد تذكرة جديدة.');
  await scenario(page, 'delay');
  await btn(page, watched).click();
  await btn(page, 'إكمال المشاهدة التجريبية').click();
  await page.getByText(/جارٍ تأكيد التذكرة من الخادم/).waitFor();
  await read(page, 'تذكرتك مؤكدة وجاهزة لمباراة واحدة.');
  assert.equal(await btn(page, watched).count(), 0);
  await shot(page, '02-verified-ticket');
  report.push('no-fill, skip, delayed confirmation and confirmed ticket');

  await page.getByText('مختبر الإعلانات · محلي', { exact: true }).click();
  await page.getByLabel('عرض الإعلانات').uncheck();
  await read(page, 'تذكرتك مؤكدة وجاهزة لمباراة واحدة.');
  if (browserType === chromium) await page.route('**/api/rewarded/local-start', async route => {
    const saved = await route.fetch();
    assert.equal(saved.status(), 200);
    await route.abort();
  }, { times: 1 });
  await submitLocal(page);
  if (browserType === chromium) {
    await page.getByText(/لم نتأكد من بدء المباراة/).waitFor();
    await page.reload();
    await btn(page, 'متابعة').click();
    report.push('lost start response recovered');
  }
  await page.locator('.m-board-grid').waitFor();
  await page.reload();
  await btn(page, 'متابعة').waitFor();
  await context.setOffline(true);
  await btn(page, 'متابعة').click();
  await page.locator('.m-board-grid').waitFor();
  await context.setOffline(false);
  report.push('ads disabled with earned ticket; confirmed local match resumed offline');

  const plus = await boot('plus');
  await read(plus.page, 'بلس مفعّل. المباراة جاهزة.');
  assert.equal(await btn(plus.page, watched).count(), 0);
  await plus.context.close();
  const control = await boot('A');
  await read(control.page, 'لك مباراة تجريبية كاملة مجانية.');
  assert.equal(await btn(control.page, watched).count(), 0);
  await control.context.close();
  const guest = await boot(null);
  await guest.context.setOffline(true);
  await btn(guest.page, 'إلى إعداد اللعبة').click();
  await guest.page.getByRole('heading', { name: 'جهّزوا الميدان' }).waitFor();
  assert.equal(await guest.page.getByText('تحدّي اللمّة التجريبي · الحزم الست مختارة').count(), 0);
  await guest.context.close();
  report.push('Plus no ad, A no ad, guest free setup still opens offline');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browserType.name(), checks: report }, null, 2));
} catch (error) {
  if (mainPage) console.error(mainPage.url(), await mainPage.locator('body').innerText(), errors);
  throw error;
} finally {
  await browser.close();
  await app.close();
}
