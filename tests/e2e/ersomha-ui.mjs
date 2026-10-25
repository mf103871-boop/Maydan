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
import{back}from'./src/platform/router.js';import{CallControls}from'./src/social/CallDock.jsx';import{useCallDockLayout}from'./src/social/CallViewport.jsx';import{BrandFonts}from'./src/shared/brand/art.jsx';import{TopBar,Button}from'./src/shared/ui/components.jsx';import ui from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';import brand from'./src/shared/brand/brand.css';import online from'./src/online/online.css';
let inkMeasuring=false,inkSamples=[],inkEvent=null;
for(const type of ['pointerdown','pointermove'])document.addEventListener(type,event=>{if(!inkMeasuring||!event.buttons||!event.target.classList?.contains('ers-board'))return;const started=performance.now(),bounds=event.target.getBoundingClientRect();inkEvent={started,canvas:event.target,x:Math.max(0,Math.min(event.target.width-1,Math.floor((event.clientX-bounds.left)/bounds.width*event.target.width))),y:Math.max(0,Math.min(event.target.height-1,Math.floor((event.clientY-bounds.top)/bounds.height*event.target.height))),recorded:false}},true);
for(const method of ['stroke','fill']){const original=CanvasRenderingContext2D.prototype[method];CanvasRenderingContext2D.prototype[method]=function(...args){const result=original.apply(this,args);if(inkMeasuring&&inkEvent&&!inkEvent.recorded&&inkEvent.canvas===this.canvas&&this.getImageData(inkEvent.x,inkEvent.y,1,1).data[3]){inkEvent.recorded=true;inkSamples.push(performance.now()-inkEvent.started)}return result}}
window.beginInkProbe=()=>{inkSamples=[];inkEvent=null;inkMeasuring=true};window.finishInkProbe=()=>{inkMeasuring=false;return [...inkSamples]};
const members=Array.from({length:8},(_,i)=>({id:'p'+i,name:['عمر','ليان','عبدالله','أحمد','نور','سارة','يزن','هبة'][i],avatar:i%4,score:i*50,connected:true}));
const fixtureCall={id:'fixture-call',name:'مكالمة الشلّة',scope:'group',status:'active',acceptedAt:Date.now()-20000};
const fixtureMedia={connected:true,connecting:false,muted:true,userId:'p0',participants:members.slice(0,2).map((person,index)=>({...person,userId:person.id,muted:!index,speaking:!!index}))};
let state={game:'ersomha',phase:'draw',code:'123456',matchId:1,round:1,rounds:8,drawerId:'p0',mode:'competitive',settings:{cycles:1,difficulty:'medium',categories:[]},deadlineAt:Date.now()+60000,participants:members.map(p=>p.id),members,drawing:{epoch:1,seq:0},myWord:'قطار',category:'transport',publicWord:{wordLengths:[],letters:[]},guessedIds:[],recentGuesses:[]};
let operations=[],undone=[],seq=0,epoch=1,hold=false,delayed=[];const commands=[],listeners=new Set();
const emit=(kind,fields={})=>{const event={type:'drawing',kind,matchId:state.matchId,round:state.round,epoch,seq,...fields};for(const listener of listeners)listener(event)};
const snapshot=()=>emit('sync',{ops:operations.map(o=>({...o,points:o.points.map(p=>[...p])})),undoneIds:undone,chunk:0,chunks:1});
const client={ws:{bufferedAmount:0},subscribeDrawing(fn){listeners.add(fn);return()=>listeners.delete(fn)},command(type,fields={}){commands.push({type,fields,at:performance.now()});return new Promise((resolve,reject)=>{const run=()=>{if(fields.matchId!==state.matchId||fields.round!==state.round){reject(Object.assign(new Error('STALE'),{code:'STALE'}));return}if(type==='drawing_sync'){snapshot();resolve({ok:true});return}if(type!=='drawing_sync'&&fields.epoch!==epoch){reject(Object.assign(new Error('ERSOMHA_CANVAS_STALE'),{code:'ERSOMHA_CANVAS_STALE'}));return}if(type==='drawing_batch'){operations=operations.filter(op=>!undone.includes(op.strokeId));undone=[];let previous=operations.find(op=>op.strokeId===fields.strokeId);if(previous){previous.points.push(...fields.points);previous.end=fields.end}else operations.push({...fields,points:[...fields.points]});seq++;emit('append',{op:fields});resolve({ok:true,seq});return}if(type==='drawing_undo'){const found=[...operations].reverse().find(op=>op.end&&!undone.includes(op.strokeId));if(found){undone.push(found.strokeId);seq++;emit('undo',{strokeId:found.strokeId})}resolve({ok:true});return}if(type==='drawing_redo'){const id=undone.pop();if(id){seq++;emit('redo',{strokeId:id})}resolve({ok:true});return}if(type==='drawing_clear'){operations=[];undone=[];epoch++;seq=0;emit('clear');resolve({ok:true});return}reject(Error(type))};if(hold)delayed.push(run);else setTimeout(run,type==='drawing_batch'?120:0)})}};
function App(){const[value,setValue]=useState({state,index:0,status:'connected',drawerReady:true});useCallDockLayout(Boolean(value.showCall));window.harness={back,set(patch){setValue(old=>{const next={...old,...patch,state:patch.state?{...old.state,...patch.state}:old.state};state=next.state;return next})},commands,client,snapshot,hold(value){hold=value;if(!value){const pending=delayed;delayed=[];pending.forEach(fn=>fn())}},operations:()=>operations,emit};return <><BrandFonts/><style>{tokens}</style><style>{ui}</style><style>{brand}</style><style>{online}</style><style>{'.fixture-room-header{height:80px;flex:none;overflow:hidden}.fixture-room-header .topbar{min-height:42px;margin:0}.fixture-room-header .topbar h1{font-size:1rem}.fixture-room-header .eyebrow{font-size:.6rem}.fixture-room-header .online-connection{padding:3px 8px;margin-top:3px;font-size:.7rem}'}</style><main className="screen online-screen stack"><div className="fixture-room-header"><TopBar title="ارسمها" eyebrow="غرفة 123456" end={<Button size="sm">خروج</Button>}/><p className="online-connection connected">متصل · كل واحد بجواله</p></div><ErsomhaMatch state={value.state} me={members[value.index]} disabled={value.status!=='connected'} isHost={value.index===0} act={async(type,fields)=>{commands.push({type,fields});if(type==='guess'){window.harness.set({state:{myGuessed:true,guessedIds:[members[value.index].id]}})}return true}} client={client} status={value.status} drawerReady={value.drawerReady} onReport={async()=>{}} /></main>{value.showCall&&<CallControls call={fixtureCall} media={fixtureMedia} currentUserId="p0" privateTurn={value.index===0&&value.state.phase==="draw"} />}</>};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
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
      await page.goto(origin); await page.locator('canvas').waitFor(); await page.locator('.ers-board-status').waitFor({ state: 'hidden' });
      const board = page.locator('canvas'), box = await board.boundingBox();
      assert.ok(Math.abs(box.width - box.height) < 2, JSON.stringify(box));
      await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2); await page.mouse.down();
      const start = await page.evaluate(() => performance.now());
      await page.mouse.move(box.x + box.width * .7, box.y + box.height * .7, { steps: 8 });
      const local = await board.evaluate(canvas => {
        const context = canvas.getContext('2d'); let ink = 0;
        for (const channel of context.getImageData(0, 0, canvas.width, canvas.height).data) if (channel) ink++;
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
      // Regression: a batch drain used to consume the same timer as an active
      // stroke's flush, leaving newer tail points local until pointer-up.
      const heldBefore = await page.evaluate(() => window.harness.operations().length);
      await board.evaluate(canvas => {
        const rect = canvas.getBoundingClientRect();
        window.heldDrawingPointer = (type, index) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 85, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: rect.left + rect.width * (.1 + index * .01), clientY: rect.top + rect.height * .4 }));
        window.heldDrawingPointer('pointerdown', 0);
        for (let index = 1; index <= 36; index++) window.heldDrawingPointer('pointermove', index);
      });
      await page.waitForTimeout(110);
      await page.evaluate(() => { for (let index = 37; index <= 40; index++) window.heldDrawingPointer('pointermove', index); });
      await page.waitForFunction(before => window.harness.operations().length > before && window.harness.operations().at(-1).points.length >= 41, heldBefore, { timeout: 1000 });
      const heldStroke = await page.evaluate(() => window.harness.operations().at(-1));
      assert.equal(heldStroke.end, false, 'The remaining line reaches the remote side while the drawing finger is still held');
      assert.ok(Math.abs(heldStroke.points.at(-1)[0] - .5) < .001, 'The newer tail cannot wait for pointer-up behind a scheduled drain');
      await page.evaluate(() => window.heldDrawingPointer('pointerup', 40));
      await page.waitForFunction(() => window.harness.operations().at(-1).end);
      // Reproduce iOS-style editor and empty-coalesced-pointer paths. The actual
      // canvas/component handles these events; only transport and edge timing
      // are synthetic. No physical Pencil/keyboard claim is made here.
      const gestureBefore = await page.evaluate(() => window.harness.operations().length);
      const gesture = await board.evaluate(canvas => {
        const editor = document.createElement('input'); editor.value = 'مسودة محفوظة'; editor.id = 'previous-editor'; document.body.append(editor); editor.focus();
        window.harness.client.state = { matchId: 99, round: 99 };
        const rect = canvas.getBoundingClientRect();
        const send = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 81, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y }));
        const downPrevented = !send('pointerdown', 81, .2, .25);
        send('pointercancel', 82, .4, .4); // A different finger must not finish 81.
        send('pointermove', 81, .5, .45); // Synthetic events expose [] coalescing.
        send('pointerup', 81, .75, .2);
        const editorBlurred = document.activeElement !== editor, draft = editor.value; editor.remove();
        const blocked = ['selectstart', 'contextmenu', 'dragstart'].map(type => { const event = new Event(type, { bubbles: true, cancelable: true }); canvas.dispatchEvent(event); return event.defaultPrevented; });
        return { downPrevented, editorBlurred, draft, blocked };
      });
      assert.deepEqual(gesture, { downPrevented: true, editorBlurred: true, draft: 'مسودة محفوظة', blocked: [true, true, true] });
      await page.waitForFunction(before => window.harness.operations().length > before && window.harness.operations().at(-1).end, gestureBefore);
      const touchStroke = await page.evaluate(() => window.harness.operations().at(-1));
      assert.ok(touchStroke.points.length >= 3, 'Empty coalescing and an unrelated pointer cancel cannot discard touch movement');
      assert.ok(Math.abs(touchStroke.points.at(-1)[0] - .75) < .001 && Math.abs(touchStroke.points.at(-1)[1] - .2) < .001, 'Pointer-up contributes its final position');
      const quickBefore = await page.evaluate(() => window.harness.operations().length);
      await board.evaluate(canvas => { const rect = canvas.getBoundingClientRect(); for (const [type, x, y] of [['pointerdown', .1, .8], ['pointerup', .8, .1]]) canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 83, pointerType: 'pen', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y })); });
      await page.waitForFunction(before => window.harness.operations().length > before && window.harness.operations().at(-1).end, quickBefore);
      assert.equal(await page.evaluate(() => window.harness.operations().at(-1).points.length), 2, 'A quick down/up preserves both endpoints without a move event');
      const lostCaptureBefore = await page.evaluate(() => window.harness.operations().length);
      await board.evaluate(canvas => {
        const original = canvas.setPointerCapture; canvas.setPointerCapture = () => { throw new DOMException('Pointer retired', 'NotFoundError'); };
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 84, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: rect.left + rect.width * .2, clientY: rect.top + rect.height * .2 }));
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 84, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: rect.right + 20, clientY: rect.top - 20 }));
        canvas.setPointerCapture = original;
      });
      await page.waitForFunction(before => window.harness.operations().length > before && window.harness.operations().at(-1).end, lostCaptureBefore);
      assert.deepEqual(await page.evaluate(() => window.harness.operations().at(-1).points.at(-1)), [1, 0], 'A rejected pointer capture still finishes an outside release and clamps its coordinate');
      assert.ok(await page.evaluate(() => window.harness.commands.every(command => !command.type.startsWith('drawing_') || (command.fields.matchId === 1 && command.fields.round === 1))), 'Drawing commands retain the round displayed by React even when the client already knows round99');
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
      assert.equal(await guess.evaluate(node => document.activeElement === node && getComputedStyle(node).caretColor !== 'rgba(0, 0, 0, 0)'), true, 'Only the drawing surface suppresses caret/selection; the guess editor still works');
      await guess.dispatchEvent('compositionstart'); await guess.press('Enter'); assert.equal(await page.evaluate(() => window.harness.commands.filter(command => command.type === 'guess').length), 0, 'IME confirmation cannot submit an unfinished guess'); await guess.dispatchEvent('compositionend');
      await guess.press('Enter'); await page.getByText('عرفتها! ✨').waitFor({ timeout: 5000 });
      await page.evaluate(() => window.harness.set({ index: 2, state: { myGuessed: false } }));
      await page.evaluate(() => window.harness.set({ showCall: true })); await page.getByTestId('call-dock').waitFor();
      await page.getByTestId('call-dock').evaluate(node => { window.fixtureCallDock = node; });
      await page.getByRole('textbox', { name: 'ما الذي يرسمه صاحبك؟' }).focus();
      await page.evaluate(() => { const viewport = new EventTarget(); Object.defineProperties(viewport, { height: { value: 420 }, scale: { value: 1 } }); Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true }); document.dispatchEvent(new FocusEvent('focusin')); viewport.dispatchEvent(new Event('resize')); });
      await page.waitForFunction(() => document.querySelector('.ersomha').classList.contains('is-keyboard'));
      await page.waitForFunction(() => document.querySelector('[data-testid="call-dock"]').dataset.keyboard === 'true');
      assert.equal(await page.getByTestId('call-dock').getAttribute('data-collapsed'), 'true', 'The existing connected call compacts during guess keyboard input');
      assert.equal(await page.getByTestId('call-dock').evaluate(node => node === window.fixtureCallDock), true, 'Guess keyboard changes keep the same call controls mounted');
      const keyboardBoard = await board.boundingBox(); assert.ok(Math.abs(keyboardBoard.width - keyboardBoard.height) < 2 && keyboardBoard.width <= 195);
      await page.screenshot({ path: path.join(output, `${name}-keyboard-phone.png`), fullPage: true });
      const layouts = [];
      for (const viewport of [{ width: 320, height: 740 }, { width: 375, height: 812 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 620, height: 430 }, { width: 667, height: 375 }, { width: 740, height: 320 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport); await page.reload(); await page.locator('canvas').waitFor(); await page.locator('.ers-board-status').waitFor({ state: 'hidden' }); await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
        const layout = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, board: (() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })(), tools:[...document.querySelectorAll('.ers-tools button')].filter(button=>button.getClientRects().length&&getComputedStyle(button).display!=='none').map(button=>{const r=button.getBoundingClientRect();return {label:button.textContent,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}), colours: [...document.querySelectorAll('.ers-colour')].filter(button=>button.getClientRects().length&&getComputedStyle(button).display!=='none').map(button => { const r = button.getBoundingClientRect(); return { width: r.width, height: r.height }; }) }));
        assert.equal(layout.overflow, false, JSON.stringify(layout)); assert.ok(layout.board.left >= 0 && layout.board.right <= viewport.width + 1); assert.ok(viewport.width > viewport.height ? layout.board.width > layout.board.height : Math.abs(layout.board.width - layout.board.height) < 2); assert.ok(layout.colours.every(control => control.width >= 44 && control.height >= 44), JSON.stringify(layout));
        if (viewport.width === 844) { assert.ok(layout.board.width >= 620, 'Landscape drawing uses the empty phone width rather than a small centered square'); }
        if (viewport.width > viewport.height) {
          assert.ok(layout.board.width >= viewport.width - 200, 'Landscape workspace uses the remaining width after its compact tools and call space');
          await page.evaluate(() => window.harness.set({ showCall: true })); await page.getByTestId('call-dock').waitFor();
          const overlaps = await page.evaluate(() => {
            const call = document.querySelector('[data-testid="call-dock"]').getBoundingClientRect();
            return [...document.querySelectorAll('.ers-tools button')].filter(button=>button.getClientRects().length&&getComputedStyle(button).display!=='none').some(button=>{const tool=button.getBoundingClientRect();return Math.min(tool.right,call.right)>Math.max(tool.left,call.left)&&Math.min(tool.bottom,call.bottom)>Math.max(tool.top,call.top);});
          });
          assert.equal(overlaps, false, 'The initial call circles do not cover landscape drawing tools');
          const wordClear = await page.evaluate(() => {
            const word = document.querySelector('.ers-match-header h1').getBoundingClientRect(), call = document.querySelector('[data-testid="call-dock"]').getBoundingClientRect();
            return word.right <= call.left || word.left >= call.right || word.bottom <= call.top || word.top >= call.bottom;
          });
          assert.equal(wordClear, true, 'Initial call circles leave the private drawing word readable');
        }
        if (viewport.width === 390 || viewport.width === 844) assert.ok(layout.board.top >= 0 && layout.board.bottom <= viewport.height + 1 && layout.tools.every(tool => tool.top >= 0 && tool.bottom <= viewport.height + 1), `Canvas and essential tools must be visible together after the 80px room header: ${JSON.stringify(layout)}`);
        layouts.push(layout); await page.screenshot({ path: path.join(output, `${name}-draw-${viewport.width}.png`), fullPage: true });
        if (viewport.width === 390 || viewport.width === 844) {
          await page.locator('.fixture-room-header').evaluate(node => { node.style.height = '140px'; });
          await page.waitForFunction(height => { const board=document.querySelector('canvas').getBoundingClientRect();return board.bottom<=height+1&&[...document.querySelectorAll('.ers-tools button')].filter(button=>button.getClientRects().length&&getComputedStyle(button).display!=='none').every(button=>button.getBoundingClientRect().bottom<=height+1); }, viewport.height);
          await page.screenshot({ path: path.join(output, `${name}-draw-${viewport.width}-header140.png`), fullPage: true });
          await page.locator('.fixture-room-header').evaluate(node => { node.style.height = '80px'; });
        }
        if (viewport.width === 844) {
          await page.evaluate(() => window.harness.set({ showCall: true })); await page.getByTestId('call-dock').waitFor();
          await page.getByTestId('call-dock').evaluate(node => { window.fixtureCallDock = node; });
          await page.screenshot({ path: path.join(output, `${name}-draw-844-call.png`), fullPage: true });
          assert.equal(await page.getByTestId('call-dock-mute').isDisabled(), true, 'The drawer cannot unmute the ongoing call while its private word is visible');
          const beforeFocusChange = await page.evaluate(() => ({ ink: window.harness.operations(), syncs: window.harness.commands.filter(item => item.type === 'drawing_sync').length }));
          await page.getByRole('button', { name: 'ألوان وأدوات إضافية', exact: true }).click();
          const toolsDialog = page.getByRole('dialog'); await toolsDialog.waitFor();
          assert.equal(await toolsDialog.locator('.ers-colour').count(), 12, 'All12 colours remain reachable through the compact toolbar');
          await toolsDialog.getByRole('button', { name: 'رمادي', exact: true }).click();
          assert.equal(await toolsDialog.getByRole('button', { name: 'رمادي', exact: true }).getAttribute('aria-pressed'), 'true');
          await page.evaluate(() => window.harness.back()); await toolsDialog.waitFor({ state: 'hidden' });
          assert.equal(await page.locator('[data-ersomha-drawing-focus="true"]').count(), 1, 'Back closes the tools dialog before collapsing the drawing workspace');
          await page.evaluate(() => window.harness.back());
          await page.getByRole('button', { name: 'تكبير لوحة الرسم', exact: true }).waitFor();
          assert.equal(await page.locator('[data-ersomha-drawing-focus="true"]').count(), 0);
          await page.getByRole('button', { name: 'تكبير لوحة الرسم', exact: true }).click();
          await page.locator('[data-ersomha-drawing-focus="true"]').waitFor();
          assert.deepEqual(await page.evaluate(() => ({ ink: window.harness.operations(), syncs: window.harness.commands.filter(item => item.type === 'drawing_sync').length })), beforeFocusChange, 'Collapsing and expanding preserve the same canvas, ink and drawing subscription');
          assert.equal(await page.getByTestId('call-dock').evaluate(node => node === window.fixtureCallDock), true, 'Room focus and dialog navigation preserve the same connected call controls');
          assert.equal(await page.getByTestId('call-dock').locator('[role="status"]').innerText(), 'صوت المكالمة متصل');
        }
      }
      // A real rectangular viewport must preserve world geometry, expose the
      // whole drawing, and retain ink through pointer/camera lifecycle changes.
      await board.evaluate(node => { window.wideCanvasIdentity = node; });
      await page.waitForFunction(() => document.querySelector('canvas').dataset.cameraMode === 'wide');
      const wideBox = await board.boundingBox(), circleBefore = await page.evaluate(() => window.harness.operations().length);
      const radius = 65, cx = wideBox.x + wideBox.width / 2, cy = wideBox.y + wideBox.height / 2;
      await page.mouse.move(cx + radius, cy); await page.mouse.down();
      for (let index = 1; index <= 40; index++) await page.mouse.move(cx + radius * Math.cos(index * Math.PI / 20), cy + radius * Math.sin(index * Math.PI / 20));
      await page.mouse.up();
      await page.waitForFunction(before => window.harness.operations().length > before && window.harness.operations().at(-1).end, circleBefore);
      const circle = await page.evaluate(() => window.harness.operations().at(-1).points);
      for (const point of circle) assert.ok(Math.abs(Math.hypot(point[0] - .5, point[1] - .5) - radius / wideBox.width) < .004, 'A circle from the wide viewport stays circular in the legacy normalized square');
      await page.getByRole('button', { name: 'عرض اللوحة كاملة', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('canvas').dataset.cameraMode === 'fit');
      assert.equal(await page.getByRole('button', { name: 'تحريك اللوحة', exact: true }).isDisabled(), true, 'Hand is unavailable while the actual camera shows the complete square');
      const letterboxCount = await page.evaluate(() => window.harness.operations().length), fitBox = await board.boundingBox();
      await page.mouse.click(fitBox.x + 8, fitBox.y + fitBox.height / 2);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.harness.operations().length), letterboxCount, 'A down in fit-all letterboxing cannot leave an edge dot');
      await page.getByRole('button', { name: 'مساحة الرسم الواسعة', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('canvas').dataset.cameraMode === 'wide');
      const panCount = await page.evaluate(() => window.harness.commands.filter(command => command.type === 'drawing_batch').length);
      await page.getByRole('button', { name: 'تحريك اللوحة', exact: true }).click();
      const panBox = await board.boundingBox();
      await page.mouse.move(panBox.x + panBox.width / 2, panBox.y + panBox.height / 2); await page.mouse.down();
      await page.mouse.move(panBox.x + panBox.width / 2, panBox.y + panBox.height / 2 - 65); await page.mouse.up();
      assert.ok(Number(await board.getAttribute('data-camera-center')) > .55, 'Explicit hand motion pans the world vertically');
      const hand = page.getByRole('button', { name: 'تحريك اللوحة', exact: true }); await hand.press('ArrowUp'); await hand.press('Home');
      assert.equal(Number(await board.getAttribute('data-camera-center')), .5);
      assert.equal(await page.evaluate(() => window.harness.commands.filter(command => command.type === 'drawing_batch').length), panCount, 'Camera gestures and keyboard panning never send drawing commands');
      await page.getByRole('button', { name: 'قلم', exact: true }).click();
      const activeBefore = await page.evaluate(() => window.harness.operations().length), activeBox = await board.boundingBox();
      await page.mouse.move(activeBox.x + activeBox.width / 2, activeBox.y + activeBox.height * .25); await page.mouse.down();
      await page.mouse.move(activeBox.x + activeBox.width / 2, activeBox.y + activeBox.height * .75);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(before => window.harness.operations().length > before && window.harness.operations().at(-1).end, activeBefore);
      await page.mouse.up();
      assert.equal(await board.evaluate(node => node === window.wideCanvasIdentity), true, 'Rotation preserves the canvas and closes the previous stroke before changing projection');
      const rotatedStroke = await page.evaluate(() => window.harness.operations().at(-1));
      assert.ok(Math.abs(rotatedStroke.points.at(-1)[1] - (.5 + .25 * activeBox.height / activeBox.width)) < .004, 'A resize cannot reinterpret the last old-view point as a portrait coordinate');
      const tallBefore = await page.evaluate(() => window.harness.operations().length), tallBox = await board.boundingBox();
      await page.mouse.move(tallBox.x + tallBox.width * .35, tallBox.y + tallBox.height * .05); await page.mouse.down();
      await page.mouse.move(tallBox.x + tallBox.width * .35, tallBox.y + tallBox.height * .95, { steps: 12 }); await page.mouse.up();
      await page.waitForFunction(before => window.harness.operations().length > before && window.harness.operations().at(-1).end, tallBefore);
      const inkBeforeRotate = await page.evaluate(() => window.harness.operations());
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => document.querySelector('canvas').dataset.cameraMode === 'fit');
      assert.deepEqual(await page.evaluate(() => window.harness.operations()), inkBeforeRotate, 'Auto fit-all on rotation preserves every canonical point of a tall existing drawing');
      await page.screenshot({ path: path.join(output, `${name}-wide-auto-fit-existing-ink.png`), fullPage: true });
      await page.getByRole('button', { name: 'مساحة الرسم الواسعة', exact: true }).click();
      await page.getByRole('button', { name: 'تحريك اللوحة', exact: true }).click();
      for (let count = 0; count < 6; count++) await page.getByRole('button', { name: 'تحريك اللوحة', exact: true }).press('ArrowUp');
      const topCenter = Number(await board.getAttribute('data-camera-center'));
      assert.ok(topCenter < .3, 'Hand can reach the upper portion of existing world ink');
      await page.setViewportSize({ width: 740, height: 320 });
      await page.waitForFunction(() => document.querySelector('canvas').dataset.cameraMode === 'fit');
      assert.equal(await page.getByRole('button', { name: 'تحريك اللوحة', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'قلم', exact: true }).getAttribute('aria-pressed'), 'true', 'Auto fit caused by resize exits Hand so the next pointer can draw immediately');
      await page.setViewportSize({ width: 844, height: 390 });
      await page.getByRole('button', { name: 'مساحة الرسم الواسعة', exact: true }).click();
      await page.getByRole('button', { name: 'تحريك اللوحة', exact: true }).click();
      await page.getByRole('button', { name: 'تحريك اللوحة', exact: true }).press('ArrowUp');
      const cameraBeforeReconnect = await board.getAttribute('data-camera-center');
      await page.evaluate(() => window.harness.set({ status: 'reconnecting' }));
      await page.evaluate(() => window.harness.set({ status: 'connected' })); await page.locator('.ers-board-status').waitFor({ state: 'hidden' });
      assert.equal(await board.getAttribute('data-camera-center'), cameraBeforeReconnect, 'Reconnecting the same round retains the preferred camera');
      await page.getByRole('button', { name: 'تحريك اللوحة', exact: true }).press('Home');
      await page.getByRole('button', { name: 'قلم', exact: true }).click();
      const outsideBefore = await page.evaluate(() => window.harness.operations().length);
      await board.evaluate(canvas => { const rect=canvas.getBoundingClientRect(); for(const[type,y]of[['pointerdown',.5],['pointerup',2]])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:92,pointerType:'touch',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:rect.left+rect.width*.8,clientY:rect.top+rect.height*y})); });
      await page.waitForFunction(before => window.harness.operations().length > before && window.harness.operations().at(-1).end, outsideBefore);
      const outsideEnd = await page.evaluate(() => window.harness.operations().at(-1).points.at(-1)[1]), outsideBox = await board.boundingBox();
      assert.ok(Math.abs(outsideEnd - (.5 + outsideBox.height / (outsideBox.width * 2))) < .004, 'Captured release outside the wide canvas ends at its visible edge, without hidden ink');
      await page.evaluate(() => { document.documentElement.style.setProperty('--safe-bottom', '21px'); document.documentElement.style.setProperty('--safe-left', '44px'); document.documentElement.style.setProperty('--safe-right', '44px'); });
      const safeBoard = await board.boundingBox(); assert.ok(safeBoard.y + safeBoard.height <= 370, 'Landscape board respects the iPhone home-indicator inset');
      await page.evaluate(() => window.harness.set({ index: 1, state: { myWord: null } }));
      const guessLandscape = await page.locator('.ers-guess').boundingBox(); const guessBoard = await board.boundingBox();
      assert.ok(guessLandscape.y >= 0 && guessLandscape.y + guessLandscape.height <= 370 && guessBoard.y + guessBoard.height <= 370, 'A landscape guesser sees the canvas and input together above the safe area');
      await page.screenshot({ path: path.join(output, `${name}-guess-landscape.png`), fullPage: true });
      await page.getByRole('button', { name: 'الإبلاغ عن الرسمة' }).click(); await page.getByRole('dialog').getByLabel('السبب').selectOption('محتوى غير مناسب'); await page.evaluate(() => window.harness.set({ state: { round: 2 } })); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.evaluate(() => window.harness.set({ index: 0, state: { myWord: 'قطار' } })); await page.locator('.ers-board-status').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => { const button = document.querySelector('[aria-label="تراجع عن آخر خط"]'); return button && !button.disabled; });
      await page.evaluate(() => window.harness.hold(true)); await page.getByRole('button', { name: 'تراجع عن آخر خط', exact: true }).click();
      await page.evaluate(() => window.harness.set({ state: { round: 3 } })); await page.waitForFunction(() => window.harness.commands.some(command => command.type === 'drawing_sync' && command.fields.round === 3));
      await page.evaluate(() => window.harness.hold(false)); await page.locator('.ers-board-status').waitFor({ state: 'hidden' });
      assert.equal(await page.getByText('انتهت هذه الجولة. انتظر تحديث الشاشة.', { exact: true }).count(), 0, 'An obsolete history rejection cannot pollute the next round or request its synchronization');
      await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await page.locator('.ers-word-banner').evaluate(node => getComputedStyle(node).animationName), 'none');
      assert.deepEqual(errors, []);
      result.browsers.push({ name, localInkBeforeRemoteAck: true, localInkProbe: { scope: 'Genuine browser pointer capture callback to first canvas stroke/fill with readable ink at its point; includes 1x1 pixel readback, does not measure physical display presentation', sampleCount: inkSamples.length, p95Ms: inkP95, maxMs: Math.max(...inkSamples), samplesMs: inkSamples }, localGestureMeasurementMs: local.time - start, batches: batches.length, localEditorBlurAndDraftPreservation: true, emptyCoalescedMovement: true, pointerEndAndForeignCancel: true, rejectedCaptureOutsideRelease: true, callControlsPreservedAndKeyboardCompacted: true, explicitDisplayedRoundIdentity: true, expandedLandscapeAndCompactTools: true, layeredBackAndCanvasPreservation: true, wideCircleKeepsLegacyGeometry: true, letterboxDownIgnored: true, panNeverSendsDrawingCommands: true, activeStrokeClosedBeforeResize: true, tallInkRotationFitsEntireBoard: true, cameraPreservedOnReconnect: true, capturedOutsidePointStopsAtVisibleEdge: true, staleHistoryErrorIgnored: true, undoRedo: true, clearConfirmation: true, backpressureResume: true, reconnectSync: true, mutePrivacyCurtain: true, guessing: true, imeGuard: true, keyboardSquareBoard: true, reducedMotion: true, layouts });
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, `${name}-failure.json`), JSON.stringify(await page.evaluate(() => ({ commands: window.harness?.commands, text: document.body.innerText, input: document.querySelector('.ers-guess input')?.value, guessDisabled: document.querySelector('.ers-guess button')?.disabled, active: document.activeElement?.tagName })).catch(() => ({})), null, 2));
      throw error;
    } finally { await browser.close(); }
  }
} finally { server.close(); }
await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
