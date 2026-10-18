// Real social/dialog components with a deterministic local API and visualViewport.
// This checks layout/IME regressions; it does not emulate the physical iOS keyboard.
// Run: node tests/e2e/keyboard.mjs (optional KEYBOARD_SCREENSHOT_DIR, CHROMIUM_PATH).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const me = { id: 'me', name: 'عمر', code: 'MDN-OMAR', avatarPreset: 'falcon' };
const peer = { id: 'friend', name: 'أحمد', code: 'MDN-AHMAD', avatarPreset: 'lion', online: true, conversationId: 'direct-1' };
const messages = [{ seq: 1, senderId: 'friend', clientId: 'first', text: 'جاهز نلعب؟', kind: 'text', createdAt: Date.now() }];
const writes = [];
async function api(url, method, body) {
  if (method !== 'GET') writes.push({ url, method, body });
  if (url === '/api/social/state') return { user: me, friends: [peer], incoming: [], outgoing: [], blocked: [], conversations: [{ id: 'direct-1', user: peer, unreadCount: 0, lastMessage: messages.at(-1) }] };
  if (url.startsWith('/api/social/conversations/direct-1/messages')) {
    if (method === 'POST') { const message = { ...body, seq: messages.length + 1, senderId: 'me', conversationId: 'direct-1', createdAt: Date.now() }; messages.push(message); return { message }; }
    return { messages, peerReadSeq: 0, readSeq: 0, hasMore: false };
  }
  if (url === '/api/social/conversations/direct-1/read') return { readSeq: body.seq };
  if (url === '/api/social/preferences') return { preferences: { enabled: true, previews: false, mutedConversations: [] } };
  if (url === '/api/social/capabilities') return { capabilities: { voiceMessages: false, liveCalls: false, pushNotifications: false } };
  if (url === '/api/social/calls') return { calls: [] };
  if (url === '/api/social/groups') return { groups: [], incoming: [] };
  if (url.startsWith('/api/profiles/')) return { profile: { ...(url.includes('friend') ? peer : me), relationship: url.includes('friend') ? 'friend' : 'self', earnedBadges: [], featuredBadges: [], earnedTitles: [], achievements: [], stats: {} } };
  if (url.startsWith('/api/social/search')) return { users: [{ ...peer, relationship: 'friend' }] };
  if (url === '/api/social/live-ticket') return { error: 'SOCIAL_UNAVAILABLE' };
  return {};
}
const bundle = await build({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
import{SocialProvider}from'./src/social/SocialProvider.jsx';import{LammaProvider}from'./src/social/LammaProvider.jsx';
import{SocialUIProvider}from'./src/social/SocialUIProvider.jsx';import{ProfileProvider}from'./src/profiles/ProfileProvider.jsx';import{SocialHost}from'./src/social/SocialHost.jsx';
import{Modal,Sheet,Button}from'./src/shared/ui/components.jsx';import{BrandFonts}from'./src/shared/brand/art.jsx';
import{Players}from'./src/platform/screens/Players.jsx';
import css from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';import brand from'./src/shared/brand/brand.css';
const request=async(path,options={})=>{const response=await fetch(path,{method:options.method||'GET',headers:{'content-type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});const data=await response.json();if(data.error)throw Object.assign(new Error(data.error),{code:data.error});return data;};
const account={...NULL_ACCOUNT,ready:true,signedIn:true,user:{id:'me',name:'عمر'},requestAuthenticated:request,refresh:async()=>{}};
const basePlatform={sound:{play(){},setDucking(){}},toast(){},settings:{},haptics:{vibrate(){}},storage:{get(){},set(){}}};
function App(){const[modal,setModal]=useState(false),[sheet,setSheet]=useState(false),[players,setPlayers]=useState(false),[roster,setRoster]=useState([]),[value,setValue]=useState('');const platform={...basePlatform,roster,setRoster};return <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><BrandFonts/><style>{tokens}</style><style>{css}</style><style>{brand}</style><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider><main style={{minHeight:'100dvh',padding:24}}><h1>ميدان</h1><Button onClick={()=>setModal(true)}>افتح النموذج</Button><Button onClick={()=>setSheet(true)}>افتح اللوحة</Button><Button onClick={()=>setPlayers(true)}>افتح دفتر اللاعبين</Button><output id="fixture-value">{value}</output>{players&&<Players/>}</main><SocialHost/>{modal&&<Modal title="نموذج الاختبار" onClose={()=>setModal(false)} footer={<Button onClick={()=>setModal(false)}>حفظ النموذج</Button>}><label className="social-search"><input aria-label="حقل النموذج" value={value} onChange={e=>setValue(e.target.value)}/></label>{Array.from({length:25},(_,i)=><p key={i}>تفاصيل الاختبار {i+1}</p>)}</Modal>}<Sheet open={sheet} title="لوحة الاختبار" onClose={()=>setSheet(false)}>{Array.from({length:25},(_,i)=><p key={i}>تفاصيل طويلة {i+1}</p>)}<label className="social-search"><input aria-label="حقل اللوحة" value={value} onChange={e=>setValue(e.target.value)}/></label><Button onClick={()=>setSheet(false)}>حفظ اللوحة</Button></Sheet></ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider></PlatformContext.Provider></AccountContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`;
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(html); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const data = await api(req.url, req.method, raw ? JSON.parse(raw) : undefined);
  res.writeHead(data.error ? 503 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = path.resolve(process.env.KEYBOARD_SCREENSHOT_DIR || '.cache/keyboard-e2e'); await fs.mkdir(out, { recursive: true });
const sentTexts = () => writes.filter(write => write.method === 'POST' && write.url.endsWith('/messages') && write.body.kind !== 'voice');
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function viewport(page, patch) { await page.evaluate(patch => window.setFixtureViewport(patch), patch); await settle(page); await noOverflow(page); }
async function fontSafe(field, label) {
  await field.focus();
  assert.ok(await field.evaluate(el => document.activeElement === el), `${label}: receives focus`);
  assert.ok(await field.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16), `${label}: focused font avoids iOS automatic input zoom`);
}
async function bounds(locator, top, height, label) {
  // React's portal subscription and the viewport listener both settle after
  // animation frames. Wait for the resulting geometry, not a fixed sleep.
  await locator.evaluate((el, { top, height }) => new Promise(resolve => {
    const deadline = performance.now() + 1200;
    const check = () => { const box = el.getBoundingClientRect(); if ((box.y >= top - 2 && box.bottom <= top + height + 2) || performance.now() >= deadline) resolve(); else requestAnimationFrame(check); };
    check();
  }), { top, height });
  const box = await locator.boundingBox(); assert.ok(box, `${label}: has a box`);
  assert.ok(box.y >= top - 2 && box.y + box.height <= top + height + 2, `${label}: within visible viewport (${JSON.stringify(box)}, ${top}+${height})`);
}
async function reachable(page, locator, top, height, label) {
  const previousScroll = await page.evaluate(() => window.scrollY);
  await locator.scrollIntoViewIfNeeded(); await bounds(locator, top, height, label);
  assert.equal(await page.evaluate(() => window.scrollY), previousScroll, `${label}: scrolls the overlay without moving the game page`);
}
async function noOverflow(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow'); }
async function run(browser, name, width, height) {
  messages.splice(1); writes.length = 0;
  const context = await browser.newContext({ viewport: { width, height }, locale: 'ar', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { width: window.innerWidth, height: window.innerHeight, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.setFixtureViewport = patch => { Object.assign(viewport, patch); viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')); };
  });
  try {
    await page.goto(origin + '/#/play/fabraka'); await page.getByRole('button', { name: /الأصدقاء،|افتح الأصدقاء واللّمة/ }).click();
    const search = page.getByRole('textbox', { name: 'البحث في اللّمة', exact: true }); await fontSafe(search, 'friends search');
    await search.fill('أح'); await search.evaluate(el => el.setSelectionRange(1, 1));
    await viewport(page, { height: 440, offsetTop: 24 });
    await bounds(page.locator('.lamma-layer'), 24, 440, 'friends drawer keyboard');
    assert.equal(await search.inputValue(), 'أح'); assert.equal(await search.evaluate(el => el.selectionStart), 1);
    await search.fill(''); await viewport(page, { height, offsetTop: 0 });
    await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).click();
    const composer = page.getByRole('textbox', { name: 'اكتب رسالة', exact: true }); await fontSafe(composer, 'chat composer');
    await composer.fill('أهلًا يا صديقي'); await composer.evaluate(el => el.setSelectionRange(5, 5));
    await page.keyboard.insertText('🎮'); const draft = await composer.inputValue();
    const selection = await composer.evaluate(el => [el.selectionStart, el.selectionEnd]);
    await viewport(page, { height: 420, offsetTop: 32 });
    await bounds(page.locator('.lamma-layer'), 32, 420, 'chat drawer keyboard');
    await bounds(composer, 32, 420, 'chat composer'); await bounds(page.getByRole('button', { name: 'إرسال الرسالة', exact: true }), 32, 420, 'send button');
    assert.equal(await composer.inputValue(), draft); assert.deepEqual(await composer.evaluate(el => [el.selectionStart, el.selectionEnd]), selection);
    assert.ok(await composer.evaluate(el => document.activeElement === el), 'keyboard resize preserves focused textarea');
    await page.screenshot({ path: path.join(out, `${name}-${width}-chat-keyboard.png`), animations: 'disabled' });
    const beforeZoom = await page.locator('.lamma-layer').boundingBox();
    await viewport(page, { height: 210, offsetTop: 80, scale: 2 });
    assert.deepEqual(await page.locator('.lamma-layer').boundingBox(), beforeZoom, 'pinch zoom does not resize/reposition drawer');
    await viewport(page, { height: 420, offsetTop: 32, scale: 1 });
    const beforeSend = sentTexts().length;
    await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true }); await settle(page);
    assert.equal(sentTexts().length, beforeSend, 'IME composition Enter does not send');
    await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, which: 229, bubbles: true }); await settle(page);
    assert.equal(sentTexts().length, beforeSend, 'IME keyCode 229 does not send');
    assert.equal(await composer.inputValue(), draft, 'IME confirmation preserves draft');
    await composer.press('Enter'); await page.waitForFunction(() => document.querySelector('[aria-label="اكتب رسالة"]').value === '');
    await page.getByText(draft, { exact: true }).last().waitFor(); assert.equal(sentTexts().length, beforeSend + 1, 'ordinary Enter sends once');
    await composer.fill('سطر أول'); await composer.press('Shift+Enter'); await page.keyboard.insertText('سطر ثاني');
    assert.equal(await composer.inputValue(), 'سطر أول\nسطر ثاني'); assert.equal(sentTexts().length, beforeSend + 1);
    await viewport(page, { height, offsetTop: 0 }); await bounds(page.locator('.lamma-layer'), 0, height, 'dismissed keyboard restores drawer');
    await page.getByRole('button', { name: 'إغلاق اللّمة والعودة للعبة' }).click();
    await page.getByRole('button', { name: /الأصدقاء،|افتح الأصدقاء واللّمة/ }).click(); await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).click();
    assert.equal(await composer.inputValue(), 'سطر أول\nسطر ثاني', 'closing/reopening retains Arabic draft');
    await page.getByRole('button', { name: 'خيارات المحادثة', exact: true }).click();
    await page.getByRole('button', { name: 'دعوة للعبة', exact: true }).click();
    const invite = page.getByRole('dialog', { name: 'ادعُه للّعب', exact: true }); const code = invite.getByRole('textbox', { name: 'رمز الغرفة' });
    await fontSafe(code, 'game invite code'); await code.fill('123456'); await viewport(page, { height: 360, offsetTop: 45 });
    await bounds(invite, 45, 360, 'invite modal'); await bounds(invite.getByRole('button', { name: 'إرسال الدعوة', exact: true }), 45, 360, 'invite submit');
    await page.keyboard.press('Escape'); await invite.waitFor({ state: 'detached' });
    await viewport(page, { height, offsetTop: 0 }); await page.getByRole('button', { name: 'العودة للّمة', exact: true }).click();
    await page.getByRole('button', { name: 'أضف صديقًا', exact: true }).click();
    const addSearch = page.getByRole('textbox', { name: 'ابحث بالاسم أو رمز الصديق', exact: true }); await fontSafe(addSearch, 'add friend search');
    await addSearch.fill('أحمد 🎮'); await addSearch.evaluate(el => el.setSelectionRange(2, 2)); await viewport(page, { height: 390, offsetTop: 26 });
    assert.ok(await addSearch.evaluate(el => document.activeElement === el), 'search input keeps focus while typing');
    await bounds(page.getByRole('dialog', { name: 'أضف صديقًا', exact: true }), 26, 390, 'search modal');
    await page.keyboard.press('Escape'); await addSearch.waitFor({ state: 'detached' });
    await viewport(page, { height, offsetTop: 0 }); await page.getByRole('button', { name: 'اللّمات', exact: true }).click();
    await page.getByRole('button', { name: /لمّة جديدة/ }).click();
    const group = page.getByRole('dialog', { name: 'لمّة جديدة', exact: true }); const groupName = group.getByRole('textbox', { name: 'اسم اللّمة' });
    await fontSafe(groupName, 'group name'); await groupName.fill('شلّة الأبطال 🦁'); await groupName.evaluate(el => el.setSelectionRange(3, 3));
    await viewport(page, { height: 390, offsetTop: 30 }); await bounds(group, 30, 390, 'group modal');
    const groupSubmit = group.getByRole('button', { name: 'اجمع أصحابك', exact: true });
    await reachable(page, groupSubmit, 30, 390, 'group submit after scroll');
    assert.ok(await group.evaluate(el => [el, el.querySelector('.modal-body')].some(node => node.scrollHeight > node.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY))), 'long group content remains scrollable above keyboard');
    await groupName.press('End'); await page.keyboard.insertText('!'); assert.ok((await groupName.inputValue()).endsWith('!'));
    await page.screenshot({ path: path.join(out, `${name}-${width}-group-keyboard.png`), animations: 'disabled' });
    await page.keyboard.press('Escape'); await group.waitFor({ state: 'detached' }); await viewport(page, { height, offsetTop: 0 });
    await page.getByRole('button', { name: 'إغلاق اللّمة والعودة للعبة' }).click();
    await page.getByRole('button', { name: 'افتح النموذج', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'نموذج الاختبار', exact: true }); await fontSafe(modal.getByRole('textbox', { name: 'حقل النموذج' }), 'shared modal input');
    await viewport(page, { height: 350, offsetTop: 37 }); await bounds(modal, 37, 350, 'shared modal');
    const modalSave = modal.getByRole('button', { name: 'حفظ النموذج', exact: true });
    await reachable(page, modalSave, 37, 350, 'modal footer after scroll');
    assert.ok(await modal.evaluate(el => [el, el.querySelector('.modal-body')].some(node => node.scrollHeight > node.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY))), 'modal content scrolls');
    const modalBox = await modal.boundingBox(); await viewport(page, { height: 175, offsetTop: 60, scale: 2 });
    assert.deepEqual(await modal.boundingBox(), modalBox, 'pinch zoom does not resize shared modal');
    await viewport(page, { height, offsetTop: 0, scale: 1 }); await bounds(modal, 0, height, 'modal restored');
    await modal.getByRole('button', { name: 'حفظ النموذج', exact: true }).click(); await modal.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'افتح اللوحة', exact: true }).click(); const sheet = page.getByRole('dialog', { name: 'لوحة الاختبار', exact: true });
    const sheetInput = sheet.getByRole('textbox', { name: 'حقل اللوحة' }); await fontSafe(sheetInput, 'shared sheet input');
    await sheetInput.fill('نص عربي يحفظ التركيز 🎉'); await viewport(page, { height: 355, offsetTop: 42 });
    await bounds(sheet, 42, 355, 'shared sheet'); await reachable(page, sheetInput, 42, 355, 'sheet input after scroll');
    const sheetSave = sheet.getByRole('button', { name: 'حفظ اللوحة', exact: true }); await reachable(page, sheetSave, 42, 355, 'sheet save after scroll');
    await page.screenshot({ path: path.join(out, `${name}-${width}-sheet-keyboard.png`), animations: 'disabled' });
    await sheetSave.click(); await sheet.waitFor({ state: 'detached' }); await viewport(page, { height, offsetTop: 0 });
    await page.getByRole('button', { name: 'افتح دفتر اللاعبين', exact: true }).click();
    const playerName = page.getByRole('textbox', { name: 'اسم اللاعب', exact: true }); await fontSafe(playerName, 'player name'); await playerName.fill('سارة 🎮');
    await playerName.dispatchEvent('compositionstart', { data: 'سارة' });
    await playerName.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }); await settle(page);
    assert.equal(await page.locator('.score-row').count(), 0, 'player composition tracking prevents premature add');
    await playerName.dispatchEvent('compositionend', { data: 'سارة' });
    await playerName.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, which: 229, bubbles: true }); await settle(page);
    assert.equal(await page.locator('.score-row').count(), 0, 'player Safari IME key does not add');
    await playerName.press('Enter'); await page.locator('.score-row').waitFor();
    assert.equal(await page.locator('.score-row').count(), 1, 'player ordinary Enter adds once'); assert.equal(await playerName.inputValue(), '');
    await noOverflow(page); assert.deepEqual(errors, [], 'no page errors');
    console.log(`PASS ${name} ${width}×${height}: focused fonts, Arabic/emoji drafts, IME, visual viewport, dialogs, sheet and zoom`);
  } catch (error) {
    await page.screenshot({ path: path.join(out, `${name}-${width}-failure.png`), animations: 'disabled' }).catch(() => {});
    await fs.writeFile(path.join(out, `${name}-${width}-failure.json`), JSON.stringify(await page.evaluate(() => ({ viewport: { height: visualViewport.height, top: visualViewport.offsetTop, scale: visualViewport.scale }, overlays: [...document.querySelectorAll('.dialog-host,.modal-layer,.modal,.sheet')].map(el => ({ tag: el.className, inline: el.style.cssText, rect: el.getBoundingClientRect().toJSON(), height: getComputedStyle(el).height, maxHeight: getComputedStyle(el).maxHeight })) })), null, 2));
    throw error;
  } finally { await context.close(); }
}
let browser;
try {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const [width, height] of [[375, 812], [390, 844]]) await run(browser, 'chromium', width, height);
  await browser.close(); browser = null;
  try { await fs.access(webkit.executablePath()); }
  catch { console.log('SKIP WebKit: browser binary is not installed (no download attempted).'); }
  if (await fs.access(webkit.executablePath()).then(() => true, () => false)) {
    browser = await webkit.launch(); for (const [width, height] of [[375, 812], [390, 844]]) await run(browser, 'webkit', width, height);
  }
  console.log(`Screenshots: ${out}`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
