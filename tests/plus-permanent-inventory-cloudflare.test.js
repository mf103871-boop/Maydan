import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { migrationSql } from '../server/local-d1.mjs';

test('D1/workerd permanent commerce: concurrent receipt ownership, JSON inventory snapshot and refund boundary',{timeout:60000},async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'maydan-permanent-commerce-'));let mf;
  try {
    const scriptPath=path.join(directory,'worker.mjs');
    await build({stdin:{resolveDir:process.cwd(),sourcefile:'commerce-fixture-entry.mjs',contents:`
      import {routePlus} from './server/plus/router.mjs';
      import {createUser,deleteUser} from './server/accounts/db.mjs';
      import {issueSession} from './server/accounts/session.mjs';
      import {createCosmeticSettlement} from './server/plus/commerce.mjs';
      const settlement=createCosmeticSettlement(async event=>({verified:true,event}));
      export default {async fetch(request,env){try{
        const url=new URL(request.url);
        // Only this in-memory test entry exposes synthetic commands. It is never
        // an application endpoint and is not part of a deployed Worker bundle.
        if(url.pathname==='/test/user'){const user=await createUser(env,{name:'fixture'});return Response.json({id:user.id,token:(await issueSession(env,user.id)).token});}
        if(url.pathname==='/test/settle')return Response.json(await settlement(env,await request.json()));
        if(url.pathname==='/test/delete'){await deleteUser(env,(await request.json()).id);return Response.json({ok:true});}
        return await routePlus(request,env,url)||new Response(null,{status:404});
      }catch(error){return Response.json({error:error.code||error.name,message:String(error.message)},{status:error.status||500});}}};`},bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:directory,name:'permanent-commerce-test',modules:true,scriptPath,compatibilityDate:'2026-09-01',d1Databases:{DB:'permanent-commerce'},bindings:{PLUS_COMMERCE_LOCAL_PREVIEW:'1'},cf:false}));
    const db=await mf.getD1Database('DB');await db.exec(migrationSql());
    const request=async(path,body,actor,method=body===undefined?'GET':'POST')=>{
      const response=await mf.dispatchFetch('https://fixture.local'+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(actor?{authorization:'Bearer '+actor.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};
    };
    const a=(await request('/test/user',{})).body,b=(await request('/test/user',{})).body;
    const now=Date.now(),event={provider:'local-test',environment:'local-preview',eventId:crypto.randomUUID(),transactionId:crypto.randomUUID(),userId:a.id,action:'paid',occurredAt:now,kind:'purchase',offerId:'sahra.bundle.permanent',paid:true,amountMinor:600,currency:'TEST'};
    const raced=await Promise.all([event,{...event,eventId:crypto.randomUUID(),userId:b.id}].map(e=>request('/test/settle',e)));
    assert.deepEqual(raced.map(r=>r.status).sort(),[200,409],JSON.stringify(raced));
    const owner=await db.prepare('SELECT user_id FROM plus_commerce_orders').first();const winner=owner.user_id===a.id?a:b,loser=owner.user_id===a.id?b:a;
    const inventory=await request('/api/me/cosmetics/inventory',undefined,winner);assert.equal(inventory.status,200,JSON.stringify(inventory));assert.equal(inventory.body.ownedItemIds.length,6);assert.equal(inventory.body.plusActive,false);
    assert.equal((await request('/api/me/cosmetics/inventory',undefined,loser)).body.grants.length,0);
    const saved=await request('/api/me/cosmetics',{selection:{frameId:'sahra.frame',entranceId:'sahra.entrance'},revision:0},winner,'PATCH');assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.effective.badge,false);
    const replay={...event,userId:winner.id,eventId:crypto.randomUUID()};assert.equal((await request('/test/settle',replay)).status,200);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM plus_inventory_grants').first()).n,6);
    const refund={provider:event.provider,environment:event.environment,eventId:crypto.randomUUID(),transactionId:event.transactionId,userId:winner.id,action:'refunded',occurredAt:Date.now()};assert.equal((await request('/test/settle',refund)).status,200);
    const after=await request('/api/me/cosmetics/inventory',undefined,winner);assert.equal(after.body.ownedItemIds.length,0);assert.equal(after.body.effective.frameId,null);assert.equal(after.body.preferred.frameId,'sahra.frame');
    assert.equal((await request('/api/me/cosmetics/checkout',{offerId:'sahra.frame.permanent'},winner)).body.error,'NOT_CONFIGURED');
    await request('/test/delete',{id:winner.id});
    for(const table of ['plus_commerce_orders','plus_commerce_events','plus_inventory_grants','plus_monthly_windows'])assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n,0);
  } finally {
    if(mf)await mf.dispose();
    assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('maydan-permanent-commerce-'));await rm(directory,{recursive:true,force:true});
  }
});
