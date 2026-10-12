// One-time integration after every editor has handed off. Dry-run by default.
import { readFile,writeFile,mkdir,unlink } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readRetiredQids } from '../bank.mjs';
import { arabicNormalizeLoose } from '../../src/shared/lib/arabicNormalize.js';
const apply=process.argv.includes('--apply');
const dir='docs/bank/quality-2026-10-08';
const version='badeeha-quality-2026-10-08';
const status=JSON.parse(await readFile('src/data/bank-status.json','utf8'));
if(status.contentVersion===version)throw new Error('Already integrated; inspect the saved mapping instead of replaying authoring.');
const files=['review-knowledge','review-stories','review-mechanics','review-root-images','review-identity-images','review-shape-images','review-spotdiff'];
const ledger=new Map();
for(const name of files){
 const data=JSON.parse(await readFile(`${dir}/${name}.json`,'utf8'));
 for(const r of Array.isArray(data)?data:data.cards){
  const qid=r.oldQid||r.qid;
  if(ledger.has(qid))throw new Error(`Duplicate review ${qid}`);
  if(!r.reason||!(r.action||r.decision))throw new Error(`Incomplete review ${qid}`);
  ledger.set(qid,r);
 }
}
if(ledger.size!==3120)throw new Error(`Expected 3120 individual reviews, found ${ledger.size}`);
const retired=await readRetiredQids();
const used=new Set(retired),packs=[],beforeSnapshot={categories:{}},baselineCards=new Map();
for(const id of Object.keys(status.categories)){
 const before=JSON.parse(execFileSync('git',['show',`e912acf:src/data/categories/${id}.json`],{encoding:'utf8'}));
 const pack=JSON.parse(await readFile(`src/data/categories/${id}.json`,'utf8'));
 if(before.qs.length!==40||pack.qs.length!==40)throw new Error(`Count ${id}`);
 beforeSnapshot.categories[id]={qids:before.qs.map(q=>q.qid)};
 for(const q of before.qs){baselineCards.set(q.qid,q);used.add(q.qid);}
 for(const q of pack.qs)used.add(q.qid);
 packs.push(pack);
}
const mapping={},audit=[],counters=new Map();
for(const pack of packs){
 for(const q of pack.qs){
  const oldQid=q.qid,review=ledger.get(oldQid),before=baselineCards.get(oldQid);
  if(!review||!before)throw new Error(`Missing original/review ${oldQid}`);
  const decision=review.action||review.decision;
  const mediaNames=x=>JSON.stringify((Array.isArray(x.media)?x.media:x.media?[x.media]:[]).map(m=>m.src));
  const changed=review.identityChanged||decision==='replace'||before.p!==q.p||before.type!==q.type||before.effect!==q.effect||mediaNames(before)!==mediaNames(q);
  if(changed){
   const key=`${pack.id}-${q.p}`;let n=counters.get(key)||921;let next;
   do{next=`${key}-${n++}`;}while(used.has(next));
   counters.set(key,n);used.add(next);mapping[oldQid]=next;q.qid=next;
  }
  const seen=new Set([arabicNormalizeLoose(q.a)]);
  q.alt=(q.alt||[]).filter(a=>{const key=arabicNormalizeLoose(a);if(!key||seen.has(key))return false;seen.add(key);return true;});
  audit.push({...review,oldQid,qid:q.qid,pack:pack.id,decision,identityChanged:!!changed,oldTier:before.p,newTier:q.p,before,after:structuredClone(q)});
 }
 pack.qs.sort((a,b)=>a.p-b.p||a.qid.localeCompare(b.qid));
 const counts=Object.fromEntries(status.tiers.map(p=>[p,pack.qs.filter(q=>q.p===p).length]));
 if(Object.values(counts).some(n=>n!==8))throw new Error(`Tier count ${pack.id}`);
 const suffixes=pack.qs.map(q=>Number(q.qid.split('-').at(-1)));
 Object.assign(status.categories[pack.id],{counts,doneAt:'2026-10-12',qidRange:{start:Math.min(...suffixes),end:Math.max(...suffixes)}});
}
Object.assign(status,{updatedAt:'2026-10-12',contentVersion:version,editorialReview:`${dir}/review-all.json`,difficultyCalibration:'editorial-not-measured'});
if(audit.length!==3120)throw new Error('Audit coverage failed');
const summary={version,baselineCommit:'e912acf',reviewed:audit.length,packs:packs.length,retired:Object.keys(mapping).length,decisions:audit.reduce((a,r)=>(a[r.decision]=(a[r.decision]||0)+1,a),{}),factualChecks:audit.reduce((a,r)=>(a[r.factualCheck||'not-recorded']=(a[r.factualCheck||'not-recorded']||0)+1,a),{})};
console.log(JSON.stringify({...summary,apply}));
const logic=await readFile('src/games/badeeha/logic.js','utf8');
const marker=/export const BANK_CONTENT_VERSION = '[^']+';/g;
if([...logic.matchAll(marker)].length!==1)throw Error('Missing or ambiguous content-version marker');
// Proofs address the active questions; archival editorial ledgers keep old IDs.
const migrate=node=>{if(Array.isArray(node))return node.map(migrate);if(node&&typeof node==='object')return Object.fromEntries(Object.entries(node).map(([k,v])=>[k,k==='qid'&&mapping[v]?mapping[v]:migrate(v)]));return node;};
const json=value=>JSON.stringify(value,null,2)+'\n';
const writes=new Map(packs.map(pack=>[`src/data/categories/${pack.id}.json`,json(pack)]));
writes.set(`${dir}/before-snapshot.json`,json(beforeSnapshot));
writes.set(`${dir}/qid-mapping.json`,json(mapping));
writes.set(`${dir}/review-all.json`,json({date:'2026-10-12',summary,cards:audit}));
writes.set('src/games/badeeha/logic.js',logic.replace(marker,`export const BANK_CONTENT_VERSION = '${version}';`));
for(const name of ['mechanics-proofs','emoji-proofs','hidden-boards-proof','sound-file-review']){
 const proofsPath=`${dir}/${name}.json`;
 const proofs=JSON.parse(await readFile(proofsPath,'utf8'));
 writes.set(proofsPath,json(migrate(proofs)));
}
const retirementPath='docs/bank/retired-qids.json';
const registry=JSON.parse(await readFile(retirementPath,'utf8'));
if(!Array.isArray(registry.qids||[])||!Array.isArray(registry.ids||[])||!Array.isArray(registry.ranges||[]))throw Error('Invalid retirement registry');
for(const entry of registry.ids||[])if(typeof(entry?.qid||entry)!=='string')throw Error('Invalid legacy retirement entry');
if(!apply)process.exit(0);
// Preflight every input before writes and retain recoverable originals. Commit
// bank-status last so the replay guard is not set during a partial application.
const originals=new Map(),root=process.cwd();
for(const file of [...writes.keys(),retirementPath,'src/data/bank-status.json']){
 if(!path.resolve(file).startsWith(root+path.sep))throw Error('Output outside repository');
 let bytes;try{bytes=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;bytes=null;}
 originals.set(file,bytes);
 if(bytes){const backup=path.join('.cache/badeeha-quality/integration-backup',file);await mkdir(path.dirname(backup),{recursive:true});await writeFile(backup,bytes);}
}
try{
 for(const [file,content] of writes)await writeFile(file,content);
 console.log(execFileSync(process.execPath,['scripts/bank-retire.mjs',`${dir}/before-snapshot.json`,'--apply'],{encoding:'utf8'}));
 await writeFile('src/data/bank-status.json',json(status));
}catch(error){
 for(const [file,bytes] of originals){if(bytes)await writeFile(file,bytes);else await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 throw error;
}
