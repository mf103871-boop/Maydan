import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const dir='docs/bank/quality-2026-10-08';
const targets={200:.8,400:.6,600:.4,800:.25,1000:.15};
const baseline=id=>JSON.parse(execFileSync('git',['show',`e912acf:src/data/categories/${id}.json`],{encoding:'utf8'}));
const art=JSON.parse(await readFile(`${dir}/question-art-plan.json`,'utf8')).jobs;
const blurArt=JSON.parse(await readFile(`${dir}/blur-art-plan.json`,'utf8')).jobs;
const extraArt=JSON.parse(await readFile(`${dir}/extra-root-art-plan.json`,'utf8')).jobs;
const references=JSON.parse(await readFile(`${dir}/blur-reference-sources.json`,'utf8'));
const refFor=qid=>references.find(r=>r.preparedFile===({'zoom-600-904':'media/zoom/quality-usbc-reference.webp','blur-200-906':'media/blur/quality-eiffel-close.webp','blur-1000-901':'media/blur/quality-tapir.webp'}[qid]));
art.push(extraArt.find(j=>j.pack==='zoom'));
blurArt.splice(blurArt.findIndex(j=>j.id==='blur-1000-907'),1,extraArt.find(j=>j.pack==='blur'));
const stamp=(q,job)=>{
 if(job.status!=='generated-installed')throw new Error(`Missing art ${job.id}`);
 q.media={src:job.file.split('/').at(-1),type:'image',title:'لغز بصري توضيحي',author:'Maydan / OpenAI image generation',disclosure:'تصوير توضيحي مولّد بالذكاء الاصطناعي',provenance:{kind:'ai-generated',tool:'OpenAI image generation (built-in)',createdAt:'2026-10-08',record:job.record}};
};
const zoom=baseline('zoom');
const zoomTierMoves={'600-903':1000,'1000-902':600,'800-904':1000,'1000-904':800,'800-908':1000,'1000-908':800};
const zoomTierReasons={'600-903':'قرينة البكرة الداخلية والخيط أقل شيوعًا من رأس عصارة الثوم الظاهر تقريبًا كاملًا، فنُقلت إلى1000.','1000-902':'رأس العصر والمفصل ظاهران معًا، ولذلك خُفضت إلى600.','800-904':'يتطلب تمييز شفرات فتحة العدسة من شكل ميكانيكي داخلي، فارتفعت إلى1000.','1000-904':'جسم الشريحة وأرجلها الإلكترونية واضحان نسبيًا، فخُفضت إلى800.','800-908':'تفصيل لؤلؤي من سطح الصدفة دون شكلها الحلزوني الكامل يحتاج تمييز مادة وبنية، فنُقل إلى1000.','1000-908':'نمط الوريقات والمحور ظاهر على مساحة واسعة، فخُفضت إلى800.'};
const origins={
 '400-905':'47% 67%','400-906':'55% 35%',
 '600-901':'62% 59%','600-902':'8% 65%','600-903':'50% 38%','600-904':'60% 62%',
 '600-906':'50% 52%','600-907':'48% 42%',
 '800-902':'48% 47%','800-903':'42% 52%','800-905':'63% 53%',
 '800-907':'48% 50%','800-908':'53% 53%',
 '1000-902':'28% 60%','1000-903':'65% 78%','1000-904':'25% 50%','1000-907':'50% 10%','1000-908':'48% 45%',
};
const keepReasons={
 '200-901':'انحناء القشرة وحافتها قرينة أولية مناسبة لمدخل الحزمة؛ بقيت للتدرج.',
 '200-902':'التقاء الشفرتين بالمسمار يختبر ربط جزء بالكل دون نص مساعد.',
 '200-903':'حزم الشعيرات والطرف البلاستيكي يكفيان لاستنتاج خفيف عند200.',
 '200-904':'صف المفاتيح وأحرفها يقدمان سؤال دخول واضحًا؛ لا يبرر نقله إلى خانة عليا.',
 '200-905':'التقاء الرقع والدرزات يثبت هوية الكرة في خانة البداية.',
 '200-906':'ربط الأوتار بفتحة الرنين مناسب200؛ قُبل الجيتار بتهجئاته العربية.',
 '200-907':'التقاء الدواسة بذراع التدوير والإطار قرائن واضحة عند200.',
 '200-908':'قراءة نمط البذور الشعاعي ملاحظة خفيفة عادلة.',
 '400-901':'نسيج الفصوص وحد القشرة يعطيان قرينتين؛ بقيت المعرفة اليومية في400.',
 '400-902':'تمييز العجلة المسننة وشفرة الفتح يتطلب ربطهما بالوظيفة.',
 '400-906':'تحريك القص إلى الطوق ومسامير الشد يزيل التباس سطح خشبي عام.',
 '400-908':'تراكب الحراشف واتجاهها يميز المخروط دون كشف هيئته كلها.',
 '600-902':'التقاء الأسلاك المنحنية يتطلب تصور جسم الخفاقة من الجزء.',
 '600-908':'اتجاه الشعيرات على جانبي المحور قرينتان بدل الاعتماد على اللون.',
 '800-903':'القص إلى انثناء السلك واتصاله بالمشبك يتطلب تتبع العلاقة؛ حُجب معظم الجسم.',
 '800-906':'طيات المنفاخ المتكررة والحد الجانبي تميّز آلية الآلة من جزء محدود.',
 '1000-901':'تراكب القنابات المدببة يتطلب تمييز بنية النبات لا لونه وحده.',
 '1000-902':'الفتحات مع مفصل الكبس وحافته تتيح استنتاج الأداة دون صورة جسمها الكامل.',
 '1000-903':'السطح المنقّر وحافة الغطاء المقوسة يتيحان تمييز أداة صغيرة غير مكشوفة بالكامل.',
 '1000-904':'بقيت أرجل التوصيل ومقابلها جسم الحزمة ضمن القص؛ يقارن اللاعب النمط بموصلات أخرى.',
 '1000-905':'الدرز المزدوج في الجلد يميزها عن كرات رياضية أخرى؛ قُبل اسم الكريكيت فقط لا أي كرة.',
 '1000-906':'ترتيب المفاتيح على جسم أسود يميز الآلة؛ قُبلت تهجئات الاسم.',
 '1000-907':'تعديل القص ليظهر تجويف الرأس الملولب مع الجسم بدل عمود معدني منفرد.',
 '1000-908':'بقي نمط الوريقات المتفرعة حول محور مشترك، وهو الدليل النباتي المقصود.',
};
const extras={
 'zoom-200-906':['جيتار','قيثارة'], 'zoom-200-908':['عباد الشمس','زهرة عباد الشمس'],
 'zoom-400-902':['فتاحة معلبات'],'zoom-400-908':['كوز صنوبر'],
 'zoom-600-902':['مضرب خفق','خفاقة يدوية'],'zoom-600-908':['ريشة'],
 'zoom-800-906':[],
 'zoom-1000-901':['أرضي شوكي','أرضي شوكة'],'zoom-1000-902':['هراسة ثوم','مكبس ثوم'],
 'zoom-1000-904':['دارة متكاملة','دائرة متكاملة'],'zoom-1000-906':['كلارنيت','كلارنيت خشبي'],
 'zoom-1000-907':['بلف إطار','صمام هواء إطار'],'zoom-1000-908':['نبات السرخس'],
};
const rows=[];
for(const q of zoom.qs){
 const before=structuredClone(q), suffix=q.qid.slice(5), job=art.find(j=>j.id===q.qid),reference=refFor(q.qid);
 if(job){if(!reference)stamp(q,job);q.a=job.a;q.alt=job.alt;q.origin=job.origin;}
 if(origins[suffix])q.origin=origins[suffix];
 if(extras[q.qid])q.alt=extras[q.qid];
 if(reference){q.media=reference.media;q.origin='50% 51%';}
 if(zoomTierMoves[suffix])q.p=zoomTierMoves[suffix];q.difficultyTarget=targets[q.p];
 q.sourceUrl=`${dir}/review-root-images.json`;
 const identityChanged=!!job||q.origin!==before.origin;
 rows.push({qid:q.qid,pack:'zoom',decision:job?'replace':q.p!==before.p?'retier':identityChanged?'improve':'keep',reason:(reference?'استبدال الصورة المولّدة غير الدقيقة بصورة مرخّصة لقابس USB-C حقيقي؛ القص يترك شكل الفتحة وحوافها قابلًا للفحص.':job?.reason||keepReasons[suffix])+(zoomTierReasons[suffix]?' مراجعة مستقلة: '+zoomTierReasons[suffix]:suffix==='600-902'?' مراجعة مستقلة: تحريك القص ليظهر انحناء الأسلاك بدل خطوط معدنية مستقيمة عامة.':suffix==='1000-903'?' مراجعة مستقلة: تضمين حافة الكشتبان مع التنقير لتقليل التباس المبشرة.':''),identityChanged,oldTier:before.p,newTier:q.p,before,after:structuredClone(q),visualReview:{original:'reviewed-all-40',effect:'3.4x at 366px; pending final adjusted crops',final:'pending'},factualCheck:reference?'licensed-reference-verified':'visual-object-review'});
}

const blur=baseline('blur');
const tierMoves={'600-902':1000,'800-902':600,'1000-902':800,'600-903':800,'800-903':1000,'1000-903':600,'400-906':600,'600-906':400,'800-906':1000,'1000-906':800,'600-908':800,'800-908':600,'800-907':1000,'1000-907':800};
const promptByTopic={حيوانات:'ما الحيوان الذي تتعرّف إليه من الصورة؟',أطعمة:'ما الطعام الظاهر في الصورة؟',البيت:'ما الغرض الظاهر في الصورة؟',موسيقى:'ما الآلة الموسيقية الظاهرة في الصورة؟','وسائل نقل':'ما وسيلة النقل الظاهرة في الصورة؟','معالم ومنشآت':'ما المنشأة الظاهرة في الصورة؟',رياضة:'إلى أي رياضة تشير الصورة؟',طبيعة:'ما الظاهرة أو التكوين الطبيعي الظاهر؟'};
const visualClues=[
 'مقارنة الأذنين والخرطوم وحدود الجسم','قراءة القرص والمكونات فوقه','الجسم المستدير مع الفوهة والمقبض','هيئة الغطاء والأرجل ولوحة العزف','الجناحان والذيل في سياق جوي','الدعامات المتباعدة والبرج المعدني؛ تُستبدل الصورة بمرجع حقيقي','وضع الذراع ومسار السباحة','المجرى والستار المائي أسفل الحافة',
 'الجسم القائم وتباين الريش والسياق الجليدي','الانحناء والطبقات المنتفخة','هيئة السقف والمقبض دون ذكرهما في النص','تحسين التباين حتى لا يذوب الأنبوب والفوهة في الخلفية','الأشرعة ومقارنتها ببدن المركب','هيئة الأذرع وعلاقتها بالمبنى','حدود القفازين ووظيفتهما الرياضية','المخروط وتدفق المادة المضيئة',
 'وضع التعلق والوجه والأطراف؛ لا يذكر النص سلوك الحيوان','العقدة الثنائية للمخبوز أقل شيوعًا فنُقلت إلى1000','ربط الذراع بالقاعدة الداعمة بعد حذف تسمية الإبرة والخيط','هيئة الجسم والرقبة القصيرة مقارنة بآلات وترية أخرى','التغذية العلوية والسياق الحضري يميزانها عن حافلة','البرج الساحلي واضح فنُقل إلى400','وضع الرامي والهدف يظلان قرينتين مرئيتين','الستائر الضوئية والسياق الليلي دون ذكر اللون',
 'شكل الدرع والخطم دون إعطاء أسماء الصفائح','لفائف متعددة تكشفها الصورة وحدها؛ خُفضت إلى600','المكبس المنفصل عن الإبريق يحتاج تمييزًا أدق فنُقل إلى1000','الجسم الدائري والرقبة الطويلة للمقارنة بالعود','ربط الزلاجات والجسم في بيئة ثلجية','فتحة القبة وأداة الرصد تحتاجان قراءة أدق فنُقلت إلى1000','تعرّف أداة رياضية غير شائعة من الحجر والمقبض','الكتلة المتفرعة وسياقها البحري واضحة نسبيًا فنُقلت إلى600',
 'الصورة المولدة ذات خطم مبالغ فيه تُستبدل بصورة حيوان حقيقي','تمييز القشرة واللب مع إزالة وصف ألوانهما؛ نُقلت إلى800','الأداة القديمة واضحة في شكلها العام؛ خُفضت إلى600','ربط الكيس والأنابيب لتمييز الآلة دون وصفها نصيًا','الميل وحدود العربة والسكة تسمح بالتمييز عن قطار أفقي','الخزان المرتفع معروف نسبيًا فنُقل إلى800','الصورة الجديدة تعرض الأداة كاملة بدل سلك يختفي خلف حركة الرياضي','تمييز اتجاه التكوينات من سقف الكهف دون تسمية موضعها في السؤال',
];
for(let i=0;i<blur.qs.length;i++){
 const q=blur.qs[i],before=structuredClone(q),suffix=q.qid.slice(5),job=blurArt.find(j=>j.id===q.qid),reference=refFor(q.qid);
 q.q=promptByTopic[q.topic];if(q.qid==='blur-200-906')q.q='ما المعلم الظاهر في الصورة؟';
 if(q.qid==='blur-800-908')q.q='ما الكائن الظاهر في الصورة؟';
 if(q.qid==='blur-1000-908')q.q='ما اسم التكوينات الصخرية في الصورة؟';
 if(q.qid==='blur-1000-907')q.q='ما الرياضة التي يمارسها اللاعب في الصورة؟';
 if(tierMoves[suffix])q.p=tierMoves[suffix];q.difficultyTarget=targets[q.p];
 if(job){stamp(q,job);q.a=job.a;q.alt=job.alt;}
 if(q.qid==='blur-200-903')q.alt=[...new Set([...q.alt,'إبريق','غلاية','غلاية ماء','غلاية شاي'])];
 if(reference){q.media=reference.media;if(q.qid==='blur-1000-901')q.alt=['التابير','تابير ملاوي','التابير الملاوي'];}
 q.sourceUrl=`${dir}/review-root-images.json`;
 rows.push({qid:q.qid,pack:'blur',decision:job&&q.a!==before.a?'replace':q.p!==before.p?'retier':'improve',reason:`إزالة وصف كان كافيًا للحل دون النظر للصورة. ${job?.reason||visualClues[i]}.`,identityChanged:!!job||!!reference||q.p!==before.p,oldTier:before.p,newTier:q.p,before,after:structuredClone(q),visualReview:{original:'reviewed-all-40',effect:'16px blur at 366px reviewed; updated assets pending final',final:'pending'},factualCheck:reference?'licensed-reference-verified':'visual-object-review'});
}
for(const pack of [zoom,blur]){
 for(const p of [200,400,600,800,1000])if(pack.qs.filter(q=>q.p===p).length!==8)throw new Error(`${pack.id} tier ${p}`);
 pack.qs.sort((a,b)=>a.p-b.p||a.qid.localeCompare(b.qid));
 await writeFile(`src/data/categories/${pack.id}.json`,JSON.stringify(pack,null,2)+'\n');
}
await writeFile(`${dir}/review-root-images.json`,JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify({reviewed:rows.length,art:art.length+blurArt.length}));
