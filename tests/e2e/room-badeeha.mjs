// Badeeha from two phones: the host creates the room with six categories, a team joins,
// both phones show the same question from their own bank, the turn team uses its aids,
// the host reveals and judges (right, steal, undo), then ends the match.
// node --test tests/e2e/room-badeeha.mjs   (CHROMIUM_PATH optional)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { startLocalServer } from '../../server/local.mjs';
import { esbuildOptions, renderHtml, readPkg, mediaVersions } from '../../scripts/lib.mjs';

let web, app, browser, webOrigin, html;
before(async () => {
  web = http.createServer((req, res) => {
    if (new URL(req.url, 'http://localhost').pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
  webOrigin = `http://127.0.0.1:${web.address().port}`;
  app = await startLocalServer({ port: 0, origins: webOrigin, vars: {} });
  process.env.MAYDAN_ROOMS_URL = app.url;
  const pkg = await readPkg();
  const result = await build(esbuildOptions({ minify: false, version: pkg.version, media: await mediaVersions() }));
  html = await renderHtml(result.outputFiles.find((file) => file.path.endsWith('.js')).text, { version: pkg.version });
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  await app?.close();
  if (web?.listening) await new Promise((resolve) => web.close(resolve));
});

async function phone(hash, initialize) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', reducedMotion: 'reduce' });
  if (initialize) await initialize(context);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${webOrigin}/${hash}`);
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('.splash button')].find((b) => !b.disabled && b.textContent.includes('الدخول بالصور المتاحة'));
    if (button) button.click();
    return !document.querySelector('.splash') && document.querySelector('[data-design-screen]');
  }, null, { timeout: 20_000 });
  return { context, page, errors };
}
const answer = (page) => page.locator('.badeeha-answer').textContent();
const shot = (page, name) => process.env.E2E_SHOTS ? page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true }) : null;

test('two phones play Badeeha: turns, aids, reveal, judge, steal, undo and end', { timeout: 120_000 }, async () => {
  const host = await phone('#/online/badeeha');
  const { page: h } = host;
  assert.equal(await h.locator('.badeeha-picker').evaluate(element => getComputedStyle(element).maxHeight), '300px', 'all categories stay inside a bounded scrolling picker');
  assert.equal(await h.locator('.badeeha-picker button').first().evaluate(element => getComputedStyle(element).minHeight), '44px', 'category controls keep a full touch target');
  await h.locator('[data-design-id="name-input"]').fill('المضيف');
  const create = h.getByRole('button', { name: 'أنشئ الغرفة' });
  assert.equal(await create.isDisabled(), true, 'six categories are needed first');
  await h.getByRole('button', { name: '٢٠ سؤالًا' }).click();
  await h.getByRole('button', { name: '٣٠ ثانية' }).click();
  await h.getByRole('button', { name: 'ست فئات عشوائية' }).click();
  assert.equal(await h.locator('.badeeha-picker button[aria-pressed="true"]').count(), 6);
  await create.click();
  const code = (await h.locator('[data-design-id="invite-code"]').textContent({ timeout: 15_000 })).trim();
  assert.match(code, /^\d{6}$/);
  await h.getByText('٢٠ سؤالًا، و٣٠ ثانية لكل سؤال.').waitFor();

  const guest = await phone(`#/room/${code}`);
  const { page: g } = guest;
  await g.locator('[data-design-id="name-input"]').fill('ليان');
  await g.getByRole('button', { name: 'ادخل الغرفة' }).click();
  await g.getByRole('button', { name: 'أنا جاهز' }).click();
  await shot(g, 'badeeha-lobby');
  const start = h.getByRole('button', { name: 'ابدأ اللعب' });
  await h.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'ابدأ اللعب' && !b.disabled), null, { timeout: 10_000 });
  await start.click();

  // The host's team opens; the guest waits with a locked board.
  await h.getByText('دور فريقك').waitFor({ timeout: 10_000 });
  await g.getByText('الدور: المضيف').waitFor();
  await shot(g, 'badeeha-board');
  assert.equal(await g.locator('.m-tier:not(:disabled)').count(), 0, 'not the guest\'s turn');
  assert.equal(await h.locator('.m-tier:not(:disabled)').count(), 20);
  await h.locator('.m-tier:not(:disabled)').first().click();
  await g.locator('[data-design-id="timer"]').waitFor();
  assert.equal(await g.locator('.badeeha-tools').count(), 0, 'aids belong to the turn team');
  await h.getByRole('button', { name: /دبل النقاط/ }).click();
  await g.getByText('✨ دبل النقاط').waitFor();
  await shot(h, 'badeeha-question-host');
  await h.getByRole('button', { name: 'اكشف الإجابة' }).click();
  await g.locator('.badeeha-answer').waitFor();
  assert.equal(await answer(g), await answer(h), 'both phones show the same question');
  for (const page of [h, g]) await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('maydan:badeeha:question-history-v4') || '{}')).length === 1);
  const right = h.locator('.badeeha-judge button').filter({ hasText: '✓ المضيف' });
  const doubled = Number((await right.textContent()).match(/\+([\d٠-٩]+)/)[1].replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  await right.click();
  await g.getByText(`✓ المضيف +`).waitFor();
  assert.ok(doubled >= 400, 'the doubled cell pays twice');

  // The guest's turn from its own phone: open, add time, and the host's team steals.
  await g.getByText('دور فريقك').waitFor();
  assert.equal(await g.locator('.m-tier:not(:disabled)').count(), 19, 'the judged cell is used');
  await g.locator('.m-tier:not(:disabled)').first().click();
  await g.locator('.badeeha-tools').waitFor();
  const seconds = async () => Number((await g.locator('[data-design-id="timer"] bdi').textContent()).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const before = await seconds();
  await g.getByRole('button', { name: /وقت زيادة/ }).click();
  await g.waitForFunction((value) => {
    const text = document.querySelector('[data-design-id="timer"] bdi')?.textContent || '';
    return Number(text.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))) > value + 20;
  }, before);
  assert.equal(await g.getByRole('button', { name: /وقت زيادة/ }).isDisabled(), true, 'once per match');
  await h.getByRole('button', { name: 'اكشف الإجابة' }).click();
  await h.locator('.badeeha-judge button').filter({ hasText: '⚡ سرقة: المضيف' }).click();
  await g.getByText('⚡ سرقة! المضيف').waitFor();
  await h.getByText('دور فريقك').waitFor();
  await g.getByText('الدور: المضيف').waitFor();

  // The host takes the steal back: the cell returns and the guest plays it again.
  await h.getByRole('button', { name: '↶ تراجع عن آخر حكم' }).click();
  await g.getByText('دور فريقك').waitFor();
  await g.waitForFunction(() => document.querySelectorAll('.m-tier:not(:disabled)').length === 19);
  assert.equal(await g.getByText('⚡ سرقة!').count(), 0);

  await h.getByRole('button', { name: 'إنهاء المباراة' }).click();
  await h.getByRole('button', { name: 'إنهاء', exact: true }).click();
  await g.getByText('أنهى المضيف المباراة قبل آخر سؤال.').waitFor();
  await g.locator('[data-design-id="podium"]').waitFor();
  await shot(g, 'badeeha-over');
  await h.getByRole('button', { name: 'العودة للانتظار وإعادة نفس الأسئلة' }).click();
  await g.getByRole('button', { name: 'أنا جاهز' }).waitFor();
  assert.deepEqual([...host.errors, ...guest.errors], []);
  await host.context.close(); await guest.context.close();
});

test('a saved Plus selection cannot host locked packs after the player returns as a guest', { timeout: 45_000 }, async () => {
  const host = await phone('#/online/badeeha', (context) => context.addInitScript(([server, categories]) => {
    localStorage.setItem(`maydan:online:${server}:badeehaSettings`, JSON.stringify({ mode: 'standard', roundSize: 20, timer: 60, categories }));
  }, [app.url, ['general', 'geo', 'capitals', 'science', 'animals', 'flags']]));
  const { page } = host;
  let creates = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && request.url() === `${app.url}/api/rooms`) creates++; });
  await page.locator('[data-design-id="name-input"]').fill('ضيف');
  assert.equal(await page.locator('.badeeha-picker button.is-locked[aria-pressed="true"]').count(), 1);
  await page.getByRole('button', { name: 'أنشئ الغرفة' }).click();
  await page.locator('.paywall').waitFor();
  assert.equal(creates, 0, 'current pack access is checked before creating the room');
  await page.keyboard.press('Escape');
  await page.locator('.paywall').waitFor({ state: 'hidden' });
  await page.locator('.badeeha-picker button.is-locked[aria-pressed="true"]').click();
  assert.equal(await page.locator('.badeeha-picker button.is-locked[aria-pressed="true"]').count(), 0, 'a now-locked saved choice can still be removed');
  assert.deepEqual(host.errors, []);
  await host.context.close();
});
