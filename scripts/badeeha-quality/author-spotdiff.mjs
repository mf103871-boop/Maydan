// One-time editorial handoff. Never replay after the central qid migration.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
const dir='docs/bank/quality-2026-10-08';
const status=JSON.parse(await fs.readFile('src/data/bank-status.json','utf8'));
if(status.contentVersion==='badeeha-quality-2026-10-08')throw new Error('Already integrated: do not replay authoring');
const pack=JSON.parse(execFileSync('git',['show','e912acf:src/data/categories/spotdiff.json'],{encoding:'utf8'}));
const edits={
 '600-901':{a:'ارتفع مستوى الماء في الكأس',alt:['مستوى الماء','كمية الماء زادت'],spot:{x:18,y:52,r:10},reason:'استبدال لون المقبض بمقارنة مستوى سائل شفاف مع بقاء الكأس نفسه؛ فرق صغير واضح في الخط الأفقي.'},
 '600-903':{a:'تغيّر اتجاه فوهة إبريق الري',alt:['ميل فوهة إبريق الري','زاوية فوهة الإبريق'],spot:{x:81,y:54,r:10},reason:'استبدال لون الحافة بمقارنة زاوية فوهة صغيرة وسط مشهد محدود؛ يلزم تدقيق الحدود.'},
 '600-904':{a:'أصبحت نافذة القطار دائرية',alt:['شكل نافذة القطار','نافذة مستطيلة ونافذة دائرية'],spot:{x:80,y:41,r:9},reason:'استبدال تبديل اللون بتغيّر هندسي داخل جسم القطار مع ثبات حجمه وعجلاته.'},
 '600-906':{a:'انتقل غطاء العدسة إلى الجهة الأخرى',alt:['تبدل موضع غطاء المنظار','العدسة المغطاة تبدلت'],spot:{x:70,y:59,r:25},reason:'مقارنة علاقة الغطاء بالعدستين؛ يبقى الغطاء واحدًا فلا يكفي عدّ العناصر.'},
 '600-908':{a:'اختفت فتحة مقبض الفرشاة',alt:['فتحة تعليق الفرشاة','مقبض الفرشاة بلا ثقب'],spot:{x:87,y:35,r:6},reason:'استبدال لون الشعيرات بتفصيل بنيوي صغير مرئي في طرف المقبض.'},
 '800-901':{q:'ما التفصيل المختلف بين صورتي مائدة الإفطار؟',a:'تقدّمت علبة المربى البرتقالية عن العلبتين',alt:['موضع علبة المربى','تغير ترتيب علب المربى','العلبة الوسطى تقدمت'],spot:{x:54,y:21,r:13},reason:'استبدال تبديل لون حافة الفنجان بمقارنة موضع نسبي في مشهد غني؛ رُفض عكس الشوكة الكبير في المراجعة اللاحقة.'},
 '800-902':{q:'ما الذي اختلف بين صورتي مكتب التصميم؟',a:'تغيّر اتجاه المجسّم المثلث الأزرق',alt:['اتجاه القطعة المثلثة','دوران المثلث الأزرق'],spot:{x:62,y:33,r:9},reason:'فحص اتجاه شكل هندسي بين عدة مجسمات وقرائن مع ثبات اللون والعدد.'},
 '800-903':{q:'ما التفصيل غير المتطابق بين صورتي ركن الزراعة؟',a:'نقص حجر من الصحن',alt:['الحجارة خمس وأربع','عدد الحصى في الصحن','اختفت حصاة'],spot:{x:51,y:55,r:10},reason:'مقارنة عدد الحصى المتشابهة داخل صحن صغير وسط مشهد نباتي متعدد التفاصيل.'},
 '800-904':{q:'ما الاختلاف بين صورتي ورشة الألعاب؟',a:'تغيّر شكل الشراع من مثلث إلى شبه منحرف',alt:['شكل شراع القارب','قمة الشراع أصبحت مسطحة'],spot:{x:65,y:54,r:12},reason:'مقارنة حدود الشراع داخل ورشة مزدحمة دون تبديل لونه أو تحريك القارب.'},
 '800-905':{q:'ما التفصيل المختلف بين صورتي غرفة الموسيقى؟',a:'ارتفع ثقل الميترونوم على القضيب',alt:['موضع ثقل المسرع','تحرك وزن بندول الميترونوم لأعلى'],spot:{x:91,y:18,r:6},reason:'مقارنة موضع قطعة في أعلى المشهد؛ رُفض حذف لوح خشبي كبير لأنه مباشر جدًا لهذه الشريحة.'},
 '800-906':{q:'ما التفصيل المتبدّل بين صورتي المخيم؟',a:'تغيّر اتجاه إبرة البوصلة',alt:['إبرة البوصلة انعكست','اتجاه مؤشر البوصلة'],spot:{x:14,y:47,r:6},reason:'تمييز اتجاه مؤشر صغير بين أدوات تخييم كثيرة مع بقاء القرص ثابتًا.'},
 '800-907':{q:'ما التفصيل المختلف بين صورتي تجهيز الملابس؟',a:'أصبح الزر الأوسط مربعًا',alt:['شكل زر السترة الأوسط','زر دائري وآخر مربع'],spot:{x:54.3,y:46.5,r:4},reason:'مقارنة شكل زر واحد ضمن سلسلة أزرار متشابهة؛ اللون والعدد ثابتان.'},
 '800-908':{q:'ما التفصيل غير المتطابق بين صورتي أدوات الورشة؟',a:'تحرّك الثقب الأوسط فأصبحت المسافات غير متساوية',alt:['موضع الثقب الأوسط','تباعد ثقوب الخشب','الثقب الأوسط انتقل يمينًا'],spot:{x:51.5,y:79.4,r:5.5},reason:'استبدال عكس مفتاح كبير بمقارنة انتظام المسافات بين ثقوب متشابهة مع ثبات العدد.'},
 '1000-901':{q:'ما الاختلاف الدقيق بين صورتي تحضير البسكويت؟',a:'أصبحت نجمة البسكويت الوسطى في الصف السفلي سداسية',alt:['عدد رؤوس نجمة البسكويت','نجمة لها ستة رؤوس بدل خمسة'],spot:{x:28.3,y:38,r:8},reason:'عدّ رؤوس شكل واحد ومقارنته بخمس قطع متشابهة؛ المشهد متعدد مجموعات العد ولا يحدد النص العنصر.'},
 '1000-902':{q:'ما التفصيل غير المتطابق بين صورتي القرطاسية؟',a:'انقطع الخط الأوسط على الدفتر الأزرق',alt:['جزء مفقود من خط الدفتر','انقطاع الشريط الأوسط'],spot:{x:30.5,y:49,r:6},reason:'مقارنة استمرارية نمط بين ستة أغلفة مختلفة مع الحفاظ على عدد الخطوط ومواقعها.'},
 '1000-903':{q:'ما الاختلاف الدقيق بين صورتي البيت الزجاجي؟',a:'نقصت بقعة سوداء من الدعسوقة الكبيرة',alt:['بقع الدعسوقة الكبيرة ثلاث وأربع','عدد بقع الدعسوقة','اختفت بقعة على الدعسوقة'],spot:{x:89.5,y:82.5,r:4.5},reason:'عدّ بقع حشرة واحدة بين ثلاث داخل مشهد غني بالنقاط والأوراق؛ رُفض نقل بقعة مسافة ضئيلة لصعوبة رؤيته على الهاتف.'},
 '1000-904':{q:'ما التفصيل المختلف بين صورتي لعبة الطاولة؟',a:'زادت نقطة في النصف الأيسر من قطعة الدومينو الوسطى السفلية',alt:['أصبحت نقاط الدومينو خمسًا بدل أربع','عدد نقاط قطعة الدومينو','نقطة إضافية في الدومينو'],spot:{x:45.5,y:55,r:7},reason:'عدّ نقاط نصف قطعة وسط اثني عشر نصفًا وثلاثة نرود؛ يلزم مقارنة منظمة مع جواب محدد.'},
 '1000-905':{q:'ما الاختلاف الدقيق بين صورتي ورشة الموسيقى؟',a:'أصبحت فتحات الآلة الخشبية الأمامية ثلاثًا بدل أربع',alt:['فتحة ناقصة في الآلة الخشبية','عدد فتحات الآلة الخشبية'],spot:{x:56.2,y:75.2,r:4.5},reason:'عدّ فتحات صغيرة على وجه الآلة ضمن أدوات متشابهة اللون؛ تظل فتحة الوجه الجانبي ثابتة.'},
 '1000-906':{q:'ما التفصيل الدقيق المتبدّل بين صورتي تجهيز التخييم؟',a:'انعكس اتجاه بوابة المشبك',alt:['اتجاه فتحة حلقة التسلق','بوابة المشبك انتقلت للجهة الأخرى'],spot:{x:71.4,y:78.1,r:8},reason:'مقارنة اتجاه بوابة داخل حلقة وسط أحزمة وحبال؛ حلقة الحزام ومساره ثابتان.'},
 '1000-907':{q:'ما التفصيل المختلف بين صورتي طاولة الخياطة؟',a:'تغيّر اتجاه عروة الكم السفلية',alt:['العروة السفلية أصبحت عمودية','اتجاه فتحة زر الكم السفلى'],spot:{x:64.7,y:70.9,r:4.5},reason:'مقارنة اتجاه عروة واحدة بعروة ثانية وبين خياطة وأزرار كثيرة؛ عدد العروات ثابت.'},
 '1000-908':{q:'ما التغيير الدقيق بين صورتي القطع المعدنية؟',a:'انتقل الشق العلوي في الحلقة',alt:['تغيّر موضع شق الحلقة','تباعد شقوق الحلقة'],spot:{x:39.5,y:48,r:7.5},reason:'فحص التوزيع الزاوي لأربعة شقوق متشابهة؛ العدد والفتحة الوسطى ثابتان.'}
};
const lowReasons={
 '200-903':'استبدال تبديل لون إبريق كبير بشريط بنيوي على الأصيص؛ رفع إلى400 لأنه يحتاج فحص حدود الأصيص.',
 '200-904':'استبدال لون السيارة بعدّ حلقات البرج الأصغر ومقارنته بالبرج المجاور؛ رفع إلى400.',
 '200-905':'استبدال لون الطبلة بمقارنة اتجاه المطرقة الموسيقية؛ رفع إلى400.',
 '200-906':'استبدال لون الحقيبة بعدد فتحات مقبضها نتيجة عارضة إضافية؛ رفع إلى400.',
 '200-907':'استبدال لون القبعة بزر صغير إضافي يحتاج مسح التفاصيل؛ رفع إلى400.',
 '200-908':'استبدال لون صندوق الأدوات بحالة مشبكه المفتوح؛ رفع إلى400.',
 '400-901':'استبدال حذف الملعقة بمقارنة اتجاهها مع ثبات عدد الأدوات؛ مناسب للمقارنة الخفيفة400.',
 '400-902':'استبدال حذف القلم بمقارنة موضع رأسه المدبب؛ مناسب للمقارنة الخفيفة400.'
};
const keptReasons={
 '200-901':'إبقاء فرق لون واضح كمدخل سهل في أدنى شريحة؛ أحد سؤالين فقط يعتمد حلهما على اللون الكبير.',
 '200-902':'إبقاء مقارنة لون الدفتر في شريحة200 كتمهيد سريع؛ لا تُستخدم هذه الآلية في الشرائح العليا.',
 '600-902':'إبقاء مقارنة اتجاه المسطرة دون حذفها؛ زاويتها تُقرأ من الصورة والجواب صريح.',
 '600-905':'إبقاء مقارنة ميل بندول المسرّع مع ثبات الآلة؛ يتطلب تتبع الجزء الرفيع داخل الجسم.',
 '600-907':'إبقاء زر القفاز الصغير المفقود؛ حجمه قابل للرؤية دون تكبير بعد مسح خياطة القفاز.'
};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const ledger=[];
for(const [index,q] of pack.qs.entries()){
 const before=structuredClone(q),short=q.qid.replace('spotdiff-','');let decision='keep',reason=keptReasons[short],identityChanged=false;
 let bRecord;try{bRecord=JSON.parse(await fs.readFile(`${dir}/spotdiff-generated/${q.qid}-b.json`,'utf8'));}catch{}
 if(lowReasons[short]){
  const d=bRecord.diff;Object.assign(q,{a:d.answer,spot:d.spot,alt:[d.answer.replace(/^انعكس /,'تغيّر ')]});
  if(short.startsWith('200'))q.p=400;
  if(short==='400-901')q.q='ما الاختلاف بين صورتي مائدة الحساء؟';
  if(short==='400-902')q.q='ما الذي تبدّل بين صورتي التحضير للرسم؟';
  reason=lowReasons[short];decision='replace';identityChanged=true;
 }else if(before.p===400&&Number(short.split('-')[1])>=903){
  q.p=200;decision='retier';reason='نقل إلى200: حذف عنصر منفصل كامل من مشهد قليل العناصر؛ الملاحظة مباشرة ولا تستحق400. إبقاء الصورة والجواب الصحيحين.';
 }else if(edits[short]){
  const {reason:r,...content}=edits[short];Object.assign(q,content);reason=r;decision='replace';identityChanged=true;
 }
 if(short==='600-907')q.q='ما التفصيل المختلف بين صورتي تجهيز الشتاء؟';
 if(short==='600-907')decision='improve';
 for(let side=0;side<2;side++){
  const file=`${dir}/spotdiff-generated/${q.qid}-${side?'b':'a'}.json`;let record;try{record=JSON.parse(await fs.readFile(file,'utf8'));}catch{continue;}
  const body=await fs.readFile(record.asset);record.sha256=sha(body);record.bytes=body.length;
  Object.assign(record.review,{status:'phone-size-reviewed',reviewedAt:'2026-10-12',semanticDifferenceCount:1,reviewer:'finish_spotdiff',imageWidthCSS:173,mobileDeviceQA:false,evidence:`${dir}/preview/spotdiff-${String(Math.floor(index/4)+1).padStart(2,'0')}.png`});
  if(['800-901','800-905','800-908','1000-903'].includes(short))record.review.independentReviewer='root';
  await fs.writeFile(file,JSON.stringify(record,null,2)+'\n');
  q.media[side]={...q.media[side],src:path.basename(record.asset),provenance:{kind:'ai-generated',tool:'OpenAI image generation (built-in)',createdAt:record.createdAt,record:file}};
 }
 q.alt=[...new Set((q.alt||[]).filter(x=>x!==q.a))];
 q.difficultyTarget=status.difficultyTargets[q.p];
 if(decision!=='keep')q.sourceUrl=`${dir}/review-spotdiff.json`;
 const assets=[];for(const m of q.media){const file='media/spotdiff/'+m.src;const body=await fs.readFile(file);assets.push({file,sha256:sha(body),bytes:body.length});}
 if(!reason)throw new Error('Missing review '+q.qid);
 ledger.push({qid:q.qid,pack:'spotdiff',decision,reason,identityChanged,oldTier:before.p,newTier:q.p,before,after:structuredClone(q),factualCheck:'visual-observation',semanticDifferenceCount:1,assets,phoneQA:{status:'phone-size-reviewed',reviewedAt:'2026-10-12',reviewer:'finish_spotdiff',imageWidthCSS:173,viewports:[390,350],views:['side-by-side before reveal','side-by-side reveal markers','stacked before and after reveal'],evidence:`${dir}/preview/spotdiff-${String(Math.floor(index/4)+1).padStart(2,'0')}.png`,mobileDeviceQA:false,limitation:'Browser-rendered phone layout; not physical iPhone testing. AI texture variation is not asserted pixel-identical.'}});
}
for(const p of [200,400,600,800,1000])if(pack.qs.filter(q=>q.p===p).length!==8)throw new Error('tier '+p);
await fs.writeFile('src/data/categories/spotdiff.json',JSON.stringify(pack,null,2)+'\n');
await fs.writeFile(`${dir}/review-spotdiff.json`,JSON.stringify(ledger,null,2)+'\n');
console.log(JSON.stringify({reviewed:ledger.length,decisions:ledger.reduce((x,r)=>(x[r.decision]=(x[r.decision]||0)+1,x),{}),newImages:ledger.flatMap(r=>r.assets).filter(x=>x.file.includes('q20261008')).length}));
