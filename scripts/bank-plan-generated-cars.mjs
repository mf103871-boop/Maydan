import fs from 'node:fs/promises';
import sharp from 'sharp';
const pack=JSON.parse(await fs.readFile('src/data/categories/guesscar.json','utf8'));
const selected={200:[1,3,13,15,22,26,35,46],400:[1,4,14,19,27,34,38,44],600:[1,7,16,20,25,27,40,42],800:[2,7,14,20,23,26,37,39],1000:[1,9,13,22,25,31,36,39]};
const jobs=[];
for(const [tier,ids] of Object.entries(selected))for(let i=0;i<ids.length;i++){
 const oldId=`guesscar-${tier}-${String(ids[i]).padStart(3,'0')}`,old=pack.qs.find(q=>q.qid===oldId);if(!old)throw Error(oldId);
 const id=`guesscar-${tier}-${901+i}`;
 const prompt=`Use case: product-mockup.\nAsset: one AI-generated car-identification illustration for an Arabic family quiz.\nSubject: ${old.media.title}\nGenerate a new high-quality realistic studio rendering of precisely this vehicle model and generation. Match its real proportions, characteristic body shape, grille, headlights, windows and wheel layout accurately; do not invent a hybrid car.\nComposition: full vehicle from front three-quarter angle (rear three-quarter angle for Tatra 87), centered, wheels and roof wholly visible, landscape 4:3. Soft ivory seamless studio floor and background, subtle contact shadow, natural materials and paint.\nDo not reproduce the described original photograph or its environment. No people, scenery, border, watermark or captions. The license plate must be blank. Omit readable model-name lettering that would reveal the answer. Brand emblems may retain their simple graphic shapes. This is a faithful visual illustration, not a document photograph.`;
 jobs.push({id,kind:'question',pack:'guesscar',p:Number(tier),a:old.a,topic:old.topic,prompt,priorQid:oldId,identityReference:old.media,question:{p:Number(tier),q:'ما طراز السيارة في الصورة؟',a:old.a,alt:old.alt||[],qid:id,type:'image',topic:old.topic,difficultyTarget:({200:.8,400:.6,600:.4,800:.25,1000:.15})[tier],verified:false,sourceUrl:old.media.sourceUrl,media:{src:id+'.webp',type:'image',title:'سيارة — تصوير توضيحي مولّد',author:'Maydan / OpenAI image generation',disclosure:'تصوير توضيحي مولّد بالذكاء الاصطناعي',provenance:{kind:'ai-generated',tool:'OpenAI image generation',createdAt:'2026-09-23',record:'docs/bank/rebuild-2026-09-18/generated-records/'+id+'.json'}}}});
}
await fs.writeFile('docs/bank/rebuild-2026-09-18/cars-generation-plan.json',JSON.stringify(jobs,null,2)+'\n');
for(const tier of Object.keys(selected)){
 const row=jobs.filter(j=>String(j.p)===tier);const parts=[];
 for(let i=0;i<row.length;i++){const j=row[i];const img=await sharp('media/guesscar/'+j.identityReference.src).resize(320,240,{fit:'contain',background:'#ffffff'}).toBuffer();parts.push({input:img,left:(i%4)*320,top:Math.floor(i/4)*270});parts.push({input:Buffer.from(`<svg width="320" height="30"><rect width="100%" height="100%" fill="white"/><text x="8" y="21" font-size="16">${j.id} / ${j.priorQid}</text></svg>`),left:(i%4)*320,top:Math.floor(i/4)*270+240});}
 await sharp({create:{width:1280,height:540,channels:3,background:'#ffffff'}}).composite(parts).png().toFile('../cars-reference-'+tier+'.png');
}
console.log(JSON.stringify(jobs.map(j=>({id:j.id,a:j.a,title:j.identityReference.title,url:j.identityReference.sourceUrl}))));
