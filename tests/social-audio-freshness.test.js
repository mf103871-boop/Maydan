import test from 'node:test';
import assert from 'node:assert/strict';
import {SocialClient} from '../src/social/client.js';
import {LammaClient} from '../src/social/lamma-client.js';
import {createSocialLiveAudio,liveNotificationAudio,createSocialSendAudio,confirmSocialSend} from '../src/social/audio-feedback.js';
import {createSocialNotificationAudio} from '../src/social/media.js';
import {createAudioEvents} from '../src/shared/fx/audio-events.js';

const message=(seq,extra={})=>({seq,conversationId:'chat',senderId:'peer',clientId:'message-'+seq,text:'fixture',...extra});
function live(){let now=1000;const source=createSocialLiveAudio({now:()=>now});source.reset('owner');source.connect();return{source,advance(ms){now+=ms;}};}
const event=(seq,extra={})=>({type:'message',reason:'message',conversationId:'chat',messageSeq:seq,...extra});
test('only a current live message frame can mint one matching receipt; inventory, ready, edits, read and malformed data cannot',()=>{
  const f=live();assert.equal(f.source.claim('direct','chat',1),null);
  for(const bad of [{type:'ready'},event(1,{reason:'edited'}),event(1,{reason:'read'}),event(0),event(1,{messageSeq:'1'}),{type:'refresh',reason:'request'}])assert.equal(f.source.receive(bad),false);
  assert.equal(f.source.receive(event(2)),true);assert.equal(f.source.claim('direct','other',2),null);assert.equal(f.source.claim('direct','chat',1),null);
  const receipt=f.source.claim('direct','chat',2);assert.equal(receipt.current(),true);assert.equal(f.source.claim('direct','chat',2),null);
  assert.equal(f.source.receive(event(2)),false);assert.equal(f.source.receive(event(1)),false);
});
test('disconnect, account swap, hidden, lock and expired leases never replay after resuming',()=>{
  for(const mode of ['disconnect','account','hidden','locked','expired']){
    const f=live();f.source.receive(event(1));const receipt=f.source.claim('direct','chat',1);
    if(mode==='disconnect'){f.source.disconnect();f.source.connect();}
    else if(mode==='account'){f.source.reset('other');f.source.connect();}
    else if(mode==='expired')f.advance(1001);
    else{const g=live();assert.equal(g.source.receive(event(2),{[mode==='hidden'?'visible':'locked']:mode==='hidden'?false:true}),false);assert.equal(g.source.receive(event(2)),false);continue;}
    assert.equal(receipt.current(),false,mode);
  }
});
test('unread-only notices and call notices stay silent; proven direct/group events use receipt time and guarded duplicate suppression',()=>{
  let now=1000;const played=[],bus=createAudioEvents((cue,options)=>{played.push({cue,options});return true;},{now:()=>now});
  const notices=createSocialNotificationAudio(bus),source=createSocialLiveAudio({now:()=>now});source.reset('owner');source.connect();
  const old={id:'inventory',userId:'owner',friend:{conversationId:'chat',lastMessage:message(4)}};
  notices.emit(old,{owner:'owner',muted:!liveNotificationAudio(old,'owner')});assert.equal(played.length,0);
  for(const [scope,type,id,seq] of [['direct','message','chat',5],['group','group','group1',8]]){
    now+=2000;source.receive({type,reason:'message',conversationId:id,groupId:id,messageSeq:seq});
    const receipt=source.claim(scope,id,seq),notification={id:type,userId:'owner',conversationId:id,messageId:seq,audioReceipt:receipt};
    const allowed=()=>liveNotificationAudio(notification,'owner');
    notices.emit(notification,{owner:'owner',scope,at:receipt.receivedAt,muted:!allowed(),guard:allowed});
    notices.emit(notification,{owner:'owner',scope,at:receipt.receivedAt,guard:allowed});
    assert.equal(played.at(-1).options.guard(),true);source.disconnect();assert.equal(played.at(-1).options.guard(),false);source.connect();
  }
  assert.equal(played.length,2);
});

function clientFixture(t){
  let seq=1,time=1000;const sockets=[];
  const snapshot=()=>({user:{id:'owner'},friends:[{id:'peer',conversationId:'chat'}],incoming:[],conversations:[{id:'chat',user:{id:'peer'},unreadCount:seq,lastMessage:message(seq)}]});
  const client=new SocialClient({now:()=>time,server:()=> 'https://fixture.invalid',request:async path=>path.endsWith('/live-ticket')?{userId:'owner',ticket:'synthetic'}:snapshot(),socketFactory:()=>{const socket={readyState:1,send(){},close(){this.onclose?.();}};sockets.push(socket);return socket;}});
  client.userId='owner';client.liveAudio.reset('owner');client.scheduleRefresh=()=>{};t.after(()=>client.stop());
  return{client,sockets,sequence(value){seq=value;},advance(ms){time+=ms;}};
}
test('actual SocialClient initial/history/reconnect refresh cannot grant audio; only its current authenticated socket callback can',async t=>{
  const f=clientFixture(t),{client}=f;await client.refresh();assert.equal(client.claimLiveAudio('direct','chat',1),null);
  await client.connect();const first=f.sockets[0];first.onopen();
  // An HTTP refresh is not live delivery, even while a socket is connected.
  f.sequence(2);await client.refresh({quiet:true});assert.equal(client.claimLiveAudio('direct','chat',2),null);
  await client.receive({data:JSON.stringify(event(3))});assert.equal(client.claimLiveAudio('direct','chat',3),null,'ordinary/global producer cannot manufacture transport provenance');
  first.onmessage({data:JSON.stringify(event(4))});f.sequence(4);await client.refresh({quiet:true});
  const proof=client.claimLiveAudio('direct','chat',4);assert.equal(proof.current(),true);
  const stale=first.onmessage;first.close();assert.equal(proof.current(),false);await client.connect();f.sockets[1].onopen();
  stale({data:JSON.stringify(event(5))});assert.equal(client.claimLiveAudio('direct','chat',5),null);
  f.sequence(6);await client.refresh({quiet:true});assert.equal(client.claimLiveAudio('direct','chat',6),null);
  f.sockets[1].onmessage({data:JSON.stringify({type:'group',reason:'message',groupId:'group1',messageSeq:7})});
  assert.equal(client.claimLiveAudio('group','group1',7).current(),true);
});
test('source notification receipt does not return after its account is stopped/replaced or its socket fails',async t=>{
  const f=clientFixture(t);await f.client.refresh();await f.client.connect();const socket=f.sockets[0];socket.onopen();
  socket.onmessage({data:JSON.stringify(event(1))});const proof=f.client.claimLiveAudio('direct','chat',1);assert.ok(proof);
  socket.onerror();assert.equal(proof.current(),false);f.client.stop();f.client.userId='other';assert.equal(proof.current(),false);
});

test('send feedback validates the actual server message and consumes retries/echoes while context changes cancel pending playback',()=>{
  const calls=[],sound={emit:(type,options)=>{calls.push({type,...options});return true;}},feedback=createSocialSendAudio();
  feedback.bind('owner','direct','chat',sound);feedback.mount();
  for(const bad of [null,message(0,{senderId:'owner'}),message(1),message(1,{senderId:'owner',conversationId:'other'}),message(1,{senderId:'owner',deletedAt:1})])assert.equal(feedback.accepted(feedback.begin(),bad),false);
  const accepted=message(1,{senderId:'owner'});assert.equal(feedback.accepted(feedback.begin(),accepted),true);assert.equal(feedback.accepted(feedback.begin(),accepted),false);
  const guard=calls[0].guard;feedback.bind('owner','direct','other',sound);assert.equal(guard(),false);
  const ticket=feedback.begin();feedback.bind('new-owner','direct','other',sound);assert.equal(feedback.accepted(ticket,message(2,{senderId:'owner',conversationId:'other'})),false);
  feedback.dispose();assert.equal(feedback.begin(),null);assert.equal(calls.length,1);
});
test('actual direct/group send methods settle before feedback and retain stable clientId duplicate ownership',async t=>{
  for(const group of [false,true]){
    const calls=[],feedback=createSocialSendAudio();feedback.bind('owner',group?'group':'direct',group?'group1':'chat',{emit:type=>{calls.push(type);return true;}});feedback.mount();
    let finish,body;
    const request=async(path,options)=>{body=options.body;return new Promise(resolve=>{finish=resolve;});};
    const client=group?new LammaClient({request}):new SocialClient({request,server:()=> 'https://fixture.invalid'});client.userId='owner';t.after(()=>client.stop());
    if(group){client.state.groupConversations.group1={messages:[]};client.refreshGroupMessage=async()=>{};}
    else{client.state.friends=[{id:'peer',conversationId:'chat'}];client.scheduleRefresh=()=>{};}
    const ticket=feedback.begin(),pending=group?client.sendGroupMessage('group1','fixture'):client.sendMessage('peer','fixture');assert.equal(calls.length,0);
    finish({message:message(1,{senderId:'owner',conversationId:group?'group1':'chat',clientId:body.clientId})});
    const receipt=await pending;assert.equal(feedback.accepted(ticket,receipt),true);assert.equal(feedback.accepted(feedback.begin(),receipt),false);assert.deepEqual(calls,['ui.confirm']);
  }
});

test('actual voice upload is silent until its message ACK; failed send/retry uses one committed confirmation and stale UI context is silent',async t=>{
  for(const scope of ['direct','group']){
    const targetId=scope==='group'?'group1':'chat',calls=[],requests=[];
    const feedback=createSocialSendAudio();feedback.bind('owner','action','open-chat',{emit:type=>{calls.push(type);return true;}});feedback.mount();
    let pending;
    const client=new LammaClient({request:async(path,options)=>{requests.push(path);if(path.endsWith('/attachments'))return{attachment:{id:'clip'}};return new Promise((resolve,reject)=>{pending={resolve,reject,body:options.body};});}});
    client.userId='owner';client.state.groupConversations.group1={messages:[]};client.refreshGroupMessage=async()=>{};t.after(()=>client.stop());
    const blob=new Blob([new Uint8Array([0,255,127,0])],{type:'audio/wav'}),target={scope,id:targetId};
    const send=()=>confirmSocialSend(feedback,target,()=>client.sendVoiceNote({targetType:scope,targetId,blob,durationMs:500}));
    const first=send();await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,2);assert.deepEqual(calls,[],'upload success is not message acceptance');
    const failedClientId=pending.body.clientId;pending.reject(Object.assign(new Error('fixture'),{code:'NETWORK'}));await assert.rejects(first);assert.deepEqual(calls,[]);
    const retry=send();await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.filter(path=>path.endsWith('/attachments')).length,1);assert.equal(pending.body.clientId,failedClientId);
    const receipt=message(30,{senderId:'owner',conversationId:targetId,clientId:failedClientId,kind:'voice',attachmentId:'clip'});pending.resolve({message:receipt});assert.equal(await retry,receipt);assert.deepEqual(calls,['ui.confirm']);
    const late=send();await new Promise(resolve=>setImmediate(resolve));feedback.bind('owner','action','another-chat',{emit:type=>{calls.push(type);return true;}});pending.resolve({message:{...receipt,seq:31}});await late;assert.deepEqual(calls,['ui.confirm'],'moving away while POST is pending cancels its cue');
  }
});

test('actual room invite confirms only its persisted message; rejected or duplicate receipt does not confirm and account switch cancels',async t=>{
  for(const scope of ['direct','group']){
    const targetId=scope==='group'?'group1':'chat',calls=[],feedback=createSocialSendAudio(),sound={emit:type=>{calls.push(type);return true;}};
    feedback.bind('owner',scope,targetId,sound);feedback.mount();let pending;
    const client=new LammaClient({request:async(path,options)=>new Promise((resolve,reject)=>{assert.equal(path,'/api/social/room-invitations');pending={resolve,reject,body:options.body};})});client.userId='owner';client.refresh=async()=>{};client.state.groupConversations.group1={messages:[]};t.after(()=>client.stop());
    const target={scope,id:targetId},send=()=>confirmSocialSend(feedback,target,()=>client.sendGameInvite({targetType:scope,targetId,roomCode:'123456'}));
    const first=send();assert.deepEqual(calls,[]);const clientId=pending.body.clientId;pending.reject(Object.assign(new Error('fixture'),{code:'NETWORK'}));await assert.rejects(first);assert.deepEqual(calls,[]);
    const retry=send();assert.equal(pending.body.clientId,clientId);const receipt=message(40,{senderId:'owner',conversationId:targetId,clientId,kind:'room_invite'});const result={message:receipt,invitation:{id:'invite'}};pending.resolve(result);assert.equal(await retry,result);assert.deepEqual(calls,['ui.confirm']);
    const duplicate=confirmSocialSend(feedback,target,async()=>result);await duplicate;assert.deepEqual(calls,['ui.confirm']);
    const late=send();feedback.bind('different-owner',scope,targetId,sound);pending.resolve({message:{...receipt,seq:41,clientId:'later'}});await late;assert.deepEqual(calls,['ui.confirm']);
  }
});
