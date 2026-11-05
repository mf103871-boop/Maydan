import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { startProgressionPreview } from '../../scripts/progression-preview/server.mjs';
import { equipFixture, loadFixture, newFixtureState } from '../../scripts/progression-preview/fixture-data.js';

const output = process.argv[2] && path.resolve(process.argv[2]);
if (output) await mkdir(output, { recursive: true });
const app = await startProgressionPreview({ port: 0 });
const expected = { 'نقاط الخبرة': [3100, 5000, '62%'], 'إتقان بديهة': [6, 10, '60%'], 'إتقان مافيا': [8, 10, '80%'] };
const layout = [[1536, 1024, 'board'], [1280, 900, 'board'], [360, 800, 'phone'], [390, 844, 'phone'], [430, 932, 'phone']];
const metrics = [];
const fixture = newFixtureState();
assert.equal(equipFixture(fixture, 'progression.frame.60'), fixture);
assert.equal(equipFixture(fixture, 'forged.id'), fixture);
assert.deepEqual(loadFixture({ getItem: () => '{"frame":"progression.frame.60","badges":["missing","gatherings","gatherings"]}' }),
  { ...fixture, badges: ['gatherings'] });

async function checkLayout(page, engine) {
  for (const [width, height, view] of layout) {
    await page.setViewportSize({ width, height });
    await page.goto(app.url + '?view=' + view);
    await page.getByRole('heading', { name: 'ليان', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const progress = await page.getByRole('progressbar').evaluateAll(meters => Object.fromEntries(meters.map(meter => [
      meter.getAttribute('aria-label'),
      [Number(meter.getAttribute('aria-valuenow')), Number(meter.getAttribute('aria-valuemax')), meter.firstElementChild.style.width],
    ])));
    assert.deepEqual(progress, expected);
    const bounds = await page.locator('[data-visual-stage]').evaluate(node => {
      const rect = element => { const box = element?.getBoundingClientRect(); return box && [box.x, box.y, box.width, box.height].map(x => Math.round(x)); };
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        stage: rect(node), profile: rect(node.querySelector('.pc-profile')), hero: rect(node.querySelector('.pc-portrait')),
        xp: rect(node.querySelector('.pc-xp')), achievements: rect(node.querySelector('.pc-achievements')),
        reward: rect(node.querySelector('.pc-reward')), mastery: rect(node.querySelector('.pc-mastery')),
        grid: rect(node.querySelector('.pc-catalog-grid')), font: document.fonts.check('800 18px "Maydan Round"', 'ليان') };
    });
    assert.equal(bounds.overflow, 0);
    assert.ok(bounds.font);
    if (view === 'board') {
      const ordering = await page.locator('.pc-catalog-grid > button').evaluateAll(nodes => nodes.map(node => [node.textContent, node.getBoundingClientRect().x]));
      assert.deepEqual(ordering.map(item => item[0].match(/المستوى ([٠-٩]+)/)?.[1]), ['١', '١٠', '٢٠', '٣٠', '٤٠', '٥٠']);
      assert.ok(ordering[0][1] < ordering[1][1] && ordering[1][1] < ordering[2][1]);
    }
    metrics.push({ engine, width, height, view, ...bounds });
    if (output && engine === 'chromium') await page.screenshot({ path: path.join(output, view + '-' + width + 'x' + height + '.png'), animations: 'disabled' });
  }
}

async function checkFunctions(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(app.url + '?view=phone');
  const scope = page.locator('.pc-profile');
  const reward = scope.getByRole('button', { name: 'معاينة إطار النجمة الشرقية', exact: true });
  await reward.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByText('عند الوصول إلى المستوى ٦٠', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'تجهيز الإطار', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.classList.contains('pc-reward'));

  const openCatalog = scope.getByRole('button', { name: /فتح خزانة المقتنيات/ });
  await openCatalog.click();
  await dialog.getByLabel('نوع المقتنيات').selectOption('frame');
  await dialog.getByLabel('حالة الملكية').selectOption('owned');
  await dialog.getByRole('button', { name: 'المستوى ١٠، صديق الميدان، مملوك', exact: true }).click();
  await dialog.getByRole('button', { name: 'تجهيز الإطار', exact: true }).click();
  await dialog.getByText('هذا الإطار مجهّز في المعاينة.', { exact: true }).waitFor();
  assert.match(await scope.locator('.pc-portrait-frame').getAttribute('src'), /frame-10\.webp$/);
  await dialog.getByRole('button', { name: 'رجوع', exact: true }).click();
  assert.equal(await dialog.getByLabel('حالة الملكية').inputValue(), 'owned');
  await dialog.getByRole('button', { name: 'إعادة الإطار السابق', exact: true }).click();
  assert.equal(await scope.locator('.pc-reference-art').count(), 1);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.classList.contains('pc-portrait'));

  await scope.getByRole('button', { name: /اللقب الحالي/ }).click();
  await dialog.getByLabel('اللقب المختار').selectOption('صديق الميدان');
  await dialog.getByRole('button', { name: 'قدّم صاحب الجمعة', exact: true }).click();
  assert.equal(await scope.locator('.pc-achievement strong').first().innerText(), 'صاحب الجمعة');
  await dialog.getByRole('button', { name: 'أخفِ مستكشف الميدان', exact: true }).click();
  assert.equal(await scope.locator('.pc-achievement').count(), 2);
  await dialog.getByRole('button', { name: 'أبرز مستكشف الميدان', exact: true }).click();
  assert.equal(await scope.locator('.pc-achievement').count(), 3);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  await scope.getByRole('button', { name: /مافيا الإتقان/ }).click();
  await dialog.getByText('الإتقان ٨ من ١٠', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.reload();
  await scope.getByRole('button', { name: /اللقب الحالي: صديق الميدان/ }).waitFor();
  await page.getByRole('button', { name: 'إعادة ضبط المرجع', exact: true }).click();
  assert.equal(await scope.locator('.pc-achievement strong').first().innerText(), 'مستكشف الميدان');
  assert.equal(await scope.locator('.pc-level').innerText(), '٥٠');
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ['maydan:progression-preview:v1']);

  const state = page.getByLabel('حالة العرض');
  await state.selectOption('loading');
  await scope.getByText('جارٍ تحميل البروفايل…', { exact: true }).waitFor();
  await state.selectOption('error');
  await scope.getByRole('button', { name: 'حاول مجددًا', exact: true }).click();
  await scope.getByRole('heading', { name: 'ليان', exact: true }).waitFor();
  await state.selectOption('empty');
  assert.equal(await scope.locator('.pc-achievement').count(), 0);
  await state.selectOption('long');
  await scope.getByRole('heading', { name: /ليان عبد الرحمن/ }).waitFor();
  await page.evaluate(() => { document.documentElement.style.fontSize = '22px'; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  await state.selectOption('missing');
  await scope.getByText('تعذّر عرض الرسم', { exact: true }).waitFor();
}

try {
  for (const [engine, launch] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await launch.launch({ headless: true });
    try {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      const page = await context.newPage();
      const external = [];
      const errors = [];
      page.on('request', request => { if (!request.url().startsWith(app.url) && !request.url().startsWith('data:')) external.push(request.url()); });
      page.on('pageerror', error => errors.push(error.message));
      await checkLayout(page, engine);
      await checkFunctions(page);
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
      console.log(engine + ': 5 viewports, progress values, inventory/ownership, focus, customization, storage, and fallback checks passed');
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify(metrics));
} finally { await app.close(); }
