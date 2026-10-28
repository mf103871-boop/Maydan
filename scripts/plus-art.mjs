// Generated artwork is only resized/re-encoded; the original images are preserved.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PLUS_COLLECTIONS, PLUS_ITEMS } from '../src/plus/catalog.js';
const output = new URL('../public/assets/plus/v1/', import.meta.url);
const source = new URL('../assets/plus/v1/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
// Hand-drawn scalable emblems in the existing code-native brand language.
const emblems = [
  '<path d="m128 34 16 31 35 5-25 24 6 35-32-16-31 16 6-35-26-24 35-5Z"/>',
  '<path d="M114 119 93 88l12-12 14 13 3-43q2-13 13-9l7 50 15-21q10-10 18 0l-14 45q-14 25-47 8Z"/><path d="m84 47 12 11m-23 8 16 4m73-38-3 16" fill="none"/>',
  '<path d="M104 39h48v30q0 25-24 29-24-4-24-29Z"/><path d="M103 48H87v17q0 18 22 19m44-36h16v17q0 18-22 19m-19 14v19m-17 0h34" fill="none"/>',
  '<path d="M73 74q23-32 45 0-23 31-45 0Zm65 0q23-32 45 0-23 31-45 0Z"/><circle cx="102" cy="74" r="9" fill="#fff9ed"/><circle cx="156" cy="74" r="9" fill="#fff9ed"/>',
  '<rect x="89" y="66" width="78" height="57" rx="9"/><path d="M85 54h86v20H85Zm43 0v68m0-70q-39-9-24-24 17-14 24 24 9-39 26-24 15 16-26 24" fill="none"/>',
  '<path d="m128 34 9 31 32 10-32 11-9 31-10-31-31-11 31-10Z"/><path d="m178 36 3 11 12 4-12 4-3 12-4-12-11-4 11-4Zm-100 72 2 8 9 3-9 3-2 8-3-8-8-3 8-3Z"/>',
];
await mkdir(output,{recursive:true});
const manifest={schema:1,generator:'built-in image_gen',prompts:'docs/plus/ART-PROMPTS.json',generatedDate:'2026-10-28',artwork:{},stickers:{}};
for(const collection of PLUS_COLLECTIONS){
  const original=await readFile(new URL(`${collection.id}.png`,source));
  const encoded=await sharp(original).resize({width:1024,withoutEnlargement:true}).webp({quality:84,effort:6}).toBuffer();
  await writeFile(new URL(`${collection.id}.webp`,output),encoded);
  manifest.artwork[collection.id]={sourceSHA256:hash(original),sha256:hash(encoded),bytes:encoded.length};
}
for(const item of PLUS_ITEMS.filter(item=>item.kind==='sticker')){
  const number=Number(item.id.split('.').at(-1));
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="220" viewBox="0 0 256 220"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${item.accent}"/><stop offset="1" stop-color="${item.color}"/></linearGradient><filter id="s" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="2" flood-color="#241b30" flood-opacity=".22"/></filter></defs><g filter="url(#s)"><path d="M38 20q90-22 180 0l12 128q4 34-31 36l-52 1-31 21-8-22H49q-25 0-25-26Z" fill="${item.color}" stroke="#fff5df" stroke-width="8"/><path d="M43 28q82-20 168 0" fill="none" stroke="${item.accent}" stroke-width="4"/><g fill="url(#g)" stroke="${item.accent}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${emblems[number-1]}</g><path d="M47 140h163" stroke="${item.accent}" opacity=".35"/><text x="128" y="171" text-anchor="middle" direction="rtl" font-family="Tahoma,Arial,sans-serif" font-weight="bold" font-size="${item.label.length>12?20:25}" fill="#fff9ed">${escape(item.label)}</text></g></svg>`;
  const filename=`${item.collectionId}-sticker-${number}.svg`;
  await writeFile(new URL(filename,output),svg);
  manifest.stickers[item.id]={sha256:hash(svg),bytes:Buffer.byteLength(svg),originalVector:true};
}
await writeFile(new URL('manifest.json',source),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({artwork:manifest.artwork,stickers:Object.keys(manifest.stickers).length}));
