// Interactive canvas and phone layout acceptance with synthetic drawing transport.
// This does not stand in for actual multi-device latency or native microphone QA.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ErsomhaMatch}from'./src/online/Ersomha.jsx';
import{BrandFonts}from'./src/shared/brand/art.jsx';import{TopBar,Button}from'./src/shared/ui/components.jsx';import ui from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';import brand from'./src/shared/brand/brand.css';import online from'./src/online/online.css';
let inkMeasuring=false,inkSamples=[],inkEvent=null;
for(const type of ['pointerdown','pointermove'])document.addEventListener(type,event=>{if(!inkMeasuring||!event.buttons||!event.target.classList?.contains('ers-board'))return;const started=performance.now(),bounds=event.target.getBoundingClientRect();inkEvent={started,canvas:event.target,x:Math.max(0,Math.min(999,Math.floor((event.clientX-bounds.left)/bounds.width*1000))),y:Math.max(0,Math.min(999,Math.floor((event.clientY-bounds.top)/bounds.height*1000))),recorded:false}},true);
for(const method of ['stroke','fill']){const original=CanvasRenderingContext2D.prototype[method];CanvasRenderingContext2D.prototype[method]=function(...args){const result=original.apply(this,args);if(inkMeasuring&&inkEvent&&!inkEvent.recorded&&inkEvent.canvas===this.canvas&&this.getImageData(inkEvent.x,inkEvent.y,1,1).data[3]){inkEvent.recorded=true;inkSamples.push(performance.now()-inkEvent.started)}return result}}
window.beginInkProbe=()=>{inkSamples=[];inkEvent=null;inkMeasuring=true};window.finishInkProbe=()=>{inkMeasuring=false;return [...inkSamples]};
const members=Array.from({length:8},(_,i)=>({id:'p'+i,name:['عمر','ليان','عبدالله','أحمد','نور','سارة','يزن','هبة'][i],avatar:i%4,score:i*50,connected:true}));
let state={game:'ersomha',phase:'draw',code:'123456',matchId:'fixture',round:1,rounds:8,drawerId:'p0',mode:'competitive',settings:{cycles:1,difficulty:'medium',categories:[]},deadlineAt:Date.now()+60000,participants:members.map(p=>p.id),members,drawing:{epoch:1,seq:0},myWord:'قطار',category:'transport',publicWord:{wordLengths:[],letters:[]},guessedIds:[],recentGuesses:[]};
let operations=[],undone=[],seq=0,epoch=1,hold=false,delayed=[];const commands=[],listeners=new Set();
const emit=(kind,fields={})=>{const event={type:'drawing',kind,matchId:state.matchId,round:state.round,epoch,seq,...fields};for(const listener of listeners)listener(event)};
const snapshot=()=>emit('sync',{ops:operations.map(o=>({...o,points:o.points.map(p=>[...p])})),undoneIds:undone,chunk:0,chunks:1});
const client={ws:{bufferedAmount:0},subscribeDrawing(fn){listeners.add(fn);return()=>listeners.delete(fn)},command(type,fields={}){commands.push({type,fields,at:performance.now()});return new Promise((resolve,reject)=>{const run=()=>{if(type==='drawing_sync'){snapshot();resolve({ok:true});return}if(type!=='drawing_sync'&&fields.epoch!==epoch){reject(Object.assign(new Error('ERSOMHA_CANVAS_STALE'),{code:'ERSOMHA_CANVAS_STALE'}));return}if(type==='drawing_batch'){operations=operations.filter(op=>!undone.includes(op.strokeId));undone=[];let previous=operations.find(op=>op.strokeId===fields.strokeId);if(previous){previous.points.push(...fields.points);previous.end=fields.end}else operations.push({...fields,points:[...fields.points]});seq++;emit('append',{op:fields});resolve({ok:true,seq});return}if(type==='drawing_undo'){const found=[...operations].reverse().find(op=>op.end&&!undone.includes(op.strokeId));if(found){undone.push(found.strokeId);seq++;emit('undo',{strokeId:found.strokeId})}resolve({ok:true});return}if(type==='drawing_redo'){const id=undone.pop();if(id){seq++;emit('redo',{strokeId:id})}resolve({ok:true});return}if(type==='drawing_clear'){operations=[];undone=[];epoch++;seq=0;emit('clear');resolve({ok:true});return}reject(Error(type))};if(hold)delayed.push(run);else setTimeout(run,type==='drawing_batch'?120:0)})}};
function App(){const[value,setValue]=useState({state,index:0,status:'connected',drawerReady:true});window.harness={set(patch){setValue(old=>{const next={...old,...patch,state:patch.state?{...old.state,...patch.state}:old.state};state=next.state;return next})},commands,client,snapshot,hold(value){hold=value;if(!value){const pending=delayed;delayed=[];pending.forEach(fn=>fn())}},operations:()=>operations,emit};return <><BrandFonts/><style>{tokens}</style><style>{ui}</style><style>{brand}</style><style>{online}</style><style>{'.fixture-room-header{height:80px;flex:none;overflow:hidden}.fixture-room-header .topbar{min-height:42px;margin:0}.fixture-room-header .topbar h1{font-size:1rem}.fixture-room-header .eyebrow{font-size:.6rem}.fixture-room-header .online-connection{padding:3px 8px;margin-top:3px;font-size:.7rem}'}</style><main className="screen online-screen stack"><div className="fixture-room-header"><TopBar title="ارسمها" eyebrow="غرفة 123456" end={<Button size="sm">خروج</Button>}/><p className="online-connection connected">متصل · كل واحد بجواله</p></div><ErsomhaMatch state={value.state} me={members[value.index]} disabled={value.status!=='connected'} isHost={value.index===0} act={async(type,fields)=>{commands.push({type,fields});if(type==='guess'){window.harness.set({state:{myGuessed:true,guessedIds:[members[value.index].id]}})}return true}} client={client} status={value.status} drawerReady={value.drawerReady} onReport={async()=>{}} /></main></>};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`;
const server = http.createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = process.env.E2E_OUTPUT_DIR || '.cache/ersomha-ui'; await fs.mkdir(output, { recursive: true });
const result = { scope: 'Current Ersomha UI and imperative canvas, synthetic transport only; no production writes, no physical device speed claim', browsers: [] };
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin); await page.locator('.ers-board-status').waitFor({ state: 'hidden' });
      const board = page.locator('canvas'), box = await board.boundingBox();
      assert.ok(Math.abs(box.width - box.height) < 2, JSON.stringify(box));
      await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2); await page.mouse.down();
      const start = await page.evaluate(() => performance.now());
      await page.mouse.move(box.x + box.width * .7, box.y + box.height * .7, { steps: 8 });
      const local = await board.evaluate(canvas => {
        const context = canvas.getContext('2d'); let ink = 0;
        for (const channel of context.getImageData(180, 180, 550, 550).data) if (channel) ink++;
        return { ink, time: performance.now(), sent: window.harness.commands.filter(command => command.type === 'drawing_batch').length };
      });
      assert.ok(local.ink > 100, 'Local lines paint before the remote acknowledgement');
      await page.mouse.up();
      await page.waitForFunction(() => window.harness.operations().some(op => op.end));
      const batches = await page.evaluate(() => window.harness.commands.filter(command => command.type === 'drawing_batch'));
      assert.ok(batches.length >= 1 && batches.length <= 8); assert.ok(batches.every(batch => batch.fields.points.length <= 32));
      await board.scrollIntoViewIfNeeded(); const probeBox = await board.boundingBox();
      await page.evaluate(() => window.beginInkProbe()); await page.mouse.move(probeBox.x + probeBox.width * .15, probeBox.y + probeBox.height * .75); await page.mouse.down(); await page.mouse.move(probeBox.x + probeBox.width * .85, probeBox.y + probeBox.height * .3, { steps: 60 }); await page.mouse.up();
      const inkSamples = await page.evaluate(() => window.finishInkProbe()); const orderedInk = [...inkSamples].sort((a,b)=>a-b); const inkP95 = orderedInk[Math.ceil(orderedInk.length * .95) - 1];
      assert.ok(inkSamples.length >= 50, 'Measure at least 50 genuine pointer callbacks, not gesture wall time'); assert.ok(inkP95 <= 32, `Pointer callback to readable local ink P95 ${inkP95}ms exceeds 32ms`);
      await page.waitForFunction(() => window.harness.operations().filter(op => op.end).length >= 2);
      await page.getByRole('button', { name: 'تراجع عن آخر خط', exact: true }).click();
      await page.getByRole('button', { name: 'إعادة الخط المتراجع عنه', exact: true }).waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('[aria-label="إعادة الخط المتراجع عنه"]').disabled);
      await page.getByRole('button', { name: 'إعادة الخط المتراجع عنه', exact: true }).click();
      await page.getByRole('button', { name: 'مسح اللوحة', exact: true }).click();
      const clear = page.getByRole('dialog'); await clear.getByRole('button', { name: 'إكمال الرسم' }).click(); await clear.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.harness.commands.filter(command => command.type === 'drawing_clear').length), 0);
      await page.getByRole('button', { name: 'مسح اللوحة', exact: true }).click(); await page.getByRole('dialog').waitFor(); await page.evaluate(() => window.harness.set({ state: { phase: 'result', revealedWord: 'قطار' } })); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.harness.commands.filter(command => command.type === 'drawing_clear').length), 0, 'Changing the phase closes a stale clear confirmation without executing it');
      await page.evaluate(() => window.harness.set({ state: { phase: 'draw' } }));
      await page.getByRole('button', { name: 'مسح اللوحة', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'مسح اللوحة', exact: true }).click();
      await page.waitForFunction(() => window.harness.operations().length === 0);
      await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.locator('.ers-board-status').waitFor({ state: 'hidden' });
      await board.scrollIntoViewIfNeeded(); await page.evaluate(() => { window.harness.client.ws.bufferedAmount = 40000; });
      const pressureBox = await board.boundingBox(); await page.mouse.move(pressureBox.x + 25, pressureBox.y + 25); await page.mouse.down(); await page.mouse.move(pressureBox.x + 80, pressureBox.y + 80); await page.mouse.up();
      await page.getByText('نثبت خطوطك… أمهل الاتصال لحظة قبل متابعة الرسم.').waitFor({ timeout: 3000 });
      const pressureCount = await page.evaluate(() => window.harness.commands.filter(command => command.type === 'drawing_batch').length);
      await page.evaluate(() => { window.harness.client.ws.bufferedAmount = 0; });
      await page.waitForFunction(before => window.harness.commands.filter(command => command.type === 'drawing_batch').length > before, pressureCount);
      await page.getByText('نثبت خطوطك… أمهل الاتصال لحظة قبل متابعة الرسم.').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => window.harness.operations().some(op => op.end));
      assert.equal(await page.evaluate(() => window.harness.commands.filter(command => command.type === 'drawing_batch').at(-1).fields.epoch), 2, 'Clear advances drawing commands through its delta alone, without a state snapshot');
      await page.getByRole('button', { name: 'تراجع عن آخر خط', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="إعادة الخط المتراجع عنه"]').disabled);
      const discardedId = await page.evaluate(() => window.harness.operations()[0].strokeId);
      await board.scrollIntoViewIfNeeded(); const replacementBox = await board.boundingBox();
      await page.mouse.move(replacementBox.x + 40, replacementBox.y + 90); await page.mouse.down(); await page.mouse.move(replacementBox.x + 90, replacementBox.y + 120); await page.mouse.up();
      await page.waitForFunction(oldId => window.harness.operations().some(op => op.strokeId !== oldId && op.end), discardedId);
      await page.waitForFunction(() => document.querySelector('[aria-label="إعادة الخط المتراجع عنه"]').disabled);
      assert.equal(await page.getByRole('button', { name: 'إعادة الخط المتراجع عنه', exact: true }).isDisabled(), true, 'Fresh ink discards the redo branch in the visible controls');
      assert.equal(await page.evaluate(oldId => window.harness.operations().some(op => op.strokeId === oldId), discardedId), false);
      await page.evaluate(() => window.harness.set({ status: 'reconnecting' }));
      await page.getByText('نستعيد اتصالك والرسمة…').waitFor();
      const before = await page.evaluate(() => window.harness.commands.length);
      await board.scrollIntoViewIfNeeded(); const nextBox = await board.boundingBox(); await page.mouse.move(nextBox.x + 20, nextBox.y + 20); await page.mouse.down(); await page.mouse.move(nextBox.x + 60, nextBox.y + 60); await page.mouse.up();
      assert.equal(await page.evaluate(() => window.harness.commands.length), before, 'Offline drawing cannot enqueue commands');
      await page.evaluate(() => window.harness.set({ status: 'connected' })); await page.locator('.ers-board-status').waitFor({ state: 'hidden' });
      await page.evaluate(() => window.harness.set({ state: { phase: 'select', myChoices: [{ id: 'a', text: 'PRIVATE_CHOICE', category: 'food' }] }, drawerReady: false }));
      assert.equal(await page.getByText('PRIVATE_CHOICE').count(), 0); await page.getByText('نجهّز دورك…').waitFor();
      await page.evaluate(() => window.harness.set({ drawerReady: true })); await page.getByText('PRIVATE_CHOICE').waitFor();
      await page.screenshot({ path: path.join(output, `${name}-choice-phone.png`), fullPage: true });
      await page.evaluate(() => window.harness.set({ index: 1, state: { phase: 'draw', myWord: null, myChoices: [], deadlineAt: Date.now() + 60000, publicWord: { wordLengths: [4], letters: [{ index: 1, char: 'ط' }] } } }));
      const guess = page.getByRole('textbox', { name: 'ما الذي يرسمه صاحبك؟' }); await guess.fill('قطار');
      await guess.dispatchEvent('compositionstart'); await guess.press('Enter'); assert.equal(await page.evaluate(() => window.harness.commands.filter(command => command.type === 'guess').length), 0, 'IME confirmation cannot submit an unfinished guess'); await guess.dispatchEvent('compositionend');
      await guess.press('Enter'); await page.getByText('عرفتها! ✨').waitFor({ timeout: 5000 });
      await page.evaluate(() => window.harness.set({ index: 2, state: { myGuessed: false } }));
      await page.getByRole('textbox', { name: 'ما الذي يرسمه صاحبك؟' }).focus();
      await page.evaluate(() => { const viewport = new EventTarget(); Object.defineProperties(viewport, { height: { value: 420 }, scale: { value: 1 } }); Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true }); document.dispatchEvent(new FocusEvent('focusin')); viewport.dispatchEvent(new Event('resize')); });
      await page.waitForFunction(() => document.querySelector('.ersomha').classList.contains('is-keyboard'));
      const keyboardBoard = await board.boundingBox(); assert.ok(Math.abs(keyboardBoard.width - keyboardBoard.height) < 2 && keyboardBoard.width <= 195);
      await page.screenshot({ path: path.join(output, `${name}-keyboard-phone.png`), fullPage: true });
      const layouts = [];
      for (const viewport of [{ width: 320, height: 740 }, { width: 375, height: 812 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport); await page.reload(); await page.locator('.ers-board-status').waitFor({ state: 'hidden' }); await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
        const layout = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, board: (() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })(), tools:[...document.querySelectorAll('.ers-tools button')].map(button=>{const r=button.getBoundingClientRect();return {label:button.textContent,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}), colours: [...document.querySelectorAll('.ers-colour')].map(button => { const r = button.getBoundingClientRect(); return { width: r.width, height: r.height }; }) }));
        assert.equal(layout.overflow, false, JSON.stringify(layout)); assert.ok(layout.board.left >= 0 && layout.board.right <= viewport.width + 1); assert.ok(Math.abs(layout.board.width - layout.board.height) < 2); assert.ok(layout.colours.every(control => control.width >= 44 && control.height >= 44), JSON.stringify(layout));
        if (viewport.width === 390 || viewport.width === 844) assert.ok(layout.board.top >= 0 && layout.board.bottom <= viewport.height + 1 && layout.tools.every(tool => tool.top >= 0 && tool.bottom <= viewport.height + 1), `Canvas and essential tools must be visible together after the 80px room header: ${JSON.stringify(layout)}`);
        layouts.push(layout); await page.screenshot({ path: path.join(output, `${name}-draw-${viewport.width}.png`), fullPage: true });
        if (viewport.width === 390 || viewport.width === 844) {
          await page.locator('.fixture-room-header').evaluate(node => { node.style.height = '140px'; });
          await page.waitForFunction(height => { const board=document.querySelector('canvas').getBoundingClientRect();return board.bottom<=height+1&&[...document.querySelectorAll('.ers-tools button')].every(button=>button.getBoundingClientRect().bottom<=height+1); }, viewport.height);
          await page.screenshot({ path: path.join(output, `${name}-draw-${viewport.width}-header140.png`), fullPage: true });
          await page.locator('.fixture-room-header').evaluate(node => { node.style.height = '80px'; });
        }
      }
      await page.evaluate(() => { document.documentElement.style.setProperty('--safe-bottom', '21px'); document.documentElement.style.setProperty('--safe-left', '44px'); document.documentElement.style.setProperty('--safe-right', '44px'); });
      const safeBoard = await board.boundingBox(); assert.ok(safeBoard.y + safeBoard.height <= 370, 'Landscape board respects the iPhone home-indicator inset');
      await page.evaluate(() => window.harness.set({ index: 1, state: { myWord: null } }));
      const guessLandscape = await page.locator('.ers-guess').boundingBox(); const guessBoard = await board.boundingBox();
      assert.ok(guessLandscape.y >= 0 && guessLandscape.y + guessLandscape.height <= 370 && guessBoard.y + guessBoard.height <= 370, 'A landscape guesser sees the canvas and input together above the safe area');
      await page.screenshot({ path: path.join(output, `${name}-guess-landscape.png`), fullPage: true });
      await page.getByRole('button', { name: 'الإبلاغ عن الرسمة' }).click(); await page.getByRole('dialog').getByLabel('السبب').selectOption('محتوى غير مناسب'); await page.evaluate(() => window.harness.set({ state: { round: 2 } })); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await page.locator('.ers-word-banner').evaluate(node => getComputedStyle(node).animationName), 'none');
      assert.deepEqual(errors, []);
      result.browsers.push({ name, localInkBeforeRemoteAck: true, localInkProbe: { scope: 'Genuine browser pointer capture callback to first canvas stroke/fill with readable ink at its point; includes 1x1 pixel readback, does not measure physical display presentation', sampleCount: inkSamples.length, p95Ms: inkP95, maxMs: Math.max(...inkSamples), samplesMs: inkSamples }, localGestureMeasurementMs: local.time - start, batches: batches.length, undoRedo: true, clearConfirmation: true, backpressureResume: true, reconnectSync: true, mutePrivacyCurtain: true, guessing: true, imeGuard: true, keyboardSquareBoard: true, reducedMotion: true, layouts });
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, `${name}-failure.json`), JSON.stringify(await page.evaluate(() => ({ commands: window.harness?.commands, text: document.body.innerText, input: document.querySelector('.ers-guess input')?.value, guessDisabled: document.querySelector('.ers-guess button')?.disabled, active: document.activeElement?.tagName })).catch(() => ({})), null, 2));
      throw error;
    } finally { await browser.close(); }
  }
} finally { server.close(); }
await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
