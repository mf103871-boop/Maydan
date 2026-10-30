import test from 'node:test';
import assert from 'node:assert/strict';
import {createMafiaMetrics,MAFIA_METRIC_BUCKETS,MAFIA_METRIC_PHASES,MAFIA_METRIC_LIMITS} from '../src/online/mafia-metrics.mjs';

const NOW=1800000000000;
const sum=values=>values.reduce((total,value)=>total+value,0);
function fixture(options={}) {
  let now=NOW;const records=[];
  const metrics=createMafiaMetrics({enabled:true,side:'server',clock:()=>now,sink:record=>records.push(record),...options});
  return {metrics,records,at:value=>{now=value;},next:()=>{now+=60000;return metrics.flush();}};
}

test('the allowlist accepts only finite scalar observations and emits no sample identifiers, timestamps or payloads',()=>{
  const f=fixture(),secret='ROOM_USER_SESSION_ROLE_TARGET_CHAT_IP_TOKEN_SENTINEL';
  const hostile={roomCode:secret,toString(){throw new Error(secret);},valueOf(){throw new Error(secret);}};
  for(const value of [hostile,secret,NaN,Infinity,-1,null,undefined,Symbol(secret)]) {
    assert.equal(f.metrics.connectionReady('initial',value),false);
    assert.equal(f.metrics.commandSettled('ok',value),false);
    assert.equal(f.metrics.queueWait(value),false);
    assert.equal(f.metrics.resultDrained(value),false);
  }
  for(const dimension of [hostile,secret,'__proto__','over','closed']) {
    assert.equal(f.metrics.connectionReady(dimension,1),false);
    assert.equal(f.metrics.commandSettled(dimension,1),false);
    assert.equal(f.metrics.phaseCommitted(dimension,1),false);
  }
  assert.equal(f.next(),null);
  f.metrics.connectionReady('initial',50);f.metrics.connectionReady('recovery',51);
  f.metrics.commandSettled('ok',250);f.metrics.commandSettled('rejected',500);
  f.metrics.commandSettled('timeout',10000);f.metrics.commandSettled('transport',99999999);
  f.metrics.queueWait(0);f.metrics.phaseCommitted('night',11);
  const record=f.next(),serialized=JSON.stringify(record);
  assert.deepEqual(Object.keys(record),['schemaVersion','type','side','connectionReady','commands','commandMs','queueMs','phaseCommitted','phaseLagMs','resultDrained','capped']);
  assert.equal(record.connectionReady.initial[0],1);assert.equal(record.connectionReady.recovery[1],1);
  assert.deepEqual(record.commands,{ok:1,rejected:1,timeout:1,transport:1});
  assert.equal(record.commandMs.at(-1),1);assert.equal(record.phaseCommitted[MAFIA_METRIC_PHASES.indexOf('night')],1);
  assert.equal(sum(record.phaseLagMs),1);assert.equal(record.resultDrained,0);
  assert.doesNotMatch(serialized,/SENTINEL|1800000|roomCode|userId|session|target|chat|token|error|requestId|matchKey|notBefore|finishedAt/);
  assert.ok(Buffer.byteLength(serialized)<=MAFIA_METRIC_LIMITS.maxBytes);
});

test('fixed histogram cells and counters saturate, payload stays bounded and flush never adds timers or retries',()=>{
  const f=fixture();
  for(let n=0;n<5000;n++) {
    for(const duration of MAFIA_METRIC_BUCKETS) {
      f.metrics.connectionReady('initial',duration);f.metrics.connectionReady('recovery',duration);
      f.metrics.queueWait(duration);f.metrics.commandSettled('ok',duration);f.metrics.phaseCommitted('night',duration);
    }
    for(const phase of MAFIA_METRIC_PHASES)f.metrics.phaseCommitted(phase);
    for(const outcome of ['rejected','timeout','transport'])f.metrics.commandSettled(outcome,0);
  }
  const record=f.next();
  assert.ok(record.capped);assert.ok(Buffer.byteLength(JSON.stringify(record))<=1024);
  assert.deepEqual(record.connectionReady.initial,MAFIA_METRIC_BUCKETS.map(()=>4095));
  assert.deepEqual(record.commands,{ok:4095,rejected:4095,timeout:4095,transport:4095});
  assert.ok(record.phaseCommitted.every(value=>value===4095));
  assert.equal(f.metrics.flush(),null);assert.equal(f.records.length,1);
  f.metrics.commandSettled('ok',0);f.at(NOW+119999);assert.equal(f.metrics.flush(),null);
  f.at(NOW+120000);assert.equal(f.metrics.flush().commands.ok,1);assert.equal(f.next(),null);
});

test('results wait until both END+30s and notBefore, including legacy events, and delayed queues have a hard cap',()=>{
  const f=fixture();f.at(NOW+60000);
  assert.equal(f.metrics.resultDrained(NOW+60000),true);
  assert.equal(f.metrics.resultDrained(NOW+60000,NOW+100000),true);
  f.at(NOW+89999);assert.equal(f.metrics.flush(),null,'no empty early terminal record');
  f.at(NOW+90000);assert.equal(f.metrics.flush().resultDrained,1);
  f.at(NOW+149999);assert.equal(f.metrics.flush(),null,'interval still enforced for the second result');
  f.at(NOW+150000);assert.equal(f.metrics.flush().resultDrained,1);
  for(let n=0;n<16;n++)assert.equal(f.metrics.resultDrained(NOW+200000+n),true);
  for(let n=0;n<1000;n++)assert.equal(f.metrics.resultDrained(NOW+200000),false);
  f.at(NOW+229999);assert.equal(f.metrics.flush(),null);
  f.at(NOW+230015);assert.equal(f.metrics.flush().resultDrained,16);
  const client=fixture({side:'client'});assert.equal(client.metrics.resultDrained(NOW),false);assert.equal(client.metrics.phaseCommitted('night'),false);assert.equal(client.metrics.queueWait(1),false);
});

test('feature-off, broken clocks, throwing/rejecting sinks and re-entry never throw or replay a batch',async()=>{
  let calls=0;const off=createMafiaMetrics({enabled:false,clock:()=>{throw new Error('must not read');},sink:()=>{calls++;}});
  assert.equal(off.commandSettled('ok',1),false);assert.equal(off.resultDrained(NOW),false);assert.equal(off.flush(),null);assert.equal(calls,0);
  for(const enabled of [undefined,1,'1','true'])assert.equal(createMafiaMetrics({enabled}).commandSettled('ok',1),false);
  for(const sink of [()=>{throw new Error('RAW_SECRET');},async()=>{throw new Error('RAW_SECRET');},()=>new Promise(()=>{})]) {
    const f=fixture({sink});f.metrics.commandSettled('ok',1);assert.equal(f.next().commands.ok,1);assert.equal(f.next(),null);
  }
  const f=fixture({clock:()=>{throw new Error('clock');}});f.metrics.commandSettled('ok',1);assert.equal(f.metrics.flush(),null);
  let metrics,now=NOW;metrics=createMafiaMetrics({enabled:true,clock:()=>now,sink:()=>{assert.equal(metrics.flush(),null);metrics.commandSettled('ok',0);}});
  metrics.commandSettled('ok',0);now+=60000;assert.equal(metrics.flush().commands.ok,1);assert.equal(metrics.flush(),null);
  await new Promise(resolve=>setImmediate(resolve));
});

test('a clock rollback cannot release a result early, bypass the rate cap or replay an emitted sample',()=>{
  const f=fixture();f.metrics.resultDrained(NOW);f.at(NOW-1000);assert.equal(f.metrics.flush(),null);
  f.at(NOW+29999);assert.equal(f.metrics.flush(),null);
  f.at(NOW+30000);assert.equal(f.metrics.flush(),null,'the end is due but the observation interval has not elapsed');
  f.at(NOW+60000);assert.equal(f.metrics.flush().resultDrained,1);f.metrics.commandSettled('ok',1);
  f.at(NOW+1000);assert.equal(f.metrics.flush(),null);f.at(NOW+119999);assert.equal(f.metrics.flush(),null);
  f.at(NOW+120000);const second=f.metrics.flush();assert.equal(second.resultDrained,0);assert.equal(second.commands.ok,1);
  assert.equal(f.records.length,2);
});
