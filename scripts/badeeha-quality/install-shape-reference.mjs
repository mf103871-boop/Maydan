import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const dir='docs/bank/quality-2026-10-08';
const original=await readFile('.cache/badeeha-quality/shape-before/astrolabe-met.jpg');
const output=await sharp(original).resize(960,720,{fit:'contain',background:'#999795'}).webp({quality:88}).toBuffer();
const file='media/tilepuzzle/quality-astrolabe-met.webp';await writeFile(file,output);
const media={src:'quality-astrolabe-met.webp',type:'image',title:'Planispheric Astrolabe, MET 63.166a–j',author:'Muhammad Zaman al-Munajjim al-Asturlabi / The Metropolitan Museum of Art',sourceUrl:'https://commons.wikimedia.org/wiki/File:Planispheric_Astrolabe_MET_DP105325.jpg',license:'CC0 1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/'};
await writeFile(`${dir}/shape-reference-sources.json`,JSON.stringify([{preparedFile:file,media,originalUrl:'https://upload.wikimedia.org/wikipedia/commons/8/84/Planispheric_Astrolabe_MET_DP105325.jpg',museumUrl:'https://www.metmuseum.org/art/collection/search/451699',verifiedAt:'2026-10-08',originalSha256:createHash('sha256').update(original).digest('hex'),sha256:createHash('sha256').update(output).digest('hex'),bytes:output.length,transform:'Resize to 960×720 with neutral side padding; complete museum object preserved.',review:'Original photo and museum attribution reviewed; real engraved rete and dial, rather than an invented ornament.'}],null,2)+'\n');
// Compression-only preparation for the detailed generated mill; retain original PNG.
const millRecordPath=`${dir}/art-records/tilepuzzle-800-903.json`;
const record=JSON.parse(await readFile(millRecordPath,'utf8'));
const source='C:/Users/user/.codex/generated_images/01a11a56-e9d4-7570-aca6-dec9cf1d8f58/exec-2e413b5b-bd1e-442e-a2c8-c88f7b51f85b.png';
const compressed=await sharp(source).resize(960,720,{fit:'cover'}).webp({quality:82}).toBuffer();
await writeFile(record.file,compressed);record.bytes=compressed.length;record.sha256=createHash('sha256').update(compressed).digest('hex');record.compressionQuality=82;await writeFile(millRecordPath,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({referenceBytes:output.length,millBytes:compressed.length}));
