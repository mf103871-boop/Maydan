import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startPlusPreview } from '../scripts/plus-preview.mjs';

async function freePort() {
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function fixture(t) {
  const port=await freePort();let apiPort=await freePort();while(apiPort===port)apiPort=await freePort();
  const app=await startPlusPreview({port,apiPort,build:false,watchSource:false});t.after(()=>app.close());
  const origin=`http://127.0.0.1:${port}`;
  async function call(path,body,actor,target=origin) {
    const response=await fetch(target+path,{method:body===undefined?'GET':'POST',headers:{origin,...(body===undefined?{}:{'content-type':'application/json'}),...(actor?{authorization:'Bearer '+actor.session.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  }
  const actor=(await call('/__plus_lab__/scenario',{scenario:'free'})).body;
  const quote=async()=>{const q=await call('/api/me/cosmetics/quote',{offerId:'sahra.frame.permanent'},actor);assert.equal(q.status,200);assert.equal(q.body.localOnly,true);assert.equal(q.body.pricing.currency,'TEST');return q.body;};
  const checkout=q=>call('/api/me/cosmetics/checkout',{offerId:q.offerId,quoteId:q.quoteId},actor);
  const count=async table=>(await app.backend.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
  return {app,actor,call,quote,checkout,count,apiOrigin:`http://127.0.0.1:${apiPort}`};
}

test('actual loopback checkout serializes different quotes against a fresh account inventory',{timeout:30000},async t=>{
  const h=await fixture(t),a=await h.quote(),b=await h.quote();
  const results=await Promise.all([h.checkout(a),h.checkout(b)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(await h.count('plus_commerce_orders'),1);assert.equal(await h.count('plus_inventory_grants'),1);
  const winner=results[0].status===200?a:b;const replay=await h.checkout(winner);assert.equal(replay.status,200);assert.equal(replay.body.transactionId,winner.quoteId);
  assert.equal(await h.count('plus_commerce_orders'),1);
  const direct=await h.call('/api/me/cosmetics/checkout',{offerId:a.offerId},h.actor,h.apiOrigin);assert.equal(direct.status,503);assert.equal(direct.body.error,'NOT_CONFIGURED','the Worker route has no synthetic verifier');
});

function failCommittedReads(h,enabled) {
  const db=h.app.backend.env.DB,prepare=db.prepare.bind(db),batch=db.batch.bind(db);let settlementBatches=0,throws=0;
  db.prepare=sql=>{
    const statement=prepare(sql);
    if(sql.includes('FROM plus_commerce_orders')&&sql.includes('external_id=?')) {
      const bind=statement.bind.bind(statement);
      statement.bind=(...args)=>{
        const bound=bind(...args),first=bound.first.bind(bound);
        bound.first=async()=>{const row=await first();if(row&&enabled(throws)){throws++;throw Error('fixture commit observed but canonical read failed');}return row;};
        return bound;
      };
    }
    return statement;
  };
  db.batch=async statements=>{if(statements.some(s=>s.sql.startsWith('INSERT OR IGNORE INTO plus_commerce_events')))settlementBatches++;return batch(statements);};
  return {batches:()=>settlementBatches,throws:()=>throws};
}

test('actual committed checkout with one lost readback reconciles GET-only and returns its same transaction',{timeout:30000},async t=>{
  const h=await fixture(t),q=await h.quote(),probe=failCommittedReads(h,n=>n===0);
  const first=await h.checkout(q);assert.equal(first.status,200);assert.equal(first.body.transactionId,q.quoteId);assert.equal(probe.throws(),1);
  const retry=await h.checkout(q);assert.equal(retry.status,200);assert.equal(retry.body.transactionId,q.quoteId);
  assert.equal(probe.batches(),1,'reconciliation must never call the settlement writer again');assert.equal(await h.count('plus_commerce_orders'),1);
});

test('unresolved checkout blocks other quotes and later reconciles without a second settlement batch',{timeout:30000},async t=>{
  const h=await fixture(t),a=await h.quote(),b=await h.quote();let failing=true;const probe=failCommittedReads(h,()=>failing);
  const unknown=await h.checkout(a);assert.equal(unknown.status,409);assert.equal(unknown.body.error,'CHECKOUT_PENDING');
  const blocked=await h.checkout(b);assert.equal(blocked.status,409);assert.equal(blocked.body.error,'CHECKOUT_PENDING');assert.equal(probe.batches(),1);
  failing=false;const recovered=await h.checkout(a);assert.equal(recovered.status,200);assert.equal(recovered.body.transactionId,a.quoteId);assert.equal(probe.batches(),1);assert.equal(await h.count('plus_commerce_orders'),1);
});

test('known committed checkout survives a lost final inventory response without another write',{timeout:30000},async t=>{
  const h=await fixture(t),q=await h.quote(),db=h.app.backend.env.DB,prepare=db.prepare.bind(db),batch=db.batch.bind(db);let committed=false,fail=true,batches=0;
  db.batch=async statements=>{const writes=statements.some(s=>s.sql.startsWith('INSERT OR IGNORE INTO plus_commerce_events'));if(writes)batches++;const result=await batch(statements);if(writes)committed=true;return result;};
  db.prepare=sql=>{
    const statement=prepare(sql);
    if(sql.includes('SELECT u.id AS user_id,c.selection_json')){
      const bind=statement.bind.bind(statement);statement.bind=(...args)=>{const bound=bind(...args),all=bound.all.bind(bound);bound.all=async()=>{if(committed&&fail)throw Error('fixture final inventory lost');return all();};return bound;};
    }
    return statement;
  };
  const first=await h.checkout(q);assert.equal(first.status,409);assert.equal(first.body.error,'CHECKOUT_PENDING');assert.equal(batches,1);
  fail=false;const recovered=await h.checkout(q);assert.equal(recovered.status,200);assert.equal(recovered.body.transactionId,q.quoteId);assert.equal(batches,1);assert.equal(await h.count('plus_inventory_grants'),1);
});
