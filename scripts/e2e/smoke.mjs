// Real UI smoke against an already running preview. Does not build or seed data.
// CHROMIUM_PATH=/path/to/chrome node scripts/e2e/smoke.mjs [output-dir]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SAMPLE_BANK } from '../../src/shared/fx/sample-bank.js';
import { MUSIC_BANK } from '../../src/shared/fx/music-bank.js';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maydan-e2e', 'smoke'));
await fs.mkdir(OUT, { recursive: true });
const results = [], errors = [], responses = [];
// Audio: Chromium runs the AudioContext without a gesture so the tap delegate's voices can be counted.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
// Cue voices are short buffers (the longest cue, the fanfare, is 3.2 s); music loops run for tens of seconds.
const CUE_MAX_FRAMES = 48000 * 10;
const CLICK_FRAMES = 12000, TICK_FRAMES = 4320;
// Playwright's Chromium ships without an AAC decoder, so the m4a files fail to decode there. The page
// shim below replaces a failed decode of a known file with a silent buffer of the manifest's length
// (music gets a long one), which is all the counting needs; real browsers decode natively.
// The bus decodes a copy of the fetched bytes, so the file is recognised by its encoded size.
const DECODE_FRAMES = Object.fromEntries([
  ...Object.values(SAMPLE_BANK).map((entry) => [entry.bytes, entry.frames]),
  ...Object.values(MUSIC_BANK).map((entry) => [entry.bytes, entry.frames || 48000 * 20]),
]);
if (Object.keys(DECODE_FRAMES).length !== Object.keys(SAMPLE_BANK).length + Object.keys(MUSIC_BANK).length) throw new Error('two audio files share a byte length; the decode shim needs another key');
const near = (frames, target) => Math.abs(frames - target) <= 2;
const games = ['badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina'];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); }
try {
  for (const profile of [
    { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    { name: 'desktop', viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false },
  ]) {
    const { name, ...options } = profile;
    const context = await browser.newContext({ ...options, locale: 'ar', deviceScaleFactor: 1 });
    // Every AudioBufferSourceNode start is recorded with its buffer length: cues are told apart
    // from music by length, and the click cue by its exact frame count.
    await context.addInitScript(({ max, frames: known }) => {
      window.__cues = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function patchedStart(...args) {
        // Lengths are normalised to the 48 kHz masters: a context at 44.1 kHz decodes shorter buffers.
        const frames = this.buffer ? Math.round(this.buffer.length * 48000 / this.context.sampleRate) : 0;
        if (frames > 0 && frames <= max) window.__cues.push(frames);
        return start.apply(this, args);
      };
      const decode = BaseAudioContext.prototype.decodeAudioData;
      BaseAudioContext.prototype.decodeAudioData = function shimmedDecode(data, onSuccess, onError) {
        const bytes = data.byteLength; // read before the native decoder detaches the buffer
        const result = decode.call(this, data).catch((error) => {
          const length = known[bytes];
          if (!length) throw error;
          return this.createBuffer(2, Math.max(1, Math.round(length * this.sampleRate / 48000)), this.sampleRate);
        });
        if (onSuccess || onError) result.then((buffer) => onSuccess && onSuccess(buffer), (error) => onError && onError(error));
        return result;
      };
    }, { max: CUE_MAX_FRAMES, frames: DECODE_FRAMES });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const cueCount = () => page.evaluate(() => window.__cues.length);
    // tap(): clicks and asserts what the tap delegate produced — at least one cue for a plain
    // activation, exactly one click for a control without its own cue, none when the bus is muted.
    const tap = async (locator, label, { expect = 'some' } = {}) => {
      const before = await cueCount();
      await locator.click();
      if (expect === 'none') {
        await page.waitForTimeout(250);
        check(`${name}: tap ${label} stays silent`, (await cueCount()) === before);
        return;
      }
      const heard = await page.waitForFunction((n) => window.__cues.length > n, before, { timeout: 2500 }).then(() => true, () => false);
      await page.waitForTimeout(120);
      const cues = await page.evaluate((n) => window.__cues.slice(n), before);
      if (expect === 'click') check(`${name}: tap ${label} plays exactly one click`, heard && cues.length === 1 && near(cues[0], CLICK_FRAMES), JSON.stringify(cues));
      else check(`${name}: tap ${label} makes a sound`, heard && cues.length >= 1, JSON.stringify(cues));
    };
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
    await tap(page.getByRole('button', { name: 'تجربة الصوت', exact: true }), 'sound preview');
    await page.reload(); await page.locator('.splash').waitFor({ state: 'detached' });
    check(`${name}: volume survives reload`, await slider.inputValue() === '40');
    await tap(page.getByRole('switch', { name: 'الصوت', exact: true }), 'mute switch', { expect: 'none' });
    check(`${name}: mute disables volume/preview`, await slider.isDisabled() && await page.getByRole('button', { name: 'تجربة الصوت', exact: true }).isDisabled());
    await tap(page.getByRole('button', { name: 'رجوع', exact: true }), 'back while muted', { expect: 'none' });
    await go('settings');
    await tap(page.getByRole('switch', { name: 'الصوت', exact: true }), 'unmute switch');
    await tap(page.getByRole('switch', { name: 'تقليل الحركة', exact: true }), 'reduced motion switch', { expect: 'click' });
    const reduced = await page.evaluate(() => ({ setting: document.documentElement.dataset.reducedMotion, duration: getComputedStyle(document.querySelector('.screen')).animationDuration }));
    check(`${name}: reduced motion applies`, reduced.setting === 'true' && parseFloat(reduced.duration) < 0.001, JSON.stringify(reduced));
    await page.reload(); await page.locator('.splash').waitFor({ state: 'detached' });
    check(`${name}: reduced motion survives reload`, await page.getByRole('switch', { name: 'تقليل الحركة', exact: true }).getAttribute('aria-checked') === 'true');
    await shot('settings'); await overflow('settings');
    await page.getByRole('switch', { name: 'تقليل الحركة', exact: true }).click();

    await go('players');
    for (const player of ['سارة', 'عمر', 'ليان']) {
      await page.getByLabel('اسم اللاعب', { exact: true }).fill(player);
      await tap(page.getByRole('button', { name: 'إضافة', exact: true }), `add ${player}`);
    }
    check(`${name}: three players created through UI`, await page.locator('.score-row').count() === 3);

    for (const game of games) {
      try {
        await go(`game/${game}`);
        await page.locator('.details-hero').waitFor();
        await overflow(`${game} details`);
        const button = page.getByRole('button', { name: ['fabraka', 'meenfina'].includes(game) ? 'العب على جهاز واحد' : 'العب', exact: true });
        await tap(button, `${game} play`);
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
          await tap(page.getByRole('button', { name: /^ابدأ اللعب/ }), `${game} start match`);
          const start = game === 'beep' ? /^جاهز/ : game === 'mamnoo' ? /^ابدأ 60 ثانية/ : game === 'meenfina' ? 'اعرض العبارة' : 'ابدأ الجولة';
          const beforeRound = await cueCount();
          await tap(page.getByRole('button', { name: start, exact: typeof start === 'string' }), `${game} start round`);
          const active = { beep: '.beep-prompt', mamnoo: '.mamnoo-card', jabeen: '.jabeen-stage', fabraka: '.fab-question', meenfina: '.meen-statement' }[game];
          await page.locator(active).first().waitFor();
          if (game === 'beep') {
            // The prompt's first second ticks right away (the timer used to stay silent until the second changed).
            const ticked = await page.waitForFunction(({ n, tick }) => window.__cues.slice(n).some((frames) => Math.abs(frames - tick) <= 2), { n: beforeRound, tick: TICK_FRAMES }, { timeout: 2500 }).then(() => true, () => false);
            check(`${name}: beep prompt ticks from its first second`, ticked);
          }
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
        await tap(page.getByRole('button', { name: 'العودة إلى المنصة', exact: true }), `${game} home button`, { expect: 'click' });
        const exit = page.getByRole('button', { name: 'خروج', exact: true });
        if (await exit.isVisible()) await tap(exit, `${game} confirm exit`);
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
