// Check prepared or extracted iPhone web resources against the final review.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {CATS} from '../../src/data/categories/index.js';
import {BANK_CONTENT_VERSION} from '../../src/games/badeeha/logic.js';
const root=path.resolve(process.argv[2]||'ios/Maydan/www');
const manifest=JSON.parse(await readFile('docs/bank/quality-2026-10-08/media-manifest.json','utf8'));
const html=await readFile(path.join(root,'index.html'),'utf8');
assert.ok(html.includes(BANK_CONTENT_VERSION),'Final content version must be embedded');
let cards=0;
for(const pack of CATS)for(const q of pack.qs){assert.ok(html.includes(q.qid),q.qid);cards++;}
for(const row of manifest.records){
 const file=row.file.replace(/^public\//,'');
 const bytes=await readFile(path.join(root,file));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,file);
 // The shipped media URL cache key must also represent these final bytes.
 const key=file.replace(/^media\//,'');
 const entry=JSON.stringify(key)+':'+JSON.stringify(row.sha256.slice(0,6));
 assert.ok(html.includes(entry),`Incorrect media cache key: ${file}`);
}
const report={version:BANK_CONTENT_VERSION,cards,images:manifest.records.length,htmlSha256:createHash('sha256').update(html).digest('hex'),result:'passed'};
await mkdir('.cache/badeeha-quality',{recursive:true});
await writeFile('.cache/badeeha-quality/resources.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
