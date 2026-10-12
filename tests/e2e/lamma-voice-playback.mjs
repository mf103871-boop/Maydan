import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import http from 'node:http';

// Eight seconds of PCM silence exercises a real HTMLAudioElement without hardware.
const wav = Buffer.alloc(44 + 16000 * 2 * 8); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const bundle = await build({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AccountContext}from'./src/shared/account/context.js';import{VoiceMessage,VoiceRecorder}from'./src/social/LammaMedia.jsx';import{LammaContext}from'./src/social/LammaProvider.jsx';
window.requests=0;window.defer=false;const blob=new Blob([Uint8Array.from(atob('${wav.toString('base64')}'),c=>c.charCodeAt(0))],{type:'audio/wav'});const urls=[];const getVoiceUrl=async()=>{window.requests++;if(window.defer)await new Promise(resolve=>window.releaseVoice=resolve);const url=URL.createObjectURL(blob);urls.push(url);return url;};window.revoke=()=>urls.forEach(url=>URL.revokeObjectURL(url));
function App(){const[owner,setOwner]=useState('first'),[mounted,setMounted]=useState(true),[lamma,setLamma]=useState({}),[record,setRecord]=useState(false);window.changeOwner=setOwner;window.setMounted=setMounted;window.setLamma=setLamma;window.setRecord=setRecord;return <AccountContext.Provider value={{ready:true,signedIn:!!owner,user:{id:owner}}}><LammaContext.Provider value={lamma}>{mounted&&<VoiceMessage attachment={{id:'voice',durationMs:8000}} getVoiceUrl={getVoiceUrl}/>} {record&&<VoiceRecorder onSend={async()=>{}} onError={message=>window.recordError=message}/>}</LammaContext.Provider></AccountContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'silent', plugins: [{ name: 'call-state-fixture', setup(build) {
  // Control the public Lamma context contract while retaining real playback and recorder code.
  build.onResolve({ filter: /LammaProvider\.jsx$/ }, () => ({ path: 'lamma-context', namespace: 'fixture' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import{createContext,useContext}from'react';export const LammaContext=createContext(null);export const useLamma=()=>useContext(LammaContext);", resolveDir: process.cwd() }));
} }] });
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(`<html lang="ar"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ permissions: ['microphone'] }); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const play = () => page.getByRole('button', { name: 'تشغيل الرسالة الصوتية', exact: true }).click();
  const playing = () => page.waitForFunction(() => document.querySelector('audio')?.paused === false);
  const stopped = () => page.waitForFunction(() => !document.querySelector('audio') || (document.querySelector('audio').paused && !document.querySelector('audio').getAttribute('src')));
  const event = detail => page.evaluate(detail => window.dispatchEvent(new CustomEvent('maydan-social-event', { detail })), detail);
  const call = active => page.evaluate(active => window.dispatchEvent(new CustomEvent('maydan-social-audio', { detail: { owner: 'live-call-fixture', active } })), active);
  await play(); await playing();
  for (const detail of [{ type: 'message', reason: 'message' }, { type: 'group', reason: 'edited' }, { type: 'refresh', reason: 'read' }, { type: 'refresh', reason: 'presence' }]) { await event(detail); assert.equal(await page.locator('audio').evaluate(element => element.paused), false); }
  await event({ type: 'message', reason: 'deleted' }); await stopped();
  await play(); await playing(); await call(true); await stopped(); await call(false);
  for (const interrupt of [() => event({ type: 'group', reason: 'removed' }), () => call(true), () => page.evaluate(() => window.setLamma({ activeCall: { id: 'call' } })), () => page.evaluate(() => window.changeOwner('second')), () => page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); })]) {
    await page.evaluate(() => { window.defer = true; window.releaseVoice = null; }); await play();
    await page.waitForFunction(() => !!window.releaseVoice); await interrupt(); await page.evaluate(() => { window.releaseVoice(); window.defer = false; });
    await stopped(); await page.waitForTimeout(50); assert.equal(await page.locator('audio').getAttribute('src'), null, 'late authorization cannot restart cancelled audio');
    await call(false); await page.evaluate(() => { delete document.hidden; window.setLamma({}); });
  }
  await play(); await playing(); await page.evaluate(() => window.setMounted(false)); await stopped();
  // The call began before these components mounted: no audio event will be replayed.
  await page.evaluate(() => window.setLamma({ activeCall: { id: 'already-running' } }));
  await page.evaluate(() => { window.setMounted(true); window.setRecord(true); });
  const playButton = page.getByRole('button', { name: 'تشغيل الرسالة الصوتية', exact: true });
  await page.waitForFunction(() => document.querySelector('.lamma-voice-player button')?.disabled);
  assert.equal(await playButton.isDisabled(), true); assert.equal(await page.locator('.lamma-voice-start').isDisabled(), true);
  const before = await page.evaluate(() => window.requests); await playButton.evaluate(button => button.click()); assert.equal(await page.evaluate(() => window.requests), before);
  for (const state of [{ media: { connecting: true } }, { media: { connected: true } }, { media: { ending: true } }]) {
    await page.evaluate(state => window.setLamma(state), state); assert.equal(await playButton.isDisabled(), true); assert.equal(await page.locator('.lamma-voice-start').isDisabled(), true);
  }
  await page.evaluate(() => window.setLamma({}));
  await page.locator('.lamma-voice-start').click(); await page.getByRole('button', { name: 'إنهاء التسجيل ومراجعته' }).waitFor(); await page.waitForTimeout(350); await page.getByRole('button', { name: 'إنهاء التسجيل ومراجعته' }).click();
  const preview = page.locator('.lamma-recorded-preview audio'); await preview.evaluate(audio => audio.play());
  await page.evaluate(() => window.setLamma({ activeCall: { id: 'native-recovered' } }));
  await page.waitForFunction(() => { const audio = document.querySelector('.lamma-recorded-preview audio'); return audio?.paused && !audio.controls; });
  await preview.evaluate(audio => audio.play().catch(() => {})); assert.equal(await preview.evaluate(audio => audio.paused), true, 'preview cannot restart into an already active call');
  await page.evaluate(() => window.revoke()); assert.deepEqual(errors, []);
  console.log('PASS: voice playback survives ordinary updates, rejects stale authorization, and blocks both playback/recording when mounted during an existing call, including connecting/ending states and preview restart');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
