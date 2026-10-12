// Bind the completed independent review to the exact generated files in use.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir='docs/bank/quality-2026-10-08';
const cards=JSON.parse(await readFile(`${dir}/review-root-images.json`,'utf8'));
let sealed=0;
for(const r of cards){
 const m=r.after.media,record=m?.provenance?.record;
 if(!record?.startsWith(`${dir}/art-records/`))continue;
 const file=`media/${r.pack}/${m.src}`,bytes=await readFile(file),data=JSON.parse(await readFile(record,'utf8'));
 const hash=createHash('sha256').update(bytes).digest('hex');
 if(data.sha256!==hash)throw Error(`Generated record hash differs: ${record}`);
 data.review={status:'phone-size-reviewed',reviewedAt:'2026-10-08',method:'Original and shipped effect at phone width, including high-tier assistance; independent editorial review.',evidence:`${dir}/independent-root-image-review.md`,qid:r.qid};
 await writeFile(record,JSON.stringify(data,null,2)+'\n');sealed++;
}
console.log(JSON.stringify({sealed}));
