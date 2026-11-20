import test from 'node:test';
import assert from 'node:assert/strict';
import { ERSOMHA_PALETTE, ERSOMHA_PALETTE_V2, ERSOMHA_LAVENDER, drawingPaletteVersion } from '../src/games/ersomha/palette.js';
import { createDrawingState, applyDrawingEvent, createDrawingSyncAssembler } from '../src/games/ersomha/drawing.js';
import { emptyErsomhaDrawing, prepareErsomhaDrawing, persistErsomhaDrawing, checkpointErsomhaDrawing, loadErsomhaDrawing, archiveErsomhaDrawing, ersomhaSyncMessages, ersomhaVisibleCanvas } from '../server/ersomha-drawing.mjs';
import { privateDrawingEvidence } from '../server/ersomha-reports.mjs';

const room = { game:'ersomha',matchId:1,round:1,phase:'draw',draw:{drawerId:'p0',pauseUntil:null,viewers:['u0']},members:[{id:'p0',accountUserId:'u0'}] };
const cmd=(id,patch={})=>({type:'drawing_batch',requestId:'r'+id,matchId:1,round:1,epoch:1,strokeId:'s'+id,points:[[.1,.2],[.8,.2]],color:ERSOMHA_LAVENDER,width:6,tool:'pen',end:true,...patch});
class Storage { constructor(){this.data=new Map();this.fail=false;} async get(k){return structuredClone(this.data.get(k));} async put(k,v){if(this.fail&&k==='ersomha:board')throw Error('commit failed');this.data.set(k,structuredClone(v));}async delete(k){this.data.delete(k);}async transaction(fn){const before=structuredClone(this.data);try{return await fn(this);}catch(e){this.data=before;throw e;}} }
const rejected=(fn,code='ERSOMHA_PALETTE_UNSUPPORTED')=>assert.throws(fn,e=>e.code===code);
async function commit(storage,state,command){const next=prepareErsomhaDrawing(room,state.board,'p0',command);if(next.event)return{board:next.board,head:await persistErsomhaDrawing(storage,next.board,next.event,state.head)};return state;}

test('v1 is immutable; additive v2 accepts legacy clients without widening old boards or changing stroke color',()=>{
 assert.equal(ERSOMHA_PALETTE.length,12);assert.deepEqual(ERSOMHA_PALETTE_V2.slice(0,12),ERSOMHA_PALETTE);assert.equal(ERSOMHA_PALETTE_V2.at(-1),'#efd3fa');
 for(const version of [null,0,3,'2',{},NaN])assert.equal(drawingPaletteVersion(version),null);
 const legacy=emptyErsomhaDrawing(room);delete legacy.paletteVersion;
 rejected(()=>prepareErsomhaDrawing(room,legacy,'p0',cmd(0)),'INVALID');
 rejected(()=>prepareErsomhaDrawing(room,legacy,'p0',cmd(0,{paletteVersion:2,color:'#9250bd'})));
 let board=emptyErsomhaDrawing(room,2);
 for(const [i,color]of ERSOMHA_PALETTE.entries())board=prepareErsomhaDrawing(room,board,'p0',cmd(i,{color})).board;
 board=prepareErsomhaDrawing(room,board,'p0',cmd('new',{paletteVersion:2,end:false})).board;
 assert.deepEqual(board.strokes.slice(0,12).map(s=>s.color),ERSOMHA_PALETTE);
 rejected(()=>prepareErsomhaDrawing(room,board,'p0',cmd('new',{requestId:'r-mutate',paletteVersion:2,color:'#9250bd'})),'ERSOMHA_CANVAS_STALE');
 for(const paletteVersion of [1,3,null,'2'])rejected(()=>prepareErsomhaDrawing(room,board,'p0',cmd('bad',{paletteVersion})));
 rejected(()=>prepareErsomhaDrawing(room,board,'p1',cmd('no')),'ERSOMHA_DRAWER_ONLY');
 rejected(()=>prepareErsomhaDrawing(room,board,'p0',cmd('bad',{color:'#efd3fb'})),'INVALID');
});

test('v2 survives multipart checkpoint/log compaction, duplicates, undo/redo, clear and report archive without recoloring',async()=>{
 const storage=new Storage();let state={board:emptyErsomhaDrawing(room,2),head:null};
 for(let n=0;n<100;n++)state=await commit(storage,state,cmd(n,{strokeId:'long',end:n===99,points:Array.from({length:32},(_,i)=>[(n*32+i)/3200,.2])}));
 const before=structuredClone(state.board);const original=JSON.stringify(state.board.strokes);
 assert.ok(state.head.log.length<=64);assert.equal(state.head.paletteVersion,2);
 state.head=await checkpointErsomhaDrawing(storage,state.board,state.head);assert.ok(state.head.parts.length>1);
 state=await loadErsomhaDrawing(storage,room);assert.deepEqual(state.board,before);assert.equal(JSON.stringify(state.board.strokes),original);
 assert.equal(prepareErsomhaDrawing(room,state.board,'p0',cmd(99)).duplicate,true);
 const packets=ersomhaSyncMessages(room,state.board);assert.ok(packets.length>1);assert.ok(packets.every(p=>p.paletteVersion===2));
 const assemble=createDrawingSyncAssembler(),model=createDrawingState(1,2);let full;
 for(const packet of packets.toReversed()){const result=assemble(packet);if(result.event)full=result.event;}
 assert.equal(applyDrawingEvent(model,full),true);assert.equal(model.strokes.get('long').color,ERSOMHA_LAVENDER);assert.equal(model.strokes.get('long').points.length,3200);
 state=await commit(storage,state,cmd('undo',{type:'drawing_undo'}));assert.equal(ersomhaVisibleCanvas(state.board).strokes.length,0);
 state=await commit(storage,state,cmd('redo',{type:'drawing_redo'}));assert.equal(JSON.stringify(state.board.strokes),original);
 const index=await archiveErsomhaDrawing(storage,room,state.board);const canvas=JSON.parse((await Promise.all(index[0].parts.map(k=>storage.get(k)))).join(''));
 const evidence=privateDrawingEvidence({game:'ersomha',roomCode:'123456',matchId:1,round:1,drawerUserId:'u0',createdAt:Date.now(),canvas,secretWord:'DO_NOT_PROJECT'},{roomCode:'123456',matchId:1,round:1});
 assert.equal(evidence.canvas.paletteVersion,2);assert.equal(evidence.canvas.strokes[0].color,ERSOMHA_LAVENDER);assert.equal(JSON.stringify(evidence).includes('DO_NOT_PROJECT'),false);
 state=await commit(storage,state,cmd('clear',{type:'drawing_clear',paletteVersion:2}));state=await loadErsomhaDrawing(storage,room);assert.equal(state.board.paletteVersion,2);assert.equal(state.board.epoch,2);assert.equal(state.board.strokes.length,0);
 assert.equal(canvas.strokes[0].color,ERSOMHA_LAVENDER);assert.equal(JSON.stringify(canvas.strokes),original);
 rejected(()=>privateDrawingEvidence({...evidence,canvas:{...canvas,paletteVersion:1}},{roomCode:'123456',matchId:1,round:1}),'INVALID');
});

test('old durable records default to v1 read-only; version mismatch/corruption and failed commits fail closed',async()=>{
 const storage=new Storage(),old=emptyErsomhaDrawing(room);delete old.paletteVersion;
 old.strokes=[{strokeId:'old',points:[[.3,.4]],color:'#9250bd',width:6,tool:'pen',end:true}];old.pointCount=1;
 let head=await checkpointErsomhaDrawing(storage,old);delete head.paletteVersion;await storage.put('ersomha:board',head);
 const raw=structuredClone(storage.data);const restored=await loadErsomhaDrawing(storage,room);
 assert.equal(restored.board.paletteVersion,undefined);assert.equal(ersomhaSyncMessages(room,restored.board)[0].paletteVersion,1);assert.deepEqual(storage.data,raw);
 await storage.put('ersomha:board',{...head,paletteVersion:2});await assert.rejects(loadErsomhaDrawing(storage,room),e=>e.code==='ERSOMHA_CANVAS_UNAVAILABLE');
 await storage.put('ersomha:board',{...head,paletteVersion:99});await assert.rejects(loadErsomhaDrawing(storage,room),e=>e.code==='ERSOMHA_PALETTE_UNSUPPORTED');
 const board=emptyErsomhaDrawing(room,2);head=await checkpointErsomhaDrawing(storage,board);storage.fail=true;
 const change=prepareErsomhaDrawing(room,board,'p0',cmd(1));await assert.rejects(persistErsomhaDrawing(storage,change.board,change.event,head),/commit failed/);
 storage.fail=false;assert.deepEqual((await loadErsomhaDrawing(storage,room)).board,board);
});

test('sync assembly requires matching version and exact chunk count; no partial or unknown-version repaint',()=>{
 const base={kind:'sync',matchId:1,round:1,epoch:1,seq:5,paletteVersion:2,chunks:2,chunk:0,ops:[cmd(1)],undoneIds:[]};
 for(const patch of [{paletteVersion:1},{chunks:3},{chunk:3},{paletteVersion:999}]){
 const assemble=createDrawingSyncAssembler();assert.equal(assemble(base).event,null);assert.equal(assemble({...base,chunk:1,...patch}).error,true);
 }
 const model=createDrawingState(1,1);model.strokes.set('retained',{color:'#9250bd'});
 assert.equal(applyDrawingEvent(model,{...base,chunks:1}),false);assert.equal(model.strokes.get('retained').color,'#9250bd');
 const v2=createDrawingState(1,2);assert.equal(applyDrawingEvent(v2,{...base,paletteVersion:77}),false);assert.equal(v2.strokes.size,0);
});

import {RoomClient} from '../src/online/client.js';
test('Room transport requires actual room capability/version while protocol1 and legacy absence remain compatible',async()=>{
 class Socket{constructor(){this.readyState=1;this.sent=[];Socket.current=this;}send(raw){this.sent.push(JSON.parse(raw));}close(){this.readyState=3;}receive(message){this.onmessage({data:JSON.stringify(message)});}}
 const client=new RoomClient({server:'http://localhost:3000',code:'123456',session:{id:'seat',token:'synthetic'},WebSocketImpl:Socket});client.start();const ws=Socket.current;ws.onopen();let revision=0;
 const state=(version,caps)=>ws.receive({type:'state',state:{game:'ersomha',protocol:1,matchId:1,round:1,revision:++revision,serverNow:Date.now(),drawing:{epoch:1,seq:0,...(version===undefined?{}:{paletteVersion:version})},capabilities:{ersomhaPaletteVersions:caps}}});
 try{
 for(const[version,caps]of[[2,undefined],[2,[1]],[99,[1,2]],[null,[1,2]]]){state(version,caps);const count=ws.sent.length;await assert.rejects(client.command('drawing_batch',cmd('client')),e=>e.code==='ERSOMHA_PALETTE_UNSUPPORTED');assert.equal(ws.sent.length,count,'blocked before wire');}
 for(const[version,caps]of[[undefined,undefined],[1,[1,2]],[2,[1,2]]]){state(version,caps);const pending=client.command('drawing_batch',cmd('valid',{color:'#9250bd'}));const sent=ws.sent.at(-1);assert.equal(sent.paletteVersion,version===undefined?1:version);ws.receive({type:'ack',requestId:sent.requestId,ok:true,drawing:{epoch:1,seq:1,paletteVersion:sent.paletteVersion}});assert.equal((await pending).ok,true);}
 assert.equal(client.connectionStatus,'connected');
 }finally{client.stop();}
});
