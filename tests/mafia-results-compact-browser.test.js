import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

let server, origin;
const output = path.resolve('.cache/mafia-results-browser');
before(async () => {
  await mkdir(output, { recursive: true });
  const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{MafiaMatchView,MafiaLobby,MafiaDirectory}from'./src/online/Mafia.jsx';import{createMafiaVisualFixture}from'./src/games/mafia/preview-fixtures.js';import{useRoute,navigate}from'./src/platform/router.js';import ui from'./src/shared/ui/ui.css';import online from'./src/online/online.css';import shell from'./src/online/online-mafia.css';
  function initial(){const p=createMafiaVisualFixture('ending');p.state.chats={public:[{id:'public-chat',playerId:p.me.id,text:'PUBLIC_RECEIVED_CHAT',at:Date.now()}],team:[{id:'team-secret',text:'PRIVATE_TEAM_NEVER_PUBLISH'}],observers:[]};p.state.replay.events=Array.from({length:80},(_,i)=>({id:'replay-'+i,text:'PUBLIC_REPLAY_EVENT_'+i}));return{...p,accountId:'result-owner',isHost:true};}
  function App(){const route=useRoute(),[p,set]=useState(initial);window.commands??=[];window.change=patch=>flushSync(()=>set(old=>({...old,...patch,state:{...old.state,...patch.state}})));window.replyRestart=()=>flushSync(()=>set(old=>({...old,state:{...old.state,phase:'lobby',phaseId:old.state.phaseId+1,matchId:old.state.matchId+1,replay:null,outcome:null,you:null}})));const act=async(type,fields)=>{window.commands.push({type,...fields});return true;};return <><style>{ui}{online}{shell}</style>{route.name==='online'?<MafiaDirectory rooms={[{code:'123456',roomName:'مجلس اختبار محلي',players:6,capacity:12,mode:'shadow',voiceMode:'off',status:'waiting',joinable:true}]} enabled footer={null} onJoin={()=>navigate('/room/123456')}/>:<div className="mafia-online-shell"><div className="mafia-room-shell"><div className="mafia-room-tools" style={{height:44}}>نتيجة عرض معزولة · ١٢ لاعبًا</div>{p.state.phase==='lobby'?<MafiaLobby {...p} act={act}/>:<MafiaMatchView {...p} act={act} voice={{status:'off'}}/>}</div></div>}</>;}createRoot(document.getElementById('root')).render(<App/>);`;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
  const html = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;min-height:100%}body{font-family:Arial,sans-serif}*{box-sizing:border-box}</style><div id="root"></div><script src="/app.js"></script></html>';
  server = createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
    if (req.url === '/') { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(html); return; }
    const file = path.resolve('public', '.' + new URL(req.url, 'http://fixture').pathname);
    if (file.startsWith(path.resolve('public') + path.sep)) try { res.end(await readFile(file)); return; } catch { /* only public fixture assets */ }
    res.writeHead(204); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`twelve-player Mafia result ${name}: compact actions, progressive reveals, private history and navigation`, { timeout: 60000 }, async () => {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 932 }, locale: 'ar', reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/#/online/mafia');
    await page.locator('[data-design-id="room-join"]').click();
    const restart = page.locator('[data-design-id="restart"]'); await restart.waitFor();
    const baseline = await page.evaluate(() => ({ documentHeight: document.documentElement.scrollHeight, viewport: innerHeight, restart: document.querySelector('[data-design-id="restart"]').getBoundingClientRect().toJSON() }));
    await writeFile(path.join(output, name + '-default.json'), JSON.stringify(baseline));
    await page.screenshot({ path: path.join(output, name + '-default.png'), fullPage: true });
    assert.ok(baseline.restart.y >= 0 && baseline.restart.bottom <= 932, 'the sole rematch action is available without scrolling past twelve portraits');
    assert.ok(baseline.documentHeight < 1600, 'the default result is brief even with80 replay events');
    assert.equal(await restart.count(), 1);
    assert.equal(await page.locator('.mafia-recap-player').count(), 12);
    await page.evaluate(() => window.change({ state: { members: Array.from({ length: 12 }, (_, i) => ({ id: 'local-display-' + (i + 1), name: 'لاعب عرض ' + i, seat: 12 - i, connected: true, ready: true, alive: true })) } }));
    assert.equal(await page.locator('.mafia-result-seat').first().innerText(), '١٢', 'result numbers retain authoritative seats rather than assigning new recap positions');
    assert.equal(await page.locator('.mafia-recap .mafia-role-art').count(), 0, 'large portraits mount only after an explicit disclosure');
    assert.equal(await page.getByText('PUBLIC_REPLAY_EVENT_79', { exact: true }).count(), 0);
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 390, height: 420 }]) {
      await page.setViewportSize(viewport); await page.evaluate(() => window.scrollTo(0, 0));
      const box = await restart.boundingBox();
      assert.ok(box.height >= 44 && box.y >= 0 && box.y + box.height <= viewport.height, `${name} ${viewport.width}x${viewport.height} rematch remains usable`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const cards = await page.locator('.mafia-recap-player>summary').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
      assert.ok(cards.every(height => height >= 44));
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => window.change({ state: { members: Array.from({ length: 12 }, (_, i) => ({ id: 'local-display-' + (i + 1), name: 'عبدالرحمنأبوالميدان' + i, connected: true, ready: true, alive: true })) } }));
    const textStress = await page.addStyleTag({ content: '.mafia-results,.mafia-results *{font-size:20px!important}' });
    const enlarged = await restart.boundingBox(); assert.ok(enlarged.height >= 44 && enlarged.y + enlarged.height <= 568);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await textStress.evaluate(node => node.remove());
    await page.setViewportSize({ width: 430, height: 932 });
    const role = page.locator('.mafia-recap-player').first();
    await role.locator('summary').click(); await role.locator('.mafia-role-art').waitFor();
    assert.equal(await page.locator('.mafia-recap .mafia-role-art').count(), 1);
    assert.ok((await role.locator('.mafia-role-art').boundingBox()).width >= 90);
    await page.screenshot({ path: path.join(output, name + '-expanded-role.png'), fullPage: true });
    await role.locator('summary').focus(); await page.keyboard.press('Enter'); await role.locator('.mafia-role-art').waitFor({ state: 'detached' });
    const replay = page.locator('.mafia-result-replay'); await replay.locator('summary').click();
    await page.getByText('PUBLIC_REPLAY_EVENT_79', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, name + '-expanded-replay.png') });
    await replay.locator('summary').focus(); await page.keyboard.press('Enter'); await page.getByText('PUBLIC_REPLAY_EVENT_79', { exact: true }).waitFor({ state: 'detached' });
    await page.locator('[data-design-id="timeline-toggle"]').click(); await page.getByText('PUBLIC_RECEIVED_CHAT', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-design-id="message-input"]').count(), 0);
    assert.equal(await page.getByText('PRIVATE_TEAM_NEVER_PUBLISH', { exact: true }).count(), 0);
    await page.goBack(); await page.locator('[data-design-id="room-join"]').waitFor();
    await page.locator('[data-design-id="room-join"]').click(); await restart.waitFor();
    await page.evaluate(() => window.change({ isHost: false })); assert.equal(await restart.count(), 0);
    await page.evaluate(() => window.change({ isHost: true, disabled: true })); assert.equal(await restart.isDisabled(), true);
    await page.evaluate(() => window.change({ disabled: false })); await restart.click();
    assert.deepEqual(await page.evaluate(() => window.commands), [{ type: 'restart' }]);
    await page.evaluate(() => window.replyRestart()); await page.locator('[data-design-id="ready"]').waitFor();
    assert.equal(await page.locator('[data-design-id="results"]').count(), 0);
    await page.evaluate(() => window.change({ state: { phase: 'discussion', phaseId: 50, replay: { players: [{ playerId: 'local-display-2', roleId: 'leader', faction: 'shadow' }], events: [{ text: 'STALE_REPLAY_MUST_NOT_RENDER' }] } } }));
    assert.equal(await page.locator('[data-design-id="recap"]').count(), 0);
    assert.equal(await page.getByText('STALE_REPLAY_MUST_NOT_RENDER', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
