const fs=require('fs'),path=require('path');
const base='C:/Users/user/Desktop/maydan/src/data/categories';
function update(id,fn){let file=path.join(base,id+'.json');let p=JSON.parse(fs.readFileSync(file));fn(p.qs);fs.writeFileSync(file,JSON.stringify(p,null,2)+'\n');}
function q(qs,id,text){qs.find(q=>q.qid===id).q=text;}
update('egyptdrama',qs=>{q(qs,'egyptdrama-200-905','من صاحب المصنع الذي يدخل في صراع طويل مع خصمه الريفي في «ليالي الحلمية»؟');q(qs,'egyptdrama-800-907','في «يوميات ونيس»، إلى من تعود القصة التي ينقلها عز الدين وينسبها لنفسه؟');q(qs,'egyptdrama-600-904','في «المال والبنون»، ما اسم ابنة سلامة التي يحبها ابن عباس الضو؟');});
update('arabseries',qs=>q(qs,'arabseries-200-905','في «العاصوف»، ما اسم أم خالد التي تجمع الأسرة وتقود شؤونها؟'));
update('babalhara',qs=>q(qs,'babalhara-200-901','من حكيم الحارة ووالد عصام وأشقائه؟'));
update('ertugrul',qs=>{q(qs,'ertugrul-600-905','ما اسم قبيلة جاندر التي ينافس تجارها الوافدين الجدد في الموسم الثالث؟');q(qs,'ertugrul-1000-908','ما اسم زوجة رفيق أرطغرل الذي يستشهد في كمين مع دوندار خلال الموسم الثالث؟');qs.find(q=>q.qid==='ertugrul-200-907').alt= ['كوردوغلو','كوردأوغلو','Kurdoğlu'];});
update('syriandrama',qs=>{q(qs,'syriandrama-200-901','ما اسم القرية الساحلية التي تقع فيها أحداث «ضيعة ضايعة»؟');q(qs,'syriandrama-1000-904','في «الزير سالم»، ما الاسم الذي تمنحه القبيلة للبطل بعد فقدان ذاكرته؟');});
update('foreignseries',qs=>{for(const r of qs){r.q=r.q.replace('سلف البطلة','جدّة البطلة القديمة');r.alt=r.alt.filter(x=>x!=='سنترال بارك'&&x!=='سنترالبارك');}});
update('turkishdrama',qs=>{for(const r of qs)r.alt=r.alt.filter(x=>x!=='إيبي تسعة');});
update('anime',qs=>{for(const r of qs){r.alt=r.alt.filter(x=>x!=='عصابة الرداء الأبيض');if(r.a==='جون ميسوغي'&&!r.q.includes('الكابتن'))r.q='في «الكابتن ماجد»، '+r.q;if(r.a==='غولياث'&&!r.q.includes('السماء'))r.q='في «قلعة في السماء»، '+r.q;}});
const ids=['arabseries','ramadanseries','babalhara','syriandrama','egyptdrama','turkishdrama','ertugrul','foreignseries','breakingbad','squidgame','movies','arabmovies','actors','anime'];
const sums={};for(const id of ids){const p=JSON.parse(fs.readFileSync(path.join(base,id+'.json')));for(const r of p.qs){const k=decodeURI(r.sourceUrl);sums[k]=(sums[k]||0)+[r.q,r.a,...r.alt].join(' ').split(/\s+/).length;}}console.log(Object.entries(sums).filter(([k,v])=>v>195));
