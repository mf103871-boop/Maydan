// Real UI smoke against an already running preview. Does not build or seed data.
// CHROMIUM_PATH=/path/to/chrome node scripts/e2e/smoke.mjs [output-dir]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maydan-e2e', 'smoke'));
await fs.mkdir(OUT, { recursive: true });
const results = [], errors = [], responses = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
const games = ['badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina'];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); }
try {
  for (const profile of [
    { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    { name: 'desktop', viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false },
  ]) {
    const { name, ...options } = profile;
    const context = await browser.newContext({ ...options, locale: 'ar', deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', (error) => errors.push({ profile: name, url: page.url(), error: error.message }));
    page.on('console', (message) => { if (message.type() === 'error') errors.push({ profile: name, url: page.url(), error: message.text() }); });
    page.on('response', (response) => { if (response.status() >= 400) responses.push({ profile: name, url: response.url(), status: response.status() }); });
    const shot = (suffix) => page.screenshot({ path: path.join(OUT, `${name}-${suffix}.png`), animations: 'disabled' });
    let navigation = 0;
    const go = async (route) => {
      await page.goto(`${BASE}/?smoke=${++navigation}#/${route}`, { waitUntil: 'load' });
      await page.locator('.splash').waitFor({ state: 'detached' });
      await page.locator('.game-loading').waitFor({ state: 'detached' });
      await page.locator('.screen, .m-root').first().waitFor({ state: 'visible' });
    };
    const overflow = async (label) => {
      const value = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      check(`${name}: ${label} fits viewport`, value.scroll <= value.width + 1, JSON.stringify(value));
    };
    await go('');
    check(`${name}: six games after automatic startup`, await page.locator('.game-card').count() === 6);
    await overflow('home'); await shot('home');

    await go('settings');
    const slider = page.locator('#sound-volume');
    await slider.fill('40');
    await page.getByRole('button', { name: 'تجربة الصوت', exact: true }).click();
    await page.reload(); await page.locator('.splash').waitFor({ state: 'detached' });
    check(`${name}: volume survives reload`, await slider.inputValue() === '40');
    await page.getByRole('switch', { name: 'الصوت', exact: true }).click();
    check(`${name}: mute disables volume/preview`, await slider.isDisabled() && await page.getByRole('button', { name: 'تجربة الصوت', exact: true }).isDisabled());
    await page.getByRole('switch', { name: 'الصوت', exact: true }).click();
    await page.getByRole('switch', { name: 'تقليل الحركة', exact: true }).click();
    const reduced = await page.evaluate(() => ({ setting: document.documentElement.dataset.reducedMotion, duration: getComputedStyle(document.querySelector('.screen')).animationDuration }));
    check(`${name}: reduced motion applies`, reduced.setting === 'true' && parseFloat(reduced.duration) < 0.001, JSON.stringify(reduced));
    await page.reload(); await page.locator('.splash').waitFor({ state: 'detached' });
    check(`${name}: reduced motion survives reload`, await page.getByRole('switch', { name: 'تقليل الحركة', exact: true }).getAttribute('aria-checked') === 'true');
    await shot('settings'); await overflow('settings');
    await page.getByRole('switch', { name: 'تقليل الحركة', exact: true }).click();

    await go('players');
    for (const player of ['سارة', 'عمر', 'ليان']) {
      await page.getByLabel('اسم اللاعب', { exact: true }).fill(player);
      await page.getByRole('button', { name: 'إضافة', exact: true }).click();
    }
    check(`${name}: three players created through UI`, await page.locator('.score-row').count() === 3);

    for (const game of games) {
      try {
        await go(`game/${game}`);
        await page.locator('.details-hero').waitFor();
        await overflow(`${game} details`);
        const button = page.getByRole('button', { name: ['fabraka', 'meenfina'].includes(game) ? 'العب على جهاز واحد' : 'العب', exact: true });
        await button.click();
        await page.waitForURL((url) => url.hash === `#/play/${game}`);
        await page.locator('.game-loading').waitFor({ state: 'detached' });
        if (game === 'badeeha') await page.locator('.m-hero-cta').click();
        else await page.getByRole('button', { name: /^ابدأ اللعب/ }).waitFor();
        check(`${name}: ${game} setup opens`, await page.locator('.game-frame').isVisible());
        await overflow(`${game} setup`);
        if (game === 'badeeha') {
          const free = page.locator('.m-category-pick:not(.is-locked) .m-category-main');
          for (let i = 0; i < 6; i += 1) await free.nth(i).click();
          await page.getByRole('button', { name: /^ابدأ 30 سؤال/ }).click();
          await page.locator('.m-board-grid').waitFor();
          check(`${name}: badeeha board starts from six free categories`, await page.locator('.m-board-grid').isVisible());
          await shot('badeeha-board');
        } else {
          await page.getByRole('button', { name: /^ابدأ اللعب/ }).click();
          const start = game === 'beep' ? /^جاهز/ : game === 'mamnoo' ? /^ابدأ 60 ثانية/ : game === 'meenfina' ? 'اعرض العبارة' : 'ابدأ الجولة';
          await page.getByRole('button', { name: start, exact: typeof start === 'string' }).click();
          const active = { beep: '.beep-prompt', mamnoo: '.mamnoo-card', jabeen: '.jabeen-stage', fabraka: '.fab-question', meenfina: '.meen-statement' }[game];
          await page.locator(active).first().waitFor();
          if (game === 'jabeen' && await page.locator('.jabeen-rotate').isVisible()) {
            const remaining = await page.locator('.jabeen-stage-top .num').textContent();
            await page.waitForTimeout(1200);
            check(`${name}: rotation prompt pauses timer and blocks hidden controls`, await page.locator('.jabeen-stage-top .num').textContent() === remaining && await page.locator('.jabeen-stage').getAttribute('inert') !== null);
            await page.getByRole('button', { name: 'تخطي هذا التنبيه', exact: true }).click();
            await page.waitForFunction((before) => Number(document.querySelector('.jabeen-stage-top .num')?.textContent) < Number(before), remaining);
            check(`${name}: dismissing rotation prompt resumes the round`, !(await page.locator('.jabeen-rotate').count()));
            await page.setViewportSize({ width: 844, height: 390 });
            await page.setViewportSize(profile.viewport);
            await page.locator('.jabeen-rotate').waitFor();
            const paused = await page.locator('.jabeen-stage-top .num').textContent();
            await page.waitForTimeout(1200);
            check(`${name}: rotating mid-round preserves remaining time`, await page.locator('.jabeen-stage-top .num').textContent() === paused);
            await page.getByRole('button', { name: 'تخطي هذا التنبيه', exact: true }).click();
            check(`${name}: rotation resume does not award a fresh timer`, Number(await page.locator('.jabeen-stage-top .num').textContent()) < Number(remaining));
          }
          check(`${name}: ${game} first round starts`, await page.locator(active).first().isVisible());
          if (game === 'jabeen') await shot('jabeen-round');
        }
        await overflow(`${game} first round`);
        // Confirm that exit controls still work above the game/transition.
        await page.getByRole('button', { name: 'العودة إلى المنصة', exact: true }).click();
        const exit = page.getByRole('button', { name: 'خروج', exact: true });
        if (await exit.isVisible()) await exit.click();
        await page.waitForURL((url) => url.hash === '#/');
        check(`${name}: ${game} exit returns home`, await page.locator('.home-screen').isVisible());
      } catch (error) {
        check(`${name}: ${game} journey`, false, error.message);
        await shot(`${game}-failure`).catch(() => {});
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await go('');
    const systemReduced = await page.locator('.screen').evaluate((element) => getComputedStyle(element).animationDuration);
    check(`${name}: OS reduced motion honored even with app switch off`, parseFloat(systemReduced) < 0.001, systemReduced);
    await context.close();
  }
} finally { await browser.close(); }
check('no browser errors', errors.length === 0, JSON.stringify(errors));
check('no HTTP errors', responses.length === 0, JSON.stringify(responses));
await fs.writeFile(path.join(OUT, 'smoke-results.json'), JSON.stringify({ base: BASE, executedAt: new Date().toISOString(), results, errors, responses }, null, 2));
console.log(`${results.filter((item) => item.ok).length}/${results.length} checks passed; report ${path.join(OUT, 'smoke-results.json')}`);
if (results.some((item) => !item.ok)) process.exitCode = 1;
