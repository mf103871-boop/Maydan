import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { mediaVersions } from '../scripts/lib.mjs';
import { chromium, webkit } from 'playwright';
import { approvedBadeehaArtwork, categoryBoardFixture } from './fixtures/badeeha-category-art.mjs';

const output = process.env.BADEEHA_LOCAL_EVIDENCE_DIR || path.resolve('.cache/badeeha-local-studio');
await mkdir(output, { recursive: true });
const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Game from'./src/games/badeeha/App.js';
import{BrandFonts}from'./src/shared/brand/art.jsx';import{PlusStyles}from'./src/plus/PlusStyles.jsx';import{setUiLocale,untranslatedUiKeys}from'./src/shared/i18n/core.js';
import{getCategories}from'./src/data/game-content.js';import logic,{BANK_CONTENT_VERSION}from'./src/games/badeeha/logic.js';import{betaTeam}from'./src/games/badeeha/teams.js';import{BADEEHA_KEYS}from'./src/games/badeeha/keys.js';
import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import brand from'./src/shared/brand/brand.css';
const locale=new URLSearchParams(location.search).get('locale')||'ar';await setUiLocale(locale);document.documentElement.dataset.reducedMotion='true';const cats=getCategories(locale),version=locale==='ar'?'legacy-ar':'new-en';
const key=name=>BADEEHA_KEYS[name]+(locale==='ar'?'':':'+locale+':'+version);const names=locale==='ar'?['فريق ليان','فريق عمر','فريق سارة','فريق نور']:['Layan team','Omar team','Sara team','Noor team'];
const baseIds=['science','geo','sports','history','animals','general'];const noop=()=>{};let fixture;
function App(){const[revision,setRevision]=useState(0),[preview,setPreview]=useState(null);fixture=window.fixture={missing:untranslatedUiKeys,names,categories:cats.map(c=>({id:c.id,name:c.name})),key,read:name=>JSON.parse(localStorage.getItem(key(name))||'null'),apiCalls:window.apiCalls||(window.apiCalls=[]),
reset:({screen='setup',count=2,type='plain',long=false}={})=>{const category=cats.find(c=>c.id==='science'),media=type==='plain'?category:cats.find(c=>c.qs.some(q=>q.type===type)),ids=[media.id,...baseIds.filter(id=>id!==media.id)].slice(0,6),deck=logic.buildDeck(cats,ids,{},logic.MODES.standard.tiers,30),chosen=media.qs.find(q=>q.type===type&&(type!=='image'||!q.effect||q.effect==='none'));if(chosen){deck[media.id][0]={...chosen,qid:logic.questionId(media.id,chosen,media.qs.indexOf(chosen))};}
const teams=Array.from({length:count},(_,i)=>({...betaTeam(i,long?'Blue Comet Team No '+(i+1)+' ليان':names[i]),score:i===0?1200:i===1?800:0,correct:i===0?6:4,steals:i===0?1:0}));setPreview({screen:screen==='reveal'?'question':screen,teams,selectedCategories:ids,deck,current:['question','reveal'].includes(screen)?{categoryId:media.id,index:0}:null,revealed:screen==='reveal',finalResult:screen==='result'?{teams,winner:teams[0].name,answered:30,total:30,mode:'standard'}:null});setRevision(x=>x+1);return revision+1;},
real:()=>{setPreview(null);setRevision(x=>x+1);},seedMedia:type=>{const category=(type==='image'?cats.find(c=>c.id==='placefinder'):null)||cats.find(c=>c.qs.some(q=>q.type===type&&(type!=='image'||!q.effect||q.effect==='none'))),ids=[category.id,...baseIds.filter(id=>id!==category.id)].slice(0,6),deck=logic.buildDeck(cats,ids,{},logic.MODES.standard.tiers,20),q=(type==='image'?category.qs.find(q=>q.qid==='placefinder-400-902'):null)||category.qs.find(q=>q.type===type&&(type!=='image'||!q.effect||q.effect==='none'));deck[category.id][0]={...q,qid:logic.questionId(category.id,q,category.qs.indexOf(q))};const saved={version:2,contentVersion:BANK_CONTENT_VERSION,contentLocale:locale,contentPackVersion:version,teams:names.slice(0,2).map((n,i)=>betaTeam(i,n)),selectedCategories:ids,deck:logic.deckToIds(deck),screen:'question',current:{categoryId:category.id,index:0},mode:'standard',roundSize:20,timerLength:60,timeLeft:60,turn:0,used:{},effect:{double:false,two:false},hintsUsed:0,paused:true,revealed:false};if(!logic.isValidSession(cats,saved))throw Error('Invalid fixture');localStorage.setItem(key('active'),JSON.stringify(saved));return{qid:deck[category.id][0].qid,answer:q.a};}}
const api={contentLocale:locale,contentVersion:version,designPreview:preview,settings:{soundOn:true,soundVolume:.3,hapticsOn:false,reducedMotion:true},sound:{play:noop,music:{scene:noop,releaseScene:noop}},authorizeMatch:async args=>{fixture.apiCalls.push({type:'authorize',args});return window.authorized!==false},matchStart:()=>fixture.apiCalls.push({type:'start'}),matchResume:()=>fixture.apiCalls.push({type:'resume'}),matchEnd:()=>fixture.apiCalls.push({type:'end'})};
return <><BrandFonts/><PlusStyles/><style>{tokens+ui+brand}</style><style>{'body{margin:0;background:#fff8f0} .m-root{--font:Maydan Round,system-ui} '}</style><main data-fixture-version={revision}><Game key={revision} api={api} entry="setup"/></main></>};createRoot(document.getElementById('root')).render(<App/>);`;
const built = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', logLevel: 'silent', define:{__MAYDAN_MEDIA_VERSIONS__:JSON.stringify(await mediaVersions())}, loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.mp3': 'dataurl' } });
const bundle = built.outputFiles[0].contents, bundleSha256 = createHash('sha256').update(bundle).digest('hex');
let mediaFailure = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(bundle); return; }
  if (url.pathname.startsWith('/media/')) {
    if (mediaFailure && !url.pathname.includes('badeeha-covers')) { res.writeHead(503); res.end(); return; }
    const relative = path.normalize(url.pathname).replace(/^[/\\]+/, '');
    if (relative.includes('..')) { res.writeHead(400); res.end(); return; }
    let data, extension = path.extname(relative);
    try { data = await readFile(path.join(process.cwd(), 'public', relative)).catch(()=>readFile(path.join(process.cwd(),relative))); }
    catch { extension = /\.(mp3|ogg|wav|m4a)$/.test(relative) ? '.mp3' : '.png'; data = await readFile(path.resolve('tests/fixtures/media/demo/' + (extension === '.mp3' ? 'siren.mp3' : 'stripes.png'))); }
    res.writeHead(200, { 'content-type': extension === '.webp' ? 'image/webp' : extension === '.mp3' ? 'audio/mpeg' : 'image/png' }); res.end(data); return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/bundle.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
test.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
const settle = page => page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].filter(img => img.getClientRects().length && img.getBoundingClientRect().top < innerHeight).map(img => img.decode().catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
const sel = id => `[data-design-id="${id}"]`;
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) for (const locale of ['ar', 'en']) test(`${name}/${locale}: actual local component states, responsive targets, real round and resume`, { timeout: 120000 }, async () => {
  const browser = await engine.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }), errors = [], evidence = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const stage = async options => { const v = await page.evaluate(options => window.fixture.reset(options), options); await page.waitForFunction(v => document.querySelector('[data-fixture-version]')?.dataset.fixtureVersion === String(v), v); await settle(page); if(options.screen==='question')await page.locator(sel('pause')).click(); await page.evaluate(() => scrollTo(0, 0)); };
  const capture = async label => {
    await settle(page);
    const geometry = await page.evaluate(() => ({ heading: (()=>{const title=document.querySelector('.bl-heading h1 span'),actions=[...document.querySelectorAll('.bl-heading button')];return title?{title:title.getBoundingClientRect().toJSON(),actions:actions.map(el=>el.getBoundingClientRect().toJSON())}:null})(), overflow: document.documentElement.scrollWidth > innerWidth + 1, scores: document.querySelectorAll('.m-question-screen>.bl-scores').length, targets: [...document.querySelectorAll('.m-local-studio button,.m-local-studio input')].filter(el => el.getClientRects().length && !el.closest('[aria-hidden=true]')).map(el => { const r = el.getBoundingClientRect(); return { id: el.dataset.designId || el.textContent, width: r.width, height: r.height }; }) }));
    const internal = await page.evaluate(() => {
      const textRects = el => {
        if (!el) return [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), boxes = [];
        while (walker.nextNode()) if (walker.currentNode.textContent.trim()) { const range = document.createRange(); range.selectNodeContents(walker.currentNode); boxes.push(...[...range.getClientRects()].map(r => r.toJSON())); }
        return boxes;
      };
      const intersects = (a,b) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
      const category = textRects(document.querySelector('.bl-category-name')), award = textRects(document.querySelector('.m-tier-text'));
      const modes = [...document.querySelectorAll('.m-mode-grid .m-choice b')].map(textRects);
      const judgeClipped=[...document.querySelectorAll('.m-judge-grid button>b')].some(el=>{const b=el.getBoundingClientRect(),points=el.parentElement.querySelector('.bl-judge-award').getBoundingClientRect();return textRects(el).some(r=>r.left<b.left-1||r.right>b.right+1||intersects(r,points));});
      const aids = [...document.querySelectorAll('.m-tools button:not(:disabled) small')].map(el => {
        let opacity = 1; for(let n=el;n;n=n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
        const rgb = getComputedStyle(el).color.match(/[\d.]+/g).slice(0,3).map(Number), bg = [255,253,249];
        const lum = color => color.map(c => { const v=c/255; return v<=.04045?v/12.92:((v+.055)/1.055)**2.4; }).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const composited = rgb.map((c,i)=>c*opacity+bg[i]*(1-opacity));
        return { text:el.textContent, opacity, contrast:(lum(bg)+.05)/(lum(composited)+.05) };
      });
      return { judgeClipped, modeLineCounts:modes.map(rects=>new Set(rects.map(r=>Math.round(r.top))).size), categoryOverlap:category.some(a=>award.some(b=>intersects(a,b))), modesOverlap:modes.some((set,i)=>modes.slice(i+1).some(other=>set.some(a=>other.some(b=>intersects(a,b))))), aids };
    });
    geometry.internal = internal;
    assert.equal(internal.categoryOverlap, false, label + ': category and points text must not overlap');
    assert.equal(internal.judgeClipped,false,label+': complete team names remain distinct from awarded points');
    assert.equal(internal.modesOverlap, false, label + ': mode labels must not overlap');
    if(!label.includes('text200'))for(const count of internal.modeLineCounts)assert.ok(count<=1,label+': ordinary mode name must fit one line');
    for(const aid of internal.aids) assert.ok(aid.contrast>=4.5,label + ': available aid text contrast ' + JSON.stringify(aid));
    assert.equal(geometry.overflow, false, label + ': no horizontal overflow');
    if(geometry.heading)for(const action of geometry.heading.actions){const title=geometry.heading.title;assert.ok(action.bottom<=title.top+1||action.top>=title.bottom-1||action.right<=title.left+1||action.left>=title.right-1,label+': heading controls have their own space '+JSON.stringify({title,action}));}
    for (const target of geometry.targets) assert.ok(target.width >= 47.5 && target.height >= 47.5, label + ': ' + target.id + ' ' + target.width + 'x' + target.height);
    await page.screenshot({ path: path.join(output, `${name}-${locale}-${label}-viewport.png`), fullPage: false, animations: 'disabled' });
    await page.screenshot({ path: path.join(output, `${name}-${locale}-${label}.png`), fullPage: true, animations: 'disabled' }); evidence.push({ label, ...geometry });
  };
  try {
    await page.goto(origin + '/?locale=' + locale); await page.locator(sel('team-name')).first().waitFor();
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const screen of ['setup', 'board', 'question', 'reveal', 'result']) { await stage({ screen }); await capture(width + '-' + screen); if(width===390&&screen==='setup'){await page.locator(sel('setup-jump')).nth(1).click();await capture('390-packages');} if (screen === 'question') assert.equal(await page.locator(sel('answer')).count(), 0); }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const count of [3, 4]) { await stage({ screen: 'board', count }); assert.equal(await page.locator('.bl-score').count(), count); await capture('390-board-' + count + 'teams'); }
    for (const width of [360, 390, 430]) for (const screen of ['setup', 'question', 'reveal', 'result']) {
      await page.setViewportSize({ width, height: 844 });
      await stage({ screen, long: true });
      await page.evaluate(() => { const sizes = [...document.querySelectorAll('.m-local-studio *')].map(el => [el, parseFloat(getComputedStyle(el).fontSize), getComputedStyle(el).lineHeight]); for (const [el, size, line] of sizes) { el.style.fontSize = size * 2 + 'px'; if (line !== 'normal') el.style.lineHeight = parseFloat(line) * 2 + 'px'; } });
      if(screen!=='result')await page.locator('.bl-heading.is-large-text').waitFor();
      await capture(width + '-' + screen + '-text200');
    }
    // A genuine locally created round: no preview state or patched game commands.
    await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.locator(sel('team-name')).first().waitFor();
    const names = await page.evaluate(() => fixture.names), categories = await page.evaluate(() => fixture.categories);
    await page.locator(sel('team-count')).nth(2).click(); assert.equal(await page.locator(sel('team-name')).count(), 4); await page.locator(sel('team-count')).first().click();
    for (let i = 0; i < 2; i++) await page.locator(sel('team-name')).nth(i).fill(names[i]);
    await page.locator(sel('round-size')).first().click(); await page.locator(sel('mode-choice')).nth(1).click();
    for (const id of ['science', 'geo', 'sports', 'history', 'animals', 'general']) { await page.locator(sel('category-search')).fill(categories.find(c => c.id === id).name); await page.locator(sel('category-card')).filter({ has: page.locator(`[data-category-art="${id}"]`) }).click(); }
    await page.locator(sel('category-search')).fill(''); await page.evaluate(()=>{window.authorized=false}); await page.locator(sel('start')).click(); await page.waitForFunction(()=>fixture.apiCalls.some(c=>c.type==='authorize')); assert.equal(await page.locator('.m-board-grid').count(),0); assert.equal(await page.evaluate(()=>fixture.read('active')),null); await page.evaluate(()=>{window.authorized=true}); await page.locator(sel('start')).click(); await page.locator('.m-board-grid').waitFor();
    await capture('real-board-start'); assert.equal(await page.locator(sel('tier')).count(), 20);
    await page.locator(sel('tier')).first().click(); await page.locator(sel('reveal')).waitFor();
    const points = Number(await page.locator('.m-award').innerText());
    await page.locator(sel('tool')).first().click(); await page.locator(sel('tool')).nth(1).click(); await page.locator(sel('tool')).nth(2).click();
    assert.equal(await page.locator(sel('tool') + ':disabled').count(), 3);
    await page.locator(sel('reveal')).click(); await page.locator(sel('answer')).waitFor();
    const visibleAnswer = await page.locator(sel('answer') + ' strong').innerText(); assert.ok(visibleAnswer.length);
    await page.locator(sel('answer-toggle')).click(); assert.equal(await page.locator(sel('answer')).count(), 0); await page.locator(sel('answer-toggle')).click(); assert.equal(await page.locator(sel('answer') + ' strong').innerText(), visibleAnswer);
    await page.locator(sel('judge-team')).first().click(); await page.locator('.m-board-grid').waitFor();
    await page.waitForFunction(() => fixture.read('active')?.screen === 'board' && Object.keys(fixture.read('active').used).length === 1);
    const saved = await page.evaluate(() => fixture.read('active')); assert.equal(saved.teams[0].score, points * 2); assert.equal(saved.teams[0].tools.double, false);
    await page.reload(); await page.locator(sel('resume')).click(); await page.locator('.m-board-grid').waitFor();
    assert.equal(await page.locator(sel('tier') + ':disabled').count(), 1); assert.ok((await page.locator('.bl-scores').innerText()).includes(String(points * 2)));
    await page.locator(sel('undo')).click(); await page.waitForFunction(() => document.querySelectorAll('[data-design-id=tier]:disabled').length === 0); assert.equal(await page.locator('.bl-score .m-points').first().innerText(), '0');
    // Complete every question through the UI, with alternating correct teams.
    for (let n = 0; n < 20; n++) { await page.locator(sel('tier') + ':not(:disabled)').first().click(); await page.locator(sel('reveal')).click(); await page.locator(sel('judge-team')).nth(n % 2).click(); await page.locator(n === 19 ? '.m-result' : '.m-board-grid').waitFor(); }
    await capture('real-match-result'); assert.equal(await page.evaluate(() => fixture.read('results')[0].answered), 20); assert.equal(await page.evaluate(() => Object.keys(fixture.read('history')).length), 20);
    const calls = await page.evaluate(() => fixture.apiCalls); assert.ok(calls.some(c => c.type === 'authorize')); assert.ok(calls.some(c => c.type === 'resume'));
    assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => fixture.missing()), []); await writeFile(path.join(output, `${name}-${locale}.json`), JSON.stringify({ passed: true, bundleSha256, actualComponent: true, realLocalRound: true, evidence, missingTranslations: await page.evaluate(() => fixture.missing()) }, null, 2));
  } finally { await browser.close(); }
});

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: real local media resume, image enlargement, three successful audio starts and retry`, { timeout: 60000 }, async () => {
  const browser = await engine.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  try {
    await page.goto(origin); await page.locator(sel('team-name')).first().waitFor();
    await page.evaluate(() => fixture.seedMedia('image')); await page.reload(); await page.locator(sel('resume')).click(); await page.locator(sel('question-media')).waitFor(); await page.locator(sel('pause')).click(); await settle(page); await page.screenshot({ path: path.join(output, name + '-ar-local-image.png'), fullPage: true });
    const enlarge = page.locator(sel('image-enlarge'));
    const preview = enlarge.locator('img[data-facade-preview]');
    const photo = await preview.evaluate(image => ({
      url: image.currentSrc, height: image.getBoundingClientRect().height, fit: getComputedStyle(image).objectFit,
    }));
    assert.ok(photo.height <= 190 && photo.fit === 'cover', 'the curated landmark preview is compact');
    assert.ok((await page.locator(sel('reveal')).boundingBox()).y < 844, 'reveal stays in the first phone viewport');
    await enlarge.click();
    const full = page.locator('.m-lightbox img.is-fit'); await full.waitFor();
    assert.equal(await full.evaluate(image => image.currentSrc), photo.url, 'the overlay displays the identical original');
    assert.equal(await full.getAttribute('data-facade-preview'), null, 'the lightbox never inherits the thumbnail crop');
    await page.keyboard.press('Escape'); await page.locator('.m-lightbox').waitFor({ state: 'hidden' });
    await page.goto(origin); await page.locator(sel('team-name')).first().waitFor(); await page.evaluate(() => { localStorage.removeItem(fixture.key('active')); fixture.seedMedia('audio'); }); await page.reload(); await page.locator(sel('resume')).click(); await page.locator('audio').waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 2); await page.locator(sel('pause')).click();
    const play = page.locator(sel('audio-play')), restart = page.locator(sel('audio-restart'));
    await play.click(); await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .05); await play.click(); await page.screenshot({path:path.join(output,name+'-ar-audio-one-start.png'),fullPage:true});
    assert.equal(await restart.isEnabled(), true); await restart.click(); await page.waitForFunction(() => /مرة واحدة|1/.test(document.querySelector('.m-audio-meta small')?.textContent));
    await play.click(); await restart.click(); await page.waitForFunction(() => document.querySelector('[data-design-id=audio-restart]')?.disabled);
    assert.equal(await page.locator('.m-audio').evaluate(el=>getComputedStyle(el).opacity),'1'); await page.screenshot({ path: path.join(output, name + '-ar-audio-three-starts.png'), fullPage: true });
    await page.evaluate(() => document.querySelector('audio').dispatchEvent(new Event('error'))); await page.locator(sel('media-retry')).waitFor(); await settle(page); await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-design-id=media-retry]')).backgroundColor==='rgb(8, 121, 109)',null,{timeout:3000}); assert.equal(await page.locator(sel('media-retry')).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(8, 121, 109)'); await page.screenshot({ path: path.join(output, name + '-ar-media-error.png'), fullPage: true });
    assert.equal(await page.locator(sel('answer')).count(),0); mediaFailure = false; await page.locator(sel('media-retry')).click(); await page.locator(sel('audio-play')).waitFor(); assert.equal(await restart.isDisabled(),true); await page.locator(sel('reveal')).click(); await page.waitForFunction(() => !document.querySelector('[data-design-id=audio-restart]')?.disabled); await restart.click();
    await writeFile(path.join(output, name + '-media.json'), JSON.stringify({ passed: true, bundleSha256, actualMediaElementPlayback: true, startsBeforeReveal: 3, unlimitedAfterReveal: true, retry: true, sourceMedia: 'Actual catalog Petra image and guitar audio served from the local media directory. Missing-file fallback fixture bytes are permitted only for unrelated assets; source files are hashed in the handoff. Playback proves UI behavior, not a new editorial verification.' }, null, 2));
  } catch (error) { await page.screenshot({path:path.join(output,name+'-media-failure.png'),fullPage:true}).catch(()=>{}); await writeFile(path.join(output,name+'-media-failure.json'),JSON.stringify({error:error.message,html:await page.locator('body').innerText(),retryStyles:await page.locator('[data-design-id=media-retry]').evaluateAll(nodes=>nodes.map(el=>({computed:getComputedStyle(el).cssText,bg:getComputedStyle(el).backgroundColor,html:el.outerHTML,rules:[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules].filter(rule=>rule.selectorText&&el.matches(rule.selectorText)).map(rule=>rule.cssText))}))),media:await page.locator('audio').evaluateAll(nodes=>nodes.map(el=>({src:el.src,currentTime:el.currentTime,readyState:el.readyState,error:el.error?.code,paused:el.paused})))},null,2)); throw error; } finally { mediaFailure = false; await browser.close(); }
});

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: local hints, steal award and question cancellation preserve the save contract`, { timeout: 45000 }, async () => {
  const browser = await engine.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  try {
    await page.goto(origin); await page.locator(sel('team-name')).first().waitFor();
    const seeded = await page.evaluate(() => fixture.seedMedia('hints')); await page.reload(); await page.locator(sel('resume')).click(); await page.locator(sel('hint')).waitFor();
    const base = Number(await page.locator('.m-award').innerText());
    await page.locator(sel('hint')).click();
    assert.equal(Number(await page.locator('.m-award').innerText()), Math.max(Math.round(base * .25), Math.round(base * .75)));
    await page.locator(sel('tool')).last().click(); await page.locator(sel('reveal')).click();
    const award = Number(await page.locator('.m-award').innerText());
    assert.equal(await page.locator('.bl-judge-award').nth(1).innerText(), '+' + award, 'steal never receives the active team double bonus');
    await page.locator(sel('judge-team')).nth(1).click(); await page.locator('.m-board-grid').waitFor();
    await page.waitForFunction(() => fixture.read('active')?.screen === 'board' && Object.keys(fixture.read('active').used).length === 1);
    const judged = await page.evaluate(() => fixture.read('active'));
    assert.equal(judged.teams[1].score, award); assert.equal(judged.teams[1].steals, 1); assert.equal(judged.teams[1].correct, 1); assert.equal(judged.used[seeded.qid], true);
    await page.locator(sel('tier') + ':not(:disabled)').first().click(); await page.locator(sel('reveal')).waitFor(); await page.locator(sel('cancel')).click(); await page.locator('.m-board-grid').waitFor();
    assert.equal(await page.locator(sel('tier') + ':disabled').count(), 1, 'cancellation does not use another question');
    assert.equal(await page.evaluate(() => Object.keys(fixture.read('history')).length), 1);
    await writeFile(path.join(output, name + '-hint-steal-cancel.json'), JSON.stringify({ passed: true, bundleSha256, realLocalSave: true, base, afterHint: award, awardedToStealingTeam: judged.teams[1].score, consumedQuestions: 1 }, null, 2));
  } finally { await browser.close(); }
});

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  for (const locale of ['ar', 'en']) {
    test(`${engineName}/${locale}: approved category art renders and selection survives into play`, { timeout: 100000 }, async () => {
      const browser = await engine.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const errors = [];
      const records = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        for (const width of [360, 390, 430]) {
          await page.setViewportSize({ width, height: 844 });
          await page.goto(`${origin}/?locale=${locale}`);
          const search = page.locator(sel('category-search'));
          await search.waitFor();
          const categories = await page.evaluate(() => fixture.categories);
          if (width === 430) {
            const names = await page.evaluate(() => fixture.names);
            for (let index = 0; index < 2; index++) await page.locator(sel('team-name')).nth(index).fill(names[index]);
            await page.locator(sel('round-size')).first().click();
            await page.locator(sel('mode-choice')).nth(1).click();
          }
          for (const id of approvedBadeehaArtwork) {
            const category = categories.find(category => category.id === id);
            await search.fill(category.name);
            const card = page.locator(sel('category-card')).filter({ has: page.locator(`[data-category-art="${id}"]`) });
            const image = card.locator('img');
            await image.scrollIntoViewIfNeeded();
            const metrics = await image.evaluate(async element => {
              await element.decode();
              const rect = element.getBoundingClientRect();
              const canvas = document.createElement('canvas');
              canvas.width = canvas.height = 1;
              const context = canvas.getContext('2d');
              context.drawImage(element, 0, 0);
              return { width: rect.width, height: rect.height, naturalWidth: element.naturalWidth, cornerAlpha: context.getImageData(0, 0, 1, 1).data[3] };
            });
            assert.deepEqual(metrics, { width: 80, height: 80, naturalWidth: 256, cornerAlpha: 0 });
            assert.ok((await card.innerText()).includes(category.name));
            if (width === 390) {
              const filename = `${engineName}-${locale}-category-${id}.png`;
              const pixels = await card.screenshot({ path: path.join(output, filename) });
              records.push({ id, name: category.name, metrics, filename, sha256: createHash('sha256').update(pixels).digest('hex') });
            }
            if (width === 430 && categoryBoardFixture.includes(id)) {
              await card.click();
              assert.equal(await card.getAttribute('aria-pressed'), 'true');
            }
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        }
        await page.locator(sel('category-search')).clear();
        await page.locator(sel('start')).click();
        await page.locator('.m-board-grid').waitFor();
        const boardImages = page.locator('.m-board-category [data-category-art]>img');
        assert.equal(await boardImages.count(), 6);
        const board = await boardImages.evaluateAll(async images => Promise.all(images.map(async image => {
          await image.decode();
          return { id: image.parentElement.dataset.categoryArt, native: image.naturalWidth, width: image.getBoundingClientRect().width };
        })));
        assert.deepEqual(board.map(entry => entry.id), categoryBoardFixture);
        assert.ok(board.every(entry => entry.native === 128 && entry.width === 44));
        await page.screenshot({ path: path.join(output, `${engineName}-${locale}-category-board.png`), fullPage: true });
        await page.waitForFunction(() => fixture.read('active')?.selectedCategories.length === 6);
        assert.deepEqual(await page.evaluate(() => fixture.read('active').selectedCategories), categoryBoardFixture);
        assert.deepEqual(errors, []);
        await writeFile(path.join(output, `${engineName}-${locale}-category-art.json`), JSON.stringify({ locale, engineName, bundleSha256, widths: [360, 390, 430], records, board }, null, 2));
      } finally {
        await browser.close();
      }
    });
  }
}
