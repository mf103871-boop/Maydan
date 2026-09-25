const fs = require('node:fs');
const repo = 'C:/Users/user/Desktop/maydan';
const file = repo + '/src/data/categories/code.json';
const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
const alphabet = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'];
const topics = ['بلدان ومدن','حيوانات','أطعمة','أدوات','أماكن','طبيعة','رياضة','أشياء يومية'];
const tiers = [
  {p:200,target:.8,words:['مصر','أسد','تمر','قلم','بحر','شمس','هدف','باب'],hint:'صِل الحروف بالترتيب لتعرف الكلمة',encode:w=>[...w].join(' · ')},
  {p:400,target:.6,words:['لبنان','حصان','تفاح','مقص','حديقة','غيمة','تنس','كرسي'],hint:'اقرأ الحروف من آخرها إلى أولها',encode:w=>[...w].reverse().join('')},
  {p:600,target:.4,words:['المغرب','بطريق','برتقال','مفتاح','مطار','بركان','مضرب','مصباح'],hint:'احذف حرف ز الدخيل بين الحروف لتعرف الكلمة',encode:w=>[...w].join('ز')},
  {p:800,target:.25,words:['تونس','دلفين','كركم','منشار','متحف','جليد','تزلج','صندوق'],hint:'كل رقم يمثل حرفًا: '+alphabet.map((c,i)=>`${i+1}=${c}`).join('، '),dir:'ltr',encode:w=>[...w].map(c=>alphabet.indexOf(c)+1).join(' - ')},
  {p:1000,target:.15,words:['ماليزيا','قنفذ','كسكس','ترمومتر','مستودع','كهرمان','جمباز','منبه'],hint:'أعد كل حرف خطوة للخلف في هذا الترتيب؛ ا يعود إلى ي: '+alphabet.join(' '),encode:w=>[...w].map(c=>alphabet[(alphabet.indexOf(c)+1)%alphabet.length]).join('')}
];
pack.qs = tiers.flatMap(t=>t.words.map((a,i)=>({p:t.p,q:t.encode(a),a,qid:`code-${t.p}-${901+i}`,type:'code',topic:topics[i],hint:t.hint,dir:t.dir||'rtl',alt:[],difficultyTarget:t.target,verified:true,source:'لغز شفرة أصلي؛ تحقق عكسي من قاعدة الترميز',sourceUrl:'docs/bank/rebuild-2026-09-18/interactive-evidence.md'})));
fs.writeFileSync(file, JSON.stringify(pack,null,2)+'\n');
console.log('Wrote 40 original code puzzles.');
