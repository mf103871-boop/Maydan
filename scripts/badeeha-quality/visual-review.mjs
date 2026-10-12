// Diagnostic browser views use the shipped image rules. They are review aids,
// not a replacement for exercising the actual game before release.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { CATS } from '../../src/data/categories/index.js';

const [requested = 'zoom', mode = 'effect', destination = '.cache/badeeha-quality/visual-review'] = process.argv.slice(2);
const root = process.cwd();
const packs = requested === 'all' ? CATS.filter(c => c.qs.some(q => q.media && q.type !== 'audio')) : CATS.filter(c => c.id === requested);
const css = await readFile('src/games/badeeha/styles.css', 'utf8');
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 1600 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await page.route('https://review.local/**', async route => {
  const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) return route.abort();
  try { await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.webp') ? 'image/webp' : 'application/octet-stream' }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
function order(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  const random = () => { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const indices = Array.from({length:12}, (_, i) => i);
  for(let i=11;i>0;i--) { const j=Math.floor(random()*(i+1)); [indices[i],indices[j]]=[indices[j],indices[i]]; }
  if(indices.every((v,i)=>v===i)) [indices[0],indices[1]]=[indices[1],indices[0]];
  return indices;
}
function picture(pack, question, media, effect) {
  const src = `https://review.local/media/${pack}/${media.src}`;
  const treated = mode === 'effect' || mode === 'assisted';
  if(treated && effect === 'jumble') return `<div class="m-jumble">${order(question.qid).map(i=>`<i style="background-image:url('${src}');background-position:${i%4*100/3}% ${Math.floor(i/4)*50}%"></i>`).join('')}</div>`;
  // Reveal is reviewed with a deterministic half-open example plus its full
  // image; actual tile interaction is checked in the integrated game.
  const overlay = treated && effect === 'reveal' ? `<div class="m-reveal-tiles">${Array.from({length:12},(_,i)=>`<i style="opacity:${[0,3,5,6,8,11].includes(i)?0:1}"></i>`).join('')}</div>` : '';
  return `<div class="m-media-stage"><img class="m-media-img ${treated?'fx-'+effect:''}${mode==='assisted'&&question.p>=600?' is-assisted':''}" src="${src}" style="transform-origin:${escape(question.origin||'50% 50%')}">${overlay}</div>`;
}
const pages=[];
try {
 for(const pack of packs) for(let offset=0;offset<pack.qs.length;offset+=8) {
  const questions=pack.qs.slice(offset,offset+8);
  const cards=questions.map(q=>{
   const media=Array.isArray(q.media)?q.media:[q.media];
   return `<article><header><b>${escape(q.qid)}</b><span>${q.p}</span></header><p dir="rtl">${escape(q.q)}</p><div class="pictures ${media.length>1?'pair':''}">${media.filter(Boolean).map(m=>picture(pack.id,q,m,q.effect||'none')).join('')}</div><footer dir="rtl">${escape(q.a)} · ${escape(q.topic)}</footer></article>`;
  }).join('');
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}\nbody{margin:0;background:#e9e3d7;font-family:Arial}main{display:grid;grid-template-columns:repeat(2,390px);gap:10px;padding:5px}.m-root{max-width:none!important;padding:0!important}article{padding:12px;background:#fffaf0;border-radius:12px;box-sizing:border-box;width:390px;break-inside:avoid}header{display:flex;justify-content:space-between;font:13px monospace;color:#383049}p{font-size:17px;line-height:1.4;min-height:48px;margin:8px 0}footer{font-size:14px;margin-top:8px;color:#403049}.pictures{display:grid;gap:4px}.pictures.pair{grid-template-columns:1fr 1fr}.m-media-img{max-height:290px}.m-media-stage{background:#f2eadd;min-height:160px}.m-jumble{max-height:290px;height:274px;direction:rtl}.pair .m-media-stage{min-height:130px}.pair img{max-height:145px}</style><main class="m-root">${cards}</main>`);
  await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
  const filename=`${pack.id}-${mode}-${String(offset/8+1).padStart(2,'0')}.jpg`;
  const file=path.join(destination,filename);
  await page.screenshot({path:file,fullPage:true,type:'jpeg',quality:88});
  pages.push({pack:pack.id,mode,file,questions:questions.map(q=>q.qid)});
 }
} finally { await browser.close(); }
await writeFile(path.join(destination,`${requested}-${mode}-index.json`),JSON.stringify(pages,null,2)+'\n');
console.log(JSON.stringify(pages.map(p=>p.file)));
