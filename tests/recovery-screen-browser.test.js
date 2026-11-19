import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const source = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BottomNavigation} from './src/platform/BottomNavigation.jsx';
import {GameFrame} from './src/platform/GameFrame.jsx';
import {PlatformContext} from './src/platform/context.js';
import {navigate,useRoute} from './src/platform/router.js';
import {BrandFonts} from './src/shared/brand/art.jsx';
import {setUiLocale,tr} from './src/shared/i18n/core.js';
import {ACCOUNT_PREFIX} from './src/shared/account/store.js';
import {environmentStorageKey} from './src/shared/lib/environment.js';
import {clearAllPlatformData} from './src/shared/lib/storage.js';
import {ErrorBoundary} from './src/shared/ui/components.jsx';
import tokens from './src/shared/theme/tokens.css';
import styles from './src/shared/ui/ui.css';
import platform from './src/platform/platform.css';

const params=new URLSearchParams(location.search);
const locale=params.get('locale')||'ar';
await setUiLocale(locale);
const mode=params.get('scope');
const keyFor=key=>mode==='screen'?environmentStorageKey(key):key;
const active=keyFor('maydan:badeeha:active-game-v2'), history=keyFor('maydan:badeeha:results-v2');
const account=ACCOUNT_PREFIX+'fixture', other=keyFor('maydan:beep:fixture');
const keys=[active,history,account,other,'maydan:platform:other-environment-fixture'];
for(const key of keys) localStorage.setItem(key,'true');
window.fixtureStorage=()=>keys.map(key=>localStorage.getItem(key));
const game={id:'badeeha',name:'بديهة',accent:'#e7ac4b',activeKeys:[active]};
function Broken(){throw Error('RenderError');}
function Game(){
  if (params.has('persistent')||localStorage.getItem(active)) throw Error('RenderError');
  return <output data-testid="game-recovered">Badeeha</output>;
}
function Case(){
  const [recovered,setRecovered]=useState(false);
  const route=useRoute();
  if (mode==='game') return <GameFrame game={game} inGame={false}><Game/></GameFrame>;
  if (mode==='social') return <>
    <a href="#/friends" data-testid="open-friends">Friends</a>
    <ErrorBoundary scope="social" resetKey={route.name==='friends'?route.path:null} title={tr("تعذّر فتح اللّمة")} message={tr("أعد فتح ميدان لتتصل بأصحابك.")} onHome={()=>navigate('/')}>
      <Broken/>
    </ErrorBoundary>
  </>;
  return <>
    <ErrorBoundary resetKey={recovered} clearLabel={tr("مسح كل البيانات وإعادة التشغيل")} onHome={()=>setRecovered(true)} onClear={()=>{clearAllPlatformData({keep:[ACCOUNT_PREFIX]});setRecovered(true);}}>
      {recovered?<output data-testid="home-recovered">Maydan</output>:<Broken/>}
    </ErrorBoundary>
    <BottomNavigation route={{name:'home',params:{}}}/>
  </>;
}
const settings={uiLocale:locale,soundOn:false,reducedMotion:true};
createRoot(document.getElementById('root'),{onCaughtError(){}}).render(<PlatformContext.Provider value={{settings,sound:{play(){},emit(){}},haptics:{vibrate(){}}}}><BrandFonts/><style>{tokens+styles+platform}</style><Case/></PlatformContext.Provider>);
`;
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/bundle.js"></script></html>';
const output = process.env.RECOVERY_EVIDENCE_DIR;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let app, origin, bundle;
before(async () => {
  bundle = (await build({
    stdin: { contents: source, loader: 'jsx', resolveDir: process.cwd() },
    bundle: true, format: 'esm', write: false, jsx: 'automatic', logLevel: 'silent',
    loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' },
    define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin') },
  })).outputFiles[0].contents;
  app = createServer((request, response) => {
    const script = request.url === '/bundle.js';
    response.writeHead(200, { 'content-type': script ? 'text/javascript' : 'text/html;charset=utf-8' });
    response.end(script ? bundle : html);
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + app.address().port;
  if (output) await mkdir(output, { recursive: true });
});
after(() => { app?.close(); app?.closeAllConnections(); });

for (const [engine, type] of Object.entries({ chromium, webkit })) for (const locale of ['ar', 'en']) {
  test(`${engine}/${locale}: recovery actions, game data boundaries, and a persistent Hangout failure`, { timeout: 90000 }, async () => {
    const browser = await type.launch();
    const evidence = [];
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    try {
      const recovery = page.locator('[data-design-screen="app.error"]');
      const home = recovery.locator('[data-design-id="home"]');
      const clear = recovery.locator('[data-design-id="clear-data"]');
      const visit = (scope, extra = '') => page.goto(`${origin}/?scope=${scope}&locale=${locale}${extra}${scope === 'social' ? '#/friends' : ''}`);
      for (const scope of ['screen','game','social']) {
        await visit(scope);
        await recovery.waitFor();
        assert.equal(await recovery.getAttribute('data-recovery-scope'), scope);
        assert.equal(await page.locator('html').getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr');
        assert.equal(await recovery.locator('img').evaluate(async element => { await element.decode(); return element.naturalWidth; }), 480);
        assert.deepEqual(await recovery.locator('[data-design-id="detail"]').textContent(), 'RenderError');
        assert.equal(await recovery.getByRole('button').count(), scope === 'social' ? 1 : 2);
        for (const [width, height, large] of [[360, 800, false], [390, 844, false], [430, 932, false], [360, 500, true], [844, 390, true]]) {
          await page.setViewportSize({ width, height });
          await recovery.evaluate((node, largeText) => {
            document.documentElement.style.fontSize = largeText ? '200%' : '';
            window.scrollTo(0, 0);
            node.closest('.recovery-dialog')?.scrollTo(0, 0);
          }, large);
          const geometry = await recovery.evaluate(node => ({
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            buttons: [...node.querySelectorAll('button')].map(button => [button.getBoundingClientRect().width, button.getBoundingClientRect().height]),
          }));
          assert.equal(geometry.overflow, false);
          assert.ok(geometry.buttons.every(([width,height]) => width >= 48 && height >= 48));
          if (output && (width === 390 || large)) {
            const filename = `${engine}-${locale}-error-${scope}-${width}x${height}.png`;
            const bytes = await page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
            evidence.push({ scope, width, height, filename, sha256: hash(bytes) });
          }
          for (const action of scope === 'social' ? [home] : [home, clear]) {
            // The dialog viewport follows visualViewport on resize. Let Playwright
            // wait for its final hit target before checking the action.
            await action.click({ trial: true });
          }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      }
      // Returning home must close a persistent social error and release focus.
      await home.click();
      await recovery.waitFor({ state: 'detached' });
      assert.equal(new URL(page.url()).hash, '#/');
      assert.equal(await page.getByTestId('open-friends').evaluate(link => link.closest('[inert]') === null), true);
      await page.getByTestId('open-friends').click();
      await recovery.waitFor();
      await page.keyboard.press('Tab');
      assert.equal(await home.evaluate(node => node === document.activeElement), true);

      await visit('game');
      await clear.click();
      await page.getByTestId('game-recovered').waitFor();
      const read = () => page.evaluate(() => window.fixtureStorage());
      assert.deepEqual(await read(), [null, 'true', 'true', 'true', 'true']);

      await visit('game', '&persistent=1');
      await clear.click();
      await recovery.getByRole('button', { name: locale === 'ar' ? 'مسح كل بيانات هذه اللعبة' : 'Clear all data for this game' }).waitFor();
      await clear.click();
      assert.deepEqual(await read(), [null, null, 'true', 'true', 'true']);

      await visit('screen');
      await clear.click();
      await page.getByTestId('home-recovered').waitFor();
      assert.deepEqual(await read(), [null, null, 'true', null, 'true']);
      assert.deepEqual(errors, []);
      if (output) await writeFile(path.join(output, `${engine}-${locale}.json`), JSON.stringify({
        engine, locale, fixtureBundleSha256: hash(bundle), evidence,
        verified: ['layout','home navigation','social persistent fault and focus release','current match reset','game-only clear','general clear retaining synthetic account'],
      }, null, 2));
    } finally { await browser.close(); }
  });
}
