// Actual component/geometry/motion tests with real curated catalog artwork.
// Only the uploaded portrait is an owned synthetic test image.
// No account, entitlement, room service, purchase or provider is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const root = process.cwd();
const output = path.join(root, '.cache/plus-identity-browser');
await mkdir(output, { recursive: true });
const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{ProfileAvatar}from'./src/profiles/ProfileAvatar.jsx';import{PlayerName}from'./src/profiles/PlayerIdentity.jsx';import identity from'./src/profiles/identity.css';
const initial={id:'member',name:'أحمد',theme:'teal',avatarUrl:'/api/profiles/member/images/avatar/'+'a'.repeat(64),cosmetics:{frameId:'sahra.frame',nameColorId:'noir.nameColor',coverId:'artist.cover',badge:false}};
function Harness(){const[user,setUser]=useState(initial),[room,setRoom]=useState({code:'123456',game:'mafia',phase:'lobby',members:[{id:'host',name:'المضيف',profile:initial}]}),[status,setStatus]=useState('connected');window.identityTest={user:patch=>setUser(u=>({...u,...patch,cosmetics:{...u.cosmetics,...patch.cosmetics}})),join:(id)=>setRoom(r=>({...r,members:[...r.members,{id,name:'ضيف '+id,profile:{...initial,name:'ضيف '+id,cosmetics:{...initial.cosmetics,entranceId:'sahra.entrance'}}}]})),phase:phase=>setRoom(r=>({...r,phase})),status:setStatus,roomCode:code=>setRoom(r=>({...r,code}))};return <><style>{identity}</style><style>{'body{margin:0;padding:25px;background:#fff6e5;color:#30203f;font-family:Arial}*{box-sizing:border-box}.cases{display:flex;align-items:center;gap:34px;flex-wrap:wrap;padding:24px}.status-wrap{position:relative;display:inline-flex}.fixture-status{position:absolute;right:-3px;bottom:-3px;width:9px;height:9px;border:2px solid white;border-radius:50%;background:rgb(0,140,90);z-index:4}.room{position:relative;min-height:180px;border:1px solid #ccc;margin-top:30px}.spacer{height:1200px}.offscreen{padding:30px}.long{max-width:100%;margin-top:20px}'}</style><h1>اختبار هوية محلي</h1><div className='cases'>{[24,40,100].map(size=><span className='status-wrap' data-case={size} key={size}><ProfileAvatar user={user} size={size}/><i className='fixture-status'/></span>)}</div><div id='name'><PlayerName user={user} card/></div><div className='long'><PlayerName user={{...user,name:'اسم طويل جدًا للاعب الميدان من دون قص معلومة مهمة'}} card/></div><div className='spacer'/><div className='offscreen'><ProfileAvatar user={user} size={40}/></div></>};createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);`;
const built = await build({ stdin: { contents: source, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin'), 'process.env.NODE_ENV': JSON.stringify('production') }, logLevel: 'silent' });
const testImage = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#06768b"/><circle cx="50" cy="40" r="22" fill="#fff6e5"/><path d="M12 100a38 38 0 0 1 76 0" fill="#fff6e5"/></svg>');
const testFrame = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="39" fill="none" stroke="#ffbf36" stroke-width="12"/><path d="M50 0 58 12 50 20 42 12Z" fill="#06768b"/></svg>');

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`shared identity renders and retires decoration correctly in ${name}`, { timeout: 45000 }, async () => {
  const broken = new Set();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (broken.has(url.pathname)) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); return; }
    if (url.pathname === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(built.outputFiles[0].contents); return; }
    if (url.pathname.startsWith('/assets/plus/')) {
      const target = path.resolve(root, 'public', '.' + url.pathname);
      assert.ok(target.startsWith(path.resolve(root, 'public/assets/plus') + path.sep));
      try { const bytes = await readFile(target); res.setHeader('content-type', target.endsWith('.svg') ? 'image/svg+xml' : 'image/webp'); res.setHeader('cache-control', 'no-store'); res.end(bytes); }
      catch { res.writeHead(404); res.end(); }
      return;
    }
    if (url.pathname.startsWith('/api/profiles/')) {
      res.setHeader('content-type', 'image/svg+xml'); res.setHeader('cache-control', 'no-store'); res.end(testImage); return;
    }
    res.setHeader('content-type', 'text/html;charset=utf-8'); res.end('<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await engine.launch({ headless: true });
  const observations = { engine: name, checks: [], physicalDevice: false, actualCatalogArtwork: true, uploadedPortraitFixture: true };
  const errors = [], outside = [], requests = [];
  let activePage, stage = 'successful-artwork';
  const remember = value => { requests.push(value); if (requests.length > 80) requests.shift(); };
  const attach = async (page, context) => {
    page.on('pageerror', error => errors.push(error.message.slice(0, 500)));
    page.on('request', request => remember({ context, event: 'request', path: new URL(request.url()).pathname.slice(0, 180) }));
    page.on('response', response => remember({ context, event: 'response', path: new URL(response.url()).pathname.slice(0, 180), status: response.status() }));
    await page.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { outside.push('external-request'); return route.abort(); } return route.continue(); });
  };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
    activePage = page;
    await attach(page, 'successful-artwork');
    await page.goto(origin);
    await page.locator('[data-case="100"] .player-avatar-frame img').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.cases img')].every(image => image.complete && image.naturalWidth > 0));
    for (const [size, detail] of [[24, 'small'], [40, 'medium'], [100, 'large']]) {
      const value = await page.locator(`[data-case="${size}"] .plus-avatar-shell`).evaluate(element => {
        const portrait = element.querySelector('.player-avatar-portrait'), frame = element.querySelector('.player-avatar-frame');
        return { slot: element.getBoundingClientRect().width, portrait: portrait.getBoundingClientRect().width, frame: frame.getBoundingClientRect().width, overflow: getComputedStyle(element).overflow, crop: getComputedStyle(portrait).overflow, pointer: getComputedStyle(frame).pointerEvents, detail: element.dataset.frameDetail, url: portrait.querySelector('img').src, status: getComputedStyle(element.parentElement.querySelector('.fixture-status')).backgroundColor };
      });
      assert.equal(value.slot, size); assert.equal(value.detail, detail); assert.ok(value.frame > size); assert.ok(value.portrait < size); assert.equal(value.overflow, 'visible'); assert.equal(value.crop, 'hidden'); assert.equal(value.pointer, 'none'); assert.match(value.url, /\/api\/profiles\/member\/images\/avatar\//); assert.equal(value.status, 'rgb(0, 140, 90)');
    }
    observations.checks.push('24/40/100 LOD, outer art separate from inner crop, uploaded avatar preserved, status indicator untouched.');
    stage = 'membership-and-name';
    await page.screenshot({ path: path.join(output, name + '-actual-artwork.png') });
    assert.equal(await page.locator('.player-membership-badge').count(), 0);
    await page.evaluate(() => localStorage.setItem('premium', 'true')); assert.equal(await page.locator('.player-membership-badge').count(), 0);
    await page.evaluate(() => window.identityTest.user({ cosmetics: { badge: true } })); await page.locator('#name .player-membership-badge').waitFor();
    assert.match(await page.locator('#name .player-name-card>img').getAttribute('src'), /noir-name-card/);
    observations.checks.push('Effective membership badge is independent of gold frame/localStorage; name card stays independent of cover.');
    stage = 'motion-and-reduced-motion';
    await page.waitForFunction(() => document.querySelector('[data-case="40"] .plus-avatar-shell').dataset.identityMotion === 'running');
    assert.equal(await page.locator('[data-case="40"] .player-avatar-frame-light').evaluate(element => getComputedStyle(element).animationPlayState), 'running');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('[data-case="40"] .player-avatar-frame-light').evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => document.documentElement.dataset.reducedMotion = 'true');
    assert.equal(await page.locator('[data-case="40"] .player-avatar-frame-light').evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.evaluate(() => delete document.documentElement.dataset.reducedMotion);
    assert.equal(await page.locator('.offscreen .plus-avatar-shell').getAttribute('data-identity-motion'), 'paused');
    await page.locator('.offscreen').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.offscreen .plus-avatar-shell').dataset.identityMotion === 'running');
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('.offscreen .plus-avatar-shell').dataset.identityMotion === 'paused');
    observations.checks.push('Actual reduced-motion CSS/system setting and IntersectionObserver pause decorative motion offscreen.');
    stage = 'successful-character';
    await page.evaluate(() => window.identityTest.user({ cosmetics: { avatarId: 'artist.avatar' } }));
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.cases .player-avatar-portrait>img')];
      return images.length === 3 && images.every(image => image.src.includes('artist-avatar') && image.complete && image.naturalWidth > 0);
    });
    assert.equal(await page.locator('[data-case="40"] .player-avatar-portrait img').evaluate(element => getComputedStyle(element).objectFit), 'contain');
    observations.checks.push('Explicit character equip decodes all three actual catalog portraits and uses contain.');

    // Start the unavailable-art scenario without any previously successful
    // decoded/in-flight artist image. Toggling a server to404 does not evict a
    // resource already held by the first browser context.
    const failedPaths = ['artist-avatar.webp', 'artist-frame-small.svg', 'artist-frame-medium.webp', 'artist-frame.webp'].map(file => '/assets/plus/v2/' + file).concat('/assets/plus/v1/artist.webp');
    for (const pathname of failedPaths) broken.add(pathname);
    stage = 'fresh-failure-context';
    const failureContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
    const failurePage = await failureContext.newPage();
    activePage = failurePage;
    await attach(failurePage, 'unavailable-artwork');
    await failurePage.goto(origin);
    await failurePage.locator('[data-case="100"] .player-avatar-frame img').waitFor();
    await failurePage.waitForFunction(() => [...document.querySelectorAll('.cases img')].every(image => image.complete && image.naturalWidth > 0));
    stage = 'actual-404-responses';
    const failedResponses = failedPaths.map(pathname => failurePage.waitForResponse(response => new URL(response.url()).pathname === pathname && response.status() === 404, { timeout: 30000 }));
    await Promise.all([
      ...failedResponses,
      failurePage.evaluate(() => window.identityTest.user({ cosmetics: { avatarId: 'artist.avatar', frameId: 'artist.frame' } })),
    ]);
    stage = 'uploaded-portrait-and-css-frame-fallback';
    await failurePage.waitForFunction(() => {
      const images = [...document.querySelectorAll('.cases .player-avatar-portrait>img')];
      const frames = [...document.querySelectorAll('.cases .player-avatar-frame')];
      return images.length === 3 && images.every(image => image.src.includes('/api/profiles/member/') && image.complete && image.naturalWidth > 0)
        && frames.length === 3 && frames.every(frame => frame.classList.contains('is-fallback') && !frame.querySelector('img'));
    });
    observations.failedArtworkResponses = failedPaths.map(path => ({ path, status: 404 }));
    observations.checks.push('Fresh context received all five404s; new/legacy portraits return to three complete uploaded images and all three frames render CSS fallback without broken img elements.');
    for (const [context, checkedPage] of [['successful-artwork', page], ['unavailable-artwork', failurePage]]) {
      activePage = checkedPage;
      for (const [width, height] of [[320, 844], [390, 844], [844, 390]]) {
        stage = `${context}-geometry-${width}`;
        await checkedPage.setViewportSize({ width, height });
        assert.equal(await checkedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${context} overflow at${width}`);
      }
    }
    stage = 'final-evidence';
    activePage = page;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, name + '-identity.png') });
    assert.deepEqual(errors, []); assert.deepEqual(outside, []);
    observations.passed = true;
    await import('node:fs/promises').then(fs => fs.writeFile(path.join(output, name + '.json'), JSON.stringify(observations, null, 2)));
  } catch (error) {
    let timer;
    const dom = await Promise.race([
      activePage?.evaluate(() => [...document.querySelectorAll('.cases [data-case]')].slice(0, 3).map(element => ({
        size: element.dataset.case,
        frame: element.querySelector('.player-avatar-frame')?.className,
        images: [...element.querySelectorAll('img')].slice(0, 5).map(image => ({ path: new URL(image.src).pathname.slice(0, 180), complete: image.complete, naturalWidth: image.naturalWidth })),
      }))).catch(() => null),
      new Promise(resolve => { timer = setTimeout(() => resolve('diagnostic-timeout'), 1000); }),
    ]).finally(() => clearTimeout(timer));
    console.error('PLUS_IDENTITY_FAILURE ' + JSON.stringify({ engine: name, stage, requests, dom, errors: errors.slice(0, 8), outside: outside.length }));
    throw error;
  } finally {
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
