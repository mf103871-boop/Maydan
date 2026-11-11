import test from 'node:test';
import assert from 'node:assert/strict';
import { gameEntryPath, needsGameEntry, localEntryRecovery } from '../src/platform/game-entry.mjs';
import { ENTRY_POLICY, TICKET_POLICY, GAMEPLAY_ENTRY_OFFERS } from '../src/shared/account/gameplay-policy.mjs';
import { environmentStorageKey } from '../src/shared/lib/environment.js';
import { lockedPack } from '../src/shared/account/entitlements.js';
import { build } from 'esbuild';

const account = { ready:true, signedIn:true, user:{id:'owner-a'}, premium:false, gameplayPolicy:ENTRY_POLICY };
function memory() {
  const values = new Map();
  return {getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,String(value)), removeItem:key=>values.delete(key),
    get length(){return values.size;},key:index=>[...values.keys()][index],values};
}
const grant = {version:1,owner:'owner-a',offer:'beep-local',matchId:'recovery-match-123',source:'ticket'};
const store = (memory,key,value) => memory.setItem(key,JSON.stringify(value));
const accessKey = key => environmentStorageKey('maydan:gameplay:beep:') + key;

test('all eight host cards use the exact v2 entry route, Plus and guest navigation retain their existing path',()=>{
  assert.equal(GAMEPLAY_ENTRY_OFFERS.length,8);
  for(const {game}of GAMEPLAY_ENTRY_OFFERS){assert.equal(gameEntryPath(game),'/entry/'+game);assert.equal(needsGameEntry(account,game),true);
    assert.equal(needsGameEntry({...account,premium:true},game),false);
    assert.equal(needsGameEntry({...account,signedIn:false,user:null,gameAccess:()=> 'trial'},game),false);
    assert.equal(needsGameEntry({...account,signedIn:false,user:null,gameAccess:()=> 'locked'},game),true);
    assert.equal(needsGameEntry({...account,gameplayPolicy:TICKET_POLICY},game),false);}
  for(const bad of ['__proto__','unknown','mafia/../../settings','']){assert.equal(gameEntryPath(bad),null);assert.equal(needsGameEntry(account,bad),false);}
});

test('entry recovery reads an exact same-owner unplayed pending ID without granting or writing anything',()=>{
  const backend=memory();store(backend,accessKey('pending:owner-a'),grant);
  const before=[...backend.values];
  assert.deepEqual(localEntryRecovery(account,'beep',backend),{kind:'pending',path:'/play/beep?mode=local'});
  assert.deepEqual([...backend.values],before);
  assert.equal(localEntryRecovery({...account,user:{id:'owner-b'}},'beep',backend),null);
  assert.equal(localEntryRecovery({...account,signedIn:false},'beep',backend),null);
  assert.equal(localEntryRecovery(account,'mafia',backend),null);
  store(backend,accessKey('match:'+grant.matchId),{...grant,completed:true});
  assert.equal(localEntryRecovery(account,'beep',backend),null,'a completed claim never becomes new access');
});

test('acknowledged active local board is reachable offline; historical/mismatched/completed journals are rejected',()=>{
  const backend=memory();
  store(backend,'maydan:beep:session-v1',{profileSession:{gameplayAccess:grant},state:{phase:'intro'}});
  store(backend,accessKey('match:'+grant.matchId),grant);
  assert.deepEqual(localEntryRecovery({...account,offline:true},'beep',backend),{kind:'active',path:'/play/beep?mode=local'});
  for(const record of [{...grant,completed:true},{...grant,owner:'owner-b'},{...grant,offer:'mamnoo-local'},{...grant,source:'trial'}]){
    store(backend,accessKey('match:'+grant.matchId),record);assert.equal(localEntryRecovery(account,'beep',backend),null);}
  backend.removeItem('maydan:beep:session-v1');store(backend,accessKey('match:'+grant.matchId),grant);
  assert.equal(localEntryRecovery(account,'beep',backend),null,'a grant with no current saved board is not fresh eligibility');
});

test('Badeeha v2 match admission never turns individual packs into paid locks',()=>{
  for(const id of ['general','not-a-basic-pack'])assert.equal(lockedPack(id,false,ENTRY_POLICY),false);
  assert.equal(lockedPack('not-a-basic-pack',false,TICKET_POLICY),true);
});

test('same-owner pre-policy saved board stays reachable without inventing a new grant',()=>{
  const backend=memory();store(backend,'maydan:beep:session-v1',{profileSession:{ownerUserId:'owner-a'}});
  assert.deepEqual(localEntryRecovery(account,'beep',backend),{kind:'active',path:'/play/beep?mode=local'});
  assert.equal(localEntryRecovery({...account,user:{id:'owner-b'}},'beep',backend),null);
  store(backend,'maydan:badeeha:active-game-v2',{profileSession:{gameplayAccess:{version:1,owner:'owner-a',offer:'badeeha-local',source:'free-packs'}}});
  assert.deepEqual(localEntryRecovery(account,'badeeha',backend),{kind:'active',path:'/play/badeeha?mode=local'});
});

test('capability option emits only exact capability2 and preserves authenticated request safeguards',async()=>{
  const compiled=await build({entryPoints:['src/shared/account/api.js'],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
  const {request}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
  for(const value of [2,1,'2',undefined]){
    const seen=[];
    await request('/api/rewarded/local-start',{server:'https://fixture.invalid',token:'fixture-only',method:'POST',body:{matchId:'fixture'},gameplayCapability:value,
      fetchImpl:async(url,options)=>{seen.push({url,options});return new Response('{}',{status:200});}});
    assert.equal(seen.length,1);assert.equal(seen[0].options.headers.authorization,'Bearer fixture-only');
    assert.equal(seen[0].options.headers['x-maydan-gameplay-capability'],value===2?'2':undefined);
    assert.equal(seen[0].options.credentials,'omit');assert.equal(seen[0].options.cache,'no-store');
  }
});

test('entry status is read-only and refuses mismatched game, policy or mode coverage before opening a picker',async()=>{
  const compiled=await build({entryPoints:['src/shared/account/rewarded.js'],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
  const {rewardedEntryStatus}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
  const valid={game:'badeeha',offer:'badeeha-entry-v2',policy:ENTRY_POLICY,access:'ticket',modeAccess:{local:'ticket',online:'required'}};
  const calls=[];let reply=valid;
  const account={requestAuthenticated:async(path,options)=>{calls.push({path,options});return reply;}};
  assert.deepEqual(await rewardedEntryStatus(account,'badeeha'),valid);
  assert.deepEqual(calls,[{path:'/api/rewarded/entry-status?game=badeeha',options:{gameplayCapability:2}}]);
  for(const changed of [{...valid,game:'mafia'},{...valid,offer:'badeeha-local'},{...valid,policy:TICKET_POLICY},
    {...valid,modeAccess:{local:'ticket'}},{...valid,modeAccess:{local:'ticket',online:'free'}},
    {...valid,access:'invented'}]){reply=changed;await assert.rejects(rewardedEntryStatus(account,'badeeha'),/Incompatible/);}
  assert.ok(calls.every(call=>call.path.startsWith('/api/rewarded/entry-status?')),'no attempt, reservation or start request is made');
});
