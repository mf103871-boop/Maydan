import fs from 'node:fs/promises';
import { sameText } from '../../../../src/shared/lib/arabicNormalize.js';
const base='docs/bank/quality-2026-10-08';
const sources=JSON.parse(await fs.readFile(`${base}/authoring/identity-source-map.json`,'utf8'));
const targets={200:.8,400:.6,600:.4,800:.25,1000:.15};
const placeText=[
'ما اسم البرج الظاهر في الصورة؟','ما اسم هذا البرج؟','ما اسم ناطحة السحاب الظاهرة؟','ما اسم هذه المجموعة من الأهرامات؟','ما اسم هذا المعلم الممتد فوق التلال؟','ما اسم هذا المعلم؟','ما اسم هذا التمثال؟','ما اسم المبنى الظاهر في الصورة؟',
'ما اسم هذا المدرج الأثري؟','ما اسم المدينة الأثرية التي تضم هذه الواجهة؟','ما اسم الجسر الظاهر في الصورة؟','ما اسم هذا الجسر المعلق؟','ما اسم هذا التمثال؟','ما اسم المتحف الذي يظهر فناؤه؟','ما اسم الجبل الظاهر في الصورة؟','ما اسم هذا المعبد؟',
'ما اسم هذه المدينة الأثرية؟','ما اسم الموقع الأثري الذي يضم هذا الهرم؟','ما اسم هذا المعلم الحجري؟','ما اسم هذه البوابة؟','ما اسم الكنيسة الظاهرة في الصورة؟','ما اسم هذا المعبد؟','ما اسم هذا المجمّع الإمبراطوري؟','ما اسم هذا المسجد؟',
'ما اسم هذه القلعة؟','ما اسم القصر الذي يضم هذا الفناء؟','ما اسم هذا المعبد؟','ما اسم هذه البوابة؟','ما اسم الموقع الأثري الذي يضم هذه المقابر؟','ما اسم هذا الموقع الأثري؟','ما اسم هذه التماثيل الحجرية؟','ما اسم هذه الكتلة الصخرية؟',
'ما اسم هذا المعبد المنحوت في الصخر؟','ما اسم هذا المجمّع من المعابد؟','ما اسم هذه القلعة؟','ما اسم هذا التمثال المنحوت في الجرف؟','ما اسم هذا الموقع الأثري؟','ما اسم هذا المسجد؟','ما اسم الموقع الأثري الذي يضم هذا المعبد؟','ما اسم هذه القناة الأثرية؟'
];
const roleText={
'نجوم عرب':'من الشخصية التي تكشفها الصورة؟',
'سينما عالمية':'من الشخصية التي تكشفها الصورة؟',
'رياضة عربية':'من الرياضي الذي يظهر في الصورة؟',
'رياضة عالمية':'من الرياضي الذي يظهر في الصورة؟',
'علوم وابتكار':'من العالم الذي تكشفه الصورة؟',
'قادة وشخصيات عامة':'من الشخصية التي تظهر في الصورة؟',
'موسيقى وغناء':'من الفنان الذي تكشفه الصورة؟',
'أدب وفنون':'من الشخصية التي تظهر في الصورة؟'
};
const specific={
'reveal-600-908':'من الفنان صاحب هذه الصورة الذاتية؟',
'reveal-800-903':'من الرياضية التي تظهر في الصورة؟',
'reveal-800-904':'من الرياضية التي تظهر في الصورة؟',
'reveal-800-905':'من العالمة التي تكشفها الصورة؟',
'reveal-800-907':'من المؤلف الموسيقي الذي تصوّره هذه اللوحة؟',
'reveal-1000-901':'من الشخصية التي تكشفها الصورة؟',
'reveal-1000-902':'من مخرج الرسوم المتحركة الذي يظهر في الصورة؟',
'reveal-1000-903':'من الرياضي الذي يظهر في الصورة؟',
'reveal-1000-904':'من بطل القفز بالزانة الذي يظهر في الصورة؟',
'reveal-1000-905':'من عالم الفيزياء الذي يظهر في الصورة؟',
'reveal-1000-906':'من ناشطة الحقوق المدنية التي تظهر في الصورة؟',
'reveal-1000-907':'من المؤلف الموسيقي الذي تصوّره هذه اللوحة التاريخية؟'
};
const replaced={
'reveal-1000-904':{a:'سيرغي بوبكا',alt:['Sergey Bubka','Sergei Bubka','سيرجي بوبكا'],sources:['https://worldathletics.org/athletes/-/14229786']},
'reveal-1000-905':{a:'ريتشارد فاينمان',alt:['Richard Feynman','ريتشارد فينمان'],sources:['https://www.feynmanlectures.caltech.edu/info/other.html']},
'reveal-1000-906':{a:'روزا باركس',alt:['Rosa Parks'],sources:['https://www.nps.gov/people/rosa-parks.htm']}
};
const report=[];
for(const pack of ['flags','reveal','guesscar','placefinder']){
 const before=JSON.parse(await fs.readFile(`${base}/authoring/${pack}-identity-baseline.json`,'utf8'));
 const after=structuredClone(before);
 for(let i=0;i<after.qs.length;i++){
  const old=before.qs[i],q=after.qs[i],r=sources.find(r=>r.qid===q.qid),s=r.source;
  if(pack==='flags') q.q=q.qid==='flags-600-901'?'ما الدولة الأوروبية صاحبة هذا العلم؟':'ما الدولة صاحبة هذا العلم؟';
  else if(pack==='guesscar') q.q='ما طراز السيارة الظاهرة في الصورة؟';
  else if(pack==='placefinder') q.q=placeText[i];
  else q.q=specific[q.qid]||roleText[q.topic];
  if(pack==='reveal'&&q.qid==='reveal-600-901')q.p=800;
  if(pack==='reveal'&&q.qid==='reveal-800-901')q.p=600;
  if(replaced[q.qid]){q.a=replaced[q.qid].a;q.alt=replaced[q.qid].alt;}
  q.alt=(q.alt||[]).filter((a,j,list)=>!sameText(a,q.a)&&!list.slice(0,j).some(x=>sameText(x,a)));
  q.difficultyTarget=targets[q.p];
  q.sourceUrl=`${base}/review-identity-images.json`;
  q.media={src:`${q.qid}.webp`,type:'image',title:s.title.replace(/^File:/,''),sourceUrl:s.sourceUrl,author:s.author,
   license:s.license.toLowerCase()==='public domain'?'Public Domain':s.license,
   licenseUrl:s.licenseUrl||'https://creativecommons.org/publicdomain/mark/1.0/',
   changes:'Converted to WebP and resized for the game; any crop is recorded in the editorial review.'};
  const identityChanged=!!replaced[q.qid];
  const retier=q.p!==old.p;
  const decision=identityChanged?'replace':retier?'retier':'improve';
  const reason=identityChanged
   ?`هوية ${old.a} كانت شائعة لشريحة 1000؛ استُبدلت بـ ${q.a} من صورة حقيقية مع قرينة مجال واسعة، دون اسم أو علامة جواب.`
   :retier
   ?`المقارنة داخل موضوع النجوم العرب تجعل ${q.a} أنسب لشريحة ${q.p}؛ حُذفت القرينة السابقة «${old.q}» واستُبدل الوجه المولّد بصورة موثقة.`
   :pack==='flags'
   ?`النص السابق «${old.q}» يكرر هندسة علم ${q.a}. استُبدلت النسخة المولّدة بالرسم المرجعي الصحيح وأزيل الوصف؛ ${q.a==='رومانيا'?'أبقي تقييد أوروبا لتمييزه من علم تشاد.':'تُختبر معرفة العلم نفسه.'}`
   :pack==='guesscar'
   ?`أزيل الوصف السابق «${old.q}» لأنه يلقّن خصائص ${q.a} ويعتمد لون الرسم. الصورة الآن للطراز الحقيقي ${s.title.replace(/^File:/,'')}؛ لا تُطلب سنة الإنتاج.`
   :pack==='placefinder'
   ?`أزيلت قرينة «${old.q}» التي تضيق الإجابة بالنص؛ صورة ${q.a} موثقة، ويطلب السؤال اسم المعلم أو الموقع بالمستوى المناسب للموضوع.`
   :`حُذفت أوصاف الجنسية والملابس والملامح في «${old.q}». هوية ${q.a} الآن من تصوير أو لوحة تاريخية موثقة، وتبقى الملامح المكتشفة هي الدليل.`;
  report.push({qid:old.qid,pack,decision,reason,identityChanged,oldTier:old.p,newTier:q.p,
   before:old,after:q,
   evidence:{factualCheck:'new-source-reviewed',scope:'Subject identity and image licensing reviewed from current Commons source record; no general biography audit implied.',
    sourceUrl:s.sourceUrl,author:s.author,license:q.media.license,licenseUrl:q.media.licenseUrl,sourceTitle:s.title,sourceDescription:s.description,
    record:'docs/bank/quality-2026-10-08/authoring/identity-source-map.json',existingAsset:r.legacy?.file||null,
    additionalPrimarySources:replaced[q.qid]?.sources||[],restrictions:s.restrictions||''},
   visualReview:{status:'pending-final-crop-review',baseline:`.cache/badeeha-quality/identity-before/${pack}-before-${String(Math.floor(i/8)+1).padStart(2,'0')}.jpg`,
    baselineEffect:`.cache/badeeha-quality/identity-before/${pack}-effect-${String(Math.floor(i/8)+1).padStart(2,'0')}.jpg`,
    limitations:'Contact sheet uses shipped CSS at a 390px card width. Reveal shows deterministic 6-of-12 tiles; it is not every tap state or a physical-device playtest.'}});
 }
 await fs.writeFile(`src/data/categories/${pack}.json`,JSON.stringify(after,null,2)+'\n');
}
await fs.writeFile(`${base}/review-identity-images.json`,JSON.stringify(report,null,2)+'\n');
console.log('Edited and recorded',report.length,'cards');
