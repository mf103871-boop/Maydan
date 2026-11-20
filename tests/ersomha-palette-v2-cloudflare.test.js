import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { RoomClient, newCredentials } from '../src/online/client.js';
import { ROOM_CAPABILITIES } from '../src/online/shared.js';
import { migrationSql } from '../server/local-d1.mjs';

const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await sleep(15); }
  assert.fail(`Timed out: ${label}`);
}
async function runtime() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-ersomha-api-'));
  const scriptPath = path.join(dir, 'worker.mjs');
  await build({ entryPoints: ['server/worker.mjs'], outfile: scriptPath, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  const mf = new Miniflare(convertV4MiniflareOptions({ rootPath: dir, name: 'ersomha-acceptance', modules: true, scriptPath,
    compatibilityDate: '2026-09-01', durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
    d1Databases: { DB: 'ersomha-db' }, bindings: { ALLOWED_ORIGINS: ORIGIN, APP_ORIGIN: ORIGIN, AUTH_DEV_FAKE: '1', SESSION_SECRET: 'ersomha-test-only', ERSOMHA_PALETTE_V2_ENABLED: '1' }, port: 0, host: '127.0.0.1', cf: false }));
  const server = (await mf.ready).origin;
  const DB = await mf.getD1Database('DB'); await DB.exec(migrationSql());
  const api = async (endpoint, body, token) => {
    const response = await fetch(server + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { origin: ORIGIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const sign = async subject => {
    const result = await api('/api/auth/dev', { subject, name: subject });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return { token: result.body.session.token, userId: result.body.me.user.id };
  };
  return { server, DB, mf, api, sign, dispose: async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }); } };
}


test('actual Worker and Room negotiate v2 over protocol1, publish versioned ACKs and restore authorized evidence', {timeout:40000},async()=>{
 const run=await runtime(),clients=[];
 try{
 const accounts=await Promise.all(['palette-owner','palette-guest'].map(run.sign));
 const oldCapabilities={...ROOM_CAPABILITIES};delete oldCapabilities.ersomhaPalette;
 const seats=accounts.map((_,i)=>({...newCredentials(),name:'Palette '+i,avatar:i,capabilities:i?oldCapabilities:ROOM_CAPABILITIES}));
 const created=await run.api('/api/rooms',{...seats[0],game:'ersomha',deviceId:'e'.repeat(32),settings:{cycles:1}},accounts[0].token);assert.equal(created.status,201);
 const code=created.body.code;assert.equal((await run.api(`/api/rooms/${code}/join`,seats[1],accounts[1].token)).status,200,'old capability shape remains admissible');
 class LegacyWireSocket extends BrowserSocket {send(raw){if(typeof raw==='string'&&raw.startsWith('{')){const message=JSON.parse(raw);if(message.capabilities)delete message.capabilities.ersomhaPalette;delete message.paletteVersion;return super.send(JSON.stringify(message));}return super.send(raw);}}
 for(let i=0;i<2;i++){const client=new RoomClient({server:run.server,code,session:seats[i],getAccountAuthorization:()=>`Bearer ${accounts[i].token}`,WebSocketImpl:i?LegacyWireSocket:BrowserSocket});clients.push(client);client.start();}
 await until(()=>clients.every(c=>c.state?.members.every(m=>m.connected)),'two connected');await clients[1].command('ready',{ready:true});await clients[0].command('start');await until(()=>clients.every(c=>c.state?.phase==='select'),'select');
 const drawer=clients.find(c=>c.state.myChoices?.length),guest=clients.find(c=>c!==drawer);assert.equal(drawer.state.protocol,1);assert.deepEqual(drawer.state.capabilities.ersomhaPaletteVersions,[1,2]);assert.equal(drawer.state.drawing.paletteVersion,2);
 await drawer.command('select_word',{choiceId:drawer.state.myChoices[0].id});await until(()=>clients.every(c=>c.state.phase==='draw'),'draw');const events=[];guest.subscribeDrawing(e=>events.push(e));
 const ink={epoch:drawer.state.drawing.epoch,strokeId:'lavender',tool:'pen',color:'#efd3fa',width:12,points:[[.2,.5],[.8,.5]],end:true};
 const ack=await drawer.command('drawing_batch',ink);assert.equal(ack.drawing.paletteVersion,2);await until(()=>events.some(e=>e.kind==='append'),'echo');assert.equal(events.at(-1).paletteVersion,2);assert.equal(events.at(-1).op.color,'#efd3fa');
 await assert.rejects(guest.command('drawing_batch',{...ink,strokeId:'forbidden'}),e=>e.code==='ERSOMHA_DRAWER_ONLY');
 await run.mf.unsafeEvictDurableObject('ersomha-acceptance','Room',{name:code,webSockets:'hibernate'});await guest.command('drawing_sync');await until(()=>events.some(e=>e.kind==='sync'&&e.ops?.some(s=>s.color==='#efd3fa')),'restored v2');
 const report=await run.api('/api/games/ersomha/reports',{roomCode:code,matchId:drawer.state.matchId,round:drawer.state.round,reason:'Synthetic palette preservation',clientId:'palette-v2-report'},accounts[clients.indexOf(guest)].token);assert.equal(report.status,201);
 const row=await run.DB.prepare('SELECT evidence_json FROM ersomha_drawing_reports WHERE report_id=?').bind(report.body.reportId).first();const evidence=JSON.parse(row.evidence_json);assert.equal(evidence.canvas.paletteVersion,2);assert.equal(evidence.canvas.strokes[0].color,'#efd3fa');assert.equal(JSON.stringify(evidence).includes(drawer.state.myWord),false);
 }finally{clients.forEach(c=>c.stop());await run.dispose();}
});
