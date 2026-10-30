// Real Home, instructions, roster and local Play components. Online is a route
// boundary fixture here; directory/server behavior is tested separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { GAME_MODE_SUPPORT } from '../src/shared/game-mode-support.mjs';
import { initialState, normalizeOptions, restoreSession, sessionSnapshot } from '../src/games/beep/logic.js';
import badeehaLogic, { BANK_CONTENT_VERSION } from '../src/games/badeeha/logic.js';
import { CATS } from '../src/data/categories/index.js';
import { BADEEHA_KEYS } from '../src/games/badeeha/keys.js';

const roster = [{ id: 'family-a', name: 'نور', emoji: '🦊' }, { id: 'family-b', name: 'سامر', emoji: '🐼' }];
const settings = normalizeOptions({ mode: 'three', seconds: 10, rounds: 3 });
const saved = sessionSnapshot({ players: roster, settings, seed: 42, cursor: [0, 0, 0], state: initialState(roster, settings), timeLeft: null });
assert.ok(restoreSession(saved));
const categoryIds = CATS.slice(0, 6).map(category => category.id);
const savedBadeeha = {
  version: 2, contentVersion: BANK_CONTENT_VERSION,
  teams: ['فريق الرمان', 'فريق الزيتون'].map((name, index) => ({ id: `team-${index + 1}`, name, score: index ? 1000 : 2000, correct: 2, steals: 0, tools: { double: true, two: true, time: true } })),
  selectedCategories: categoryIds, mode: 'expert', roundSize: 20, timerLength: 90,
  deck: badeehaLogic.deckToIds(badeehaLogic.buildDeck(CATS, categoryIds, {}, badeehaLogic.MODES.expert.tiers, 20)),
  screen: 'board', used: {}, turn: 1,
};
assert.ok(badeehaLogic.isValidSession(CATS, savedBadeeha));

async function waitForProfileGeometry(page, timeout = 5000) {
  await page.waitForFunction(() => {
    const profile = document.querySelector('.home-profile');
    if (!profile) return false;
    // Visibility does not wait for the header's scale(.98) entrance frame.
    // Even a reduced-motion animation needs a rendering tick to settle.
    for (let node = profile; node; node = node.parentElement) {
      if (node.getAnimations().some(animation =>
        !['finished', 'idle'].includes(animation.playState) &&
        animation.effect?.getTiming().iterations !== Infinity)) return false;
    }
    return parseFloat(getComputedStyle(profile).width) >= 72 && profile.offsetWidth >= 72 && profile.getBoundingClientRect().width >= 72;
  }, undefined, { timeout });
}

test('Chromium/WebKit: profile geometry waits for real ancestor animation and still rejects undersized layout', { timeout: 30000 }, async () => {
  const css = (await Promise.all(['src/shared/theme/tokens.css', 'src/shared/ui/ui.css', 'src/platform/platform.css', 'src/platform/screens/home-rebuild.css'].map(file => readFile(file, 'utf8')))).join('\n');
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      await page.setContent(`<style>${css}</style><section class="screen home-screen"><header class="home-head"><button class="home-profile" aria-label="بروفايلي">🙂</button></header></section><script>
        const header = document.querySelector('.home-head'); getComputedStyle(header).transform;
        const entrance = header.getAnimations().find(animation => animation.animationName === 'ui-lift-in');
        entrance.pause(); entrance.currentTime = 0; window.finishEntrance = () => entrance.finish();
      </script>`);
      assert.equal(await page.locator('.home-profile').evaluate(node => node.offsetWidth), 72);
      assert.ok((await page.locator('.home-profile').boundingBox()).width < 72, 'the existing entrance scales its 72px layout before settling');
      let settled = false;
      const waiting = waitForProfileGeometry(page).then(() => { settled = true; });
      await page.waitForTimeout(40);
      assert.equal(settled, false, 'a visible but still transformed profile is not ready');
      await page.evaluate(() => window.finishEntrance()); await waiting;
      assert.ok((await page.locator('.home-profile').boundingBox()).width >= 72);
      await page.locator('.home-profile').evaluate(node => { node.style.width = '71px'; node.style.flexBasis = '71px'; });
      await assert.rejects(waitForProfileGeometry(page, 150), /Timeout/, 'waiting must not hide a persistent layout defect');
    } finally { await browser.close(); }
  }
});

test('Chromium/WebKit: compact Home, every mode, family setup/resume, reload and roster access', { timeout: 90000 }, async () => {
  const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{PlatformContext}from'./src/platform/context.js';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{ProfileContext}from'./src/profiles/ProfileProvider.jsx';
    import{Home}from'./src/platform/screens/Home.jsx';import{GameDetails}from'./src/platform/screens/GameDetails.jsx';import{Play}from'./src/platform/screens/Play.jsx';import{Settings}from'./src/platform/screens/Settings.jsx';import{Players}from'./src/platform/screens/Players.jsx';
    import{useRoute,navigate}from'./src/platform/router.js';import{BrandFonts}from'./src/shared/brand/art.jsx';
    import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import brand from'./src/shared/brand/brand.css';import platformCSS from'./src/platform/platform.css';import setupCSS from'./src/shared/setup/setup.css';
    const noop=()=>{},sound={play:noop,emit:noop,volume:.5,music:{volume:.3,scene:noop,releaseScene:noop,play:noop}},account={...NULL_ACCOUNT,signedIn:false};window.go=navigate;
    function App(){const route=useRoute(),[roster,setRoster]=useState(${JSON.stringify(roster)}),[settings,setSettings]=useState({soundOn:false,musicOn:false,hapticsOn:false,reducedMotion:true});const platform={roster,setRoster,settings,setSettings,version:'local-ui',sound,haptics:{vibrate:noop},confetti:{fire:noop,burst:noop},toast:noop};
      return <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><ProfileContext.Provider value={{mine:null,beginSession:async()=>null,completeSession:async()=>null}}><BrandFonts/><style>{tokens+ui+brand+platformCSS+setupCSS}</style><main>{route.name==='home'?<Home/>:route.name==='game'?<GameDetails id={route.params.id} mode={route.params.mode}/>:route.name==='play'?<Play id={route.params.id}/>:route.name==='settings'?<Settings/>:route.name==='players'?<Players/>:<output data-testid="destination">{route.name+':'+(route.params.id||'')}</output>}</main></ProfileContext.Provider></PlatformContext.Provider></AccountContext.Provider>;}
    createRoot(document.getElementById('root')).render(<App/>);`;
  const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.mp3': 'dataurl' }, logLevel: 'silent', define: { __MAYDAN_AUDIO_PREVIEW__: 'false' } });
  const header = await readFile(path.resolve('public/art/home/home-header-v1.webp'));
  const html = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
  const server = createServer((request, response) => {
    const image = request.url === '/art/home/home-header-v1.webp';
    response.setHeader('content-type', image ? 'image/webp' : request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    response.end(image ? header : request.url === '/bundle.js' ? built.outputFiles[0].contents : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, proof = path.resolve('.cache/local-ui-home-proof');
  await mkdir(proof, { recursive: true });
  try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: true });
      const errors = [], external = [];
      let page;
      try {
        page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
          if (route.request().url().startsWith(origin) || route.request().url().startsWith('data:')) return route.continue();
          external.push(route.request().url()); return route.abort();
        });
        await page.addInitScript(({ saved, settings, savedBadeeha, badeehaKey }) => {
          if (!localStorage.getItem('home-flow-seeded')) {
            localStorage.setItem('maydan:beep:session-v1', JSON.stringify(saved));
            localStorage.setItem('maydan:beep:options', JSON.stringify(settings));
            localStorage.setItem(badeehaKey, JSON.stringify(savedBadeeha));
            localStorage.setItem('home-flow-seeded', '1');
          }
        }, { saved, settings, savedBadeeha, badeehaKey: BADEEHA_KEYS.active });
        await page.goto(origin);
        await page.getByRole('heading', { name: 'اختار لعبتك' }).waitFor();
        assert.equal(await page.locator('.home-game-row').count(), 8);
        assert.equal(await page.locator('.home-presence,.home-tools').count(), 0);
        assert.equal(await page.locator('[data-design-id="privacy-link"]').count(), 1);
        for (const [width, height] of [[360, 640], [390, 844], [430, 932], [844, 390], [1024, 768]]) {
          await page.setViewportSize({ width, height });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}:${width} overflow`);
          const row = await page.locator('.home-game-row').first().boundingBox(), list = await page.locator('.home-game-list').boundingBox();
          assert.ok(Math.abs(row.width - list.width) < 2 && row.height < 150, `${name}:${width} horizontal row`);
          await waitForProfileGeometry(page);
          assert.ok((await page.getByRole('button', { name: 'بروفايلي', exact: true }).boundingBox()).width >= 72);
          await page.screenshot({ path: path.join(proof, `${name}-home-${width}.png`), fullPage: true });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        for (const [id, support] of Object.entries(GAME_MODE_SUPPORT)) {
          await page.locator('[data-design-id="game-card.' + id + '"]').click();
          const dialog = page.getByRole('dialog'); await dialog.waitFor();
          assert.equal(await dialog.locator('[data-design-id="online-mode"]').isEnabled(), support.online);
          assert.equal(await dialog.locator('[data-design-id="local-mode"]').isEnabled(), support.local);
          await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
        }
        await page.locator('[data-design-id="game-card.mafia"]').click();
        await page.getByRole('dialog').locator('[data-design-id="online-mode"]').click();
        await page.locator('[data-testid="destination"]').waitFor();
        assert.ok(page.url().endsWith('#/online/mafia?mode=online'));
        await page.goBack(); await page.locator('.home-game-row').first().waitFor();
        await page.locator('[data-design-id="game-card.beep"]').click();
        await page.getByRole('dialog').locator('[data-design-id="local-mode"]').click();
        await page.getByRole('button', { name: 'تخطي التعليمات', exact: true }).waitFor();
        assert.ok(page.url().endsWith('#/game/beep?mode=local'));
        assert.equal(await page.locator('[data-design-id="online"],[data-design-id="local"]').count(), 0);
        const untouched = await page.evaluate(() => localStorage.getItem('maydan:beep:session-v1'));
        await page.reload(); await page.getByRole('button', { name: 'تخطي التعليمات', exact: true }).click();
        await page.getByRole('heading', { name: /من يلعب/ }).waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'استئناف اللعبة المحفوظة', exact: true }).waitFor();
        assert.ok(page.url().endsWith('#/play/beep?mode=local'));
        assert.equal(await page.evaluate(() => localStorage.getItem('maydan:beep:session-v1')), untouched);
        assert.ok(await page.getByRole('button', { name: /نور/ }).count());
        await page.screenshot({ path: path.join(proof, `${name}-family-setup.png`), fullPage: true });
        await page.goBack(); await page.getByRole('button', { name: 'تخطي التعليمات', exact: true }).waitFor();
        assert.ok(page.url().endsWith('#/game/beep?mode=local'));
        await page.getByRole('button', { name: 'تخطي التعليمات', exact: true }).click();
        await page.getByRole('button', { name: 'استئناف اللعبة المحفوظة', exact: true }).click();
        await page.locator('[data-design-screen="beep.three.intro"]').waitFor();
        await page.goto(origin + '/#/settings');
        const exit = page.getByRole('dialog', { name: 'الخروج من اللعبة؟', exact: true });
        await exit.waitFor(); await exit.getByRole('button', { name: 'خروج', exact: true }).click();
        await page.getByRole('button', { name: 'دفتر اللاعبين · اللعب مع العائلة', exact: true }).click();
        await page.getByRole('heading', { name: /دفتر اللاعبين/ }).waitFor();
        assert.ok(await page.getByText('نور', { exact: true }).count());
        await page.evaluate(() => window.go('/'));
        await page.locator('[data-design-id="game-card.badeeha"]').click();
        await page.getByRole('dialog').locator('[data-design-id="local-mode"]').click();
        await page.getByRole('button', { name: 'تخطي التعليمات', exact: true }).click();
        const family = page.locator('[data-design-screen="badeeha.setup"]'); await family.waitFor();
        assert.equal(await page.locator('[data-design-screen="badeeha.home"]').count(), 0, 'no second legacy hero');
        assert.equal(await page.evaluate(key => localStorage.getItem(key), BADEEHA_KEYS.active), JSON.stringify(savedBadeeha));
        await family.locator('[data-design-id="history"]').click();
        await page.locator('[data-design-screen="badeeha.history"]').waitFor();
        await page.locator('[data-design-screen="badeeha.history"] [data-design-id="back"]').click();
        await family.waitFor(); await family.locator('[data-design-id="back"]').click();
        await page.getByRole('button', { name: 'تخطي التعليمات', exact: true }).click();
        await family.locator('[data-design-id="resume"]').click();
        await page.locator('[data-design-screen="badeeha.board"]').waitFor();
        assert.ok(await page.getByText('فريق الرمان', { exact: true }).count());
        assert.ok(await page.getByText('فريق الزيتون', { exact: true }).count());
        assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).teams.map(team => [team.name, team.score]), BADEEHA_KEYS.active), savedBadeeha.teams.map(team => [team.name, team.score]));
        await page.screenshot({ path: path.join(proof, `${name}-badeeha-resume.png`), fullPage: true });
        assert.deepEqual(errors, [], `${name}: browser exceptions`);
        assert.deepEqual(external, [], `${name}: test must stay local`);
      } catch (error) {
        await page?.screenshot({ path: path.join(proof, `${name}-failure.png`), fullPage: true });
        const visible = await page?.locator('body').innerText();
        throw new Error(`${name}: ${error.message}; page errors: ${errors.join('; ')}; URL: ${page?.url()}; visible: ${visible?.slice(0, 1800)}`);
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
