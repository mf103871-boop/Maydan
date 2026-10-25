// Portable before/after review. It never changes the shipped question bank.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {CATS} from '../../src/data/categories/index.js';
const out=path.resolve('release/badeeha-quality-preview');
await mkdir(path.join(out,'assets'),{recursive:true});
const audit=JSON.parse(await readFile('docs/bank/quality-2026-10-08/review-all.json','utf8'));
const oldFile=file=>execFileSync('git',['show',`e912acf:${file}`],{maxBuffer:16*1024*1024});
async function media(pack,q,old){
 if(!['image','diff','audio'].includes(q.type))return[];
 const list=Array.isArray(q.media)?q.media:[q.media],result=[];
 for(let i=0;i<list.length;i++){
  const m=list[i],file=m.src.startsWith('media/')?m.src:`media/${pack}/${m.src}`;
  const name=`${old?'before':'after'}-${q.qid}-${i}${path.extname(file)}`;
  await writeFile(path.join(out,'assets',name),old?oldFile(file):await readFile(file));
  result.push({src:'assets/'+name,title:m.title,author:m.author,license:m.license,licenseUrl:m.licenseUrl,sourceUrl:m.sourceUrl,changes:m.changes});
 }
 return result;
}
const covers=[];
for(const pack of CATS){
 const file=`public/media/badeeha-covers/${pack.id}.webp`;
 const before=`assets/cover-before-${pack.id}.webp`,after=`assets/cover-after-${pack.id}.webp`;
 await writeFile(path.join(out,before),oldFile(file));await copyFile(file,path.join(out,after));
 covers.push({id:pack.id,name:pack.name,before,after});
}
const rows=[];
for(const r of audit.cards){
 const minimal=q=>Object.fromEntries(['qid','p','q','a','alt','hint','hints','items','options','dir','type','effect','origin','spot','grid','target','sourceUrl','source'].filter(k=>q[k]!==undefined).map(k=>[k,q[k]]));
 rows.push({pack:r.pack,decision:r.decision,reason:r.reason,before:{...minimal(r.before),media:await media(r.pack,r.before,true)},after:{...minimal(r.after),media:await media(r.pack,r.after,false)}});
}
const template=await readFile('scripts/badeeha-quality/preview-template.html','utf8');
const data=JSON.stringify({summary:audit.summary,covers,rows}).replaceAll('<','\\u003c');
await writeFile(path.join(out,'index.html'),template.replace('/*REVIEW_DATA*/',()=>data));
console.log(JSON.stringify({preview:path.join(out,'index.html'),questions:rows.length,covers:covers.length}));
