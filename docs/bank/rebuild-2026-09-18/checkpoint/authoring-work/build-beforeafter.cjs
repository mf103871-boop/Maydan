const fs=require('node:fs');
const root='C:/Users/user/Desktop/maydan/';
const evidence=JSON.parse(fs.readFileSync(root+'docs/bank/beforeafter-evidence.json','utf8'));
const primary={liberty:'https://www.nps.gov/stli/learn/statue-of-liberty-facts.htm',londonmetro:'https://foi.tfl.gov.uk/FOI-0773-2324/TUBE160%20Heritage%20Leaflet.pdf',dubaimetro:'https://rta.ae/wps/portal/rta/ae/home/news-and-media/all-news/NewsDetails/dubai-metro-accomplishes-a-decade-of-happy-journeys-for-riders'};
const events=new Map(evidence.groups.flatMap(g=>g.events.map(e=>{if(primary[e.id])e.sourceUrl=primary[e.id];return [e.id,{...e,topic:g.topic}];})));
const curated=[
 ['apollo11/webb','burjkhalifa/eiffel','snowwhite/lionking','iphone/eniac','londonmetro/dubaimetro','rio/beijing','aladdin/cinderella','towerbridge/louvreabudhabi'],
 ['apple1/iphone','webb/hubble','liberty/burjkhalifa','lionking/jaws','dubaimetro/dohametro','beijing/barcelona','junglebook/et','louvreabudhabi/sydneyopera'],
 ['arpanet/macintosh','cassini/voyager1','sydneyopera/goldengate','bttf/jurassicpark','parismetro/tokyometro','sydneygames/atlanta','et/beautybeast','empirestate/towerbridge'],
 ['ibmpc/macintosh','newhorizons/cassini','spaceneedle/goldengate','beautybeast/aladdin','moscowmetro/newyorkmetro','montreal/moscow','apollo13/apollo11','eniac/univac'],
 ['intel4004/arpanet','apollo8/apollo11','liberty/eiffel','jaws/junglebook','tokyometro/moscowmetro','munich/mexico','jurassicpark/lionking','towerbridge/eiffel']
];
const pack=JSON.parse(fs.readFileSync(root+'src/data/categories/beforeafter.json','utf8'));
pack.qs=curated.flatMap((rows,t)=>rows.map((pair,i)=>{const ids=pair.split('/');const [a,b]=ids.map(id=>events.get(id));return{p:(t+1)*200,q:`${a.label} مقارنة بـ${b.label}؟`,a:a.year<b.year?'قبل':'بعد',qid:`beforeafter-${(t+1)*200}-${901+i}`,type:'choice',options:['قبل','بعد'],topic:a.topic,source:[a.sourceUrl,b.sourceUrl],sourceUrl:a.sourceUrl,verified:true,difficultyTarget:[.8,.6,.4,.25,.15][t],verification:{checkedAt:'2026-09-18',events:ids,method:'dated-event-comparison',years:[a.year,b.year]}};}));
evidence.note='أربعون مقارنة منتقاة من الأحداث الموثقة. التدرج يعتمد على شهرة الحدثين وتقارب موعديهما؛ نسبة النجاح الفعلية في خيارين لها خط أساس عشوائي 50%، لذا أهداف 40/25/15% تعني المعرفة دون تخمين، وليست قياسًا للنجاح في هذا النمط.';
fs.writeFileSync(root+'src/data/categories/beforeafter.json',JSON.stringify(pack,null,2)+'\n');
fs.writeFileSync(root+'docs/bank/beforeafter-evidence.json',JSON.stringify(evidence,null,2)+'\n');
console.log('Wrote 40 curated before/after questions.');
