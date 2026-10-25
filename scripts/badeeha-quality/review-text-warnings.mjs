// Final cross-card check; run once before integration, after editorial handoff.
import {readFile,writeFile} from 'node:fs/promises';
const dir='docs/bank/quality-2026-10-08';
const status=JSON.parse(await readFile('src/data/bank-status.json','utf8'));
if(status.contentVersion==='badeeha-quality-2026-10-08')throw Error('Already integrated');
const ledger=JSON.parse(await readFile(`${dir}/review-knowledge.json`,'utf8'));
const edits=[
 ['geo','geo-600-915','ما اسم الشريط شبه الجاف الفاصل بين الصحراء الكبرى والأقاليم العشبية المدارية؟','استبدال اسم السافانا بوصف الإقليم في سؤال مستقل حتى لا يعرض جواب بطاقة200 حرفيًا؛ الحدود الجغرافية المقصودة لم تتغير.'],
 ['ramadan','ramadan-800-915','ما غطاء الرأس الأسود المزخرف بالذهب الذي ترتديه الفتيات في احتفال منتصف رمضان القطري؟','حذف اسم قرنقعوه الذي كان جواب بطاقة600 مع الحفاظ على توقيت الاحتفال وبلده لتبقى قرائن الزي عادلة.'],
];
for(const [id,qid,text,reason] of edits){
 const file=`src/data/categories/${id}.json`,pack=JSON.parse(await readFile(file,'utf8'));
 pack.qs.find(q=>q.qid===qid).q=text;await writeFile(file,JSON.stringify(pack,null,2)+'\n');
 const r=ledger.find(r=>r.qid===qid);if(r.action==='keep')r.action='improve';r.reason+=' مراجعة مستقلة: '+reason;
 r.crossCardReview={reviewer:'root',date:'2026-10-08',decision:'remove-avoidable-answer-word',reason};
}
const conjunction=ledger.find(r=>r.qid==='ramadan-600-917');
conjunction.factualCheck='existing-source-reviewed';conjunction.sourceReviewScope='أعيد فتح مرجع USNO والتحقق من تعريف المحاق بتساوي الطولين السماويين، مع قبول الاقتران والقمر الجديد.';
conjunction.sources=[...new Set([...conjunction.sources,'https://aa.usno.navy.mil/faq/crescent','https://aa.usno.navy.mil/faq/asa_glossary'])];
await writeFile(`${dir}/review-knowledge.json`,JSON.stringify(ledger,null,2)+'\n');
const report={date:'2026-10-08',reviewer:'root',avoidableMentionsRemoved:edits.map(([,qid,,reason])=>({qid,reason})),remainingWarnings:[
 {answerQid:'arabliterature-400-912',promptQid:'arabliterature-1000-912',reason:'الروي مصطلح لازم لتمييز ألف التأسيس؛ السؤال الآخر لا يعرّف الروي ولا يكرر مفهوم بطاقة التسمية.'},
 {answerQid:'general-400-918',promptQid:'general-1000-914',reason:'أزرق لون شائع في سياقين مختلفين: غروب المريخ وتفريغ كهربائي؛ لا تتكرر الحقيقة.'},
 {answerQid:'prophets-200-915',promptQid:'prophets-1000-918',reason:'الريح عنصر في قصتين مختلفتين لسليمان وعاد؛ تسمية العنصر لا تكشف وصفه القرآني.'},
 {answerQid:'prophets-200-917',promptQid:'prophets-800-912',reason:'اسم أيوب يحدد القصة المطلوبة، بينما السؤال الأول عن دعاء والثاني عن أمر مستقل؛ حذف الاسم يجعل المرجع مبهما.'},
 {answerQid:'quran-1000-911',promptQids:['quran-600-917','quran-800-914'],reason:'الأول يذكر الجرم القمري، والثاني يستعين باسم السورة لتحديد لفظ مستقل؛ لا ترد الآية التي تحدد جواب بطاقة1000.'},
 {answerQid:'ramadan-600-917',promptQid:'ramadan-1000-918',reason:'الطور الفلكي يستخدم لتعريف الدورة بين حدثين؛ بطاقة600 تقبل المحاق والاقتران والقمر الجديد، وبطاقة1000 تسأل مدة دورة لا الحدث نفسه.'},
 {answerQid:'tarab-200-914',promptQid:'tarab-1000-913',reason:'صباح المطربة وصباح فخري شخصان مختلفان؛ تطابق الاسم الأول إنذار لفظي.'},
 {answerQid:'tarab-400-916',promptQid:'tarab-800-918',reason:'لقب أمير البزق يحدد الموسيقي؛ البطاقة الأخرى تختبر معرفة بنية الآلة، واللقب لا يصفها.'},
 {answerQid:'tarab-600-914',promptQid:'tarab-200-917',reason:'اسم الرق لازم لحصر مادة الغشاء التقليدية وعدم قبول مواد دفوف أخرى؛ لا يذكر السؤال الصنوج التي تميز جواب بطاقة600.'},
 ],sourceChecks:[{qid:'ramadan-600-917',url:'https://aa.usno.navy.mil/faq/crescent',finding:'Astronomical new moon occurs when Sun and Moon have equal geocentric ecliptic longitude; the existing alternate answers are retained.'}]};
await writeFile(`${dir}/cross-card-warnings.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({edits:edits.length,decisions:ledger.reduce((a,r)=>(a[r.action]=(a[r.action]||0)+1,a),{})}));
