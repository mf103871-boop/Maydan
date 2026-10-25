import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialClient, mergeMessages } from '../src/social/client.js';

const message = (seq, patch = {}) => ({ seq, clientId: `message-${seq}`, conversationId: 'chat', senderId: 'bob', text: `نص ${seq}`,
  createdAt: seq*1000, editedAt: null, deletedAt: null, ...patch });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function setup(t, handler = () => { throw new Error('Unexpected request'); }) {
  const client = new SocialClient({ request: handler, server: () => 'https://example.test' });
  client.userId = 'alice'; client.state.friends = [{ id: 'bob', conversationId: 'chat' }];
  client.scheduleRefresh = () => {}; t.after(() => client.stop()); return client;
}

test('a stalled social WebSocket opening expires and late callbacks cannot replace its successor',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const client=setup(t,async()=>({userId:'alice',ticket:'one-use-ticket'})),sockets=[];
  client.socketFactory=()=>{const socket={readyState:0,closed:0,close(){this.closed++;},send(){}};sockets.push(socket);return socket;};
  let retries=0;client.reconnectLater=()=>{retries++;};
  await client.connect();const staleOpen=sockets[0].onopen,staleClose=sockets[0].onclose;
  t.mock.timers.tick(20_000);assert.equal(client.socket,null);assert.equal(sockets[0].closed,1);assert.equal(retries,1);
  await client.connect();const current=sockets[1];current.readyState=1;current.onopen();
  staleOpen();staleClose();assert.equal(client.socket,current);assert.equal(client.state.connected,true);
  t.mock.timers.tick(20_000);assert.equal(client.socket,current);assert.equal(retries,1);
});

test('offline transition retires social transport immediately and prevents stale messages from arriving',async t=>{
  const client=setup(t,async()=>({userId:'alice',ticket:'one-use-ticket'}));let received=0;
  const socket={readyState:1,closed:0,close(){this.closed++;},send(){}};client.socketFactory=()=>socket;
  await client.connect();socket.onopen();const staleMessage=socket.onmessage;
  client.receive=async()=>{received++;};client.networkOffline();staleMessage({data:'{}'});
  assert.equal(client.socket,null);assert.equal(client.state.connected,false);assert.equal(client.state.offline,true);assert.equal(socket.closed,1);assert.equal(received,0);
  await client.connect();assert.equal(client.socket,null);
});
test('a server echo replaces a pending message once and tombstones replace old text', () => {
  const pending = { clientId: 'retry-stable', text: 'مرحبًا', status: 'pending' };
  const ack = message(8, { clientId: pending.clientId });
  let messages = mergeMessages([message(2),pending],[ack],2);
  assert.deepEqual(messages.map(m=>m.seq),[2,8]); assert.equal(messages[0].read,true);
  messages = mergeMessages(messages,[ack,message(2,{text:'',deletedAt:9000})],8);
  assert.equal(messages.length,2); assert.equal(messages[0].text,''); assert.equal(messages[1].read,true);
});

test('confirmed outgoing voice appears immediately without waiting for history and deduplicates its echo', t => {
  const client = setup(t);
  const voice = message(9, { senderId: 'alice', kind: 'voice', attachment: { id: 'audio', durationMs: 1000 } });
  assert.equal(client.receiveOwnMessage(voice, 'chat'), true);
  assert.equal(client.state.conversations.bob.messages[0].attachment.id, 'audio');
  client.receiveOwnMessage(voice, 'chat'); assert.equal(client.state.conversations.bob.messages.length, 1);
  client.receiveOwnMessage({ ...voice, deletedAt: 100, attachment: null }, 'chat');
  client.receiveOwnMessage(voice, 'chat'); assert.equal(client.state.conversations.bob.messages[0].deletedAt, 100);
});

test('confirmed messages resolve a legacy friend through the authorized conversation list', t => {
  const client = setup(t);
  client.update({ friends: [{ id: 'bob' }], conversationList: [{ id: 'chat', user: { id: 'bob' } }] });
  assert.equal(client.receiveOwnMessage(message(9, { senderId: 'alice', kind: 'voice' }), 'chat'), true);
  assert.equal(client.state.conversations.bob.messages[0].seq, 9);
  client.update({ friends: [] });
  assert.equal(client.receiveOwnMessage(message(10, { senderId: 'alice' }), 'chat'), false);
});

test('confirmed-message optimization refuses another account or removed friendship', t => {
  const client = setup(t);
  assert.equal(client.receiveOwnMessage(message(9), 'chat'), false);
  assert.equal(client.receiveOwnMessage(message(9, { senderId: 'alice' }), 'other-chat'), false);
  client.userId = 'charlie'; assert.equal(client.receiveOwnMessage(message(9, { senderId: 'alice' }), 'chat'), false);
  client.userId = 'alice'; client.state.friends = [];
  assert.equal(client.receiveOwnMessage(message(9, { senderId: 'alice' }), 'chat'), false);
  assert.deepEqual(client.state.conversations, {});
});
test('retry after an uncertain delivery reuses clientId and cannot duplicate the message', async t => {
  const bodies=[];
  const client=setup(t,async (path,options)=>{
    bodies.push(options.body);
    if(bodies.length===1)throw Object.assign(new Error('lost response'),{code:'NETWORK'});
    return {message:message(4,{...options.body,senderId:'alice'})};
  });
  await assert.rejects(client.sendMessage('bob','أهلًا'));
  const pending=client.state.conversations.bob.messages[0]; assert.equal(pending.status,'failed');
  await client.retryMessage('bob',pending.clientId);
  assert.equal(bodies[0].clientId,bodies[1].clientId);
  assert.equal(client.state.conversations.bob.messages.length,1);
  assert.equal(client.state.conversations.bob.messages[0].seq,4);
});
test('a delayed response cannot restore the previous account messages after logout', async t => {
  const response=deferred(); const client=setup(t,()=>response.promise);
  const pending=client.sendMessage('bob','رسالة خاصة');
  client.stop(); client.userId='charlie';
  response.resolve({message:message(8,{text:'رسالة خاصة'})});
  await assert.rejects(pending,{code:'STALE'});
  assert.deepEqual(client.state.conversations,{});
});
test('older pages preserve current messages and overlap does not create duplicates', async t => {
  const calls=[];const client=setup(t,async path=>{calls.push(path);return {messages:[message(1),message(2)],nextBefore:null,hasMore:false,peerReadSeq:3,readSeq:2};});
  client.conversation('bob',{id:'chat',messages:[message(2),message(3)],hasMore:true,nextBefore:2});
  await client.loadOlder('bob');
  assert.match(calls[0],/before=2/); assert.deepEqual(client.state.conversations.bob.messages.map(m=>m.seq),[1,2,3]);
  assert.equal(client.state.conversations.bob.hasMore,false);
});
test('read receipts require the visible selected conversation and never include pending messages', async t => {
  const calls=[];const client=setup(t,async (path,options)=>{calls.push(options.body.seq);return {readSeq:options.body.seq};});
  client.conversation('bob',{id:'chat',messages:[message(7),{clientId:'pending',status:'pending'}]});
  await client.markRead('bob'); assert.equal(calls.length,0);
  client.selectConversation('bob');client.visible=()=>false;
  await client.markRead('bob');assert.equal(calls.length,0);
  client.visible=()=>true;await client.markRead('bob');await client.markRead('bob');
  assert.deepEqual(calls,[7]);
});
test('a committed action stays successful when a later refresh fails', async t => {
  const client=setup(t,async()=>({ok:true}));client.refresh=async()=>{throw new Error('network');};
  assert.deepEqual(await client.removeFriend('bob'),{ok:true});
});
test('stale history cannot restore a deleted message or replace a newer edit', () => {
  const deleted = message(1,{text:'',deletedAt:4000});
  const edited = message(2,{text:'الجديد',editedAt:5000});
  const merged = mergeMessages([deleted,edited],[message(1),message(2,{text:'القديم',editedAt:3000})]);
  assert.equal(merged[0].text,''); assert.equal(merged[0].deletedAt,4000);
  assert.equal(merged[1].text,'الجديد');
});
test('account changes between the API promise and its continuation cannot leak private data', async t => {
  for (const operation of ['edit','receive','search','action']) {
    const client=setup(t);
    client.conversation('bob',{id:'chat',messages:[message(1)]});
    // The API has completed its own epoch check; identity changes in the next microtask.
    client.call=()=>{
      queueMicrotask(()=>{
        client.stop(); client.userId='charlie';
        client.state.friends=[{id:'bob',conversationId:'new-chat'}];
        client.conversation('bob',{id:'new-chat',messages:[]});
      });
      return Promise.resolve({message:message(1,{text:'سر الحساب السابق',editedAt:9000}),users:[{id:'private'}]});
    };
    if(operation==='edit')await assert.rejects(client.editMessage('bob',1,'سر الحساب السابق'),{code:'STALE'});
    if(operation==='receive')await client.receive({data:JSON.stringify({type:'message',conversationId:'chat',messageSeq:1})});
    if(operation==='search')await assert.rejects(client.searchUsers('اسم'),{code:'STALE'});
    if(operation==='action')await assert.rejects(client.sendRequest('bob'),{code:'STALE'});
    assert.deepEqual(client.state.conversations.bob.messages,[],operation);
  }
});
test('refresh revalidates previously loaded pages after offline edits and deletions', async t => {
  const calls=[];
  const client=setup(t,async path=>{
    calls.push(path);
    const after=Number(new URL(path,'https://example.test').searchParams.get('after'));
    const rows=path.includes('after=')
      ? Array.from({length:Math.min(100,120-after)},(_,i)=>message(after+i+1,after+i+1===5?{text:'',deletedAt:999999}:{}))
      : Array.from({length:50},(_,i)=>message(i+71));
    return {messages:rows,hasMore:rows.at(-1).seq<120 || !path.includes('after='),nextBefore:71,readSeq:50,peerReadSeq:50};
  });
  client.conversation('bob',{id:'chat',messages:Array.from({length:120},(_,i)=>message(i+1)),hasMore:false,nextBefore:null,readSeq:100,peerReadSeq:100});
  await client.openConversation('bob',{quiet:true});
  assert.equal(calls.length,3);
  assert.match(calls[1],/after=0&limit=100/); assert.match(calls[2],/after=100&limit=100/);
  const chat=client.state.conversations.bob;
  assert.equal(chat.messages.length,120); assert.equal(chat.messages[4].text,'');
  assert.equal(chat.hasMore,false); assert.equal(chat.readSeq,100); assert.equal(chat.peerReadSeq,100);
});
test('late history and read responses cannot reopen an unfriended conversation', async t => {
  for(const operation of ['open','older','read']) {
    const response=deferred();const client=setup(t,()=>response.promise);
    client.conversation('bob',{id:'chat',messages:[message(5)],hasMore:true,nextBefore:5});
    client.selectConversation('bob');
    const task=operation==='open'?client.openConversation('bob'):operation==='older'?client.loadOlder('bob'):client.markRead('bob');
    client.update({friends:[],conversations:{}});
    response.resolve({messages:[message(1)],readSeq:5,peerReadSeq:0,nextBefore:null,hasMore:false});
    await task; assert.deepEqual(client.state.conversations,{},operation);
  }
});
test('reconnecting fills the gap when more than one page arrived while offline', async t => {
  const client=setup(t,async path=>{
    const cursor=new URL(path,'https://example.test').searchParams.get('after');
    const first=cursor===null?501:Number(cursor)+1;
    const rows=Array.from({length:Math.min(cursor===null?50:100,551-first)},(_,i)=>message(first+i));
    return {messages:rows,hasMore:rows.at(-1).seq<550 || cursor===null,nextBefore:501,readSeq:50,peerReadSeq:50};
  });
  client.conversation('bob',{id:'chat',messages:Array.from({length:50},(_,i)=>message(i+1)),hasMore:false});
  await client.openConversation('bob',{quiet:true});
  assert.deepEqual(client.state.conversations.bob.messages.map(m=>m.seq),Array.from({length:550},(_,i)=>i+1));
  assert.equal(client.state.conversations.bob.hasMore,false);
});
test('blur and send cannot duplicate the typing stop and consume the next typing event', t => {
  const client=setup(t);const frames=[];
  client.socket={readyState:1,send:data=>frames.push(JSON.parse(data)),close(){}};
  client.setTyping('bob',true);client.setTyping('bob',true);
  client.setTyping('bob',false);client.setTyping('bob',false);client.setTyping('bob',true);
  assert.deepEqual(frames.map(frame=>frame.active),[true,false,true]);
});
