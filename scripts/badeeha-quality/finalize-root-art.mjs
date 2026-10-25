import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const dir='docs/bank/quality-2026-10-08';
const revision=JSON.parse(await readFile(`${dir}/trumpet-revision.json`,'utf8'));
const plan=JSON.parse(await readFile(`${dir}/blur-art-plan.json`,'utf8'));
plan.jobs[0].prompt=revision.prompt;
const rejected=[
 {file:'media/blur/quality-1000-907.webp',reason:'Hammer-throw wire and grip disappear after blur, leaving insufficient evidence; replaced with water polo.'},
 {file:'media/zoom/quality-600-904.webp',reason:'Generated USB-C plug geometry was inaccurate; replaced with a licensed real photograph.'},
];
for(const r of rejected){try{const bytes=await readFile(r.file);r.sha256=createHash('sha256').update(bytes).digest('hex');await unlink(r.file);}catch(e){if(e.code!=='ENOENT')throw e;}r.status='rejected-not-shipped';}
plan.jobs[1].status='rejected-not-shipped';plan.jobs[1].reason=rejected[0].reason;delete plan.jobs[1].record;
await writeFile(`${dir}/blur-art-plan.json`,JSON.stringify(plan,null,2)+'\n');
await writeFile(`${dir}/root-art-rejections.json`,JSON.stringify(rejected,null,2)+'\n');
const zoomPlan=JSON.parse(await readFile(`${dir}/question-art-plan.json`,'utf8'));
const usb=zoomPlan.jobs.find(j=>j.id==='zoom-600-904');usb.status='rejected-not-shipped';usb.reason=rejected[1].reason;
await writeFile(`${dir}/question-art-plan.json`,JSON.stringify(zoomPlan,null,2)+'\n');
const file='media/blur/quality-tapir.webp';
const data=await sharp(await readFile(file)).webp({quality:84}).toBuffer();await writeFile(file,data);
const refs=JSON.parse(await readFile(`${dir}/blur-reference-sources.json`,'utf8'));
const tapir=refs.find(r=>r.preparedFile===file);tapir.bytes=data.length;tapir.sha256=createHash('sha256').update(data).digest('hex');
await writeFile(`${dir}/blur-reference-sources.json`,JSON.stringify(refs,null,2)+'\n');
console.log(JSON.stringify({rejected:rejected.length,tapirBytes:data.length}));
