const fs=require('fs'),path=require('path');
const {createRequire}=require('module');
const repo=process.env.MAYDAN_REPO || path.resolve(__dirname, '../../../../../..');const req=createRequire(path.join(repo,'package.json'));const sharp=req('sharp');
const out=process.env.MAYDAN_UI_OUT || path.join(require('os').tmpdir(),'Maydan-ui-review'); fs.mkdirSync(out,{recursive:true});
(async()=>{const pack=JSON.parse(fs.readFileSync(path.join(repo,'src/data/categories/zoom.json')));if(pack.qs.length!==40)throw new Error('Expected new 40 cards');const evidence=[];
for(const p of [200,400,600,800,1000]){const composite=[];let i=0;
for(const q of pack.qs.filter(q=>q.p===p)){
 const file=path.join(repo,'media/zoom',q.media.src),m=await sharp(file).metadata(),scale=p<600?3.4:3.16,[ox,oy]=q.origin.split(' ').map(x=>parseFloat(x)/100);
 const exact={left:ox*m.width*(1-1/scale),top:oy*m.height*(1-1/scale),width:m.width/scale,height:m.height/scale};
 const box={left:Math.round(exact.left),top:Math.round(exact.top),width:Math.round(exact.width),height:Math.round(exact.height)};
 if(box.left<0||box.top<0||box.left+box.width>m.width||box.top+box.height>m.height)throw new Error('out of range '+q.qid);
 const crop=await sharp(file).extract(box).resize(256,192).png().toBuffer(); await fs.promises.writeFile(path.join(out,q.qid+'-static-crop.png'),crop);
 const rect=Buffer.from(`<svg width="${m.width}" height="${m.height}"><rect x="${exact.left}" y="${exact.top}" width="${exact.width}" height="${exact.height}" fill="none" stroke="#f00070" stroke-width="9"/></svg>`);
 const full=await sharp(file).composite([{input:rect}]).png().toBuffer();const small=await sharp(full).resize(256,192).toBuffer();
 const x=(i%2)*512,y=Math.floor(i/2)*222;
 composite.push({input:small,left:x,top:y},{input:crop,left:x+256,top:y});
 const caption=Buffer.from(`<svg width="512" height="30"><rect width="512" height="30" fill="white"/><text x="8" y="20" font-family="sans-serif" font-size="14" fill="black">${q.qid} | ${q.origin} | ${scale}x | FULL + CSS CROP</text></svg>`); composite.push({input:caption,left:x,top:y+192});
 const stats=await sharp(crop).stats();evidence.push({qid:q.qid,answer:q.a,origin:q.origin,scale,source:{width:m.width,height:m.height,bytes:fs.statSync(file).size},exact,rounded:box,entropy:stats.entropy,sharpness:stats.sharpness}); i++;
}
await sharp({create:{width:1024,height:888,channels:3,background:'#ddd'}}).composite(composite).png().toFile(path.join(out,`zoom-static-${p}.png`));
}
fs.writeFileSync(path.join(out,'zoom-static-bounds.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({questions:evidence.length,bytes:evidence.reduce((s,x)=>s+x.source.bytes,0),bounds:'all inside image',sources:[...new Set(evidence.map(x=>`${x.source.width}x${x.source.height}`))]},null,2));})();
