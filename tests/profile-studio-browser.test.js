// Actual ProfileView/editor/progression components. Synthetic public profiles and
// account/social transports exercise the UI without any real account or service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import sharp from 'sharp';
import { accountLevel } from '../server/account-progression.mjs';
import { getNodeDefinition } from '../src/design/registry.js';
import { esbuildOptions } from '../scripts/lib.mjs';

const root = process.cwd();
const output = process.env.PROFILE_STUDIO_EVIDENCE_DIR || path.join(root, '.cache/profile-studio');
const cropPhoto = await sharp({create:{width:320,height:240,channels:4,background:'#b9e4d8'}}).png().toBuffer();
const levelCenter=await sharp(path.join(root,'src/shared/brand/assets/playful-scenes/sahra-level-v1-128.webp')).extract({left:64,top:64,width:1,height:1}).removeAlpha().raw().toBuffer();
const levelBackground=`rgb(${[...levelCenter].join(',')})`;
await mkdir(output, { recursive: true });
const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{ProfileView}from'./src/profiles/ProfileScreen.jsx';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';
import{BrandFonts}from'./src/shared/brand/art.jsx';import{setUiLocale}from'./src/shared/i18n/core.js';
import{BottomNavigation}from'./src/platform/BottomNavigation.jsx';import{PlatformContext}from'./src/platform/context.js';
import{ACHIEVEMENTS}from'./src/profiles/catalog.js';
import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import brand from'./src/shared/brand/brand.css';import studio from'./src/platform/playful-studio.css';
const lang=new URLSearchParams(location.search).get('locale')||'ar';document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
const initial={id:'demo',name:lang==='ar'?'ليان':'Lina',code:'DEMO-1234',bio:lang==='ar'?'كل جمعة، لعبة جديدة.':'New games. Good company.',theme:'teal',avatarPreset:'fox',avatarUrl:'/api/profiles/demo/images/avatar/'+'a'.repeat(64),coverUrl:null,online:true,friendCount:18,relationship:'self',revision:7,selectedTitle:null,earnedTitles:['member','winner'],earnedBadges:['welcome','first-win','five-wins','explorer'],featuredBadges:['first-win','five-wins','explorer'],stats:{localSessions:12,onlineMatches:18,onlineWins:5,distinctGames:4},achievements:ACHIEVEMENTS.map(rule=>({...rule,current:rule.id==='first-win'?5:0})),cosmetics:{},progression:{...${JSON.stringify(accountLevel(3700))},totalXp:3700,owned:[{itemId:'progression.frame.1',grantedAt:1700000000000}],mastery:[{game:'ersomha',grade:8,maxGrade:10,completed:60},{game:'mafia',grade:6,maxGrade:10,completed:25}],nextReward:{itemId:'progression.frame.10',level:10}}};
window.events=[];
const platform={sound:{play:()=>{}},haptics:{vibrate:()=>{}}};
function App(){const[profile,setProfile]=useState(initial),[scenario,setScenario]=useState('advanced'),[offline,setOffline]=useState(false),[error,setError]=useState(null),[signedIn,setSignedIn]=useState(true);
const owner=!['none','friend','pending_incoming','pending_outgoing'].includes(scenario);
window.fixture={scenario:value=>{setScenario(value);setOffline(false);setError(null);setSignedIn(true);window.events=[];setProfile({...initial,...(owner?{}:{}),id:['none','friend','pending_incoming','pending_outgoing'].includes(value)?'visitor':'demo',relationship:['none','friend','pending_incoming','pending_outgoing'].includes(value)?value:'self',requestId:'request-17',...(value==='new'?{name:lang==='ar'?'عمر':'Omar',bio:'',avatarUrl:null,friendCount:0,stats:{localSessions:0,onlineMatches:0,onlineWins:0,distinctGames:0},earnedBadges:['welcome'],earnedTitles:['member'],featuredBadges:[],progression:{...${JSON.stringify(accountLevel(0))},totalXp:0,owned:[],mastery:[{game:'ersomha',grade:0,maxGrade:10,completed:0},{game:'mafia',grade:0,maxGrade:10,completed:0}],nextReward:{itemId:'progression.frame.1',level:1}}}:{}),...(['no-xp','none','friend','pending_incoming','pending_outgoing'].includes(value)?{progression:undefined,featuredBadges:['first-win','five-wins']}:{}),...(value==='photo-cover'?{coverUrl:'/api/profiles/demo/images/cover/'+'b'.repeat(64)}:{})});},offline:setOffline,error:setError,signedIn:setSignedIn,profile:patch=>setProfile(p=>({...p,...patch})),get:()=>profile};
const account={...NULL_ACCOUNT,ready:true,signedIn,user:signedIn?{id:'demo'}:null,requestAuthenticated:async(url,options={})=>{window.events.push({type:'account',url,method:options.method||'GET',body:options.body});const frameId=options.method==='PATCH'?options.body.selection.frameId:profile.cosmetics.frameId||null;if(options.method==='PATCH')setProfile(p=>({...p,cosmetics:{...p.cosmetics,frameId}}));return{revision:4,effective:{frameId},preferred:{frameId}};}};
const profiles={ready:true,mine:owner?profile:null,profiles:{visitor:profile},errors:error?{[owner?'me':'visitor']:error}:{},saving:false,loadProfile:async()=>profile,saveProfile:async patch=>{window.events.push({type:'save',patch});setProfile(p=>({...p,...patch}));return{...profile,...patch};},removeImage:async kind=>{window.events.push({type:'remove',kind});return profile;}};
const social={offline,sendRequest:async id=>{window.events.push({type:'send',id});setProfile(p=>({...p,relationship:'pending_outgoing'}));},acceptRequest:async id=>{window.events.push({type:'accept',id});setProfile(p=>({...p,relationship:'friend'}));},cancelRequest:async id=>{window.events.push({type:'cancel',id});setProfile(p=>({...p,relationship:'none'}));},blockUser:async id=>window.events.push({type:'block',id}),reportUser:async(...args)=>window.events.push({type:'report',args})};
return <PlatformContext.Provider value={platform}><AccountContext.Provider value={account}><BrandFonts/><style>{tokens}</style><style>{ui}</style><div className="call-game-viewport"><ProfileView key={scenario} account={account} profiles={profiles} social={social} profileId={owner?null:'visitor'} onNavigate={route=>window.events.push({type:'navigate',route})}/></div><BottomNavigation route={{name:'profile',path:owner?'/profile':'/profile/visitor',params:owner?{}:{id:'visitor'}}}/><style>{brand}</style><style>{studio}</style></AccountContext.Provider></PlatformContext.Provider>;
}setUiLocale(lang).then(()=>createRoot(document.getElementById('root')).render(<App/>));`;
const fileAssets = process.env.PROFILE_STUDIO_FILES === '1';
const artSource = async name => {
  const bytes = await readFile(path.join(root, 'src/shared/brand/assets/playful-cosmetics', name + '.webp'));
  return fileAssets ? name + '-' : 'data:image/webp;base64,' + bytes.toString('base64');
};
const [level1Art, panoramaArt] = await Promise.all(['level-1','panorama'].map(artSource));
const filesOut = path.join(output,'site');
const productionOptions = esbuildOptions({assets:'files',outdir:filesOut,roomsUrl:'same-origin'});
const built = await build(fileAssets ? {...productionOptions,entryPoints:undefined,stdin:{contents:source,resolveDir:root,loader:'jsx'},format:'esm'} : { stdin: { contents: source, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin') }, logLevel: 'silent' });
const builtFiles = new Map(fileAssets ? built.outputFiles.map(file=>['/'+path.relative(filesOut,file.path).replaceAll('\\','/'),file.contents]) : []);
const photo = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#a6dbd1"/><circle cx="120" cy="88" r="43" fill="#50375d"/><path d="M30 240a90 100 0 0 1 180 0" fill="#50375d"/></svg>';
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://local');
  if(builtFiles.has(url.pathname)){response.writeHead(200,{'content-type':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.woff2')?'font/woff2':url.pathname.endsWith('.webp')?'image/webp':'text/javascript;charset=utf-8'});response.end(builtFiles.get(url.pathname));return;}
  if (url.pathname === '/api/me/mafia/progress') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ available: true, revision: 2, preferences: { visibility: 'private', representativeRoleId: null }, preferencesLocked: false, progress: { totalXp: 100, level: 1, xpInLevel: 100, xpPerLevel: 200, rewardedMatches: 2, legacyMatches: 0 }, roles: [] })); return; }
  if (url.pathname.startsWith('/api/profiles/')) { response.writeHead(200, { 'content-type': 'image/svg+xml' }); response.end(photo); return; }
  if (url.pathname.startsWith('/assets/')) {
    const file = path.resolve(root, 'public', '.' + url.pathname);
    assert.ok(file.startsWith(path.resolve(root, 'public/assets') + path.sep));
    try { response.writeHead(200, { 'content-type': 'image/webp' }); response.end(await readFile(file)); } catch { response.writeHead(404); response.end(); } return;
  }
  if (url.pathname === '/bundle.js') { response.writeHead(200, { 'content-type': 'text/javascript;charset=utf-8' }); response.end(built.outputFiles[0].text); return; }
  response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/bundle.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(resolve => server.close(resolve)));
const settle = async page => {
  await page.evaluate(async () => {
  const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  await document.fonts.ready; await frames();
  });
  // Poll the current DOM: React may replace a lazy image during a scenario
  // transition. decode() on a detached, still-lazy element can wait forever.
  await page.waitForFunction(() => [...document.images].filter(img=>{const box=img.getBoundingClientRect();return img.checkVisibility()&&box.bottom>0&&box.top<innerHeight&&box.right>0&&box.left<innerWidth;}).every(img=>img.complete&&img.naturalWidth>0),{},{timeout:10000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
};
const contrast = (a, b) => {
  const luminance = color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126,0.7152,0.0722][index], 0);
  const values = [luminance(a),luminance(b)].sort((x,y) => y-x); return (values[0] + 0.05) / (values[1] + 0.05);
};

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) for (const locale of ['ar', 'en']) test(`${name}/${locale}: Studio profile data, roles and compact layout`, { timeout: 90000 }, async () => {
  const browser = await engine.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = [], external = [], evidence = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== origin) { external.push(url.origin); return route.abort(); } return route.continue(); });
  const select = async scenario => { await page.evaluate(value => window.fixture.scenario(value), scenario); await settle(page); await page.evaluate(() => scrollTo(0, 0)); };
  try {
    await page.goto(origin + '/?locale=' + locale);
    await page.locator('[data-design-id="edit"]').waitFor();
    const friendStat = page.locator('[data-design-id="summary"] > span').last();
    for (const cosmetics of [{}, { profileSkinId: 'sahra.profileSkin' }]) {
      for (const friendCount of [0, 1, 2]) {
        await page.evaluate(patch => window.fixture.profile(patch), { cosmetics, friendCount });
        const singular = locale === 'en' ? 'Friend' : 'صديق';
        const plural = locale === 'en' ? 'Friends' : 'أصدقاء';
        const text = friendCount.toLocaleString(locale) + (friendCount === 1 ? singular : plural);
        await page.waitForFunction(({ element, text }) => element.textContent === text,
          { element: await friendStat.elementHandle(), text });
      }
    }
    for (const scenario of ['advanced', 'new', 'no-xp', 'none', 'friend', 'pending_incoming', 'pending_outgoing']) {
      await select(scenario);
      const owner = ['advanced', 'new', 'no-xp'].includes(scenario);
      const geometry = await page.locator('.pc-identity').evaluate(node => ({ identity: node.getBoundingClientRect().toJSON(), portrait: node.querySelector('.pc-portrait').getBoundingClientRect().toJSON(), actualAvatar: node.querySelector('.player-avatar').getBoundingClientRect().toJSON(), avatarMinWidth: getComputedStyle(node.querySelector('.player-avatar')).minWidth, copy: node.querySelector('.pc-identity-copy').getBoundingClientRect().toJSON(), overflow: document.documentElement.scrollWidth > innerWidth }));
      assert.equal(geometry.overflow, false);
      assert.ok(locale === 'ar' ? geometry.portrait.x > geometry.copy.x : geometry.portrait.x < geometry.copy.x, 'actual face starts the reading direction');
      assert.ok(geometry.actualAvatar.width <= geometry.portrait.width + 0.1 && geometry.actualAvatar.height <= geometry.portrait.height + 0.1, 'the real 220px avatar is constrained by its compact portrait slot');
      assert.equal(geometry.avatarMinWidth, '0px');
      assert.equal(await page.locator('[data-design-id="edit"]').count(), Number(owner));
      assert.equal(await page.locator('[data-design-id="profile-settings"]').count(), Number(owner));
      assert.equal(await page.locator('[data-design-id="profile-library"]').count(), Number(owner));
      if (scenario === 'advanced' || scenario === 'new') {
        const meter = page.locator('[data-design-id="xp"] [role="progressbar"]');
        assert.equal(await meter.getAttribute('aria-valuenow'), String(scenario === 'new' ? 0 : accountLevel(3700).xpIntoLevel));
        assert.equal(await meter.getAttribute('aria-valuemax'), String(scenario === 'new' ? 100 : accountLevel(3700).xpForNextLevel));
        const meters = await page.locator('.pc-meter').evaluateAll(nodes => nodes.map(node => ({ direction: getComputedStyle(node).direction, track: node.getBoundingClientRect().toJSON(), fill: node.firstElementChild.getBoundingClientRect().toJSON(), trackColor: getComputedStyle(node).backgroundColor, fillColor: getComputedStyle(node.firstElementChild).backgroundColor, value: Number(node.getAttribute('aria-valuenow')), max: Number(node.getAttribute('aria-valuemax')) })));
        for (const observed of meters) {
          assert.equal(observed.direction, locale === 'ar' ? 'rtl' : 'ltr');
          assert.ok(Math.abs((locale === 'ar' ? observed.fill.right - observed.track.right : observed.fill.left - observed.track.left)) < 0.15, 'fill starts at the reading edge');
          assert.ok(Math.abs(observed.fill.width / observed.track.width - observed.value / observed.max) < 0.01, 'physical fill width reflects the actual server value');
          assert.ok(contrast(observed.trackColor, observed.fillColor) >= 3, 'the fill remains distinguishable from the empty track');
        }
        geometry.meters = meters;
        const fractions = await page.locator('.pc-track-value,.pc-xp-label>bdi').evaluateAll(nodes => nodes.map(node => {
          const value = document.createRange(), maximum = document.createRange();
          value.selectNodeContents(node.firstElementChild); maximum.selectNodeContents(node.lastElementChild);
          return { text:node.textContent, value:value.getBoundingClientRect().toJSON(), maximum:maximum.getBoundingClientRect().toJSON() };
        }));
        for (const fraction of fractions) assert.ok(fraction.value.right <= fraction.maximum.left + 0.1, 'fraction numerator precedes denominator physically in both scripts');
        geometry.fractions = fractions;
        const order = await page.locator('[data-design-id="mastery"]').evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('[data-design-id="badges"]').getBoundingClientRect().top);
        assert.equal(order, true, 'mastery appears before selected badges');
        assert.equal(await page.locator('[data-design-id="mastery-empty"]').count(), Number(scenario === 'new'));
        assert.equal(await page.locator('.pc-achievement').count(), scenario === 'new' ? 0 : 3, 'earned-but-unselected badge never appears equipped');
      } else {
        assert.equal(await page.locator('[data-design-id="xp"], [data-design-id="mastery"]').count(), 0, 'unavailable/private progression is not invented');
        assert.equal(await page.locator('.pc-public-level').count(), 0);
      }
      if (scenario !== 'new') {
        await page.waitForFunction(() => [...document.querySelectorAll('.pc-portrait img')].some(img => img.src.includes('/api/profiles/demo/images/avatar/') && img.complete && img.naturalWidth));
        assert.equal(await page.locator('.pc-portrait .player-avatar-portrait > img').getAttribute('src'), origin + '/api/profiles/demo/images/avatar/' + 'a'.repeat(64), 'real account photo remains the displayed identity');
      }
      const primary = owner ? page.locator('[data-design-id="edit"]') : page.locator('[data-design-id="contact"] .btn');
      const hit = await primary.evaluate(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; });
      assert.ok(hit.width >= 48 && hit.height >= 52 && hit.hit, `primary action preserves the 52px height and is reachable at 390px: ${scenario} ${JSON.stringify(hit)}`);
      if (scenario === 'new') {
        const start = await page.locator('.pc-mastery-empty .pc-control').evaluate(node => ({ height:node.getBoundingClientRect().height, color:getComputedStyle(node).color, background:getComputedStyle(node).backgroundColor, radius:getComputedStyle(node).borderRadius }));
        assert.ok(start.height >= 52);
        assert.equal(start.radius,'20px');
        assert.ok(contrast(start.color,start.background)>=4.5,'first-match action uses readable Studio colors');
      }
      const composition = await page.locator('.profile-screen').evaluate(root => {
        const rect = selector => root.querySelector(selector)?.getBoundingClientRect().toJSON() || null;
        return { badges:rect('[data-design-id="badges"]'),tools:rect('.profile-owner-tools'),stats:rect('[data-design-id="stats"]'),collection:rect('[data-design-id="profile-library"]'),share:rect('[data-design-id="share"]'),secondary:rect('.pc-identity-more'),nav:document.querySelector('.menu-navigation').getBoundingClientRect().toJSON(),summaryCounts:root.querySelectorAll('[data-design-id="summary"]>span').length,primaryColor:getComputedStyle(root.querySelector('[data-design-id="contact"] .btn') || root.querySelector('[data-design-id="edit"]')).color,primaryWeight:getComputedStyle(root.querySelector('[data-design-id="contact"] .btn') || root.querySelector('[data-design-id="edit"]')).fontWeight,badgeWidths:[...root.querySelectorAll('.pc-achievement')].map(node=>node.getBoundingClientRect().width) };
      });
      if (owner && scenario !== 'no-xp') {
        assert.ok(composition.tools.top >= composition.badges.bottom && composition.tools.bottom <= composition.nav.top, 'owner stats/collection access immediately follows badges above navigation');
        if(composition.secondary) assert.ok(composition.secondary.top >= composition.tools.bottom, 'secondary identity detail follows the primary tools');
      } else if (owner) {
        assert.ok(composition.stats.top >= composition.badges.bottom && composition.collection.top >= composition.stats.bottom, 'no-XP real stats precede the compact collection');
        assert.ok(composition.collection.height <= 50 && composition.collection.bottom <= composition.nav.top);
      } else {
        assert.equal(composition.summaryCounts,1,'visitor identity shows friends only; wins remain in real statistics');
        assert.equal(await page.locator('.profile-stats [data-design-id="stat"]').count(),4);
        assert.ok(composition.share.bottom <= composition.nav.top,'four visitor statistics and sharing fit before navigation');
        if(scenario !== 'pending_outgoing') assert.equal(composition.primaryColor,'rgb(255, 255, 255)','teal relationship actions use the white action foreground');
        assert.ok(Number(composition.primaryWeight) >= 700,'relationship actions retain their readable strong weight');
      }
      if(composition.badgeWidths.length===2) assert.ok(Math.abs(composition.badgeWidths[0]-composition.badgeWidths[1])<0.1 && composition.badgeWidths[0]>150,'two featured badges fill the row evenly');
      geometry.composition=composition;
      await page.screenshot({ path: path.join(output, `${name}-${locale}-${scenario}.png`) });
      evidence.push({ scenario, geometry, primary: hit, owner, screenshot: `${name}-${locale}-${scenario}.png` });
      const missing = await page.locator('[data-design-screen="profile"]').evaluate(root => [...root.querySelectorAll('button,summary')].filter(element => element.getClientRects().length && element.closest('[data-design-screen]') === root && !element.dataset.designId).map(element => element.outerHTML.slice(0,180)));
      assert.deepEqual(missing, [], 'every visible profile action has a stable design identity');
      const observedIds = await page.locator('[data-design-screen="profile"]').evaluate(root => [...new Set([...root.querySelectorAll('[data-design-id]')].filter(element => element.getClientRects().length && element.closest('[data-design-screen]') === root).map(element => element.dataset.designId))]);
      for (const id of observedIds) assert.ok(getNodeDefinition('profile', id), `actual profile node ${id} has registry metadata`);
      geometry.designIds = observedIds;
      if (!owner) {
        if (scenario === 'friend') {
          await page.evaluate(() => window.fixture.profile({ cosmetics:{profileSkinId:'sahra.profileSkin'} })); await settle(page);
          const action = await primary.evaluate(node => ({ height:node.getBoundingClientRect().height, color:getComputedStyle(node).color, gradient:getComputedStyle(node).backgroundImage }));
          const stops = action.gradient.match(/rgba?\([^)]+\)/g);
          assert.ok(stops?.length >= 2,'equipped visitor action retains its defined gradient');
          for (const stop of stops) assert.ok(contrast(action.color,stop)>=4.5,'equipped visitor text is readable across both gradient endpoints');
          assert.ok(action.height>=52,'equipped visitor action retains the primary height');
          evidence.push({scenario:'visitor-skin-action',...action});
          await page.evaluate(() => window.fixture.profile({ cosmetics:{} })); await settle(page);
        }
        const expected = { none: 'add-friend', friend: 'friend-chat', pending_incoming: 'friend-accept', pending_outgoing: 'friend-cancel' }[scenario];
        assert.equal(await page.locator('[data-design-id="' + expected + '"]').count(), 1);
        if (scenario !== 'friend') { await page.evaluate(() => window.fixture.offline(true)); await settle(page); assert.equal(await primary.isDisabled(), true); await page.evaluate(() => window.fixture.offline(false)); await settle(page); }
        await primary.click();
        const events = await page.evaluate(() => window.events);
        assert.deepEqual(events, [{ none: { type: 'send', id: 'visitor' }, friend: { type: 'navigate', route: '/friends/visitor' }, pending_incoming: { type: 'accept', id: 'request-17' }, pending_outgoing: { type: 'cancel', id: 'request-17' } }[scenario]], 'relationship actions keep their actual trusted IDs');
      }
    }
    await select('advanced');
    await page.locator('[data-design-id="profile-stats-toggle"]').click();
    await page.locator('.profile-expanded-stats [data-design-id="stats"]').waitFor();
    await page.locator('[data-design-id="profile-tab-achievements"]').click();
    assert.equal(await page.locator('.profile-expanded-stats [data-design-id="achievements"]').isVisible(),true,'compact owner access retains the full achievements view');
    await page.locator('[data-design-id="profile-library-toggle"]').click();
    for (const id of ['plus-store','profile-store']) {
      const target = await page.locator('[data-design-id="'+id+'"]').evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}));
      assert.ok(target.width>=48 && target.height>=48,'expanded collection links retain the minimum touch target: '+id);
    }
    // Read the opened collection at large text, not just the collapsed summary.
    await page.evaluate(()=>{window.libraryTextRestore=[...document.querySelectorAll('.profile-library-card,.profile-library-card *')].map(node=>({node,style:node.getAttribute('style'),font:parseFloat(getComputedStyle(node).fontSize),line:parseFloat(getComputedStyle(node).lineHeight)}));for(const item of window.libraryTextRestore){item.node.style.fontSize=item.font*2+'px';if(Number.isFinite(item.line))item.node.style.lineHeight=item.line*2+'px';}});
    for(const width of [360,390,430]){
      await page.setViewportSize({width,height:844});await settle(page);
      const labels=await page.locator('.profile-identity-links>.btn').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect(),walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),rects=[];while(walker.nextNode()){if(!walker.currentNode.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(walker.currentNode);rects.push(...[...range.getClientRects()].map(rect=>rect.toJSON()));}return{text:node.textContent,box:box.toJSON(),scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,rects};}));
      for(const label of labels){assert.ok(label.scrollWidth<=label.clientWidth+1,'opened library has no clipped large-text label: '+label.text);for(const rect of label.rects)assert.ok(rect.left>=label.box.left-1&&rect.right<=label.box.right+1,'full library label stays inside its button: '+label.text);}
      await page.locator('[data-design-id="plus-store"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${name}-${locale}-${width}-library-open-text200.png`)});evidence.push({scenario:'library-open-text200',width,labels});
    }
    await page.locator('[data-design-id="plus-store"]').click();
    assert.ok((await page.evaluate(()=>window.events)).some(event=>event.type==='navigate'&&event.route==='/store?tab=library'),'compact collection retains the real library navigation');
    await page.evaluate(()=>{for(const{node,style}of window.libraryTextRestore){if(style===null)node.removeAttribute('style');else node.setAttribute('style',style);}delete window.libraryTextRestore;});await page.setViewportSize({width:390,height:844});
    await select('new');
    await page.locator('[data-design-id="choose-badges"]').click();
    let editor = page.locator('[data-design-screen="profile.editor"]');
    await editor.waitFor();
    const editorFractions = await editor.locator('.profile-field small,.profile-edit-section h3>bdi').evaluateAll(nodes => nodes.map(node => {
      const value=document.createRange(), maximum=document.createRange(); value.selectNodeContents(node.firstElementChild); maximum.selectNodeContents(node.lastElementChild);
      return {text:node.textContent,value:value.getBoundingClientRect().toJSON(),maximum:maximum.getBoundingClientRect().toJSON()};
    }));
    assert.equal(editorFractions.length,3);
    for(const fraction of editorFractions) assert.ok(fraction.value.right <= fraction.maximum.left+0.1,'editor text and badge count fractions preserve physical numerator/denominator order');
    evidence.push({scenario:'editor-fractions',fractions:editorFractions});
    const earned = editor.locator('[data-design-id="badge-choice"]').first();
    assert.equal(await earned.isEnabled(), true);
    assert.equal(await earned.getAttribute('aria-pressed'), 'false');
    assert.equal(await editor.locator('[data-design-id="badge-choice"]').nth(10).isDisabled(), true);
    await earned.click();
    await editor.locator('[data-design-id="save"]').click();
    await editor.waitFor({ state: 'detached' });
    assert.deepEqual((await page.evaluate(() => window.events)).filter(event => event.type === 'save').map(event => event.patch.featuredBadges), [['welcome']]);
    assert.equal(await page.locator('.pc-achievement').count(), 1);
    await select('photo-cover');
    await page.locator('[data-design-id="cover"] > img').waitFor();
    assert.equal(await page.locator('[data-design-id="cover"] > img').getAttribute('src'), '/api/profiles/demo/images/cover/' + 'b'.repeat(64));
    await page.locator('[data-design-id="edit"]').click(); await editor.waitFor();
    await editor.locator('[data-design-id="bio-input"]').fill(locale === 'ar' ? 'نبذة جديدة' : 'Updated bio');
    await editor.locator('[data-design-id="save"]').click(); await editor.waitFor({ state: 'detached' });
    const patch = (await page.evaluate(() => window.events)).find(event => event.type === 'save').patch;
    assert.equal(Object.hasOwn(patch, 'avatarPreset'), false, 'editing text preserves uploaded photo');
    assert.equal(patch.revision, 7);
    await page.locator('[data-design-id="profile-visitor-preview"]').click();
    assert.equal(await page.locator('[data-design-id="edit"], [data-design-id="profile-library"], [data-design-id="xp"]').count(), 0, 'visitor preview cannot expose owner tools/XP');
    await page.locator('[data-design-id="profile-visitor-preview"]').click();
    // The actual wardrobe keeps its server revision and earned-grant checks.
    await select('advanced');
    await page.locator('[data-design-id="mastery-track"]').first().click();
    let detail = page.getByRole('dialog'); await detail.waitFor();
    assert.match(await detail.innerText(), locale === 'ar' ? /٦٠/ : /60/);
    await page.keyboard.press('Escape'); await detail.waitFor({ state: 'detached' });
    await page.locator('[data-design-id="featured-badge"]').first().click(); await detail.waitFor();
    assert.match(await detail.innerText(), locale === 'ar' ? /حقق أول فوز/ : /first individual or team win/i);
    await page.keyboard.press('Escape'); await detail.waitFor({ state: 'detached' });
    await page.evaluate(() => window.fixture.profile({ avatarUrl: null, avatarPreset: 'human-02' })); await settle(page);
    await page.locator('[data-design-id="name"]').click();
    await page.evaluate(() => scrollTo(0,0));
    await page.screenshot({ path: path.join(output, `${name}-${locale}-advanced-preset.png`) });
    await select('advanced');
    await page.locator('.pc-portrait').click();
    let wardrobe = page.getByRole('dialog'); await wardrobe.waitFor();
    await wardrobe.locator('.pc-catalog-item').last().click();
    const equipName = locale === 'ar' ? 'تجهيز الإطار' : 'Equip frame';
    assert.equal(await wardrobe.getByRole('button', { name: equipName, exact: true }).count(), 0, 'locked frame cannot be equipped');
    await wardrobe.locator('.pc-wardrobe-preview > .btn').last().click();
    await wardrobe.locator('.pc-catalog-item').first().click();
    await wardrobe.getByRole('button', { name: equipName, exact: true }).click();
    await page.waitForFunction(() => window.events.some(event => event.type === 'account' && event.method === 'PATCH'));
    const equip = (await page.evaluate(() => window.events)).find(event => event.type === 'account' && event.method === 'PATCH');
    assert.deepEqual(equip.body, { selection: { frameId: 'progression.frame.1' }, revision: 4 });
    await page.keyboard.press('Escape'); await wardrobe.waitFor({ state: 'detached' });
    await page.waitForFunction(expected => document.querySelector('.pc-identity .pc-portrait-frame')?.getAttribute('src')?.includes(expected),level1Art);
    const framed = await page.locator('.pc-identity').evaluate(node => ({ slot: node.querySelector('.pc-portrait').getBoundingClientRect().toJSON(), photo: node.querySelector('.player-avatar').getBoundingClientRect().toJSON(), overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(framed.overflow, false); assert.ok(framed.photo.width < framed.slot.width, 'earned frame has its own layer around the retained photo');
    await page.evaluate(() => window.fixture.profile({ name: 'Alexandria Montgomery Riverside', bio: 'A long biography stays complete, including spaces and punctuation. '.repeat(2) }));
    await settle(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'long authored profile text remains within the viewport');
    const baseTitleColor = await page.locator('[data-design-id="title"]').evaluate(node => getComputedStyle(node).color);
    await page.evaluate(() => window.fixture.profile({ cosmetics: { profileSkinId: 'sahra.profileSkin', frameId: 'sahra.frame' }, imageReviews: { avatar: { status: 'pending', previewUrl: '/api/profiles/me/images/avatar/pending/' + 'c'.repeat(64) } } }));
    await settle(page);
    assert.equal(await page.locator('[data-profile-skin="sahra"]').count(), 1);
    assert.equal(await page.locator('.pc-portrait .player-avatar-portrait > img').getAttribute('src'), origin + '/api/profiles/demo/images/avatar/' + 'a'.repeat(64));
    assert.equal(await page.locator('.pc-portrait .player-avatar-frame').count(), 1, 'effective paid frame remains around the real photo');
    const skin = await page.locator('.profile-screen').evaluate(root => ({ colors: [...root.querySelectorAll('h1,.pc-identity-copy h2,.pc-xp > strong,.pc-section-title,.pc-track strong')].map(node => ({ selector: node.className || node.tagName, color: getComputedStyle(node).color, text: getComputedStyle(node).getPropertyValue('--text'), ink: getComputedStyle(node).getPropertyValue('--pc-ink') })), cover: root.querySelector('.profile-cover')?.getBoundingClientRect().toJSON() || null, masthead: root.querySelector('.pc-profile-masthead')?.getBoundingClientRect().toJSON() || null }));
    await writeFile(path.join(output, `${name}-${locale}-skin-colors.json`), JSON.stringify(skin, null, 2) + '\n');
    for (const copy of skin.colors) {
      const surfaces = copy.selector === 'pc-xp-badge' ? [levelBackground] : ['rgb(237,247,240)','rgb(255,253,248)','rgb(244,248,239)'];
      for (const surface of surfaces) assert.ok(contrast(copy.color,surface) >= 4.5, `equipped skin text ${copy.selector} remains readable over its actual surface after switching`);
    }
    const levelBadge=await page.locator('.pc-xp-badge').evaluate(node=>({slot:node.getBoundingClientRect().toJSON(),image:node.querySelector('img').getBoundingClientRect().toJSON(),text:node.querySelector('span').getBoundingClientRect().toJSON()}));
    assert.ok(Math.abs(levelBadge.image.x+levelBadge.image.width/2-levelBadge.slot.x-levelBadge.slot.width/2)<.5,'level image is centered behind the real number');
    assert.ok(levelBadge.image.width>levelBadge.slot.width*1.5,'level art accounts for its intrinsic transparent margin');
    assert.ok(await page.locator('[data-design-id="edit"]').evaluate(node=>node.getBoundingClientRect().height)>=52,'equipped skin does not shrink the owner primary action');
    assert.ok(skin.cover.width > 0 && skin.cover.height > 0, 'the Sahra panorama is visible in the profile');
    assert.ok((await page.locator('.profile-cover-art').evaluate(node=>getComputedStyle(node).backgroundImage)).includes(panoramaArt));
    assert.ok((await page.locator('.profile-equipped-pieces img').first().getAttribute('src')).includes(panoramaArt), 'the equipped item thumbnail uses the same panorama');
    assert.equal(await page.locator('.profile-cover > img').count(),0,'the artwork belongs to the skin and leaves the saved cover slot empty');
    await page.evaluate(()=>window.fixture.profile({coverUrl:'/api/profiles/demo/images/cover/'+'b'.repeat(64)})); await settle(page);
    const retainedCover=await page.locator('.profile-cover').evaluate(node=>({width:node.getBoundingClientRect().width,masthead:node.parentElement.getBoundingClientRect().width,src:node.querySelector('img')?.getAttribute('src')}));
    assert.ok(Math.abs(retainedCover.width-retainedCover.masthead)<=2,'explicitly selected cover fills the bordered masthead');
    assert.equal(retainedCover.src,'/api/profiles/demo/images/cover/'+'b'.repeat(64));
    await page.evaluate(()=>window.fixture.profile({coverUrl:null})); await settle(page);
    evidence.push({ scenario: 'equipped-skin', ...skin });
    await page.locator('[data-design-id="name"]').click();
    await page.evaluate(() => scrollTo(0,0));
    await page.screenshot({ path: path.join(output, `${name}-${locale}-equipped-skin.png`) });
    // Capture the approved short-name/preset and uploaded-photo/no-XP cases
    // separately from the long-name stress case used above.
    const stressedProfile = await page.evaluate(() => window.fixture.get());
    await page.evaluate(value => window.fixture.profile({name:value==='ar'?'ليان':'Layan',bio:'',avatarUrl:null,avatarPreset:'human-01'}),locale); await settle(page);
    await page.screenshot({ path:path.join(output,`${name}-${locale}-sahra-approved-preset.png`) });
    await page.evaluate(value => window.fixture.profile({name:value==='ar'?'نور':'Noor',bio:value==='ar'?'كل جمعة، لعبة جديدة.':'Every gathering, a new game',avatarUrl:'/api/profiles/demo/images/avatar/'+'a'.repeat(64),progression:undefined}),locale); await settle(page);
    const libraryBox=await page.locator('.profile-library-card summary').boundingBox(),dockBox=await page.locator('.menu-navigation').boundingBox();
    assert.ok(libraryBox.y+libraryBox.height<=dockBox.y,'approved no-XP case shows the full Collection action above the dock');
    await page.screenshot({ path:path.join(output,`${name}-${locale}-sahra-approved-no-xp.png`) });
    await page.evaluate(value => window.fixture.profile(value),stressedProfile); await settle(page);
    const skinTransitions = [];
    for (let cycle = 0; cycle < 8; cycle++) for (const equipped of [false, true]) {
      await page.evaluate(value => window.fixture.profile({ cosmetics: value ? { profileSkinId: 'sahra.profileSkin', frameId: 'sahra.frame' } : {} }), equipped);
      await page.waitForFunction(value => document.querySelector('.profile-screen').dataset.profileSkin === (value ? 'sahra' : 'base'), equipped);
      const observed = await page.locator('[data-design-id="title"]').evaluate(node => ({ text:node.textContent, color:getComputedStyle(node).color, inlineColor:node.style.color, transitionProperty:getComputedStyle(node).transitionProperty, transitionDuration:getComputedStyle(node).transitionDuration, animations:node.getAnimations().map(animation=>({type:animation.constructor.name,property:animation.transitionProperty,currentTime:animation.currentTime})) }));
      assert.equal(observed.color,equipped ? 'rgb(53, 33, 57)' : baseTitleColor,'heading color follows every completed equip/remove render without waiting for a color retry');
      assert.deepEqual(observed.animations,[],'changing an unanimated heading does not create a transient color transition under reduced motion');
      if(equipped) assert.ok(contrast(observed.color,'rgb(237, 247, 240)')>=4.5);
      skinTransitions.push({cycle,equipped,...observed});
    }
    evidence.push({scenario:'skin-title-transitions',transitions:skinTransitions});
    await page.locator('[data-design-id="edit"]').click(); await editor.waitFor();
    assert.equal(await editor.locator('[data-design-id="avatar-upload"]').count(), 1);
    assert.equal(await editor.locator('[data-design-id="cover-upload"]').count(), 1);
    assert.equal(await editor.locator('.profile-image-review').count(), 1, 'image moderation status remains in the actual editor');
    assert.equal(await editor.locator('.profile-image-editor-row .player-avatar-portrait').evaluate(node=>getComputedStyle(node).borderTopLeftRadius),'16px','current photo uses the approved rounded square instead of the gameplay portrait mask');
    // Approved editor extension uses its own scroll region and a visible action
    // row; the current uploaded photo stays selected until an explicit choice.
    for (const width of [360,390,430]) {
      await page.setViewportSize({width,height:844}); await settle(page);
      await editor.locator('.modal-body').evaluate(node=>node.scrollTop=0);
      const geometry=await editor.evaluate(node=>({root:node.getBoundingClientRect().toJSON(),body:node.querySelector('.modal-body').getBoundingClientRect().toJSON(),footer:node.querySelector('.modal-foot').getBoundingClientRect().toJSON(),overflow:node.scrollWidth>node.clientWidth,avatars:node.querySelectorAll('[data-design-id="avatar-choice"]').length,themes:node.querySelectorAll('[data-design-id="theme-choice"]').length}));
      assert.equal(geometry.overflow,false);
      assert.equal(geometry.avatars,12); assert.equal(geometry.themes,8);
      assert.ok(geometry.footer.bottom<=844.5&&geometry.footer.top>=geometry.body.bottom-.5,'footer stays outside the scrollable form');
      const filename=`${name}-${locale}-editor-${width}.png`;
      await page.screenshot({path:path.join(output,filename)});
      evidence.push({scenario:'approved-editor',width,geometry,screenshot:filename});
    }
    await page.setViewportSize({width:390,height:844}); await settle(page);
    await editor.locator('[data-design-id="badge-choice"]').first().scrollIntoViewIfNeeded();await settle(page);
    const badgeBounds=await editor.locator('[data-design-id="badge-choice"]').evaluateAll(nodes=>nodes.map(node=>{const art=node.querySelector('.profile-badge-art img')?.getBoundingClientRect(),label=node.querySelector('.profile-badge-art+span').getBoundingClientRect();return{label:node.textContent,art:art?.toJSON(),text:label.toJSON()};}));
    for(const badge of badgeBounds)if(badge.art)assert.ok(badge.art.bottom<=badge.text.top+.5,'badge illustration never covers its label: '+badge.label);
    await page.screenshot({path:path.join(output,`${name}-${locale}-editor-badges.png`)});evidence.push({scenario:'badge-art-label-separation',badges:badgeBounds});
    await editor.locator('[data-design-id="avatar-choice"]').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,`${name}-${locale}-editor-presets.png`)});
    await page.evaluate(()=>{window.editorTextRestore=[...document.querySelectorAll('.profile-editor,.profile-editor *')].map(node=>({node,style:node.getAttribute('style'),size:getComputedStyle(node).fontSize,line:getComputedStyle(node).lineHeight}));for(const item of window.editorTextRestore){item.node.style.fontSize=(parseFloat(item.size)*2)+'px';if(item.line!=='normal')item.node.style.lineHeight=(parseFloat(item.line)*2)+'px';}});
    await editor.locator('[data-design-id="bio-input"]').fill(locale==='ar'?'نص عربي English 123 طويل':'Long English العربية 123 text');
    assert.equal(await editor.evaluate(node=>node.scrollWidth>node.clientWidth),false,'200% text remains inside the dialog');
    const counterSpace=await editor.locator('[data-design-id="name-input"]').evaluate(input=>{const box=input.getBoundingClientRect(),counter=input.closest('label').querySelector('small').getBoundingClientRect(),style=getComputedStyle(input);return style.direction==='rtl'?box.left+parseFloat(style.paddingLeft)-counter.right:counter.left-(box.right-parseFloat(style.paddingRight));});
    assert.ok(counterSpace>=8,'200% name counter stays at least 8px clear of typed text');
    assert.ok(counterSpace<=40,'name counter does not reserve an unnecessarily large blank column');
    await page.screenshot({path:path.join(output,`${name}-${locale}-editor-text-200.png`)});
    await page.evaluate(()=>{for(const {node,style}of window.editorTextRestore){if(style===null)node.removeAttribute('style');else node.setAttribute('style',style);}delete window.editorTextRestore;});
    await page.setViewportSize({width:390,height:480}); await settle(page);
    await editor.locator('[data-design-id="bio-input"]').focus();
    const smallFooter=await editor.locator('.modal-foot').boundingBox();
    assert.ok(smallFooter.y+smallFooter.height<=480.5,'reduced visual viewport keeps save controls in view');
    await page.setViewportSize({width:390,height:844}); await settle(page);
    const [chooser]=await Promise.all([page.waitForEvent('filechooser'),editor.locator('[data-design-id="avatar-upload"]').click()]);
    await chooser.setFiles({name:'profile-test.png',mimeType:'image/png',buffer:cropPhoto});
    const cropDialog=page.locator('[data-design-screen="profile.crop"]'); await cropDialog.waitFor();
    const crop=await cropDialog.locator('[data-design-id="crop"]').boundingBox();
    assert.ok(Math.abs(crop.width-crop.height)<.5,'avatar crop matches the square image sent to review');
    await cropDialog.locator('[data-design-id="zoom-input"]').fill('1.3');
    await cropDialog.locator('[data-design-id="zoom-input"]').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await cropDialog.locator('[data-design-id="zoom-input"]').inputValue(),'1.31','styled range retains keyboard precision');
    await cropDialog.locator('[data-design-id="zoom-input"]').fill('1.3'); await settle(page);
    const cropCoverage=await cropDialog.locator('[data-design-id="crop"]').evaluate(node=>({stage:node.getBoundingClientRect().toJSON(),image:node.querySelector('img').getBoundingClientRect().toJSON()}));
    assert.ok(cropCoverage.image.bottom>=cropCoverage.stage.bottom-.5&&cropCoverage.image.top<=cropCoverage.stage.top+.5,'cropped image covers the complete vertical selection');
    await page.screenshot({path:path.join(output,`${name}-${locale}-crop-square.png`)});
    await cropDialog.locator('[data-design-id="cancel"]').click(); await cropDialog.waitFor({state:'detached'});
    await editor.locator('[data-design-id="profile-image-review-toggle"]').click();
    await editor.locator('[data-design-id="review-image-retry"]').waitFor();
    for (const id of ['profile-image-review-toggle','review-image-retry']) assert.ok(getNodeDefinition('profile.editor', id), `visible editor review action ${id} is registered`);
    const beforeRetry = (await page.evaluate(() => window.events)).filter(event => event.url?.includes('/pending/')).length;
    await editor.locator('[data-design-id="review-image-retry"]').click();
    await page.waitForFunction(count => window.events.filter(event => event.url?.includes('/pending/')).length === count + 1, beforeRetry);
    await editor.locator('[data-design-id="avatar-choice"]').first().click();
    await editor.locator('[data-design-id="save"]').click(); await editor.waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => window.events)).filter(event => event.type === 'save').at(-1).patch.avatarPreset, 'spark', 'only an explicit preset choice replaces the uploaded avatar');
    await select('advanced');
    const mafiaRequests = [];
    page.on('request', request => { if (request.url().includes('/api/me/mafia/')) mafiaRequests.push(request.url()); });
    assert.equal(await page.locator('.mafia-profile').count(), 0, 'secondary Mafia data remains deferred until its disclosure opens');
    await page.locator('[data-design-id="mafia-progress-toggle"]').click();
    await page.locator('[data-design-id="mafia-progress-save"]').waitFor();
    assert.equal(mafiaRequests.length, 1);
    const mafiaIds = await page.locator('.mafia-profile').locator('button,select').evaluateAll(nodes => nodes.map(node => node.dataset.designId));
    for (const id of mafiaIds) assert.ok(id && getNodeDefinition('profile', id), `actual Mafia preference ${id} is registered`);
    evidence.push({ scenario: 'secondary-mafia-details', designIds: mafiaIds, requestsAfterOpening: mafiaRequests.length });
    await select('none');
    await page.locator('[data-design-id="contact"] [data-design-id="menu"]').click();
    const menu = page.getByRole('dialog'); await menu.waitFor();
    assert.ok((await menu.locator('button').count()) >= 3, 'safety menu and its close remain reachable');
    await menu.locator('.profile-menu > button').last().click();
    const safety = page.locator('[data-design-screen="profile.safety"]'); await safety.waitFor();
    assert.equal(await safety.locator('[data-design-id="submit"]').isDisabled(), true);
    await safety.locator('[data-design-id="report-reason"]').selectOption('رسائل مزعجة');
    await safety.locator('[data-design-id="report-details"]').fill('Synthetic report');
    await safety.locator('[data-design-id="submit"]').click(); await safety.waitFor({ state: 'detached' });
    assert.deepEqual((await page.evaluate(() => window.events)).find(event => event.type === 'report').args, ['visitor', { reason: 'رسائل مزعجة: Synthetic report' }], 'localized labels keep the trusted report value');
    // Observe the actual entrance from before mount; a settled screenshot cannot
    // prove that navigation animated or that reduced motion removes displacement.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      window.profileMotion = [];
      document.addEventListener('animationstart', event => {
        if (event.target.matches('.profile-screen')) window.profileMotion.push({ name:event.animationName, duration:getComputedStyle(event.target).animationDuration });
      });
    });
    await select('advanced');
    await page.waitForFunction(() => window.profileMotion.some(event => event.name === 'profile-page-in'));
    assert.equal(await page.evaluate(() => window.profileMotion.find(event => event.name === 'profile-page-in').duration), '0.22s');
    for (const preference of ['system', 'app']) {
      await page.emulateMedia({ reducedMotion: preference === 'system' ? 'reduce' : 'no-preference' });
      await page.evaluate(value => { document.documentElement.dataset.reducedMotion = String(value === 'app'); window.profileMotion = []; }, preference);
      await select(preference === 'system' ? 'friend' : 'new');
      assert.deepEqual(await page.locator('.profile-screen').evaluate(element => ({ name:getComputedStyle(element).animationName, transform:getComputedStyle(element).transform })), { name:'none', transform:'none' });
      assert.deepEqual(await page.evaluate(() => window.profileMotion), []);
    }
    evidence.push({scenario:'profile-motion',normalDurationMs:220,systemReduced:true,appReduced:true});
    await page.evaluate(() => window.fixture.error('This profile is unavailable.'));
    await settle(page);
    assert.equal(await page.locator('[data-design-id="identity"]').count(), 0, 'blocked/unavailable response hides cached identity');
    await page.evaluate(() => { window.fixture.error(null); window.fixture.signedIn(false); });
    await settle(page);
    assert.equal(await page.locator('[data-design-id="identity"]').count(), 0, 'sign-out hides cached identity');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    await writeFile(path.join(output, `${name}-${locale}.json`), JSON.stringify({ passed: true, engine: name, locale, viewport: { width: 390, height: 844 }, actualReactComponents: true, syntheticTransportOnly: true, pageErrors: errors, externalRequests: external, evidence }, null, 2) + '\n');
  } catch (error) { await page.screenshot({ path: path.join(output, `${name}-${locale}-failure.png`), fullPage: true }).catch(() => {}); throw error; }
  finally { await browser.close(); }
});
