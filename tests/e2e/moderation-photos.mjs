// Browser evidence for the real profile upload and moderation routes on a temporary local D1 database.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createLocalD1 } from '../../server/local-d1.mjs';
import { createUser } from '../../server/accounts/db.mjs';
import { issueSession } from '../../server/accounts/session.mjs';
import { routeProfiles } from '../../server/profiles/router.mjs';
import { routeModeration } from '../../server/moderation/router.mjs';
import { errorResponse, json } from '../../server/protocol.mjs';

const out = path.resolve(process.env.PHOTO_MODERATION_EVIDENCE_DIR || '.cache/profile-photo-moderation');
await mkdir(out, { recursive: true });

const avatarBytes = await sharp('src/shared/brand/assets/playful-identity/avatar-human-02-256.webp').flatten({ background: '#cdeedf' }).jpeg().toBuffer();
const replacementAvatar = await sharp('src/shared/brand/assets/playful-identity/avatar-human-02-256.webp').flatten({ background: '#bde6da' }).jpeg().toBuffer();
const coverBytes = await sharp('public/media/badeeha-covers/history.webp').resize(720, 240, { fit: 'cover' }).jpeg().toBuffer();
const oldCover = await sharp({ create: { width: 720, height: 240, channels: 3, background: '#daecdf' } }).jpeg().toBuffer();
const jpeg = bytes => ({ dataUrl: 'data:image/jpeg;base64,' + bytes.toString('base64') });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let release; const wait = new Promise(resolve => { release = resolve; }); return { wait, release }; };

function requestAt(url, token, method = 'GET', body) {
  return new Request(url, { method,
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

const source = `
import React, {useMemo,useState} from 'react';
import { createRoot } from 'react-dom/client';
import { CreatorDashboard } from './src/creator/CreatorDashboard.jsx';
import { ModerationScreen } from './src/moderation/ModerationScreen.jsx';
import { BottomNavigation } from './src/platform/BottomNavigation.jsx';
import { CallViewport } from './src/social/CallViewport.jsx';
import { navigate,useRoute } from './src/platform/router.js';
import { AccountContext,NULL_ACCOUNT } from './src/shared/account/context.js';
import { PlatformContext } from './src/platform/context.js';
import { BrandFonts } from './src/shared/brand/art.jsx';
import { setUiLocale } from './src/shared/i18n/core.js';
import tokens from './src/shared/theme/tokens.css';
import ui from './src/shared/ui/ui.css';
import brand from './src/shared/brand/brand.css';
import studio from './src/platform/playful-studio.css';

window.imageBlobs={created:[],revoked:[]};
const makeURL=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=makeURL(blob);if(blob.type==='image/jpeg')window.imageBlobs.created.push(url);return url;};
URL.revokeObjectURL=url=>{window.imageBlobs.revoked.push(url);revoke(url);};
const platform={sound:{play(){}},haptics:{vibrate(){}}};
const accounts=window.fixtureAccounts;
const requestFor=actor=>async(url,options={})=>{
  const response=await fetch(url,{method:options.method||'GET',cache:'no-store',
    headers:{authorization:'Bearer '+actor.token,...(options.body===undefined?{}:{'content-type':'application/json'})},
    ...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
  if(response.ok)return options.raw?response:response.json();
  const error=await response.json();
  throw Object.assign(new Error(error.error),{code:error.error});
};
function App(){
  const [owner,setOwner]=useState('guest'),[snapshot,setSnapshot]=useState('guest');
  const route=useRoute(), actor=accounts[owner], me=accounts[snapshot];
  const requestAuthenticated=useMemo(()=>actor?requestFor(actor):async()=>{throw new Error('Guest request');},[actor]);
  window.fixture={select:(next,current=next)=>{setOwner(next);setSnapshot(current);},open:path=>navigate(path,{replace:true})};
  const user=actor?{id:actor.id,name:actor.name}:null;
  const account={...NULL_ACCOUNT,ready:true,signedIn:!!actor,user,
    me:me?{user:{id:me.id,name:me.name},creator:{enabled:me.creator}}:null,
    requestAuthenticated};
  return <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><BrandFonts/>
    <style>{tokens}</style><style>{ui}</style><style>{brand}</style><style>{studio}</style>
    <output hidden data-owner={owner} data-snapshot={snapshot}/>
    <CallViewport>{route.name==='moderation'?<ModerationScreen/>:<CreatorDashboard/>}</CallViewport>
    <BottomNavigation route={route}/>
  </PlatformContext.Provider></AccountContext.Provider>;
}
setUiLocale(new URLSearchParams(location.search).get('locale')).then(()=>createRoot(document.getElementById('root')).render(<App/>));`;
const bundle = await build({ stdin: { contents: source, loader: 'jsx', resolveDir: process.cwd() }, write: false, bundle: true, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.svg': 'dataurl' }, logLevel: 'silent' });

async function createFixture(locale) {
  const env = { DB: createLocalD1() };
  const requests = [];
  const submitted = [];
  async function user(name, creator = false) {
    const { id } = await createUser(env, { name });
    const { token } = await issueSession(env, id);
    return { id, name, token, creator };
  }
  const player = await user(locale === 'ar' ? 'لاعب تجريبي' : 'Sample Player');
  const dual = await user('Creator reviewer', true);
  const creatorOnly = await user('Creator only', true);
  const moderatorOnly = await user('Moderator only');
  const accounts = { dual, creatorOnly, moderatorOnly };
  env.MODERATOR_USER_IDS = dual.id + ',' + moderatorOnly.id;
  const profile = async (endpoint = '/me', method = 'GET', body) => {
    const response = await routeProfiles(requestAt('https://fixture.test/api/profiles' + endpoint, player.token, method, body), env);
    const result = await response.json();
    assert.ok(response.ok, 'profile fixture response ' + response.status + ' ' + result.error);
    return result.profile;
  };
  const moderator = async (endpoint, method = 'GET', body) => {
    const response = await routeModeration(requestAt('https://fixture.test/api/moderation' + endpoint, dual.token, method, body), env);
    assert.ok(response.ok, 'moderator fixture response ' + response.status);
    return response.json();
  };
  const previous = await profile('/me/images/cover', 'PUT', jpeg(oldCover));
  assert.equal(previous.imageReviews.cover.status, 'pending');
  const { images: [old] } = await moderator('/images');
  await moderator('/actions', 'POST', { action: 'approve_image', targetId: old.id, version: old.version, clientId: crypto.randomUUID(), reason: 'Initial test cover' });
  const prior = await profile();
  assert.ok(prior.coverUrl.endsWith(old.version));
  await profile('/me/images/cover', 'PUT', jpeg(coverBytes));
  const pending = await profile('/me/images/avatar', 'PUT', jpeg(avatarBytes));
  assert.equal(pending.imageReviews.avatar.status, 'pending');
  assert.equal(pending.imageReviews.cover.status, 'pending');
  assert.equal(pending.coverUrl, prior.coverUrl);
  const { images } = await moderator('/images');
  assert.equal(images.length, 2);
  let avatar = images.find(row => row.kind === 'avatar');
  const cover = images.find(row => row.kind === 'cover');
  assert.equal(avatar.version, pending.imageReviews.avatar.pendingVersion);
  assert.equal(cover.version, pending.imageReviews.cover.pendingVersion);
  const replaceAvatar = async () => {
    const previousVersion = avatar.version;
    const result = await profile('/me/images/avatar', 'PUT', jpeg(replacementAvatar));
    avatar = (await moderator('/images')).images.find(row => row.kind === 'avatar');
    assert.equal(avatar.version, result.imageReviews.avatar.pendingVersion);
    assert.notEqual(avatar.version, previousVersion);
  };
  const forbidden = await routeModeration(requestAt('https://fixture.test' + avatar.previewUrl, creatorOnly.token), env);
  assert.equal(forbidden.status, 403, 'creator analytics permission alone does not authorize private previews');
  const gates = { role: null, list: null, preview: null, failPreview: false, failReports: false, ambiguousPost: false };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        const actor = Object.keys(accounts).find(alias => 'Bearer ' + accounts[alias].token === req.headers.authorization);
        requests.push({ actor, path: url.pathname, method: req.method });
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : undefined;
        let response;
        if (url.pathname === '/api/creator/analytics') {
          response = json({ schemaVersion: 1, timezone: 'Asia/Amman', updatedAt: new Date().toISOString(), metricsStartedAt: null,
            environment: { id: 'local' }, collection: { status: 'not-started', onlineWindowSeconds: 90, peakSampleSeconds: 60 },
            summary: { onlinePlayers: 0, todayPlayers: 0, todayPeakOnline: 0, activeGames: 0, registeredAccountsTotal: 4, registeredAccountsToday: 4 },
            byGame: [], byScreen: [], byMode: [], hourly: [], daily: [] });
        } else {
          const request = requestAt(url, accounts[actor]?.token, req.method, body);
          if (url.pathname === '/api/moderation/me') await gates.role?.wait;
          if (url.pathname === '/api/moderation/images') await gates.list?.wait;
          if (url.pathname === avatar.previewUrl) await gates.preview?.wait;
          response = await routeModeration(request, env);
          if (url.pathname === '/api/moderation/reports' && gates.failReports) {
            gates.failReports = false;
            await response.body?.cancel();
            response = json({ error: 'NETWORK' }, 503);
          }
          if (url.pathname === avatar.previewUrl && gates.failPreview) {
            gates.failPreview = false;
            await response.body?.cancel();
            response = new Response(JSON.stringify({ error: 'NETWORK' }), { status: 503, headers: { 'content-type': 'application/json' } });
          }
          if (url.pathname === '/api/moderation/actions' && req.method === 'POST') {
            submitted.push(body);
            if (gates.ambiguousPost) {
              assert.ok(response.ok, 'fixture commits the first decision before dropping its response');
              gates.ambiguousPost = false;
              await response.body?.cancel();
              response = new Response(JSON.stringify({ error: 'NETWORK' }), { status: 503, headers: { 'content-type': 'application/json' } });
            }
          }
        }
        res.writeHead(response.status, { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' });
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.fixtureAccounts=${JSON.stringify(accounts)};</script><script>${bundle.outputFiles[0].text}</script></html>`;
      res.writeHead(200, { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    } catch (error) {
      const response = errorResponse(error);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return { origin, gates, requests, submitted, get avatar() { return avatar; }, cover, prior, profile, moderator, replaceAvatar, close: async () => {
    for (const gate of Object.values(gates)) gate?.release?.();
    await new Promise(resolve => server.close(resolve));
    env.DB.close();
  }};
}

const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
const widths = [360, 390, 430];
const queue = page => page.locator('.moderation-photo-queue');
const dialog = page => page.getByRole('dialog');
async function checkTarget(locator) {
  await locator.evaluate(button => button.scrollIntoView({ block: 'center' }));
  const rect = await locator.boundingBox();
  assert.ok(rect.width >= 48 && rect.height >= 48);
  assert.ok(await locator.evaluate(button => {
    const rect = button.getBoundingClientRect();
    const nav = document.querySelector('.menu-navigation:not([hidden])');
    const bottom = nav ? nav.getBoundingClientRect().top : innerHeight;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.top >= -.5 && rect.bottom <= bottom + .5 && button.contains(hit);
  }));
}

async function run(browser, engine, locale) {
  const f = await createFixture(locale);
  const name = engine + '-' + locale;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(7000);
  await page.route('**/*', route => new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort());
  const select = async (alias, snapshot = alias) => {
    await page.evaluate(([owner, current]) => window.fixture.select(owner, current), [alias, snapshot]);
    await page.locator('output[data-owner="' + alias + '"][data-snapshot="' + snapshot + '"]').waitFor({ state: 'attached' });
    await settle(page);
  };
  const go = async route => { await page.evaluate(route => window.fixture.open(route), route); await settle(page); };
  const shot = async tag => { await settle(page); await page.screenshot({ path: path.join(out, name + '-' + tag + '.png') }); };
  const moderationRequests = () => f.requests.filter(request => request.path.startsWith('/api/moderation/'));
  const frame = kind => queue(page).locator('.moderation-image-card[data-kind="' + kind + '"]');
  const clickId = (root, id) => root.locator('[data-design-id="' + id + '"]').click();
  const scrollQueue = () => queue(page).evaluate(node => node.scrollIntoView({ block: 'start' }));
  try {
    await page.goto(f.origin + '/?locale=' + locale + '#/creator');
    await page.locator('.creator-dashboard').waitFor();
    assert.equal(await page.locator('html').getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr');
    assert.deepEqual(moderationRequests(), [], 'guests must not start moderation');
    await select('moderatorOnly');
    assert.deepEqual(moderationRequests(), [], 'non-creator moderator must not start a Creator queue');
    const permissionDenied = page.waitForResponse(response => response.url().endsWith('/api/moderation/me'));
    await select('creatorOnly');
    await permissionDenied;
    await settle(page);
    assert.deepEqual(moderationRequests(), [{ actor: 'creatorOnly', path: '/api/moderation/me', method: 'GET' }]);
    assert.equal(await queue(page).count(), 0);
    await select('moderatorOnly', 'dual');
    assert.equal(moderationRequests().length, 1, 'an old creator snapshot cannot authorize a different user');

    f.gates.role = deferred();
    f.gates.list = deferred();
    await select('dual');
    assert.equal(await queue(page).count(), 0);
    assert.ok(moderationRequests().every(request => request.path === '/api/moderation/me'));
    f.gates.role.release(); f.gates.role = null;
    await queue(page).waitFor();
    assert.ok(await queue(page).locator('[aria-busy=true]').isVisible());
    await scrollQueue();
    await shot('creator-loading');
    f.gates.failPreview = true;
    f.gates.list.release(); f.gates.list = null;
    const retry = frame('avatar').locator('[data-design-id="review-image-retry"]');
    const approve = frame('avatar').locator('[data-design-id="approve-image"]');
    const reject = frame('avatar').locator('[data-design-id="reject-image"]');
    await retry.waitFor();
    assert.ok(await approve.isDisabled(), 'approval waits for an actual decoded preview');
    assert.ok(await reject.isEnabled(), 'rejection remains available when preview retrieval fails');
    await scrollQueue();
    await shot('creator-preview-error');
    await retry.click();
    for (const kind of ['avatar', 'cover']) {
      const image = frame(kind).locator('img');
      await image.waitFor();
      assert.match(await image.getAttribute('src'), /^blob:/);
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await settle(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      for (const button of await queue(page).getByRole('button').all()) {
        const rect = await button.boundingBox();
        assert.ok(rect.width >= 48 && rect.height >= 48);
      }
      await page.evaluate(() => scrollTo(0, 0));
      await shot('creator-pending-' + width);
      await scrollQueue();
      await shot('creator-queue-' + width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const originalVersion = f.avatar.version;
    await f.replaceAvatar();
    f.gates.failPreview = true;
    await clickId(queue(page), 'image-queue-refresh');
    await retry.waitFor();
    assert.ok(await approve.isDisabled(), 'the earlier loaded avatar cannot enable approval of a failed replacement');
    assert.ok(await reject.isEnabled());
    await retry.click();
    await page.waitForFunction(() => {
      const card = document.querySelector('.moderation-image-card[data-kind="avatar"]');
      return card?.querySelector('img')?.naturalWidth > 0 && !card.querySelector('[data-design-id="approve-image"]').disabled;
    });
    const savedURLs = await page.evaluate(() => [...window.imageBlobs.created]);
    f.gates.preview = deferred();
    const pendingRead = page.waitForRequest(request => request.url().endsWith(f.avatar.previewUrl));
    await clickId(queue(page), 'image-queue-refresh');
    await pendingRead;
    await frame('avatar').waitFor();
    await select('moderatorOnly', 'dual');
    assert.equal(await queue(page).count(), 0);
    assert.equal(await page.locator('img[src^="blob:"]').count(), 0);
    f.gates.preview.release(); f.gates.preview = null;
    await settle(page);
    assert.ok(await page.evaluate(urls => urls.every(url => window.imageBlobs.revoked.includes(url)), savedURLs));
    assert.equal(await page.locator('img[src^="blob:"]').count(), 0);
    assert.ok(moderationRequests().every(request => request.actor !== 'moderatorOnly'), 'stale creator snapshot cannot read data');

    const imageLabel = locale === 'ar' ? 'الصور الجديدة' : 'New images';
    await select('moderatorOnly');
    await page.setViewportSize({ width: 390, height: 844 });
    f.gates.failReports = true;
    await go('/moderation');
    const reportAlert = page.locator('.moderation-screen [role="alert"]');
    await reportAlert.waitFor();
    assert.match(await reportAlert.innerText(), locale === 'ar' ? /تحميل البلاغات/ : /load the reports/i);
    const loadedReports = page.waitForResponse(response => new URL(response.url()).pathname === '/api/moderation/reports' && response.ok());
    await page.locator('.moderation-toolbar button').click();
    await loadedReports;
    await reportAlert.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: imageLabel, exact: true }).click();
    await frame('avatar').locator('img').waitFor();
    await frame('cover').locator('img').waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    await shot('moderation-pending-390');
    await clickId(frame('avatar'), 'approve-image');
    await dialog(page).getByRole('textbox').fill(locale === 'ar' ? 'صورة شخصية مناسبة لملف اللاعب.' : 'The photo fits the player profile.');
    const confirm = await dialog(page).locator('[data-design-id="save-decision"]').boundingBox();
    const cancel = await dialog(page).locator('[data-design-id="cancel-decision"]').boundingBox();
    assert.ok(locale === 'ar' ? confirm.x > cancel.x : confirm.x < cancel.x, 'decision starts at the leading edge');
    assert.deepEqual(await dialog(page).locator('.moderation-actions > button').evaluateAll(buttons => buttons.map(button => button.dataset.designId)), ['save-decision', 'cancel-decision']);
    await shot('moderation-approve-dialog');
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({ state: 'detached' });
    assert.equal(f.submitted.length, 0, 'closing the preview of a decision makes no write');
    await page.setViewportSize({ width: 360, height: 800 });
    const title = frame('avatar').getByRole('heading');
    const normalText = await title.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const text = page.locator('.moderation-screen').locator('h1, h2, h3, .eyebrow, .moderation-photo-heading, .segment button, .moderation-image-account strong, .moderation-image-account > bdi, .moderation-status, .moderation-image-date, .moderation-photo-queue button');
    await text.evaluateAll(nodes => {
      const sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
      nodes.forEach((node, index) => { node.style.fontSize = sizes[index] * 2 + 'px'; });
    });
    await settle(page);
    assert.equal(await title.evaluate(node => parseFloat(getComputedStyle(node).fontSize)), normalText * 2);
    await checkTarget(frame('avatar').locator('[data-design-id="approve-image"]'));
    await checkTarget(frame('cover').locator('[data-design-id="reject-image"]'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const clipped = await queue(page).evaluate(section => [...section.querySelectorAll('.moderation-image-card, .moderation-image-preview, .moderation-actions > button, .moderation-image-date, .moderation-image-account')].flatMap(node => {
      const contents = document.createRange();
      contents.selectNodeContents(node);
      const outside = rect => rect.left < -.5 || rect.right > document.documentElement.clientWidth + .5;
      return [node.getBoundingClientRect(), ...contents.getClientRects()].some(outside)
        ? [{ type: node.className, bounds: node.getBoundingClientRect().toJSON() }] : [];
    }));
    assert.deepEqual(clipped, [], 'photo controls and content fit the actual viewport at 200%');
    await shot('moderation-text200-360');
    await text.evaluateAll(nodes => nodes.forEach(node => node.style.removeProperty('font-size')));
    await page.setViewportSize({ width: 390, height: 844 });
    await go('/creator');
    await select('dual');
    await frame('avatar').locator('img').waitFor();
    await clickId(frame('avatar'), 'approve-image');
    await dialog(page).waitFor();
    const reason = dialog(page).getByRole('textbox');
    await reason.fill('x');
    await clickId(dialog(page), 'save-decision');
    assert.ok(await dialog(page).getByRole('alert').isVisible());
    assert.equal(f.submitted.length, 0);
    const approvalReason = locale === 'ar' ? 'صورة شخصية مناسبة للمراجعة.' : 'Profile photo is suitable.';
    await reason.fill(approvalReason);
    assert.equal(await dialog(page).getByRole('alert').count(), 0, 'editing clears obsolete reason validation');
    await shot('approve-dialog');
    f.gates.ambiguousPost = true;
    await clickId(dialog(page), 'save-decision');
    await dialog(page).getByRole('alert').waitFor();
    assert.equal(await reason.isDisabled(), true);
    assert.equal(f.submitted.length, 1);
    await clickId(dialog(page), 'save-decision');
    await dialog(page).waitFor({ state: 'detached' });
    assert.equal(f.submitted.length, 2);
    assert.deepEqual(f.submitted[0], f.submitted[1]);
    assert.equal(f.submitted[0].version, f.avatar.version);
    assert.equal(f.submitted[0].targetId, f.avatar.id);
    assert.equal(f.submitted[0].reason, approvalReason);
    const afterApproval = await f.profile();
    assert.ok(afterApproval.avatarUrl.endsWith(f.avatar.version));
    assert.equal(afterApproval.coverUrl, f.prior.coverUrl);

    await go('/moderation');
    await page.getByRole('button', { name: imageLabel, exact: true }).click();
    await frame('cover').locator('img').waitFor();
    await shot('moderation-cover');
    await clickId(frame('cover'), 'reject-image');
    const rejectionReason = locale === 'ar' ? 'الغلاف لا يناسب هوية ميدان.' : 'Cover does not suit Maydan.';
    await dialog(page).getByRole('textbox').fill(rejectionReason);
    await shot('reject-dialog');
    await clickId(dialog(page), 'save-decision');
    await dialog(page).waitFor({ state: 'detached' });
    await queue(page).locator('.moderation-photo-empty').waitFor();
    await shot('moderation-empty');
    await clickId(queue(page), 'image-queue-refresh');
    await queue(page).locator('.moderation-photo-empty').waitFor();
    await shot('moderation-empty-refreshed');
    assert.equal(f.submitted[2].version, f.cover.version);
    assert.equal(f.submitted[2].targetId, f.cover.id);
    assert.equal(f.submitted[2].reason, rejectionReason);
    const revised = await f.profile();
    assert.equal(revised.coverUrl, f.prior.coverUrl, 'rejecting a pending cover keeps the approved version');
    assert.equal(revised.imageReviews.cover.status, 'rejected');
    assert.equal(revised.imageReviews.cover.rejectionReason, rejectionReason);
    const { actions } = await f.moderator('/audit');
    assert.equal(actions.length, 3, 'initial cover approval plus one browser approval and one browser rejection');
    assert.equal(actions.filter(action => action.reason === approvalReason).length, 1, 'ambiguous retry produces one persisted decision');
    assert.equal(actions.filter(action => action.reason === rejectionReason).length, 1);
    assert.deepEqual(errors, []);
    const result = { engine, locale, passed: true, widths, versionChecks: ['failed replacement preview blocks approval', 'avatar approval verified on current public path', 'cover rejection keeps previous approved public path'], reasonAttempts: f.submitted.map(item => ({ action: item.action, version: item.version, targetId: item.targetId, clientId: item.clientId, reason: item.reason })), moderatorRequests: moderationRequests(), originalVersion, avatarVersion: f.avatar.version, coverVersion: f.cover.version, auditedDecisions: actions.length, screenshotScope: 'Actual browser, local database, synthetic upload fixtures' };
    await writeFile(path.join(out, name + '-summary.json'), JSON.stringify(result, null, 2));
    console.log('PASS ' + name + ': account and role fence, authenticated preview, pending avatar and cover, persisted versioned decisions, idempotent retry');
  } catch (error) {
    await shot('failure');
    await writeFile(path.join(out, name + '-error.txt'), error.stack + '\n' + await page.locator('body').innerText() + '\n' + errors.join('\n'));
    throw error;
  } finally {
    await context.close();
    await f.close();
  }
}

const failures = [];
for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await launcher.launch(engine === 'chromium' && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    for (const locale of ['ar', 'en']) {
      try { await run(browser, engine, locale); }
      catch (error) { failures.push(error); console.error(engine + '/' + locale + ': ' + error.stack); }
    }
  } finally { await browser.close(); }
}
if (failures.length) throw new AggregateError(failures, 'Photo moderation browser verification failed');
const paths = ['src/moderation/ModerationScreen.jsx', 'src/moderation/moderation.css', 'src/moderation/ReviewImage.jsx', 'src/moderation/useModeration.js', 'src/moderation/client.js', 'src/creator/CreatorDashboard.jsx', 'src/shared/i18n/en-social.js', 'tests/e2e/moderation-photos.mjs'];
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async file => [file, hash(await readFile(file))])));
await writeFile(path.join(out, 'source-sha256.json'), JSON.stringify({ browserBundle: hash(bundle.outputFiles[0].contents), files: sourceHashes }, null, 2));
