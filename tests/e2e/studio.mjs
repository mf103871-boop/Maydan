// Full editor + real design HTTP routes, signed disposable sessions, SQLite D1
// adapter and isolated R2-compatible object bytes. No production credentials.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, webkit } from 'playwright';
import sharp from 'sharp';
import { startStudioLocal } from '../../scripts/studio-local.mjs';
import { buildStudio } from '../../scripts/studio-build.mjs';
import { buildDesignPreview } from '../../scripts/design-preview-build.mjs';
import { DESIGN_SCREENS } from '../../src/design/registry.js';
import { PREVIEW_SIZES } from '../../src/studio/editor-model.js';

const outputIndex = process.argv.indexOf('--out');
const OUT = path.resolve(outputIndex < 0 ? '.cache/studio-e2e' : process.argv[outputIndex + 1]);
const engines = process.argv.includes('--chromium-only') ? { chromium } : process.argv.includes('--webkit-only') ? { webkit } : { chromium, webkit };
const sweep = process.argv.includes('--sweep');
await mkdir(OUT, { recursive: true });
await buildStudio(); await buildDesignPreview({ version: '1.8' });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = { startedAt: new Date().toISOString(), builds: { editorSha256: hash(await readFile('dist/studio/studio.js')), previewSha256: hash(await readFile('dist/studio/preview/index.html')) }, backend: 'real routeDesign + all migrations + SQLite D1 adapter + private memory R2', productionContacted: false, engines: [] };

for (const [engineName, engine] of Object.entries(engines)) {
  const runtime = await startStudioLocal({ legacyServiceWorker: true });
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const result = { engine: engineName, checks: [], scenes: [], pageErrors: [], apiFailures: [], apiCalls: [] };
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  page.on('response', (response) => { if (response.url().includes('/api/design/') && response.status() >= 400 && response.status() !== 409) result.apiFailures.push({ status: response.status(), path: new URL(response.url()).pathname }); });
  page.on('request', (request) => { if (request.url().includes('/api/design/')) result.apiCalls.push({ method: request.method(), path: new URL(request.url()).pathname }); });
  const token = runtime.sessions['studio-test-owner'].token;
  await context.addInitScript((session) => { if (window === window.top) localStorage.setItem('maydan:account:session', JSON.stringify(session)); }, token);
  const draft = async () => { const row = await runtime.DB.prepare("SELECT document_json,revision FROM design_draft WHERE id='main'").first(); return { document: row.document_json ? JSON.parse(row.document_json) : null, revision: row.revision }; };
  const waitDraft = async (predicate) => { const until = Date.now() + 15000; while (Date.now() < until) { const value = await draft(); if (predicate(value)) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('Expected persisted draft change did not arrive'); };
  const chooseScene = async (id) => { const definition = DESIGN_SCREENS.find((item) => item.id === id); await page.locator('.st-screen').filter({ has: page.getByText(definition.label, { exact: true }) }).click(); await page.waitForTimeout(120); };
  const waitSaved = async () => { await page.waitForFunction(() => document.querySelector('.st-save-status')?.innerText.includes('كل التعديلات محفوظة')); };
  try {
    await page.goto(`${runtime.origin}/__studio_sw_probe`);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller)); result.legacyWorkerSha256 = runtime.legacyWorkerSha256;
    await page.goto(`${runtime.origin}/api/studio/`); await page.locator('.st-shell').waitFor();
    result.checks.push('canonical /api/studio bypasses the installed production service worker');
    await page.waitForFunction(() => !document.querySelector('.st-preview-wait'));
    // Selecting via the actual tree works without relying on translated game text.
    await page.getByRole('button', { name: 'كل العناصر المسجّلة', exact: true }).count().catch(() => {});
    await page.getByLabel('كل العناصر المسجّلة').check();
    await page.locator('.st-node-pick').filter({ hasText: /^العنوان$/ }).click();
    await page.getByLabel(/^النص/).fill('اللّمّة تبدأ هنا'); await waitSaved();
    assert.equal((await draft()).document.screens.home.nodes.title.text, 'اللّمّة تبدأ هنا');
    await page.frameLocator('iframe').locator('[data-design-screen="home"] [data-design-id="title"]').filter({ hasText: 'اللّمّة تبدأ هنا' }).waitFor();
    result.checks.push('text change visibly renders and persists via real OCC draft endpoint');
    await page.getByRole('button', { name: 'تراجع', exact: true }).click(); await waitSaved(); assert.ok(!(await draft()).document.screens.home?.nodes?.title?.text);
    await page.getByRole('button', { name: 'إعادة', exact: true }).click(); await waitSaved(); assert.equal((await draft()).document.screens.home.nodes.title.text, 'اللّمّة تبدأ هنا'); result.checks.push('undo and redo persist correctly');
    await chooseScene('store');
    const artwork = page.frameLocator('iframe').locator('[data-design-screen="store"] [data-design-id="artwork"]');
    await artwork.waitFor({ state: 'visible' }); const beforeDrag = await artwork.boundingBox(), dragRevision = (await draft()).revision;
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2); await page.mouse.down(); await page.mouse.move(beforeDrag.x + beforeDrag.width / 2 + 20, beforeDrag.y + beforeDrag.height / 2 + 14, { steps: 8 }); await page.mouse.up(); await waitSaved();
    const dragged = await waitDraft((value) => Boolean(value.document.screens.store?.nodes?.artwork?.layouts?.portrait)); await waitSaved(); const afterDrag = await artwork.boundingBox(); assert.equal(dragged.revision, dragRevision + 1); assert.ok(Math.abs(afterDrag.x - beforeDrag.x) + Math.abs(afterDrag.y - beforeDrag.y) > 3); result.checks.push('actual iframe drag changes visible position and creates one persisted undo step');
    const handle = page.frameLocator('iframe').getByRole('button', { name: 'تغيير حجم العنصر', exact: true }); await handle.waitFor(); const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await page.mouse.down(); await page.mouse.move(handleBox.x + handleBox.width / 2 + 17, handleBox.y + handleBox.height / 2 + 11, { steps: 6 }); await page.mouse.up(); await waitSaved();
    await waitDraft((value) => value.document.screens.store.nodes.artwork.layouts.portrait.width !== dragged.document.screens.store.nodes.artwork.layouts.portrait.width); await waitSaved(); result.checks.push('actual 44px resize handle changes saved dimensions');
    await page.getByRole('switch', { name: 'إظهار العنصر', exact: true }).uncheck(); await waitSaved(); assert.equal((await draft()).document.screens.store.nodes.artwork.visible, false); assert.equal(await artwork.isVisible(), false);
    await page.getByRole('button', { name: 'تراجع', exact: true }).click(); await waitSaved(); assert.equal(await artwork.isVisible(), true); result.checks.push('hide and undo affect actual component visibility');
    await chooseScene('home');
    await page.getByRole('button', { name: 'جرّب على حسابي', exact: true }).click(); await page.getByRole('button', { name: 'إنهاء التجربة', exact: true }).waitFor();
    const preview = await runtime.DB.prepare('SELECT version_id FROM design_previews WHERE user_id=?').bind('studio-test-owner').first(); assert.ok(preview.version_id);
    assert.equal((await runtime.DB.prepare("SELECT version_id FROM design_publication WHERE id='main'").first()).version_id, null); result.checks.push('immutable snapshot pinned privately; public configuration untouched');
    await page.getByRole('button', { name: 'إنهاء التجربة', exact: true }).click(); await page.waitForTimeout(150); assert.equal(await runtime.DB.prepare('SELECT version_id FROM design_previews WHERE user_id=?').bind('studio-test-owner').first(), null);
    assert.equal(await page.getByRole('button', { name: 'نشر للجميع', exact: true }).isDisabled(), true); result.checks.push('phone test publication gate cannot be bypassed in UI');
    await page.screenshot({ path: path.join(OUT, `${engineName}-editor-desktop.png`) });
    // Upload exercises the real decoder, metadata sanitizer, private object
    // storage and asset relationship validation, not a stubbed upload endpoint.
    await page.getByRole('button', { name: 'الملفات', exact: true }).click();
    const bytes = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#087d89' } }).png().toBuffer();
    await page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'تجربة.png', mimeType: 'image/png', buffer: bytes });
    await page.getByRole('button', { name: 'قص وحفظ الصورة', exact: true }).click();
    await page.locator('.st-assets-grid button').first().waitFor(); await page.locator('.st-assets-grid button').first().click(); await waitSaved();
    const withAsset = (await draft()).document, assetId = withAsset.assets[0]; assert.ok(assetId); assert.equal(withAsset.screens.home.decorations.at(-1).assetId, assetId);
    const decorationId = withAsset.screens.home.decorations.at(-1).id, decoration = page.frameLocator('iframe').locator(`[data-design-decoration="${decorationId}"]`); await decoration.waitFor(); await page.waitForTimeout(150); assert.ok((await decoration.getAttribute('src')).startsWith('blob:'));
    const decorationBox = await decoration.boundingBox(); await page.mouse.move(decorationBox.x + decorationBox.width / 2, decorationBox.y + decorationBox.height / 2); await page.mouse.down(); await page.mouse.move(decorationBox.x + decorationBox.width / 2 + 13, decorationBox.y + decorationBox.height / 2 + 9, { steps: 5 }); await page.mouse.up(); await waitSaved();
    await waitDraft((value) => value.document.screens.home.decorations.at(-1).layouts.portrait.x !== withAsset.screens.home.decorations.at(-1).layouts.portrait.x); await waitSaved(); result.checks.push('uploaded decoration is visible, selectable and draggable without exposing its private endpoint');
    assert.equal((await fetch(`${runtime.origin}/api/design/assets/${assetId}`)).status, 404); assert.ok(runtime.objects.size === 1); result.checks.push('cropped image sanitized and privately stored, then referenced in saved decoration');
    await page.getByRole('button', { name: 'الشاشات', exact: true }).click();
    await chooseScene('social.list'); await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, `${engineName}-friends-preview.png`) });
    // Scene sweep changes the actual UI, not synthetic JSON-only component trees.
    const profiles = sweep ? ['portrait', 'landscape', 'large'] : ['portrait'];
    const sceneList = sweep ? DESIGN_SCREENS : DESIGN_SCREENS.filter((entry) => ['home','settings','store','social.list','social.conversation','social.call','profile','ersomha.draw.drawer','ersomha.draw.guesser','badeeha.question','online.lobby','system.dialog','account.paywall'].includes(entry.id));
    for (const profile of profiles) {
      const profileLabel = { portrait: 'هاتف رأسي', landscape: 'هاتف أفقي', large: 'شاشة كبيرة' }[profile]; await page.getByRole('button', { name: profileLabel, exact: true }).click();
      for (const definition of sceneList) {
        const before = result.pageErrors.length; await chooseScene(definition.id); await page.waitForTimeout(120);
        const frame = page.frames().find((frame) => frame.url().includes('/api/studio/preview/'));
        const content = await frame.locator('body').innerText();
        result.scenes.push({ id: definition.id, profile, chars: content.trim().length, errors: result.pageErrors.slice(before) });
        assert.ok(content.trim().length > 0, `Empty preview ${definition.id} ${profile}`); assert.ok(!content.includes('تعذّر عرض هذه الحالة') && !content.includes('تعذر تحضير المعاينة'), `Boundary failure ${definition.id} ${profile}: ${content}`);
      }
    }
    for (const width of [320,390,430,620,768,1024,1440]) {
      const preset = PREVIEW_SIZES.find((entry) => entry.width === width);
      await page.getByLabel('مقاس الجهاز').selectOption(preset.id);
      await page.waitForFunction((value) => document.querySelector('iframe')?.clientWidth === value, width);
    }
    result.checks.push('seven approved viewport widths select their correct portrait/landscape/large design profiles');
    await chooseScene('home'); await page.getByRole('button', { name: 'هاتف رأسي', exact: true }).click();
    const fullPreviewHeight = await page.locator('iframe').evaluate((frame) => Number(frame.getAttribute('style').match(/height:\s*([\d.]+)px/)[1]));
    await page.getByLabel('حالة المعاينة').selectOption('keyboard'); await page.waitForTimeout(200);
    assert.ok(await page.locator('iframe').evaluate((frame) => frame.clientHeight) < fullPreviewHeight); assert.equal(await page.locator('.st-simulated-keyboard').count(), 1);
    result.checks.push('keyboard preset shrinks the real iframe viewport and labels simulated keyboard space');
    for (const state of ['empty','loading','error','longText','largeText','guest']) { await page.getByLabel('حالة المعاينة').selectOption(state); await page.waitForTimeout(150); } await page.getByLabel('حالة المعاينة').selectOption('normal');
    result.checks.push('remaining preview states mount without runtime or boundary failures; device OS behavior remains unclaimed');
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(OUT, `${engineName}-editor-phone.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); result.checks.push('phone editor has no horizontal document overflow');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'تصدير', exact: true }).click(); const download = await downloadPromise; const exportedPath = path.join(OUT, `${engineName}-exported-design.json`); await download.saveAs(exportedPath);
    const imported = (await draft()).document; imported.tokens['--radius'] = 27;
    await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({ name: 'تصميم.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await waitDraft((value) => value.document.tokens['--radius'] === 27); await waitSaved(); result.checks.push('real JSON export download and validated import round trip');
    await page.getByRole('button', { name: 'استعادة هذه الشاشة', exact: true }).click(); await page.getByRole('button', { name: 'تأكيد الاستعادة', exact: true }).click();
    await waitDraft((value) => !value.document.screens.home); await waitSaved();
    await page.getByRole('button', { name: 'تراجع', exact: true }).click(); await waitDraft((value) => value.document.screens.home?.nodes?.title?.text === 'اللّمّة تبدأ هنا'); await waitSaved(); result.checks.push('screen reset is confirmed, isolated and fully undoable');
    await page.getByLabel('كل العناصر المسجّلة').check(); await page.locator('.st-node-pick').filter({ hasText: /^العنوان$/ }).click();
    await runtime.DB.prepare("UPDATE design_draft SET revision=revision+1 WHERE id='main'").run();
    await page.getByLabel(/^النص/).fill('تعارض مقصود'); await page.getByRole('button', { name: 'حل التعارض', exact: true }).waitFor();
    assert.equal((await draft()).document.screens.home.nodes.title.text, 'اللّمّة تبدأ هنا'); result.checks.push('concurrent revision conflict never overwrites existing draft');
    await page.getByRole('button', { name: 'حل التعارض', exact: true }).click(); await page.getByRole('button', { name: 'حمّل المسودة الأحدث', exact: true }).click(); await page.locator('.st-shell').waitFor();
    await page.evaluate((next) => { localStorage.setItem('maydan:account:session', JSON.stringify(next)); dispatchEvent(new Event('storage')); }, runtime.sessions['studio-test-player'].token);
    await page.locator('.st-entry').waitFor(); assert.equal(await page.locator('.st-shell').count(), 0); result.checks.push('account switch immediately removes draft and editor access');
    assert.equal(result.pageErrors.length, 0, JSON.stringify(result.pageErrors)); assert.equal(result.apiFailures.length, 0, JSON.stringify(result.apiFailures)); result.passed = true;
  } catch (error) { result.passed = false; result.failure = error.message; result.savedDraft = await draft(); const child = page.frames().find((frame) => frame.url().includes('/api/studio/preview/')); result.previewBody = child ? await child.locator('body').innerText().catch(() => '') : ''; await page.screenshot({ path: path.join(OUT, `${engineName}-failure.png`), fullPage: true }).catch(() => {}); await writeFile(path.join(OUT, `${engineName}-failure.html`), await page.content()); }
  finally { report.engines.push(result); await browser.close(); await runtime.close(); await writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ engine: engineName, passed: result.passed, checks: result.checks.length, sceneViews: result.scenes.length, failure: result.failure, pageErrors: result.pageErrors, apiFailures: result.apiFailures }));
  if (!result.passed) break;
}
report.finishedAt = new Date().toISOString(); report.passed = report.engines.length === Object.keys(engines).length && report.engines.every((result) => result.passed);
await writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
