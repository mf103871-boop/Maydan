import { createRequire } from 'node:module';
const require=createRequire(process.cwd()+'/package.json');
const sharp=require('sharp');
const root=process.cwd();
for(const tier of process.argv.slice(2)){
 const p=Number(tier),overlays=[];
 for(let n=901;n<=908;n++){
  const id=`blur-${p}-${n}`,sigma=p>=600?14.4:16,y=(n-901)%4*395,sheet=n<=904?'a':'b';
  for(const [w,h,x] of [[320,240,8],[491,368,348]]){
   const input=await sharp(`${root}/media/blur/${id}.webp`).resize(w,h).blur(sigma).modulate({saturation:1.3}).png().toBuffer();overlays.push({sheet,input,left:x,top:y+24});
  }
 }
 for(const sheet of ['a','b'])await sharp({create:{width:860,height:1580,channels:3,background:'#fff7e7'}}).composite(overlays.filter(x=>x.sheet===sheet).map(({sheet,...x})=>x)).png().toFile(`${root}/docs/bank/rebuild-2026-09-18/checkpoint/blur-resume/previews/blur-approx-${p}-${sheet}.png`);
}
