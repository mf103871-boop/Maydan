// Publication regression tests use isolated accounts and the real design HTTP
// routes. They never contact production or enable production publication.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, webkit } from 'playwright';
import { startStudioLocal } from '../../scripts/studio-local.mjs';
import { buildStudio } from '../../scripts/studio-build.mjs';
import { buildDesignPreview } from '../../scripts/design-preview-build.mjs';
import { DESIGN_SCREENS } from '../../src/design/registry.js';

const outputIndex = process.argv.indexOf('--out');
const OUT = path.resolve(outputIndex < 0 ? '.cache/studio-publication' : process.argv[outputIndex + 1]);
await mkdir(OUT, { recursive: true });
await buildStudio(); await buildDesignPreview({ version: '1.8' });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = { startedAt: new Date().toISOString(), productionContacted: false, builds: { editorSha256: sha(await readFile('dist/studio/studio.js')), editorHtmlSha256: sha(await readFile('dist/studio/index.html')), previewSha256: sha(await readFile('dist/studio/preview/index.html')) }, engines: [] };
for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  const runtime = await startStudioLocal({ publishEnabled: true });
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript((session) => {
    if (window === window.top) localStorage.setItem('maydan:account:session', JSON.stringify(session));
    else addEventListener('message', (event) => { if (event.source === parent && event.data?.type === 'studio:render') { const { sceneId, profile, documentSerial } = event.data; window.__studioTestMeta = { sceneId, profile, documentSerial }; } });
  }, runtime.sessions['studio-test-owner'].token);
  const first = await context.newPage(), second = await context.newPage();
  const result = { engine: engineName, checks: [], errors: [], posts: [] };
  for (const page of [first, second]) {
    page.setDefaultTimeout(15000); page.on('pageerror', (error) => result.errors.push(error.message));
    page.on('response', (response) => { if (response.request().method() === 'POST' && /\/api\/design\/(publish|rollback)$/.test(new URL(response.url()).pathname)) result.posts.push({ page: page === first ? 'first' : 'second', status: response.status(), body: response.request().postDataJSON() }); });
  }
  const opened = async (page) => { await page.goto(`${runtime.origin}/api/studio/`); await page.locator('.st-shell').waitFor(); await page.waitForFunction(() => !document.querySelector('.st-preview-wait')); await page.waitForFunction(() => document.querySelector('.st-save-status')?.innerText.includes('كل التعديلات محفوظة')); };
  const publication = () => runtime.DB.prepare("SELECT version_id,revision FROM design_publication WHERE id='main'").first();
  const child = () => first.frames().find((frame) => frame.url().includes('/api/studio/preview/'));
  const diagnostic = (changes) => child().evaluate((override) => parent.postMessage({ type: 'studio:validation', nonce: new URL(location.href).searchParams.get('nonce'), ...window.__studioTestMeta, errors: [], warnings: [], ...override }, location.origin), changes);
  const chooseScene = async (id) => { const def = DESIGN_SCREENS.find((entry) => entry.id === id); await first.locator('.st-screen').filter({ has: first.getByText(def.label, { exact: true }) }).click(); await child().waitForFunction((sceneId) => window.__studioTestMeta?.sceneId === sceneId, id); };
  try {
    await opened(first);
    await first.getByRole('button', { name: 'نشر للجميع', exact: true }).click(); await first.getByRole('button', { name: 'اعتماد التصميم', exact: true }).waitFor();
    await opened(second);
    await second.getByRole('button', { name: 'نشر للجميع', exact: true }).click(); await second.getByRole('button', { name: 'اعتماد التصميم', exact: true }).click();
    await second.getByText('نُشر التصميم بنجاح.', { exact: true }).waitFor();
    const otherHead = await publication(); assert.ok(otherHead.version_id); await first.bringToFront();
    await first.getByRole('button', { name: 'اعتماد التصميم', exact: true }).click();
    await first.getByRole('heading', { name: 'تغيّر التصميم المنشور', exact: true }).waitFor();
    assert.deepEqual(await publication(), otherHead); assert.equal(result.posts.length, 2);
    assert.equal(result.posts[0].status, 200); assert.equal(result.posts[1].status, 409); assert.equal(result.posts[1].body.expectedPublished, null);
    result.checks.push('two real editor tabs publish concurrently: stale tab sends its observed head and receives409 without replacing newer publication');
    await first.getByRole('button', { name: 'حمّل أحدث حالة للنشر', exact: true }).click(); await first.locator('.st-shell').waitFor();
    await first.getByRole('button', { name: 'نشر للجميع', exact: true }).click(); await first.getByRole('button', { name: 'اعتماد التصميم', exact: true }).waitFor();
    const postsBeforeFatal = result.posts.length;
    await diagnostic({ errors: [{ message: 'فشل الوصول إلى إجراء مطلوب في اختبار معزول' }] });
    await first.getByRole('button', { name: 'اعتماد التصميم', exact: true }).waitFor({ state: 'visible' });
    await first.waitForFunction(() => document.querySelector('.st-dialog footer .primary')?.disabled === true);
    assert.equal(await first.getByRole('button', { name: 'نشر للجميع', exact: true }).isDisabled(), true);
    assert.equal(await first.getByRole('button', { name: 'جرّب على حسابي', exact: true }).isDisabled(), true);
    await first.getByRole('button', { name: 'اعتماد التصميم', exact: true }).evaluate((button) => button.click()); await first.waitForTimeout(100);
    assert.equal(result.posts.length, postsBeforeFatal); result.checks.push('fatal validation arriving after confirmation opens disables adoption, private trial and publication without sending a publication request');
    const meta = await child().evaluate(() => window.__studioTestMeta);
    await diagnostic({ documentSerial: meta.documentSerial - 1 }); await first.waitForTimeout(100);
    assert.equal(await first.getByRole('button', { name: 'اعتماد التصميم', exact: true }).isDisabled(), true);
    await diagnostic({ nonce: 'wrong-nonce' }); await first.waitForTimeout(100);
    assert.equal(await first.getByRole('button', { name: 'اعتماد التصميم', exact: true }).isDisabled(), true);
    result.checks.push('stale document diagnostics and spoofed nonce cannot clear fatal publication gates');
    await diagnostic({ warnings: [{ message: 'ملاحظة تباين قابلة للمراجعة' }] }); await first.waitForFunction(() => document.querySelector('.st-dialog footer .primary')?.disabled === false);
    assert.equal(await first.getByRole('button', { name: 'جرّب على حسابي', exact: true }).isDisabled(), false);
    result.checks.push('warnings remain visible review notes and do not block adoption');
    await first.getByRole('button', { name: 'إلغاء', exact: true }).click();
    await chooseScene('players');
    // Use real drawing-layout updates and the child inspector, not fabricated
    // validation, to cover a required back button with a higher real button.
    await child().evaluate(() => parent.postMessage({ type: 'studio:patches', nonce: new URL(location.href).searchParams.get('nonce'), patches: [
      { screenId: 'players', nodeId: 'back', patch: { layouts: { portrait: { x: .05, y: .1, width: .8, height: .12, anchorX: 'left', anchorY: 'top', z: 1 } } } },
      { screenId: 'players', nodeId: 'add-player', patch: { layouts: { portrait: { x: .05, y: .1, width: .8, height: .12, anchorX: 'left', anchorY: 'top', z: 2 } } } },
    ] }, location.origin));
    await first.getByText(/لا يمكن اعتماد التصميم قبل إصلاح أخطاء الوصول المطلوبة/).waitFor();
    const notes = (await first.locator('.st-validation li').allTextContents()).join('؛ '); assert.match(notes, /إجراء مطلوب تغطيه طبقة أخرى/);
    assert.equal(await first.getByRole('button', { name: 'نشر للجميع', exact: true }).isDisabled(), true);
    assert.equal(result.posts.length, postsBeforeFatal); result.checks.push('actual required back action covered by a customized real button produces fatal access diagnostic and blocks publication');
    await chooseScene('store'); await first.waitForTimeout(250);
    assert.equal(await first.getByRole('button', { name: 'نشر للجميع', exact: true }).isDisabled(), true); result.checks.push('changing screens does not discard fatal errors reported by another screen');
    await chooseScene('players'); await first.getByRole('button', { name: 'تراجع', exact: true }).click();
    await first.waitForFunction(() => document.querySelector('.st-top-actions .primary')?.disabled === false);
    result.checks.push('fixing the actual layout and revalidating that view clears the gate');
    await first.screenshot({ path: path.join(OUT, `${engineName}-publication-editor.png`) });
    assert.equal(result.errors.length, 0); result.passed = true;
  } catch (error) { result.passed = false; result.failure = error.message; await first.screenshot({ path: path.join(OUT, `${engineName}-failure.png`), fullPage: true }).catch(() => {}); result.preview = await child()?.locator('body').innerText().catch(() => ''); result.notes = await first.locator('.st-validation li').allTextContents().catch(() => []); result.nodes = await child()?.evaluate(() => [...document.querySelectorAll('[data-design-id]')].filter((el) => ['back','add-player'].includes(el.dataset.designId)).map((el) => ({ id: el.dataset.designId, tag: el.tagName, rect: el.getBoundingClientRect().toJSON(), scope: el.closest('[data-design-screen]')?.dataset.designScreen, display: getComputedStyle(el).display, z: getComputedStyle(el).zIndex, hit: document.elementsFromPoint(el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2, el.getBoundingClientRect().y + el.getBoundingClientRect().height / 2).slice(0,5).map((item)=>({tag:item.tagName,id:item.dataset.designId,scope:item.closest('[data-design-screen]')?.dataset.designScreen})) })));  }
  finally { report.engines.push(result); await browser.close(); await runtime.close(); await writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ engine: engineName, passed: result.passed, checks: result.checks.length, failure: result.failure, errors: result.errors }));
  if (!result.passed) break;
}
report.finishedAt = new Date().toISOString(); report.passed = report.engines.length === 2 && report.engines.every((entry) => entry.passed);
await writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
