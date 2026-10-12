// Packaging only: retain composition and dimensions while meeting the image budget.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
const dir='docs/bank/quality-2026-10-08';
const pack=JSON.parse(await readFile('src/data/categories/spotdiff.json','utf8'));
const reports=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir('.cache/badeeha-quality/spotdiff-precompression',{recursive:true});
for(const q of pack.qs)for(const media of q.media){
 const file=`media/spotdiff/${media.src}`,original=await readFile(file);
 if(original.length<=262144)continue;
 let output,quality;
 for(const value of [92,88,84,80,76,72,68,64]){
  const encoded=await sharp(original).webp({quality:value,effort:6}).toBuffer();
  if(encoded.length<=262144){output=encoded;quality=value;break;}
 }
 if(!output)throw Error(`Needs separate visual review before further resizing: ${file}`);
 await writeFile(path.join('.cache/badeeha-quality/spotdiff-precompression',path.basename(file)),original);
 await writeFile(file,output);
 const info={file,beforeBytes:original.length,bytes:output.length,beforeSha256:hash(original),sha256:hash(output),quality,dimensionsUnchanged:true,operation:'WebP encoding only; no scene edit'};
 const recordPath=media.provenance.record,record=JSON.parse(await readFile(recordPath,'utf8'));
 record.sha256=info.sha256;record.bytes=info.bytes;
 record.packagingReview={date:'2026-10-12',...info,phoneReview:'pending-final-encoding-review'};
 await writeFile(recordPath,JSON.stringify(record,null,2)+'\n');reports.push(info);
}
await writeFile(`${dir}/spotdiff-packaging.json`,JSON.stringify({date:'2026-10-12',records:reports},null,2)+'\n');
console.log(JSON.stringify({files:reports.length,beforeBytes:reports.reduce((n,r)=>n+r.beforeBytes,0),bytes:reports.reduce((n,r)=>n+r.bytes,0)}));
