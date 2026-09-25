// One-time integration of the individually reviewed September 2026 zoom assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir='docs/bank/rebuild-2026-09-18';
const read=async p=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const write=async(p,v)=>fs.writeFile(path.join(root,p),JSON.stringify(v,null,2)+'\n');
if ((await read('src/data/categories/zoom.json')).qs.every(q=>/-90[1-8]$/.test(q.qid))) {
  throw new Error('One-time integration already applied. Edit reviewed content and provenance directly; do not overwrite it from the authoring plan.');
}
const jobs=(await read(`${dir}/checkpoint/authoring-work/object-media-plan.json`)).filter(j=>j.pack==='zoom');
const oldRecords=(await read(`${dir}/checkpoint/asset-records.json`)).records;
const records=new Map(oldRecords.map(r=>[r.id,r]));
for(const name of await fs.readdir(path.join(root,dir,'generated-records'))) {
  if(name.endsWith('.json')) { const r=await read(`${dir}/generated-records/${name}`); records.set(r.id,r); }
}
const origins=[
 ['50% 60%','50% 45%','20% 60%','50% 45%','50% 50%','40% 50%','45% 66%','50% 50%'],
 ['65% 50%','25% 65%','50% 63%','50% 50%','32% 45%','50% 60%','66% 80%','50% 50%'],
 ['50% 50%','35% 55%','50% 50%','25% 65%','35% 70%','45% 50%','50% 60%','55% 50%'],
 ['50% 50%','50% 50%','85% 62%','50% 30%','50% 50%','50% 50%','55% 82%','50% 50%'],
 ['50% 50%','22% 68%','50% 50%','18% 55%','50% 50%','50% 50%','50% 20%','50% 50%'],
].flat();
const notes=[
 'Yellow curved banana and peel visible.', 'Two pivoted blades and red finger loops.', 'Blue bristles and white-blue handle; crop moved to bristles.', 'Physical key rows; crop keeps keys visible.', 'Black pentagons on white football.', 'Six-string acoustic guitar with sound hole; crop moved to body.', 'Two-wheel pedal bicycle; crop moved to crank and chain.', 'Yellow ray petals around brown sunflower head.',
 'Whole orange and cut citrus section.', 'Manual opener with cutting wheel; crop moved from handles to mechanism.', 'Black comb with distinct teeth.', 'Handheld remote with directional pad and colored buttons.', 'Oval racket head with string grid.', 'Snare-style drum and two sticks; accepted broad answer drum.', 'Two-wheel kick scooter; crop moved to front wheel and deck.', 'Open woody pine-cone scales.',
 'Cut pomegranate exposing red seeds.', 'Balloon whisk with wire loops.', 'Zipper slider and metal teeth on blue fabric.', 'Over-ear headphones; crop moved from empty center to ear cup.', 'Feathered badminton shuttlecock; answer clarified to name the sport.', 'Violin, bow, bridge and f-holes.', 'Motorcycle with engine, seat and two wheels.', 'Single barred bird feather; no species is claimed.',
 'Kiwi cut surface with black seeds.', 'Box grater with perforated metal face.', 'Open safety pin with coil and clasp; crop moved to clasp.', 'USB webcam with clip mount; crop moved to lens.', 'White ball with golf dimples.', 'Accordion keyboard, bellows and bass buttons.', 'Inline roller skate; crop moved to wheels.', 'Spiral marine shell with flared opening; no species is claimed.',
 'Artichoke flower bud with overlapping green bracts.', 'Garlic press with handles and perforated chamber; crop moved to chamber.', 'Metal thimble with textured dimples.', 'Integrated-circuit package with pins; crop moved from unmarked center to pins.', 'Red leather cricket ball with raised stitched seam.', 'Black clarinet with reed mouthpiece, keywork and bell.', 'Schrader-style tire valve on inner tube; broad tire-valve answers accepted.', 'Fern frond with divided leaflets; no species is claimed.',
];
const reviewRows=[];
for(let i=0;i<jobs.length;i++) {
 const job=jobs[i], r=records.get(job.id); if(!r)throw Error(`Missing provenance: ${job.id}`);
 r.review={status:'subject_reviewed',reviewedAt:'2026-09-23',method:'Full image and/or contact sheet visual inspection by Codex; crop inspected separately.',note:notes[i],browserRuntime:'not_run_missing_chromium'};
 const q=job.question; delete q.source; q.origin=origins[i]; q.verified=true;
 q.media.provenance.createdAt=r.createdAt;
 if(q.qid==='zoom-600-905'){q.a='ريشة بادمنتون';q.alt=['ريشة تنس الريشة','كرة الريشة','ريشة بدمينتون','shuttlecock'];}
 if(q.qid==='zoom-1000-907'){q.a='صمام إطار';q.alt=['صمام دراجة','بلف إطار','بلف','صمام شريدر','صمام هواء'];}
 reviewRows.push(`| ${q.qid} | ${q.a} | ${q.origin} | ${notes[i]} |`);
}
// Keep the original generation records intact; record any distribution-only optimization.
for(const r of records.values()) {
 const file=r.asset||r.file, absolute=path.join(root,file);
 let bytes=await fs.readFile(absolute), meta=await sharp(bytes).metadata();
 const w=r.kind==='cover'?640:1280,h=r.kind==='cover'?480:1280;
 if(meta.width>w||meta.height>h) {
   r.originalAsset={sha256:r.sha256,width:r.width,height:r.height,bytes:r.bytes,record:`${dir}/checkpoint/asset-records.json`};
   bytes=await sharp(bytes).resize(w,h,{fit:'inside',withoutEnlargement:true}).webp({quality:90,effort:6}).toBuffer();
   if(bytes.length>256*1024) bytes=await sharp(bytes).webp({quality:78,effort:6}).toBuffer();
   await fs.writeFile(absolute,bytes); meta=await sharp(bytes).metadata();
   r.transformation='Resized/re-encoded to distribution WebP; no semantic image edit.';
 }
 if(bytes.length>256*1024) throw Error(`Image exceeds budget: ${file}`);
 Object.assign(r,{file,asset:file,width:meta.width,height:meta.height,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 if(r.kind==='cover'&&(!r.review||r.review.status==='pending')) r.review={status:'contact_sheet_reviewed',reviewedAt:'2026-09-23',note:'Decoded and reviewed in category-cover contact sheets; no obvious clipping. Browser interaction checks remain blocked.'};
}
const pack=await read('src/data/categories/zoom.json');pack.qs=jobs.map(j=>j.question);await write('src/data/categories/zoom.json',pack);
await write(`${dir}/generated-art.json`,{version:1,status:'partial_bank_subject_reviewed_runtime_pending',updatedAt:'2026-09-23',images:[...records.values()].sort((a,b)=>a.id.localeCompare(b.id))});
await fs.writeFile(path.join(root,dir,'visual-evidence.md'),`# Generated visual review — 23 September 2026\n\n40 zoom subjects and 78 covers are present. These are AI-generated illustrations, not documentary photographs. Each active asset has its actual SHA-256, dimensions, generation prompt/date/tool and review in generated-art.json. Earlier generation records remain in checkpoint/asset-records.json. verified:true on zoom refers to the pictured subject matching the answer, not an observed difficulty success rate.\n\nThe full images were viewed. Crop positions below avoid empty backgrounds or generic handles; the final crop contact sheet must also be inspected. The renderer uses type:image/effect:zoom, which honors origin, hides the full-image viewer before reveal, and restores the image after reveal. A local browser test is prepared but cannot run without Chromium; no mobile/offline/runtime pass is claimed.\n\n| Question | Accepted subject | Origin | Observed evidence |\n| --- | --- | --- | --- |\n${reviewRows.join('\n')}\n\nDifficulty remains editorial (.80/.60/.40/.25/.15), and needs real-player calibration. The 9 other media packs are not rebuilt by this integration; old media files are retained until their replacements are ready.\n`);
const state=await read('src/data/bank-status.json');
for(const [id,entry] of Object.entries(state.categories)) {const c=await read(`src/data/categories/${id}.json`); entry.counts=Object.fromEntries(state.tiers.map(p=>[p,c.qs.filter(q=>q.p===p).length]));}
state.updatedAt='2026-09-23';await write('src/data/bank-status.json',state);
const manifest=await read(`${dir}/manifest.json`);manifest.status='in_progress';manifest.updatedAt='2026-09-23';manifest.releasable=false;await write(`${dir}/manifest.json`,manifest);
console.log(JSON.stringify({zoomQuestions:jobs.length,assets:records.size}));
