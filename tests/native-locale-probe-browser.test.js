// Exercise the simulator probe against the real packaged React app. Native
// acknowledgments are mocked here; the Release simulator gate verifies Swift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { ROOT, DIST, esbuildOptions, renderHtml } from '../scripts/lib.mjs';

let compiled;
const packagedApp = () => compiled ||= (async () => {
  const result = await build(esbuildOptions({ minify: true, assets: 'files', version: 'native-locale-probe', roomsUrl: 'same-origin' }));
  const assets = new Map(result.outputFiles.filter(file => !file.path.endsWith('.js'))
    .map(file => ['/' + path.relative(DIST, file.path).replaceAll('\\', '/'), file.contents]));
  return { assets, html: await renderHtml(result.outputFiles.find(file => file.path.endsWith('.js')).text,
    { version: 'native-locale-probe', assets: [...assets.keys()].map(url => '.' + url) }) };
})();
const mime = { '.json':'application/json', '.css':'text/css', '.webp':'image/webp', '.png':'image/png',
  '.woff2':'font/woff2', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json', '.m4a':'audio/mp4' };

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: finite native locale probe changes actual Settings and survives four document launches`, { timeout: 120000 }, async t => {
  const app = await packagedApp(), browser = await engine.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-JO' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://maydan-native.test') return route.abort();
    if (url.pathname === '/' || url.pathname === '/index.html') return route.fulfill({ contentType:'text/html;charset=utf-8', body: app.html });
    if (app.assets.has(url.pathname)) return route.fulfill({ contentType:mime[path.extname(url.pathname)] || 'application/octet-stream', body: Buffer.from(app.assets.get(url.pathname)) });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status:503, contentType:'application/json', body:'{"error":"UNAVAILABLE"}' });
    const publicRoot = path.join(ROOT, 'public'), file = path.resolve(publicRoot, '.' + url.pathname);
    if (!file.startsWith(publicRoot + path.sep)) return route.abort();
    try { return route.fulfill({ contentType:mime[path.extname(file)] || 'application/octet-stream', body:await readFile(file) }); }
    catch { return route.fulfill({ status:404, body:'' }); }
  });
  await context.addInitScript(() => {
    const scenario = new URL(location.href).searchParams.get('scenario');
    if (!['set-en','retain-en','set-ar','retain-ar'].includes(scenario)) return;
    window.__maydanSimulatorLaunchToken = 'e7b0d07a-7fcb-4b58-86c7-32aff0457518';
    window.__maydanSimulatorLocaleScenario = scenario;
    window.__observedNativeMessages = [];
    window.webkit = { messageHandlers:{ maydan:{ postMessage(message) {
      window.__observedNativeMessages.push(message);
      if (message.type === 'simulatorGameReady') window.__maydanSimulatorLaunchReady = message.token;
      if (message.type === 'simulatorLocaleReady') window.__maydanSimulatorLocaleReady = message.token;
    } } } };
  });
  for (const scenario of ['set-en','retain-en','set-ar','retain-ar']) {
    await page.goto('https://maydan-native.test/?scenario=' + scenario, { waitUntil: 'domcontentloaded' });
    try { await page.waitForFunction(() => !!window.__maydanSimulatorLocaleReady, null, { timeout:30000 }); }
    catch (error) {
      const observed = JSON.stringify(await page.evaluate(() => ({ url:location.href,
        lang:document.documentElement.lang, messages:window.__observedNativeMessages,
        text:document.body.innerText.slice(0,1500) })));
      throw new Error(error.message + '\nObserved: ' + observed);
    }
    const messages = await page.evaluate(() => window.__observedNativeMessages);
    const receipt = messages.find(message => message.type === 'simulatorLocaleReady'), locale = scenario.slice(-2);
    assert.equal(receipt.scenario, scenario);
    assert.equal(receipt.rendered.lang, locale);
    assert.equal(receipt.rendered.dir, locale === 'en' ? 'ltr' : 'rtl');
    assert.equal(receipt.rendered.homeDir, receipt.rendered.dir);
    assert.equal(receipt.rendered.navDir, receipt.rendered.dir);
    assert.deepEqual(receipt.rendered.navigation, locale === 'en' ? ['Play','Friends','Store','Me'] : ['العب','الأصدقاء','المتجر','أنا']);
    assert.equal(receipt.rendered.games.length, 8);
    assert.equal(receipt.rendered.games.find(game => game.id === 'ersomha').label, locale === 'en' ? 'Draw It' : 'ارسمها');
    assert.equal(receipt.rendered.settingsLabel, scenario.startsWith('retain') ? null : locale === 'en' ? 'Interface language' : 'لغة الواجهة');
    assert.ok(messages.some(message => message.type === 'setLocale' && message.locale === locale));
    if (scenario.startsWith('retain')) assert.ok(messages.filter(message => message.type === 'setLocale').every(message => message.locale === locale), 'retention must already load the selected locale');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('maydan:platform:settings')).uiLocale), locale);
  }
  assert.deepEqual(errors, []);
});
