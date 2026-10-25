import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const built = await build({ stdin: { contents: `import{createSound}from'./src/shared/fx/sound.js';window.sound=createSound({voice:true});window.sound.attach();document.querySelector('button').onclick=()=>window.sound.music.play('home');`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', logLevel: 'silent' });
const measure = `
window.proof={contexts:[],media:[],decoded:[],errors:[]};
const AC=window.AudioContext||window.webkitAudioContext;
if(typeof AC!=='function'){window.proof.unsupported='AudioContext unavailable in this desktop engine build';}else{
window.AudioContext=class extends AC{
 constructor(options){super(options);proof.contexts.push(this);this.gains=[];}
 createGain(){const node=super.createGain();this.gains.push(node);return node;}
 createMediaElementSource(media){proof.media.push(media);return super.createMediaElementSource(media);}
 decodeAudioData(...args){const result=super.decodeAudioData(...args);result?.then(buffer=>proof.decoded.push(buffer.duration));return result;}
 createDynamicsCompressor(){const node=super.createDynamicsCompressor();this.meter=super.createAnalyser();this.meter.fftSize=256;node.connect(this.meter);return node;}
};
window.snapshot=()=>{const c=proof.contexts.at(-1),samples=new Float32Array(256);c?.meter.getFloatTimeDomainData(samples);return{transport:sound.music.transport,position:sound.music.position,current:sound.music.current,contexts:proof.contexts.length,media:proof.media.length,playing:proof.media.filter(m=>!m.paused).length,rms:Math.sqrt(samples.reduce((a,b)=>a+b*b,0)/samples.length),decodedMax:Math.max(0,...proof.decoded),decoded:proof.decoded.length,state:c.state,gain:c.gains[1]?.gain.value,errors:proof.errors};};
window.lifecycle=(state)=>window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle',{detail:{state}}));
window.addEventListener('unhandledrejection',e=>proof.errors.push(String(e.reason)));
}
`;
let rangeReads = 0;
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.startsWith('/audio/')) {
    try {
      const file = path.resolve('public', `.${url.pathname}`);
      if (!file.startsWith(path.resolve('public/audio') + path.sep)) throw new Error('untrusted path');
      const data = await readFile(file);
      const headers = { 'content-type': file.endsWith('.wav') ? 'audio/wav' : 'audio/mp4', 'accept-ranges': 'bytes' };
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
      if (range) {
        rangeReads += 1;
        const start = Number(range[1]), end = Math.min(data.length - 1, range[2] ? Number(range[2]) : data.length - 1);
        headers['content-range'] = `bytes ${start}-${end}/${data.length}`; headers['content-length'] = end - start + 1;
        response.writeHead(206, headers); response.end(data.subarray(start, end + 1));
      } else { headers['content-length'] = data.length; response.writeHead(200, headers); response.end(data); }
    } catch { response.writeHead(404); response.end(); }
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html lang="ar"><meta name="viewport" content="width=device-width,initial-scale=1"><button>تشغيل</button><script>${measure}${built.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></html>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const report = { generatedAt: new Date().toISOString(), method: 'Actual desktop browser AAC/WAV decoding and Web Audio RMS; injected native lifecycle notifications and loop seek. No hardware interruption or perceptual/iPhone claim.', passed: false, engines: [] };
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => { report.errors ||= []; report.errors.push(error.message); });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const unsupported = await page.evaluate(() => proof.unsupported);
      if (unsupported) { report.engines.push({ name, skipped: true, reason: unsupported }); continue; }
      await page.locator('button').click();
      await page.waitForFunction(() => snapshot().transport === 'stream' && snapshot().rms > 0.00001 && snapshot().position > 0.1);
      const started = await page.evaluate(() => snapshot());
      assert.equal(started.media, 1); assert.equal(started.playing, 1); assert.ok(started.decodedMax < 10);
      const moved = await page.evaluate(() => { const before = sound.music.position; sound.music.play('calm'); sound.music.play('tense'); return { before, after: snapshot() }; });
      assert.ok(moved.after.position >= moved.before); assert.equal(moved.after.media, 1); assert.equal(moved.after.current, 'tense');
      await page.evaluate(() => lifecycle('background'));
      await page.waitForFunction(() => snapshot().playing === 0 && snapshot().state !== 'running');
      const paused = await page.evaluate(() => snapshot());
      await page.evaluate(() => lifecycle('foreground'));
      await page.waitForFunction(before => snapshot().state === 'running' && snapshot().playing === 1
        && snapshot().position > before.position + .25 && proof.contexts.at(-1).currentTime > before.time + .25
        && snapshot().rms > 0.00001, { position: paused.position, time: await page.evaluate(() => proof.contexts.at(-1).currentTime) });
      const resumed = await page.evaluate(() => snapshot()); assert.equal(resumed.media, 1);
      await page.evaluate(() => sound.setDucking(true, 'lamma'));
      await page.waitForFunction(() => Math.abs(snapshot().gain - 0.0625) < 0.001);
      await page.evaluate(() => sound.setDucking(false, 'lamma'));
      await page.waitForFunction(() => snapshot().decoded >= 28);
      await page.evaluate(() => sound.play('correct'));
      await page.waitForFunction(() => snapshot().gain < 0.09);
      const response = await page.evaluate(() => snapshot());
      await page.evaluate(() => lifecycle('media-reset'));
      await page.waitForFunction(() => snapshot().contexts === 2 && snapshot().state === 'running'
        && proof.contexts.at(-1).currentTime > .25 && snapshot().playing === 1 && snapshot().rms > 0.00001);
      const rebuilt = await page.evaluate(() => snapshot()); assert.equal(rebuilt.media, 2); assert.ok(rebuilt.position >= moved.before);
      await page.evaluate(() => { const current = proof.media.at(-1); current.currentTime = 478.5; current.dispatchEvent(new Event('timeupdate')); });
      await page.waitForFunction(() => snapshot().media === 3 && snapshot().playing === 2);
      await page.waitForFunction(() => snapshot().playing === 1 && snapshot().position < 5);
      const looped = await page.evaluate(() => snapshot()); assert.ok(looped.decodedMax < 10); assert.deepEqual(looped.errors, []);
      await page.evaluate(() => sound.dispose()); assert.equal(await page.evaluate(() => snapshot().playing), 0);
      report.engines.push({ name, started, resumed, response, rebuilt, looped, passed: true });
    } finally { await browser.close(); }
  }
  assert.ok(!report.errors?.length); report.passed = true;
} catch (error) { report.failure = String(error.stack || error); throw error; }
finally {
  report.rangeReads = rangeReads;
  await mkdir('.cache/selected-audio-browser', { recursive: true });
  await writeFile('.cache/selected-audio-browser/report.json', JSON.stringify(report, null, 2));
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  console.log(JSON.stringify({ passed: report.passed, engines: report.engines.map((engine) => engine.name), rangeReads, report: '.cache/selected-audio-browser/report.json' }));
}
