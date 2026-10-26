import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Real browser AudioContext/HTMLMediaElement playback. Only lifecycle notifications
// are injected: desktop engines cannot reproduce iPhone hardware interruptions.
const baseline = process.argv.includes('--baseline');
const output = path.resolve('.cache', baseline ? 'audio-recovery-before' : 'audio-recovery');
await mkdir(output, { recursive: true });
const wav = Buffer.alloc(44 + 16000 * 2 * 12);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 16000 * 12; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 16000) * 5000), 44 + i * 2);
const instrumentation = `
window.audioProof={contexts:[],sources:[],errors:[]};
const NativeAC=window.AudioContext||window.webkitAudioContext;
window.audioProof.webAudioSupported=typeof NativeAC==='function';
if(window.audioProof.webAudioSupported){
class MeasuredAudioContext extends NativeAC{
 constructor(options){super(options);window.audioProof.contexts.push(this);this.proofGains=[];this.proofSources=[];}
 createGain(){const node=super.createGain();this.proofGains.push(node);return node;}
 createBufferSource(){const node=super.createBufferSource(),start=node.start.bind(node),stop=node.stop.bind(node);const proof={node,context:this,started:false,stopped:false};this.proofSources.push(proof);window.audioProof.sources.push(proof);node.start=(...args)=>{const value=start(...args);proof.started=true;return value;};node.stop=(...args)=>{const value=stop(...args);proof.stopped=true;return value;};return node;}
 createDynamicsCompressor(){const node=super.createDynamicsCompressor(),meter=super.createAnalyser();meter.fftSize=256;node.connect(meter);this.proofMeter=meter;return node;}
}
window.AudioContext=MeasuredAudioContext;
}
window.proofSnapshot=()=>{const c=window.audioProof.contexts.at(-1),data=new Float32Array(256);c?.proofMeter?.getFloatTimeDomainData(data);return{contextCount:window.audioProof.contexts.length,state:c?.state,time:c?.currentTime,rms:Math.sqrt(data.reduce((sum,n)=>sum+n*n,0)/data.length),sources:window.audioProof.sources.filter(s=>s.started).length,loopSources:window.audioProof.sources.filter(s=>s.started&&s.node.loop&&!s.stopped).length,master:c?.proofGains[0]?.gain.value,music:c?.proofGains[1]?.gain.value,duckStage:window.duckStage,enabled:window.sound?.enabled,musicEnabled:window.sound?.music.enabled,musicWanted:window.sound?.music.wanted,musicCurrent:window.sound?.music.current};};
window.setHidden=value=>{Object.defineProperty(document,'hidden',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'));};
window.lifecycle=(state,shouldResume)=>window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle',{detail:{state,shouldResume}}));
window.addEventListener('unhandledrejection',event=>window.audioProof.errors.push(String(event.reason)));
`;
const fixture = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{createSound}from'./src/shared/fx/sound.js';
import{MediaAudio,MediaVideo}from'./src/games/badeeha/media.js';
import{socialInterruption}from'./src/social/interruption.js';
window.sound=createSound();window.sound.attach();window.socialInterruption=socialInterruption;
function App(){const[on,setOn]=useState(true),[url,setUrl]=useState('/question.wav'),[kind,setKind]=useState('audio'),[mounted,setMounted]=useState(true);window.question={setOn,setUrl,setKind,setMounted};return <><h1>فحص الصوت الحقيقي</h1><button data-sound="none" id="start" onClick={()=>{window.sound.music.play('home');window.sound.play('correct');}}>بدء الموسيقى</button><button data-sound="none" id="cue" onClick={()=>window.sound.play('correct')}>مؤثر</button><section id="question">{mounted&&(kind==='audio'?<MediaAudio url={url} soundOn={on} sound={window.sound}/>:<MediaVideo url={url} soundOn={on} sound={window.sound}/>)}</section></>;}
createRoot(document.getElementById('root')).render(<App/>);`;
const sourceAt = async file => baseline ? execFileSync('git', ['show', `HEAD:${file.replaceAll('\\', '/')}`], { encoding: 'utf8' }) : readFile(file, 'utf8');
const built = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.png': 'dataurl', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent', plugins: [{ name: 'actual-media-test-exports', setup(build) {
  if (baseline) build.onLoad({ filter: /src[\\/]games[\\/]badeeha[\\/]media\.js$/ }, async args => ({ contents: await sourceAt(path.relative(process.cwd(), args.path)), loader: 'jsx', resolveDir: path.dirname(args.path) }));
  if (baseline) build.onLoad({ filter: /src[\\/]shared[\\/]fx[\\/]sound\.js$/ }, async args => ({ contents: await sourceAt(path.relative(process.cwd(), args.path)), loader: 'js', resolveDir: path.dirname(args.path) }));
} }] });
let stalledRequests = 0;
const stalledResponses = new Set();
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/question.wav') { response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'accept-ranges': 'bytes' }); response.end(wav); return; }
  if (url.pathname === '/stall.wav') { stalledRequests++; stalledResponses.add(response); response.on('close', () => stalledResponses.delete(response)); return; }
  if (url.pathname === '/release-question') { for (const pending of stalledResponses) { pending.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length }); pending.end(wav); } stalledResponses.clear(); response.writeHead(204); response.end(); return; }
  if (url.pathname.startsWith('/audio/')) { try { const file = await readFile(path.resolve('public', `.${url.pathname}`)); response.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': file.length }); response.end(file); } catch { response.writeHead(404); response.end(); } return; }
  response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(`<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:18px system-ui;background:#fff6e5;color:#30203f;padding:16px}button{font:inherit;min-width:44px;min-height:44px;margin:4px}section{border:2px solid #06768b;border-radius:20px;padding:16px;margin-top:20px}.m-audio{display:flex;flex-wrap:wrap;gap:12px}.m-audio-meta{display:grid}video{width:100%}</style></head><body><div id="root"></div><script>${instrumentation}${built.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const report = { baseline, generatedAt: new Date().toISOString(), method: 'Actual browser AudioContext, original AAC assets and real question HTMLAudio; injected lifecycle notifications, real suspend/close. No iPhone hardware claim.', engines: [], passed: true };
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    const result = { engine: name, checks: [], pageErrors: [] }; report.engines.push(result);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(6000); page.on('pageerror', error => result.pageErrors.push(error.message));
    let webAudioSupported = true;
    const run = async (label, task) => {
      if (!webAudioSupported && !label.startsWith('question')) { result.checks.push({ label, skipped: true, reason: 'This Windows WebKit build exposes no AudioContext; no WebAudio result claimed.' }); return; }
      try { const detail = await task(); result.checks.push({ label, passed: true, detail }); console.log(`PASS ${name}: ${label}`); } catch (error) { const state = await page.evaluate(() => window.proofSnapshot()).catch(() => null); result.checks.push({ label, passed: false, error: error.message, state }); report.passed = false; console.log(`FAIL ${name}: ${label}: ${error.message} ${JSON.stringify(state)}`); }
    };
    const snapshot = () => page.evaluate(() => window.proofSnapshot());
    const running = () => page.waitForFunction(() => { const c = window.audioProof.contexts.at(-1); return c?.state === 'running' && window.sound.music.current === 'home'; }, null, { timeout: 6000 });
    const audible = () => page.waitForFunction(() => window.proofSnapshot().rms > .00001, null, { timeout: 6000 });
    const play = () => page.locator('[data-design-id="audio-play"]').click();
    const playing = () => page.waitForFunction(() => { const el = document.querySelector('#question audio'); return el && !el.paused && el.currentTime > .05; }, null, { timeout: 5000 });
    const paused = () => page.waitForFunction(() => document.querySelector('#question audio')?.paused, null, { timeout: 1500 });
    const fresh = async () => { await page.goto(`http://127.0.0.1:${server.address().port}`); await page.locator('#start').click(); webAudioSupported = await page.evaluate(() => window.audioProof.webAudioSupported); if (webAudioSupported) { await running(); await audible(); } };
    try {
      await fresh();
      await run('real AAC music/cue output and advancing context clock', async () => { const before = await snapshot(); await page.locator('#cue').click(); await page.waitForFunction(sources => window.proofSnapshot().sources > sources, before.sources); const after = await snapshot(); assert.ok(after.time > before.time); assert.ok(after.rms > 0); return after; });
      await run('hidden→visible restores real music graph', async () => { await page.evaluate(() => window.setHidden(true)); await page.waitForFunction(() => window.proofSnapshot().state !== 'running'); await page.evaluate(() => window.setHidden(false)); await running(); await audible(); return snapshot(); });
      await run('pagehide pauses even before visibilitychange; pageshow recovers', async () => { await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForFunction(() => window.proofSnapshot().state !== 'running', null, { timeout: 1800 }); await page.evaluate(() => window.dispatchEvent(new Event('pageshow'))); await running(); await audible(); return snapshot(); });
      await fresh();
      await run('native background/foreground restores without changing settings', async () => { await page.evaluate(() => window.lifecycle('background')); await page.waitForFunction(() => window.proofSnapshot().state !== 'running', null, { timeout: 1800 }); await page.evaluate(() => window.lifecycle('foreground')); await running(); await audible(); return snapshot(); });
      await fresh();
      await run('closed graph is replaced on focus and actual music returns', async () => { const old = (await snapshot()).contextCount; await page.evaluate(async () => { await window.audioProof.contexts.at(-1).close(); window.dispatchEvent(new Event('focus')); }); await page.waitForFunction(old => window.proofSnapshot().contextCount > old, old, { timeout: 5500 }); await running(); await audible(); return snapshot(); });
      await fresh();
      await run('native interruption with shouldResume=false waits for real tap', async () => { await page.evaluate(() => window.lifecycle('interruption-began')); await page.waitForFunction(() => window.proofSnapshot().state !== 'running', null, { timeout: 1800 }); await page.evaluate(() => window.lifecycle('interruption-ended', false)); await page.waitForTimeout(200); assert.notEqual((await snapshot()).state, 'running'); await page.locator('#cue').click(); await running(); await audible(); return snapshot(); });
      await fresh();
      await run('call and recorder duck owners survive recovery and release independently', async () => { await page.evaluate(() => { window.duckStage = 'both-active'; window.sound.setDucking(true, 'call-test'); window.sound.setDucking(true, 'record-test'); window.lifecycle('background'); }); await page.evaluate(() => window.lifecycle('foreground')); await running(); await page.waitForFunction(() => window.proofSnapshot().music < .08 && window.proofSnapshot().music > .02); await page.evaluate(() => { window.duckStage = 'one-active'; window.sound.setDucking(false, 'call-test'); }); assert.ok((await snapshot()).music < .08); await page.evaluate(() => { window.duckStage = 'both-released'; window.sound.setDucking(false, 'record-test'); }); await page.waitForFunction(() => window.proofSnapshot().music > .24); return snapshot(); });
      await run('player sound disabled stays disabled through every recovery signal', async () => { await page.evaluate(() => { window.sound.enable(false); window.lifecycle('background'); window.lifecycle('foreground'); window.lifecycle('media-reset'); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); }); await page.locator('#cue').click(); await page.waitForFunction(() => { const s = window.proofSnapshot(); return s.state !== 'running' || s.master < .001 && s.music < .001; }); const state = await snapshot(); assert.equal(state.enabled, false); return state; });
      await fresh();
      // Chromium does not advance an idle gain's automation, so its .value can stay at the last level while
      // nothing flows through it. Assert the behavior instead: no cue starts and no music loop runs.
      await run('music disabled and zero effects volume remain disabled after recovery', async () => { await page.evaluate(() => { window.sound.music.enable(false); window.sound.setVolume(0); window.lifecycle('background'); window.lifecycle('foreground'); }); const before = (await snapshot()).sources; await page.locator('#cue').click(); await page.waitForTimeout(500); const state = await snapshot(); assert.equal(state.musicEnabled, false); assert.equal(await page.evaluate(() => window.sound.volume), 0); assert.equal(state.sources, before, 'no cue starts at zero effects volume'); assert.equal(state.loopSources, 0, 'no music loop runs'); return state; });
      await fresh();
      await run('question audio pauses hidden, resumes explicitly without spending another listen', async () => { await play(); await playing(); const before = await page.locator('.m-audio-meta small').textContent(); await page.evaluate(() => window.setHidden(true)); await paused(); await page.evaluate(() => window.setHidden(false)); assert.equal(await page.locator('audio').evaluate(el => el.paused), true); await play(); await playing(); assert.equal(await page.locator('.m-audio-meta small').textContent(), before); return { remaining: before }; });
      for (const event of ['pagehide', 'background', 'interruption-began']) await run(`question audio pauses on ${event}, never auto-restarts`, async () => { await fresh(); await play(); await playing(); await page.evaluate(event => event === 'pagehide' ? window.dispatchEvent(new Event(event)) : window.lifecycle(event), event); await paused(); await page.evaluate(event => event === 'pagehide' ? window.dispatchEvent(new Event('pageshow')) : window.lifecycle(event === 'background' ? 'foreground' : 'interruption-ended', true), event); await page.waitForTimeout(120); assert.equal(await page.locator('audio').evaluate(el => el.paused), true); await play(); await playing(); });
      await run('question pending network play cancels and retries same source without autoplay', async () => { await fresh(); await page.evaluate(() => window.question.setUrl('/stall.wav')); await page.locator('audio[src="/stall.wav"]').waitFor({ state: 'attached' }); await play(); await page.waitForTimeout(80); assert.ok(stalledRequests > 0); await page.evaluate(() => window.lifecycle('background')); await paused(); await page.evaluate(async () => { window.lifecycle('foreground'); await fetch('/release-question'); }); await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 2); assert.equal(await page.locator('audio').evaluate(el => el.paused), true, 'arriving network data cannot restart the interrupted attempt'); await play(); await playing(); return { stalledRequests }; });
      await run('question disabled audio remains muted after native recovery', async () => { await page.evaluate(() => window.question.setOn(false)); await page.waitForFunction(() => document.querySelector('#question audio')?.muted); await page.evaluate(() => { window.lifecycle('background'); window.lifecycle('foreground'); }); assert.equal(await page.locator('[data-design-id="audio-play"]').isDisabled(), true); assert.equal(await page.locator('audio').evaluate(el => el.paused && el.muted), true); });
      await page.screenshot({ path: path.join(output, `${name}-audio.png`) });
      assert.deepEqual(result.pageErrors, []); assert.deepEqual(await page.evaluate(() => window.audioProof.errors), []);
    } catch (error) { result.failure = error.message; report.passed = false; }
    finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ passed: report.passed, engines: report.engines.map(item => ({ engine: item.engine, passed: item.checks.filter(c => c.passed).length, skipped: item.checks.filter(c => c.skipped).length, failed: item.checks.filter(c => c.passed === false), failure: item.failure })) }, null, 2));
if (!report.passed) process.exitCode = 1;
