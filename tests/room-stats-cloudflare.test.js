import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { migrationStatements } from '../server/local-d1.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { RoomClient, newCredentials } from '../src/online/client.js';
import questions from '../src/data/games/fabraka/questions.json' with { type: 'json' };

const ORIGIN='http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url,{origin:ORIGIN}); } }
async function until(fn,label='condition') {
  const deadline=Date.now()+7000;
  while(Date.now()<deadline) { if(await fn()) return; await new Promise(r=>setTimeout(r,15)); }
  assert.fail(`Timed out: ${label}`);
}

test('workerd records authenticated natural match results once across hibernation and restart; guests and forged identities get no credit', {timeout:60_000}, async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'maydan-room-stats-')); const clients=[]; let mf;
  try {
    const scriptPath=path.join(dir,'worker.mjs');
    await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:dir,name:'maydan-rooms',modules:true,scriptPath,compatibilityDate:'2026-09-01',
      durableObjects:{ROOMS:{className:'Room',useSQLite:true},LIMITERS:{className:'RequestLimiter',useSQLite:true}},
      d1Databases:{DB:'profile-tests'},bindings:{ALLOWED_ORIGINS:ORIGIN},port:0,host:'127.0.0.1',cf:false}));
    const server=(await mf.ready).origin; const DB=await mf.getD1Database('DB');
    for(const sql of migrationStatements()) await DB.prepare(sql).run();
    const tokens=[];
    for(let n=0;n<3;n++) {
      await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(`account-${n}`,`حساب ${n}`,Date.now(),Date.now()).run();
      const session=await issueSession({DB},`account-${n}`); tokens.push(session.token);
      if(n===2) await DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now()-1,session.id).run();
    }
    async function post(endpoint,data,token,expected=200) {
      const response=await fetch(server+endpoint,{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)});
      const body=await response.json(); assert.equal(response.status,expected,JSON.stringify(body)); return body;
    }
    async function group(game) {
      const seats=Array.from({length:3},(_,n)=>({...newCredentials(),name:`هاتف ${n}`,avatar:n,accountUserId:`account-${(n+1)%3}`}));
      const {code}=await post('/api/rooms',{...seats[0],game,rounds:5,settings:{rounds:3,mode:'classic',writeSeconds:0,discussionSeconds:0,finalDouble:false,funnyVote:false}},tokens[0],201);
      await post(`/api/rooms/${code}/join`,{...newCredentials(),name:'مقعد مكرر',avatar:3},tokens[0],409);
      for(let n=1;n<3;n++) await post(`/api/rooms/${code}/join`,seats[n],tokens[n]);
      const groupClients=seats.map(seat=>new RoomClient({server,code,session:{id:seat.id,token:seat.token},WebSocketImpl:BrowserSocket}));
      clients.push(...groupClients); groupClients.forEach(c=>c.start());
      await until(()=>groupClients.every(c=>c.state?.members.every(m=>m.connected)),'all seats connected');
      return {code,seats,clients:groupClients};
    }
    async function start(group) {
      await Promise.all(group.clients.slice(1).map(c=>c.command('ready',{ready:true})));
      await group.clients[0].command('start');
    }
    const first=await group('meenfina');
    for(let match=1;match<=2;match++) {
      await start(first);
      for(let round=1;round<=5;round++) {
        await until(()=>first.clients.every(c=>c.state.phase==='vote'&&c.state.round===round));
        await Promise.all(first.clients.map(c=>c.command('vote',{targetId:first.seats[0].id})));
        await until(()=>first.clients.every(c=>c.state.phase==='result'));
        for(const c of first.clients) assert.equal(JSON.stringify(c.state).includes('account-'),false);
        if(match===1&&round===2) await mf.unsafeEvictDurableObject('maydan-rooms','Room',{name:first.code,webSockets:'hibernate'});
        await first.clients[0].command('next');
      }
      await until(()=>first.clients.every(c=>c.state.phase==='over'));
      try { await until(async()=>Number((await DB.prepare('SELECT COUNT(*) AS n FROM player_events').first()).n)===match*2,'persisted match events'); }
      catch(error) { assert.fail(error.message + JSON.stringify((await DB.prepare('SELECT user_id,event_id,game FROM player_events').all()).results)); }
      first.clients[1].stop(); first.clients[1].start(); await until(()=>first.clients[1].connectionStatus==='connected');
      if(match===1) { await first.clients[0].command('restart'); await until(()=>first.clients.every(c=>c.state.phase==='lobby')); }
    }
    assert.deepEqual((await DB.prepare('SELECT online_matches,online_wins,online_draws FROM player_stats WHERE user_id=?').bind('account-0').first()),
      {online_matches:2,online_wins:0,online_draws:0});
    assert.equal((await DB.prepare('SELECT COUNT(DISTINCT event_id) AS n FROM player_events').first()).n,2);
    first.clients.forEach(c=>c.stop());

    const fab=await group('fabraka'); await start(fab);
    for(let round=1;round<=3;round++) {
      await until(()=>fab.clients.every(c=>c.state.phase==='write'&&c.state.round===round));
      const question=questions.find(q=>q.text===fab.clients[0].state.question.text); assert.ok(question);
      for(let n=0;n<3;n++) await fab.clients[n].command('lie',{text:`خيال اللاعب ${n}`});
      await until(()=>fab.clients.every(c=>c.state.phase==='vote'));
      const option=text=>fab.clients[0].state.options.find(o=>o.text===text).id;
      await fab.clients[0].command('vote',{optionId:option(question.answer)});
      for(let n=1;n<3;n++) await fab.clients[n].command('vote',{optionId:option('خيال اللاعب 0')});
      await until(()=>fab.clients.every(c=>c.state.phase==='reveal'));
      while(fab.clients[0].state.phase==='reveal') await fab.clients[0].command(fab.clients[0].state.reveal.shown?'next_reveal':'reveal');
      await until(()=>fab.clients.every(c=>c.state.phase==='result'));
      await fab.clients[0].command('next');
    }
    await until(()=>fab.clients.every(c=>c.state.phase==='over'));
    await until(async()=>Number((await DB.prepare('SELECT COUNT(*) AS n FROM player_events').first()).n)===6);
    const result=await DB.prepare('SELECT user_id,online_matches,online_wins,online_draws FROM player_stats ORDER BY user_id').all();
    assert.deepEqual(result.results,[{user_id:'account-0',online_matches:3,online_wins:1,online_draws:0},{user_id:'account-1',online_matches:3,online_wins:0,online_draws:0}]);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM player_events WHERE user_id=?').bind('account-2').first()).n,0);
    assert.equal((await DB.prepare('SELECT COUNT(DISTINCT game) AS n FROM player_events WHERE user_id=?').bind('account-0').first()).n,2);
  } finally {
    clients.forEach(c=>c.stop()); if(mf) await mf.dispose();
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    await rm(dir,{recursive:true,force:true});
  }
});
