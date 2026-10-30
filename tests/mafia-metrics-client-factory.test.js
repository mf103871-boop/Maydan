import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createMafiaClientMetrics,createMafiaMetrics,MAFIA_METRIC_PHASES} from '../src/online/mafia-metrics.mjs';

const NOW=1800000000000;
test('the lightweight client factory preserves typed observations, clock/gate/cap behavior and the full payload contract',()=>{
  for(const options of [{},{enabled:true},{enabled:'1'},{enabled:true,side:'server'},{enabled:true,side:'unknown'}]) {
    let now=NOW;const records=[[],[]],reads=[0,0];
    const factories=[createMafiaClientMetrics,createMafiaMetrics];
    const pair=factories.map((factory,index)=>factory({...options,clock:()=>{reads[index]++;return now;},sink:record=>records[index].push(record)}));
    assert.deepEqual(Object.keys(pair[0]),['connectionReady','commandSettled','flush']);assert.ok(Object.isFrozen(pair[0]));
    const secret={toString(){throw new Error('PRIVATE_SENTINEL');},valueOf(){throw new Error('PRIVATE_SENTINEL');}};
    const compare=(method,...args)=>assert.deepEqual(pair[0][method](...args),pair[1][method](...args));
    for(const value of [secret,Symbol('private'),NaN,Infinity,-1,null,undefined]) {
      compare('connectionReady','initial',value);compare('commandSettled','ok',value);
    }
    for(const label of [secret,'__proto__','night_action','PRIVATE_SENTINEL']) {
      compare('connectionReady',label,1);compare('commandSettled',label,1);
    }
    for(let n=0;n<5000;n++){compare('connectionReady','initial',51);compare('commandSettled','transport',999999);}
    compare('connectionReady','recovery',123);compare('commandSettled','ok',0);
    compare('commandSettled','rejected',100);compare('commandSettled','timeout',10000);
    now=NOW+59999;compare('flush',NOW+999999);now++;compare('flush');
    compare('commandSettled','ok',1);now=NOW-1;compare('flush');now=NOW+119999;compare('flush');now++;compare('flush');
    assert.deepEqual(records[0],records[1]);assert.equal(reads[0],reads[1]);
    for(const record of records[0]) {
      assert.deepEqual(record.queueMs,Array(9).fill(0));assert.deepEqual(record.phaseLagMs,Array(9).fill(0));
      assert.deepEqual(record.phaseCommitted,Array(MAFIA_METRIC_PHASES.length).fill(0));assert.equal(record.resultDrained,0);
      assert.ok(Buffer.byteLength(JSON.stringify(record))<=1024);assert.ok(!JSON.stringify(record).includes('PRIVATE_SENTINEL'));
    }
  }
});

test('the browser client factory tree-shakes server methods, deadline processing and phase labels',async()=>{
  const resolveDir=fileURLToPath(new URL('../',import.meta.url));
  const bundle=async name=>(await build({stdin:{contents:`import {${name}} from './src/online/mafia-metrics.mjs';globalThis.metric=${name}({enabled:true});`,resolveDir},
    bundle:true,minify:true,write:false,format:'iife',target:['es2019','safari14']})).outputFiles[0].text;
  const client=await bundle('createMafiaClientMetrics'),full=await bundle('createMafiaMetrics');
  assert.match(full,/queueWait\(/);assert.match(full,/phaseCommitted\(/);assert.match(full,/resultDrained\(/);assert.match(full,/'nomination'|"nomination"/);
  assert.doesNotMatch(client,/queueWait|phaseCommitted\(|resultDrained\(|pendingResults|'nomination'|"nomination"/);
  assert.match(client,/resultDrained:0/,'the fixed payload still includes its empty server-result dimension');
  assert.ok(Buffer.byteLength(client)<Buffer.byteLength(full));
});
