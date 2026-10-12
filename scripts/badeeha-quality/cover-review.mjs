import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root=process.cwd(),out='.cache/badeeha-quality/cover-review';
await mkdir(out,{recursive:true});
const {covers}=JSON.parse(await readFile('docs/bank/quality-2026-10-08/cover-plan.json','utf8'));
const css=await readFile('src/games/badeeha/styles.css','utf8');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:700,height:1500},deviceScaleFactor:1});
await page.route('https://review.local/**',async route=>{
 const file=path.resolve(root,decodeURIComponent(new URL(route.request().url()).pathname.slice(1)));
 if(!file.startsWith(root+path.sep))return route.abort();
 try{await route.fulfill({body:await readFile(file),contentType:'image/webp'});}catch{await route.fulfill({status:404,body:'missing'});}
});
const files=[];
for(let i=0;i<covers.length;i+=20){
 const cards=covers.slice(i,i+20).map(c=>`<article><header>${escape(c.name)} <small>${c.id}</small></header><div class="pair">${[`.cache/badeeha-quality/before-covers/${c.id}.webp`,c.file].map((src,n)=>`<section><small>${n?'بعد':'قبل'}</small><span class="m-category-cover" data-state="ready"><img src="https://review.local/${src}" alt="${escape(c.name)}"></span></section>`).join('')}</div></article>`).join('');
 await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}body{margin:0;background:#e9e2d8;font-family:Arial;color:#31243e}main{display:grid;grid-template-columns:repeat(2,340px);gap:10px;padding:5px}article{background:#fffaf0;padding:6px;border-radius:9px}header{font-size:15px;text-align:right;height:22px}header small{font-size:10px;color:#786a78}.pair{display:flex;gap:8px}section{width:160px}section small{font-size:10px}.m-category-cover{border:0;border-radius:7px}</style><main>${cards}</main>`);
 await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
 const file=`${out}/covers-${1+i/20}.jpg`;
 await page.screenshot({path:file,fullPage:true,type:'jpeg',quality:90});files.push(file);
}
await browser.close();
await writeFile(`${out}/index.json`,JSON.stringify(files,null,2)+'\n');
console.log(JSON.stringify(files));
