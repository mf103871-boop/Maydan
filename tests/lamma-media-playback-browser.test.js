import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

// Real HTMLMediaElement; Chrome receives a generated MediaStream. WebKit builds
// without Web Audio use generated PCM WAV. RTC signaling is a delayed fixture.
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import { CallMedia } from './src/social/media.js';
  let room, release, audio, source, context, engine, stream, blobUrl;
  const events = Object.fromEntries(['ParticipantConnected','ParticipantDisconnected','ActiveSpeakersChanged','TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished','TrackSubscribed','TrackUnsubscribed','Reconnecting','Reconnected','Disconnected'].map(x=>[x,x]));
  class Room {
    constructor(){room=this;this.handlers=new Map();this.remoteParticipants=new Map();this.localParticipant={identity:'fixture',isMicrophoneEnabled:false,async setMicrophoneEnabled(enabled){this.isMicrophoneEnabled=enabled;}};}
    on(event,callback){this.handlers.set(event,callback);}
    async connect(){}
    async disconnect(){await new Promise(resolve=>{release=resolve;});}
  }
  document.querySelector('#start').onclick=async()=>{
    window.setupPhase='audio-source';const AudioContextType=window.AudioContext||window.webkitAudioContext;
    if(AudioContextType){context=new AudioContextType();const destination=context.createMediaStreamDestination();source=context.createOscillator();source.frequency.value=431;source.connect(destination);source.start();await context.resume();stream=destination.stream;}
    else blobUrl='/fixture.wav';
    window.setupPhase='call-connect';
    engine=new CallMedia(()=>{},{loadSDK:async()=>({Room,RoomEvent:events,Track:{Kind:{Audio:'audio'}}})});engine.setAccount('fixture');
    await engine.connect({call:{id:'fixture',scope:'direct'},connection:{url:'wss://fixture.invalid',token:'not-used'}},{muted:true});
    window.setupPhase='attach';audio=document.createElement('audio');if(stream)audio.srcObject=stream;else audio.src=blobUrl;
    room.handlers.get('TrackSubscribed')({kind:'audio',attach:()=>audio});
    window.ready=true;
  };
  document.querySelector('#play').onclick=()=>audio.play();
  window.snapshot=()=>({paused:audio.paused,time:audio.currentTime,readyState:audio.readyState,errorCode:audio.error?.code||0,canPlayWav:audio.canPlayType('audio/wav'),hasStream:!!audio.srcObject,hasSource:!!(audio.srcObject||audio.getAttribute('src')),attached:audio.isConnected});
  window.retire=()=>{window.retiring=engine.disconnect();return window.snapshot();};
  window.closeFixture=async()=>{release?.();await window.retiring;source?.stop();await context?.close();await engine?.dispose();};
` }, bundle: true, write: false, format: 'iife', logLevel: 'silent' });

for (const [name, browserType] of [['Chromium', chromium], ['WebKit', webkit]]) test(`${name}: retiring a call pauses and detaches its real stream before SDK shutdown resolves`, async t => {
  const rate = 44100, frames = rate * 3, wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 431 * index / rate) * 5000), 44 + index * 2);
  const server = createServer((request, response) => {
    if (request.url === '/fixture.wav') { response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length }); response.end(wav); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><button id="start">Start</button><button id="play">Play</button>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await browserType.launch({ headless: true, ...(name === 'Chromium' ? { executablePath: process.env.CHROMIUM_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined), args: ['--autoplay-policy=no-user-gesture-required'] } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const capabilities = await page.evaluate(() => ({ webAudio: typeof AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined', wav: document.createElement('audio').canPlayType('audio/wav') }));
  if (!capabilities.webAudio && !capabilities.wav) {
    t.skip('This installed WebKit exposes neither Web Audio nor WAV playback; actual-media validation requires a supported engine/device.');
    return;
  }
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.click('#start');
  try { await page.waitForFunction(() => window.ready, undefined, { timeout: 5000 }); }
  catch { assert.fail('fixture setup: ' + JSON.stringify(await page.evaluate(() => ({ phase: window.setupPhase, audioContextState: typeof AudioContext, outputApi: 'setSinkId' in HTMLMediaElement.prototype })))); }
  await page.click('#play');
  await page.waitForFunction(() => window.snapshot().time > .08 && !window.snapshot().paused, undefined, { timeout: 5000 });
  try {
    const before = await page.evaluate(() => window.snapshot());
    assert.equal(before.paused, false); assert.equal(before.hasSource, true);
    const after = await page.evaluate(() => window.retire());
    assert.equal(after.paused, true, 'removing an audio node alone does not stop its real browser playback');
    assert.equal(after.hasStream, false);
    assert.equal(after.attached, false);
  } finally { await page.evaluate(() => window.closeFixture()); }
});
