// Re-run only after final visual review or an intentional image correction.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {CATS} from '../../src/data/categories/index.js';
const dir='docs/bank/quality-2026-10-08';
const records=[];
for(const pack of CATS){
 const files=[{kind:'cover',file:`public/media/badeeha-covers/${pack.id}.webp`}];
 for(const q of pack.qs){
  if(!['image','diff'].includes(q.type))continue;
  for(const m of Array.isArray(q.media)?q.media:[q.media])files.push({kind:'question',qid:q.qid,file:m.src.startsWith('media/')?m.src:`media/${pack.id}/${m.src}`});
 }
 for(const f of files){const bytes=await readFile(f.file),meta=await sharp(bytes).metadata();records.push({...f,pack:pack.id,bytes:bytes.length,width:meta.width,height:meta.height,sha256:createHash('sha256').update(bytes).digest('hex')});}
}
const report={date:'2026-10-12',purpose:'Exact final media hashes; editorial and phone reviews are recorded separately.',covers:records.filter(r=>r.kind==='cover').length,questionImages:records.filter(r=>r.kind==='question').length,records};
if(report.covers!==78||report.questionImages!==400)throw Error(JSON.stringify({covers:report.covers,questionImages:report.questionImages}));
await writeFile(`${dir}/media-manifest.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({covers:report.covers,images:report.questionImages,bytes:records.reduce((n,r)=>n+r.bytes,0)}));
