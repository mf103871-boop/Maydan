import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {createHash}from'node:crypto';
import {build}from'esbuild';import{Miniflare,convertV4MiniflareOptions}from'miniflare';
const source=`import{emptyErsomhaDrawing,prepareErsomhaDrawing,persistErsomhaDrawing,checkpointErsomhaDrawing,loadErsomhaDrawing,ersomhaSyncMessages,archiveErsomhaDrawing}from'./server/ersomha-drawing.mjs';
const room={game:'ersomha',matchId:1,round:1,phase:'draw',draw:{drawerId:'drawer',pauseUntil:null,viewers:['viewer']},members:[{id:'drawer',accountUserId:'author'}]};
export class DrawingTest{constructor(ctx){this.ctx=ctx;this.ready=ctx.blockConcurrencyWhile(async()=>{const v=await loadErsomhaDrawing(ctx.storage,room);this.board=v.board;this.head=v.head;});}async fetch(req){await this.ready;const input=await req.json();try{
if(input.type==='init'){this.board=emptyErsomhaDrawing(room,input.version);this.head=await this.ctx.storage.transaction(tx=>checkpointErsomhaDrawing(tx,this.board,this.head));}
else if(input.type==='checkpoint'){this.head=await this.ctx.storage.transaction(tx=>checkpointErsomhaDrawing(tx,this.board,this.head));}
else if(input.type==='sync')return Response.json({packets:ersomhaSyncMessages(room,this.board),head:this.head,board:this.board});
else if(input.type==='archive'){const index=await this.ctx.storage.transaction(tx=>archiveErsomhaDrawing(tx,room,this.board));return Response.json(JSON.parse((await Promise.all(index[0].parts.map(k=>this.ctx.storage.get(k)))).join('')));}
else{const change=prepareErsomhaDrawing(room,this.board,input.actor||'drawer',input);if(change.event){const head=await persistErsomhaDrawing(this.ctx.storage,change.board,change.event,this.head);this.board=change.board;this.head=head;}return Response.json({duplicate:!!change.duplicate,version:this.board.paletteVersion,seq:this.board.seq});}
return Response.json({version:this.board.paletteVersion});}catch(e){return Response.json({error:e.code||e.message},{status:e.status||400});}}}
export default{fetch(req,env){return env.DRAWING.get(env.DRAWING.idFromName('same-persisted-board')).fetch(req);}};`;
const output=process.env.ERSOMHA_PALETTE_EVIDENCE_DIR||path.resolve('.cache/ersomha-palette-v2');
test('real workerd storage keeps v2 across process restart, multipart sync, undo/redo/clear and archive', {timeout:60000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'maydan-palette-v2-'));let mf,outbound=0;const scriptPath=path.join(dir,'worker.mjs');
 const built=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});await writeFile(scriptPath,built.outputFiles[0].contents);
 const boot=async()=>{mf=new Miniflare(convertV4MiniflareOptions({name:'palette-storage',rootPath:dir,modules:true,scriptPath,compatibilityDate:'2026-09-01',durableObjects:{DRAWING:{className:'DrawingTest',useSQLite:true}},resourcePersistencePath:path.join(dir,'storage'),cf:false,outboundService:()=>{outbound++;throw Error('no outbound');}}));await mf.ready;};
 const call=async body=>{const response=await mf.dispatchFetch('http://fixture.local/',{method:'POST',body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
 const command=(n,patch={})=>({type:'drawing_batch',matchId:1,round:1,epoch:1,paletteVersion:2,requestId:'r'+n,strokeId:'long',color:'#efd3fa',width:6,tool:'pen',end:n===99,points:Array.from({length:32},(_,i)=>[(n*32+i)/3200,.3]),...patch});
 try{
 await boot();assert.equal((await call({type:'init',version:2})).status,200);
 for(let n=0;n<100;n++)assert.equal((await call(command(n))).status,200);
 await call({type:'checkpoint'});const before=(await call({type:'sync'})).body;assert.equal(before.head.paletteVersion,2);assert.ok(before.packets.length>1);assert.ok(before.head.parts.length>1);
 await mf.dispose();mf=null;await boot();const restored=(await call({type:'sync'})).body;assert.equal(createHash('sha256').update(JSON.stringify(restored)).digest('hex'),createHash('sha256').update(JSON.stringify(before)).digest('hex'),'fresh isolate restores exact persisted board/log/head');
 assert.equal((await call(command(99))).body.duplicate,true);
 assert.equal((await call(command(100,{actor:'viewer'}))).body.error,'ERSOMHA_DRAWER_ONLY');
 assert.equal((await call(command(100,{paletteVersion:1}))).body.error,'ERSOMHA_PALETTE_UNSUPPORTED');
 assert.equal((await call(command(100,{type:'drawing_undo'}))).status,200);assert.equal((await call({type:'archive'})).body.strokes.length,0);
 assert.equal((await call(command(101,{type:'drawing_redo'}))).status,200);const archive=(await call({type:'archive'})).body;assert.equal(archive.paletteVersion,2);assert.equal(archive.strokes[0].color,'#efd3fa');assert.equal(archive.strokes[0].points.length,3200);
 assert.equal((await call(command(102,{type:'drawing_clear'}))).body.version,2);await mf.dispose();mf=null;await boot();const cleared=(await call({type:'sync'})).body;assert.equal(cleared.board.paletteVersion,2);assert.equal(cleared.board.epoch,2);assert.equal(cleared.board.strokes.length,0);
 assert.equal(outbound,0);await mkdir(output,{recursive:true});await writeFile(path.join(output,'workerd.json'),JSON.stringify({passed:true,runtime:'workerd',fixture:'actual drawing storage module inside local SQLite Durable Object; no production route/auth fixture',remoteRequests:outbound,restarts:2,points:3200,syncChunks:before.packets.length,checkpointParts:before.head.parts.length,paletteVersion:2,archiveColor:archive.strokes[0].color,bundleSHA256:createHash('sha256').update(built.outputFiles[0].contents).digest('hex')},null,2));
 }finally{if(mf)await mf.dispose();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'maydan-palette-v2-'));await rm(dir,{recursive:true,force:true});}
});
