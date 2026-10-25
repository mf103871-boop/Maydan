import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

// Real HTMLAudioElements decode a local PCM fixture; LiveKit transport/capture
// are deterministic doubles. Audio Blob URLs use the byte-identical local HTTP
// fixture because Windows WebKit cannot decode blob: WAVs. No live service used.
const wav = Buffer.alloc(44 + 16000 * 2 * 12); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const source = `
import React from'react';import{createRoot}from'react-dom/client';import{AccountContext}from'./src/shared/account/context.js';import{VoiceMessage,VoiceRecorder}from'./src/social/LammaMedia.jsx';import{CallMedia,activeAudioOwners}from'./src/social/media.js';
const bytes=Uint8Array.from(atob('${wav.toString('base64')}'),c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:'audio/wav'}),url='/voice.wav';
const objectURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>value.type?.startsWith('audio/')?url:objectURL(value);URL.revokeObjectURL=value=>{if(value!==url)revokeURL(value);};
window.owners=activeAudioOwners;window.mic=[];window.resumeCalls=0;window.errors=[];window.hidden=false;
Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.hidden});
window.hide=()=>{window.hidden=true;document.dispatchEvent(new Event('visibilitychange'));};window.show=()=>{window.hidden=false;document.dispatchEvent(new Event('visibilitychange'));};
window.addEventListener('pause',e=>{if(window.suppressPause)e.stopImmediatePropagation();},true);
const RoomEvent=Object.fromEntries(['ParticipantConnected','ParticipantDisconnected','ActiveSpeakersChanged','TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished','TrackSubscribed','TrackUnsubscribed','Reconnecting','Reconnected','Disconnected'].map(x=>[x,x]));
class Room{constructor(){window.room=this;this.handlers={};this.remoteParticipants=new Map();this.localParticipant={identity:'alice',isMicrophoneEnabled:false,setMicrophoneEnabled:async enabled=>{window.mic.push(enabled);this.localParticipant.isMicrophoneEnabled=enabled;}};}on(n,fn){this.handlers[n]=fn;}async connect(){}async disconnect(){}async startAudio(){window.resumeCalls++;if(window.holdResume)await new Promise((resolve,reject)=>{window.resolveResume=resolve;window.rejectResume=reject;});}}
const engine=new CallMedia(()=>{},{loadSDK:async()=>({Room,RoomEvent,Track:{Kind:{Audio:'audio'}}})});engine.setAccount('alice');window.engine=engine;
window.startCall=async(id='one')=>{await engine.connect({call:{id},connection:{url:'wss://fixture.invalid',token:'fixture'}},{muted:true});const audio=document.createElement('audio');audio.src=url;audio.preload='auto';window.room.handlers.TrackSubscribed({kind:'audio',attach:()=>audio});};
window.endCall=()=>engine.disconnect();
class Recorder extends EventTarget{static isTypeSupported(){return true;}constructor(){super();this.mimeType='audio/wav';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.dispatchEvent(new MessageEvent('dataavailable',{data:blob}));this.dispatchEvent(new Event('stop'));});}}
window.MediaRecorder=Recorder;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]}),enumerateDevices:async()=>[]}});
createRoot(document.getElementById('root')).render(<AccountContext.Provider value={{ready:true,signedIn:true,user:{id:'alice'}}}><VoiceMessage attachment={{id:'same',durationMs:12000}} getVoiceUrl={async()=>url}/><VoiceMessage attachment={{id:'same',durationMs:12000}} getVoiceUrl={async()=>url}/><VoiceRecorder onSend={async()=>{}} onError={error=>window.errors.push(error)}/></AccountContext.Provider>);
window.ready=true;`;
const built = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'silent', plugins: [{ name: 'isolated-call-context', setup(b) { b.onResolve({ filter: /LammaProvider\.jsx$/ }, () => ({ path: 'context', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export const useLamma=()=>({});", resolveDir: process.cwd() })); } }] });
const html = `<!doctype html><html lang="ar"><body><button id="activate" onclick="window.startCall()">ابدأ المكالمة</button><button id="resume" onclick="window.engine.resumeAudio()">تشغيل صوت المكالمة</button><div id="root"></div><script>${built.outputFiles[0].text}</script></body></html>`;
const server = http.createServer((req, res) => { if(req.url==='/voice.wav'){res.writeHead(200,{'content-type':'audio/wav','content-length':wav.length,'accept-ranges':'bytes'});res.end(wav);return;} res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
for (const [name, browserType] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: foreground call recovery and explicit recording/playback duck release`, { timeout: 60000 }, async () => {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    const playbackReady = async () => {
      await page.waitForFunction(() => { const audio=document.querySelector('[data-lamma-audio="call"]'); return audio && (!audio.paused || (!window.engine.resuming && !!window.engine.state.error)); });
      if (await page.locator('[data-lamma-audio="call"]').evaluate(audio=>audio.paused)) { assert.ok(await page.evaluate(()=>window.engine.state.error)); await page.locator('#resume').click(); }
      await page.waitForFunction(() => document.querySelector('[data-lamma-audio="call"]')?.paused === false);
    };
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.locator('#activate').click(); await page.waitForFunction(() => document.querySelector('[data-lamma-audio="call"]')?.paused === false);
    assert.deepEqual(await page.evaluate(() => window.mic), [false]);
    const count = await page.evaluate(() => { const audio = document.querySelector('[data-lamma-audio="call"]'); window.hide(); audio.pause(); const count = window.resumeCalls; window.show(); return count; });
    await playbackReady();
    const resumed = await page.evaluate(count => ({ count, next: window.resumeCalls, paused: document.querySelector('[data-lamma-audio="call"]').paused, mic: window.mic }), count);
    assert.ok(resumed.next >= resumed.count + 1); assert.equal(resumed.paused, false); assert.deepEqual(resumed.mic, [false]);
    await page.evaluate(async () => { document.querySelector('[data-lamma-audio="call"]').pause(); window.dispatchEvent(new Event('pageshow')); });
    await playbackReady();
    await page.waitForFunction(() => !window.engine.resuming);
    await page.evaluate(async () => { window.holdResume = true; window.pending = window.engine.resumeAudio().catch(()=>{}); });
    await page.waitForFunction(() => !!window.rejectResume);
    await page.evaluate(async () => { await window.endCall(); await window.startCall('two'); window.engine.update({ error: 'replacement-status' }); window.rejectResume(new Error('old session')); await window.pending; window.holdResume=false; });
    assert.equal(await page.evaluate(() => window.engine.state.error), 'replacement-status');
    await page.evaluate(() => window.endCall());

    // Duplicate renderings of one attachment have distinct ownership. Losing a
    // pause event on one element must not keep the game ducked after foreground.
    const buttons = page.locator('.lamma-voice-player button');
    await buttons.nth(0).click(); await page.waitForFunction(() => window.owners().length === 1);
    await buttons.nth(1).click(); await page.waitForFunction(() => window.owners().length === 2);
    const stopped = await page.evaluate(() => { window.suppressPause = true; window.hide(); return { owners: window.owners(), sources: [...document.querySelectorAll('.lamma-voice-message audio')].map(a=>a.getAttribute('src')) }; });
    assert.deepEqual(stopped.owners, []); assert.deepEqual(stopped.sources, [null, null]);
    await page.evaluate(() => { window.suppressPause = false; window.show(); });
    await page.locator('.lamma-voice-start').click(); await page.getByRole('button', { name: 'إنهاء التسجيل ومراجعته' }).waitFor();
    assert.equal((await page.evaluate(() => window.owners())).length, 1);
    await page.evaluate(() => window.hide()); await page.locator('.lamma-voice-start').waitFor(); assert.deepEqual(await page.evaluate(() => window.owners()), []);
    await page.evaluate(() => window.show()); await page.locator('.lamma-voice-start').click(); await page.getByRole('button', { name: 'إنهاء التسجيل ومراجعته' }).click();
    const preview = page.locator('.lamma-recorded-preview audio'); await preview.waitFor(); await preview.evaluate(audio=>audio.play());
    await page.waitForFunction(() => window.owners().some(owner=>owner.startsWith('voice-preview-')));
    const previewStopped = await page.evaluate(() => { window.suppressPause=true; window.hide(); return window.owners(); }); assert.deepEqual(previewStopped, []);
    assert.deepEqual(await page.evaluate(() => window.errors), []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
test.after(() => new Promise(resolve => server.close(resolve)));
