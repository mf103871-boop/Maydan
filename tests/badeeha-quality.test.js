import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CATS} from '../src/data/categories/index.js';
import {BANK_CONTENT_VERSION} from '../src/games/badeeha/logic.js';
import {readRetiredQids} from '../scripts/bank.mjs';
const dir='docs/bank/quality-2026-10-08';
const read=file=>JSON.parse(readFileSync(new URL('../'+file,import.meta.url),'utf8'));

test('quality review covers the exact live bank without resurrecting replaced questions',async()=>{
 const audit=read(`${dir}/review-all.json`),mapping=read(`${dir}/qid-mapping.json`),retired=await readRetiredQids();
 const live=new Map(CATS.flatMap(c=>c.qs.map(q=>[q.qid,q])));
 assert.equal(CATS.length,78);assert.equal(live.size,3120);assert.equal(audit.cards.length,3120);
 assert.equal(new Set(audit.cards.map(r=>r.oldQid)).size,3120);
 assert.equal(audit.summary.version,BANK_CONTENT_VERSION);
 for(const pack of CATS){assert.equal(pack.qs.length,40,pack.id);for(const p of [200,400,600,800,1000])assert.equal(pack.qs.filter(q=>q.p===p).length,8,`${pack.id}/${p}`);}
 for(const r of audit.cards){assert.ok(r.reason&&r.reason.trim().length>15,r.qid);assert.deepEqual(r.after,live.get(r.qid),r.qid);assert.ok(['keep','improve','replace','retier'].includes(r.decision),r.qid);}
 for(const [oldQid,newQid] of Object.entries(mapping)){assert.ok(retired.has(oldQid),oldQid);assert.ok(!live.has(oldQid),oldQid);assert.ok(live.has(newQid),newQid);}
 for(const qid of live.keys())assert.ok(!retired.has(qid),qid);
});

test('all final covers and active question pictures match their reviewed asset hashes',()=>{
 const manifest=read(`${dir}/media-manifest.json`),covers=read(`${dir}/cover-plan.json`).covers;
 assert.equal(manifest.covers,78);assert.equal(manifest.questionImages,400);assert.equal(covers.length,78);
 assert.equal(new Set(manifest.records.map(r=>r.file)).size,478);
 for(const r of manifest.records){const bytes=readFileSync(new URL('../'+r.file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),r.sha256,r.file);assert.ok(r.width>0&&r.height>0,r.file);}
 for(const cover of covers){assert.equal(cover.status,'generated-installed',cover.id);const record=read(cover.record);assert.equal(record.review.status,'phone-size-reviewed',cover.id);}
});
