// Packages original artwork; never derives one cosmetic type by cropping another.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const inputPath=process.argv[2]||path.join(root,'.cache/plus-art-v2-sources.json');
const masters=process.argv[3];
const inputs=JSON.parse(await readFile(inputPath,'utf8'));
const out=path.join(root,'public/assets/plus/v2');
await mkdir(out,{recursive:true});
if(masters)await mkdir(masters,{recursive:true});
const manifest={version:2,assets:{},provenance:{generator:'OpenAI image_gen',design:'Maydan original local Plus study',billing:'not configured',avatars:'static portraits; no animated-avatar claim',sourceMasters:[]}};
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
async function save(name,buffer,kind,extra={}) {
  await writeFile(path.join(out,name),buffer);
  const meta=name.endsWith('.svg')?{width:64,height:64}:await sharp(buffer).metadata();
  manifest.assets[`/assets/plus/v2/${name}`]={sha256:hash(buffer),bytes:buffer.length,width:meta.width,height:meta.height,kind,...extra};
}
const colors={sahra:['#FFD56A','#087F91','#5E3A14'],artist:['#C7A7EB','#16899A','#8E4FC0'],noir:['#D69962','#14283E','#75482C'],signature:['#FFDA75','#118A9A','#70431D']};
function smallFrame(id) {
  const [gold,fill,dark]=colors[id];
  const crown=id==='artist'?'<path d="M10 14 21 4l5 5-12 11Z" fill="#F18968" stroke="#60317D" stroke-width="1.4"/>':id==='noir'?'<path d="m32 1 7 9-7 6-7-6Z" fill="#DEA975" stroke="#644831" stroke-width="1.5"/>':id==='signature'?'<path d="M27 2h10v7c0 6-10 6-10 0Zm-4 2h4v6c-5 0-6-4-4-6Zm14 0h4c2 2 1 6-4 6ZM30 13h4v4h-4Z" fill="#FFE49B" stroke="#986A24" stroke-width="1"/>':'<path d="m32 1 3.3 6.6 7.3 1.1-5.3 5.1 1.2 7.2-6.5-3.4-6.5 3.4 1.2-7.2-5.3-5.1 7.3-1.1Z" fill="#FFDE73" stroke="#9B7022" stroke-width="1"/>';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${gold}"/><stop offset=".55" stop-color="${dark}"/><stop offset="1" stop-color="${gold}"/></linearGradient></defs><circle cx="32" cy="33" r="26" fill="none" stroke="${dark}" stroke-width="7"/><circle cx="32" cy="33" r="26" fill="none" stroke="url(#g)" stroke-width="5"/><circle cx="32" cy="33" r="24.5" fill="none" stroke="${fill}" stroke-width="1.5"/>${crown}</svg>`);
}
for(const [name,file]of Object.entries(inputs)) {
  const source=await readFile(file),meta=await sharp(source).metadata();
  const kind=name.split('-').at(-1);
  if(!['frame','avatar','cover','room','table'].includes(kind))throw Error(`Unknown artwork ${name}`);
  if(['frame','avatar','table'].includes(kind)) {
    if(!meta.hasAlpha)throw Error(`Missing transparency ${name}`);
    const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const alpha=(x,y)=>data[(y*info.width+x)*info.channels+3];
    if(alpha(0,0)>5||alpha(info.width-1,info.height-1)>5)throw Error(`Opaque outer corners ${name}`);
    if(kind==='frame'&&alpha(Math.floor(info.width/2),Math.floor(info.height/2))>5)throw Error(`Frame aperture is not transparent ${name}`);
  }
  if(masters)await copyFile(file,path.join(masters,`${name}.png`));
  manifest.provenance.sourceMasters.push({name:`${name}.png`,sha256:hash(source),width:meta.width,height:meta.height});
  const size=kind==='frame'||kind==='avatar'?[512,512]:kind==='cover'?[1200,480]:kind==='room'?[960,640]:[640,400];
  const fit=['frame','avatar','table'].includes(kind)?'contain':'cover';
  await save(`${name}.webp`,await sharp(source).resize(...size,{fit,background:'#00000000'}).webp({quality:87,alphaQuality:100,effort:6}).toBuffer(),kind);
  if(kind==='frame') {
    await save(`${name}-medium.webp`,await sharp(source).resize(192,192,{fit:'contain',background:'#00000000'}).webp({quality:89,alphaQuality:100,effort:6}).toBuffer(),kind,{lod:'medium'});
    await save(`${name}-small.svg`,smallFrame(name.split('-')[0]),kind,{lod:'small',design:'original simplified vector silhouette'});
  }
}
for(const id of ['sahra','artist','noir']) {
  const [gold,teal,dark]=colors[id],paper=id==='noir'?'#1A2B42':'#FFF6E5';
  const card=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200" viewBox="0 0 900 200"><defs><linearGradient id="p" x2="1" y2="1"><stop stop-color="${paper}"/><stop offset="1" stop-color="${id==='noir'?'#0B1727':'#EDE0CF'}"/></linearGradient><linearGradient id="r"><stop stop-color="${gold}"/><stop offset=".5" stop-color="${dark}"/><stop offset="1" stop-color="${gold}"/></linearGradient></defs><rect x="8" y="12" width="884" height="180" rx="38" fill="${dark}" opacity=".3"/><rect x="8" y="5" width="884" height="180" rx="38" fill="url(#p)" stroke="url(#r)" stroke-width="6"/><path d="M40 35h820M40 156h820" stroke="${gold}" opacity=".6" stroke-width="2"/><path d="m72 55 12 20 22 5-17 17 3 24-20-12-20 12 3-24-17-17 22-5Z" fill="${teal}" stroke="${gold}" stroke-width="3"/><path d="m830 67 12 22-12 22-12-22Z" fill="${gold}"/><path d="M180 160Q450 100 720 160" fill="none" stroke="${teal}" stroke-width="7" opacity=".1"/></svg>`);
  await save(`${id}-name-card.webp`,await sharp(card).webp({quality:91,alphaQuality:100,effort:6}).toBuffer(),'nameColor',{design:'original vector name plate, not a cover crop'});
  const marks=Array.from({length:9},(_,n)=>{const x=60+n*48,y=48+(n%3)*49,r=n%2?5:10;return `<path d="m${x} ${y-r} ${r/3} ${r*2/3} ${r*2/3} ${r/3}-${r*2/3} ${r/3}-${r/3} ${r*2/3}-${r/3}-${r*2/3}-${r*2/3}-${r/3} ${r*2/3}-${r/3}Z" fill="${n%2?teal:gold}"/>`;}).join('');
  const entry=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="240" viewBox="0 0 500 240"><defs><radialGradient id="g"><stop stop-color="${gold}" stop-opacity=".3"/><stop offset="1" stop-color="${gold}" stop-opacity="0"/></radialGradient></defs><ellipse cx="250" cy="122" rx="230" ry="110" fill="url(#g)"/><path d="M55 170Q250 220 445 170" fill="none" stroke="${gold}" stroke-width="3" opacity=".7"/>${marks}</svg>`);
  await save(`${id}-entrance.webp`,await sharp(entry).webp({quality:91,alphaQuality:100,effort:6}).toBuffer(),'entrance',{design:'original vector sparkle overlay; runtime animation is separate'});
}
await writeFile(path.join(root,'assets/plus/v2/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({assets:Object.keys(manifest.assets).length,bytes:Object.values(manifest.assets).reduce((n,a)=>n+a.bytes,0),masters:masters||'not copied'}));
