// Real browser media playback with private, authenticated report evidence.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import http from 'node:http';

const wav = Buffer.alloc(44 + 16000 * 2 * 8);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
let requests = 0; let invalid = false; let denied = false; let pending = null; let delay = false;
const bundle = await build({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AccountContext}from'./src/shared/account/context.js';import{ReviewAudio}from'./src/moderation/ReviewAudio.jsx';
const requestAuthenticated=async(path,options)=>{if(!options.raw)throw Error('raw required');const response=await fetch(path,{headers:{authorization:'Bearer moderator-fixture'},cache:'no-store'});if(!response.ok)throw Object.assign(Error(),{code:'FORBIDDEN'});return response;};
window.created=[];window.revoked=[];const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);window.created.push(u);return u};URL.revokeObjectURL=u=>{window.revoked.push(u);revoke(u)};
function App(){const[owner,setOwner]=useState('moderator'),[mounted,setMounted]=useState(true),[path,setPath]=useState('/api/moderation/reports/report-1/audio'),[ready,setReady]=useState(true);window.update={setOwner,setMounted,setPath,setReady};return <AccountContext.Provider value={{ready,signedIn:!!owner,user:{id:owner},requestAuthenticated}}>{mounted&&<ReviewAudio path={path}/>}</AccountContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'silent' });
const server = http.createServer((req, res) => {
  if (req.url === '/api/moderation/reports/report-1/audio') {
    assert.equal(req.headers.authorization, 'Bearer moderator-fixture'); requests++;
    const send = () => { res.writeHead(denied ? 403 : 200, { 'content-type': invalid ? 'text/html' : 'audio/wav', 'cache-control': 'no-store' }); res.end(denied ? '' : invalid ? '<p>not audio</p>' : wav); };
    if (delay) pending = send; else send(); return;
  }
  res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(`<html lang="ar" dir="rtl"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
try {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const play = () => page.getByRole('button', { name: 'تشغيل الدليل الصوتي', exact: true }).click();
  const stop = () => page.getByRole('button', { name: 'إيقاف الدليل الصوتي', exact: true }).click();
  const stopped = () => page.waitForFunction(() => (!document.querySelector('audio') || (document.querySelector('audio').paused && !document.querySelector('audio').getAttribute('src'))) && window.created.length === window.revoked.length);
  await page.getByRole('button', { name: 'تشغيل الدليل الصوتي', exact: true }).waitFor(); assert.equal(requests, 0);
  assert.equal(await page.locator('audio').getAttribute('src'), null); assert.equal(await page.locator('audio').getAttribute('controls'), null);
  await play(); await page.getByRole('button', { name: 'إيقاف الدليل الصوتي', exact: true }).waitFor(); assert.equal(requests, 1);
  await stop(); await stopped(); await play(); await page.getByRole('button', { name: 'إيقاف الدليل الصوتي', exact: true }).waitFor(); assert.equal(requests, 2, 'each replay must reauthorize');
  await page.evaluate(() => window.update.setOwner('another')); await stopped();
  await play(); await page.getByRole('button', { name: 'إيقاف الدليل الصوتي', exact: true }).waitFor();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }); await stopped();
  await page.evaluate(() => { delete document.hidden; });
  await play(); await page.getByRole('button', { name: 'إيقاف الدليل الصوتي', exact: true }).waitFor(); await page.evaluate(() => window.update.setMounted(false)); await stopped();
  await page.evaluate(() => window.update.setMounted(true)); invalid = true; await play(); await page.getByRole('alert').waitFor(); await stopped(); invalid = false;
  denied = true; await play(); await page.getByText('هذه الصفحة مخصّصة لفريق المراجعة.').waitFor(); await stopped(); denied = false;
  delay = true; await play(); await page.getByRole('button', { name: 'إلغاء تحميل الدليل الصوتي' }).waitFor();
  while (!pending) await new Promise(resolve => setTimeout(resolve, 10));
  await page.evaluate(() => window.update.setOwner(null)); pending(); pending = null; delay = false;
  await stopped(); await page.waitForTimeout(100); assert.equal(await page.locator('audio').count(), 0);
  const previous = requests;
  await page.evaluate(() => { window.update.setOwner('moderator'); window.update.setReady(false); }); await page.waitForTimeout(50); assert.equal(await page.locator('button').count(), 0);
  await page.evaluate(() => { window.update.setReady(true); window.update.setPath('https://example.com/public-audio'); }); await page.waitForTimeout(50); assert.equal(await page.locator('audio').count(), 0); assert.equal(requests, previous);
  assert.deepEqual(errors, []);
  console.log('PASS: private moderator audio reauthorizes every playback, rejects foreign paths/types, revokes on stop/account/hidden/unmount, discards stale requests');
} finally { pending?.(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
