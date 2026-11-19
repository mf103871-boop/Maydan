import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const output = path.resolve(process.env.PARTY_STUDIO_EVIDENCE_DIR || '.cache/party-studio-proof');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PlatformContext} from './src/platform/context.js';
import {AccountContext,NULL_ACCOUNT} from './src/shared/account/context.js';
import {ProfileContext} from './src/profiles/ProfileProvider.jsx';
import {Play} from './src/platform/screens/Play.jsx';
import {useRoute} from './src/platform/router.js';
import {BrandFonts} from './src/shared/brand/art.jsx';
import {setUiLocale,untranslatedUiKeys} from './src/shared/i18n/core.js';
import tokens from './src/shared/theme/tokens.css';
import ui from './src/shared/ui/ui.css';
import brand from './src/shared/brand/brand.css';
import platformStyles from './src/platform/platform.css';
import setup from './src/shared/setup/setup.css';
import studio from './src/platform/playful-studio.css';
const locale = new URLSearchParams(location.search).get('locale') || 'ar';
await setUiLocale(locale);
window.missingTranslations = untranslatedUiKeys;
window.toasts = [];
const noop = () => {};
const sound = {play:noop,emit:noop,volume:.5,music:{volume:.3,scene:noop,releaseScene:noop,play:noop}};
const portraits = ['😎','🦋','🌟','🚀'];
const names = locale === 'ar' ? ['محمد','نورة','سارة','يزن'] : ['Mohamad','Noura','Sara','Yazan'];
const defaultRoster = names.map((name, index) => ({id:'demo-'+index, name, emoji:portraits[index]}));
function App() {
  const route = useRoute();
  const [roster,setRoster] = useState(defaultRoster);
  const [settings,setSettings] = useState({soundOn:false,musicOn:false,hapticsOn:false,reducedMotion:true});
  const platform = {roster,setRoster,settings,setSettings,version:'party-studio',sound,haptics:{vibrate:noop},confetti:{fire:noop,burst:noop},toast:message=>window.toasts.push(message)};
  return <AccountContext.Provider value={NULL_ACCOUNT}><PlatformContext.Provider value={platform}>
    <ProfileContext.Provider value={{mine:null,beginSession:async()=>null,completeSession:async()=>null}}>
      <BrandFonts/><style>{tokens+ui+brand+platformStyles+setup+studio}</style>
      <main>{route.name === 'play' ? <Play id={route.params.id} /> : <output data-testid="destination">{route.name}</output>}</main>
    </ProfileContext.Provider>
  </PlatformContext.Provider></AccountContext.Provider>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;

const result = await build({
  stdin: { contents: source, loader: 'jsx', resolveDir: process.cwd() },
  bundle: true,
  write: false,
  format: 'esm',
  jsx: 'automatic',
  loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.mp3': 'dataurl' },
  logLevel: 'silent',
  define: { __MAYDAN_AUDIO_PREVIEW__: 'false', __MAYDAN_ROOMS_URL__: '"same-origin"' },
});
const bundle = result.outputFiles[0].contents;
const bundleSHA256 = hash(bundle);
const sourceFiles = [
  'src/games/beep/Game.jsx', 'src/games/beep/StudioParty.jsx', 'src/games/beep/beep.css', 'src/games/beep/studio-party.css',
  'src/games/mamnoo/Game.jsx', 'src/games/mamnoo/mamnoo.css',
  'src/games/jabeen/Game.jsx', 'src/games/jabeen/jabeen.css', 'src/shared/i18n/en-games.js',
];
const sourceSHA256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(file))])));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/bundle.js"></script></html>';
const server = createServer((request,response) => {
  if (request.url === '/bundle.js') { response.setHeader('content-type','text/javascript'); response.end(bundle); return; }
  response.setHeader('content-type','text/html; charset=utf-8');
  response.end(html);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(output, { recursive: true });
test.after(() => new Promise(resolve => server.close(resolve)));

const byId = id => `[data-design-id="${id}"]`;
const screen = (page, id) => page.locator(`[data-design-screen="${id}"]`);
const switchButton = (page, id, index) => page.locator(byId(id)).locator(byId('segment-option')).nth(index);
const viewport = {width:390,height:844};

async function setupGame(page, game, locale) {
  await page.setViewportSize(viewport);
  await page.goto(`${origin}/?locale=${locale}#/play/${game}?mode=local`);
  const options = screen(page,`setup.${game}`);
  await options.waitFor();
  if (locale === 'en') {
    await page.locator('#local-content-locale').selectOption('en');
    await options.waitFor();
  }
  assert.equal(await page.locator('html').getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr');
}

function watchPage(page) {
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) external.push(request.url());
  });
  return { errors, external };
}

function evidenceRecorder(page, prefix, records) {
  return async (state, target, options = {}) => {
    await target.waitFor();
    await page.evaluate(async keepScroll => {
      if (!keepScroll) scrollTo({top:0,behavior:'instant'});
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },options.keepScroll === true);
    // The resting target excludes the transient press and selection scales.
    await target.evaluate(async node => {
      const scales = node.getAnimations({ subtree: true }).filter(animation =>
        animation.transitionProperty === 'transform' || animation.animationName === 'ui-pop-select');
      await Promise.allSettled(scales.map(animation => animation.finished));
    });
    const geometry = await target.evaluate((node) => ({
      width: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      names: [...node.querySelectorAll('.players-setup-name')].map(name => {
        const range = document.createRange();
        range.selectNodeContents(name);
        return { text:name.textContent,font:parseFloat(getComputedStyle(name).fontSize), lines:new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size };
      }),
      options: [...node.querySelectorAll('[data-design-id="segment-option"]')].map(option => {
        const bounds = option.getBoundingClientRect();
        const walker = document.createTreeWalker(option, NodeFilter.SHOW_TEXT);
        const broken = [];
        const clipped = [];
        const range = document.createRange();
        while (walker.nextNode()) {
          const node = walker.currentNode;
          for (const word of node.textContent.matchAll(/\S+/g)) {
            range.setStart(node, word.index);
            range.setEnd(node, word.index + word[0].length);
            const rects = [...range.getClientRects()];
            if (new Set(rects.map(rect => Math.round(rect.top))).size !== 1) broken.push(word[0]);
            if (rects.some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) clipped.push(word[0]);
          }
        }
        return { text: option.textContent.trim(), font: parseFloat(getComputedStyle(option).fontSize), broken, clipped };
      }),
      targets: [...node.querySelectorAll('button,input:not([type="hidden"]),select')].filter(control => control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden').map(control => {
        const size = control.getBoundingClientRect();
        return { id: control.dataset.designId || control.className, width: size.width, height: size.height };
      }),
    }));
    assert.ok(geometry.pageWidth <= geometry.width + 1, state + ' overflows horizontally');
    assert.ok(geometry.targets.every(control => control.width >= 47.5 && control.height >= 47.5), state + ' targets: ' + JSON.stringify(geometry.targets));
    assert.ok(geometry.names.every(name => name.lines === 1), state + ' short names must remain whole: ' + JSON.stringify(geometry.names));
    assert.ok(geometry.options.every(option => !option.broken.length && !option.clipped.length),
      state + ' option words must remain readable: ' + JSON.stringify(geometry.options));
    if (state.endsWith('text200')) assert.ok(geometry.names.every(name => name.font >= 28), state + ' must visibly double the player names: ' + JSON.stringify(geometry.names));
    if (options.normalLabels) {
      assert.deepEqual(geometry.options.map(({text,font}) => ({text,font})),
        options.normalLabels.map(({text,font}) => ({text,font:font * 2})),
        state + ' must visibly double each option label');
    }
    if (options.measureOnly) return geometry;
    const name = `${prefix}-${state}.png`;
    const png = await page.screenshot({ path: path.join(output,name), fullPage: options.fullPage ?? true, animations: 'disabled' });
    records.push({ state, path:name, sha256:hash(png), ...geometry });
  };
}

async function settleFontsAtWidths(page, state, target, record) {
  for (const [width,height] of [[360,800],[390,844],[430,932]]) {
    await page.setViewportSize({width,height});
    if (width !== 390) await record(state + '-' + width,target);
  }
  const normal = await record(state, target, { measureOnly:true });
  await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.players-setup-name,[data-design-id="segment-option"]')];
    const prior = labels.map(label => parseFloat(getComputedStyle(label).fontSize));
    document.documentElement.style.fontSize = '200%';
    labels.forEach((label,index) => { label.style.fontSize = prior[index] * 2 + 'px'; });
  });
  for (const [width,height] of [[360,800],[390,844],[430,932]]) {
    await page.setViewportSize({width,height});
    await record(state + '-' + width + '-text200', target, { normalLabels:normal.options });
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
    document.querySelectorAll('.players-setup-name,[data-design-id="segment-option"]').forEach(label => label.style.removeProperty('font-size'));
  });
  await page.setViewportSize(viewport);
}

for (const [engineName, engine] of [['chromium',chromium],['webkit',webkit]]) {
  for (const locale of ['ar','en']) {
    test(`${engineName}/${locale}: approved party games through actual local Play entry`, { timeout: 180000 }, async () => {
      const browser = await engine.launch({headless:true});
      const records = [];
      const prefix = `${engineName}-${locale}`;
      const notices = [];
      try {
        const beep = await browser.newPage({ viewport, reducedMotion:'reduce' });
        notices.push(watchPage(beep));
        const beepRecord = evidenceRecorder(beep,prefix,records);
        await setupGame(beep,'beep',locale);
        const beepSetup = screen(beep,'play-setup');
        await beepRecord('beep-three-setup',beepSetup);
        await settleFontsAtWidths(beep,'beep-setup',beepSetup,beepRecord);
        await switchButton(beep,'setting-rounds',0).click();
        await switchButton(beep,'setting-duration',2).click();
        await beepSetup.locator(byId('start')).click();
        const ready = screen(beep,'beep.three.intro');
        const prompt = screen(beep,'beep.three.prompt');
        const judge = screen(beep,'beep.three.judge');
        await beepRecord('beep-three-ready',ready);
        for (let round = 0; round < 3; round++) for (let turn = 0; turn < 4; turn++) {
          await ready.locator(byId('start')).click();
          if (round === 0 && turn === 0) {
            await beepRecord('beep-three-spoken-prompt',prompt);
            assert.equal(await prompt.locator('input,textarea').count(),0);
          }
          await prompt.locator(byId('continue')).click();
          if (round === 0 && turn === 0) {
            await beepRecord('beep-three-judge',judge);
            const promptHeight = await judge.locator(byId('prompt')).evaluate(node=>node.getBoundingClientRect().height);
            assert(promptHeight < viewport.height * .22, 'the short spoken prompt leaves room for the verdict and current scores');
          }
          await judge.locator(byId(turn === 0 || (turn === 1 && round < 2) ? 'correct' : 'wrong')).click();
        }
        const beepFinal = screen(beep,'beep.three.over');
        await beepRecord('beep-three-final',beepFinal);
        assert.equal(await beepFinal.locator('[data-rank="1"] .party-podium-score b').textContent(),'3');
        assert.equal(await beepFinal.locator('.party-result-row').count(),1);
        await beepFinal.locator(byId('options')).click();
        await switchButton(beep,'setting-mode',1).click();
        await beepSetup.locator(byId('start')).click();
        const fuseReady = screen(beep,'beep.bomb.intro');
        const fusePrompt = screen(beep,'beep.bomb.prompt');
        const boom = screen(beep,'beep.bomb.boom');
        const survivor = screen(beep,'beep.bomb.over');
        await beepRecord('beep-bomb-ready',fuseReady);
        await beep.clock.install();
        const targets = locale === 'ar' ? ['نورة','سارة','يزن'] : ['Noura','Sara','Yazan'];
        for (const [index,targetPlayer] of targets.entries()) {
          for (let hit = 0; hit < 3; hit++) {
            await fuseReady.locator(byId('start')).click();
            await fusePrompt.waitFor();
            assert.equal(await fusePrompt.getByRole('timer').count(),0);
            const showPass = index === 0 && hit === 0;
            if (showPass) {
              await beep.clock.fastForward(19000);
              assert.equal(await fusePrompt.isVisible(),true);
            }
            const playerName = fusePrompt.locator('.beep-active-player b');
            for (let pass=0; pass<4 && await playerName.textContent() !== targetPlayer; pass++) {
              await fusePrompt.locator(byId('continue')).click();
            }
            assert.equal(await playerName.textContent(),targetPlayer);
            if (showPass) await beepRecord('beep-bomb-pass',fusePrompt);
            await beep.clock.fastForward(showPass ? 42000 : 61000);
            if (index !== targets.length-1 || hit < 2) {
              await boom.waitFor();
              if (showPass) await beepRecord('beep-bomb-loss',boom);
              await boom.locator(byId('continue')).click();
            }
          }
        }
        await beepRecord('beep-survivor',survivor);
        assert.equal(await survivor.locator('.beep-chip.is-out').count(),3);

        const taboo = await browser.newPage({viewport,reducedMotion:'reduce'});
        notices.push(watchPage(taboo));
        const tabooRecord = evidenceRecorder(taboo,prefix,records);
        await setupGame(taboo,'mamnoo',locale);
        const teamSetup = screen(taboo,'play-setup.teams');
        const teamNames = locale === 'ar' ? ['فريق الشمس','فريق البحر'] : ['Sun team','Sea team'];
        for (const [index,name] of teamNames.entries()) await teamSetup.locator(byId('team-name')).nth(index).fill(name);
        const indexes = await teamSetup.locator('[data-index]').evaluateAll(nodes => nodes.map(node=>node.dataset.index));
        await switchButton(taboo,'setting-rounds',0).click();
        await tabooRecord('mamnoo-setup',teamSetup);
        await settleFontsAtWidths(taboo,'mamnoo-setup',teamSetup,tabooRecord);
        await teamSetup.locator(byId('start')).click();
        const tabooReady = screen(taboo,'mamnoo.intro');
        const tabooLive = screen(taboo,'mamnoo.play');
        const roundEnd = screen(taboo,'mamnoo.roundEnd');
        await tabooRecord('mamnoo-ready',tabooReady);
        await taboo.clock.install();
        for (let turn = 0; turn < 4; turn++) {
          assert.equal(await tabooReady.locator('.mamnoo-team-hero [data-index]').getAttribute('data-index'),indexes[turn % 2]);
          await tabooReady.locator(byId('start')).click();
          assert.equal(await tabooLive.locator('.mamnoo-active-team [data-index]').getAttribute('data-index'),indexes[turn % 2]);
          if (turn === 0) {
            await tabooLive.locator(byId('correct')).click();
            await tabooLive.locator(byId('correct')).click();
            await tabooLive.locator(byId('wrong')).click();
            assert.equal(await tabooLive.locator('.mamnoo-active-team strong').textContent(),'1');
            assert.equal(await tabooLive.locator('.mamnoo-forbidden li').count(),5);
            await tabooLive.locator(byId('skip')).click();
            assert.match(await tabooLive.locator(byId('skip')).textContent(),/\(2\)/);
            await tabooRecord('mamnoo-active-card',tabooLive);
            for (let skip = 0; skip < 2; skip++) await tabooLive.locator(byId('skip')).click();
            assert.equal(await tabooLive.locator(byId('skip')).isDisabled(),true);
          }
          await taboo.clock.fastForward(91000);
          if (turn === 0) {
            await tabooRecord('mamnoo-round-summary',roundEnd);
            assert.equal(await roundEnd.locator('.mamnoo-round-points strong').textContent(),'+1');
          }
          await roundEnd.locator(byId('continue')).click();
        }
        const tabooFinal = screen(taboo,'mamnoo.over');
        await tabooRecord('mamnoo-final',tabooFinal);
        assert.equal(await tabooFinal.locator('[data-rank="1"] [data-index]').getAttribute('data-index'),indexes[0]);

        const heads = await browser.newPage({viewport,reducedMotion:'reduce'});
        notices.push(watchPage(heads));
        const headsRecord = evidenceRecorder(heads,prefix,records);
        await setupGame(heads,'jabeen',locale);
        const headsSetup = screen(heads,'play-setup');
        await screen(heads,'setup.jabeen').locator('.jabeen-cat').first().click();
        assert.equal(await screen(heads,'setup.jabeen').locator('.jabeen-cat img').count(),8);
        await headsRecord('jabeen-setup',headsSetup);
        await headsSetup.locator(byId('start')).scrollIntoViewIfNeeded();
        await headsRecord('jabeen-setup-continued',headsSetup,{keepScroll:true,fullPage:false});
        await settleFontsAtWidths(heads,'jabeen-setup',headsSetup,headsRecord);
        await screen(heads,'setup.jabeen').getByRole('button',{name:locale === 'ar' ? 'اللمس':'Touch',exact:true}).click();
        await headsSetup.locator(byId('start')).click();
        const headsReady = screen(heads,'jabeen.intro');
        const headsPlay = screen(heads,'jabeen.play');
        const headsReview = screen(heads,'jabeen.review');
        await headsRecord('jabeen-portrait-ready',headsReady);
        await headsReady.locator(byId('start')).click();
        assert.equal(await heads.getByRole('timer').count(),0);
        await heads.setViewportSize({width:844,height:390});
        for (let turn = 0; turn < 4; turn++) {
          await headsReady.locator(byId('start')).click();
          await headsPlay.locator(byId('word')).waitFor();
          if (turn === 0) {
            await headsPlay.locator(byId('correct')).click();
            await headsRecord('jabeen-landscape-live',headsPlay,{fullPage:false});
            for (const action of ['correct','skip']) {
              const box = await headsPlay.locator(byId(action)).boundingBox();
              assert.ok(box && box.y >= 52 && box.y + box.height <= 390, 'Landscape touch controls must fit the viewport');
            }
            await heads.setViewportSize(viewport);
            await headsPlay.locator(byId('rotate')).waitFor();
            assert.equal(await headsPlay.locator(byId('word')).count(),0);
            await headsRecord('jabeen-rotation-paused',headsPlay);
            await heads.setViewportSize({width:844,height:390});
            await headsPlay.locator(byId('word')).waitFor();
            await headsPlay.locator('.timer-resume').waitFor({state:'hidden'});
          }
          await headsPlay.locator(byId('correct')).click();
          await headsPlay.locator(byId('skip')).click();
          await headsPlay.locator('.jabeen-stage-top').locator(byId('continue')).click();
          if (turn === 0) {
            await heads.setViewportSize(viewport);
            const reviewOption = headsReview.locator(byId('option')).last();
            assert.equal(await reviewOption.getAttribute('aria-pressed'),'false');
            assert.equal(await headsReview.locator('[data-design-id="option"][aria-pressed="true"]').count(),2);
            await headsRecord('jabeen-review-before-correction',headsReview);
            await reviewOption.click();
            assert.equal(await reviewOption.getAttribute('aria-pressed'),'true');
            await headsRecord('jabeen-edited-results',headsReview);
            await heads.setViewportSize({width:844,height:390});
          }
          const beforeConfirm = await heads.evaluate(()=>window.toasts.length);
          await headsReview.locator(byId('continue')).click();
          const afterConfirm = await heads.evaluate(()=>window.toasts.length);
          assert.equal(afterConfirm - beforeConfirm, turn === 3 ? 0 : 1, 'only handoffs show the temporary points notice');
        }
        await heads.setViewportSize(viewport);
        const headsFinal = screen(heads,'jabeen.over');
        await headsRecord('jabeen-final',headsFinal);
        assert.equal(await headsFinal.locator('[data-rank="1"] .party-podium-step b').textContent(),'3');
        assert.equal(await headsFinal.locator('.party-result-row').count(),1);
        for (const notice of notices) {
          assert.deepEqual(notice.errors,[]);
          assert.deepEqual(notice.external,[]);
        }
        const missing = [...new Set((await Promise.all([beep,taboo,heads].map(page => page.evaluate(()=>window.missingTranslations())))).flat())];
        assert.deepEqual(missing,[]);
        await writeFile(path.join(output,`${prefix}.json`), JSON.stringify({engineName,locale,bundleSHA256,sourceSHA256,records,realLocalPlay:true},null,2));
      } finally { await browser.close(); }
    });
  }
}
