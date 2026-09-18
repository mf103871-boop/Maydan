import fs from 'node:fs';
import assert from 'node:assert/strict';
const qs=JSON.parse(fs.readFileSync('C:/Users/user/Desktop/maydan/src/data/categories/puzzles.json','utf8')).qs;
const get=id=>qs.find(q=>q.qid==='puzzles-'+id).a;
const checks=[];
function num(id,actual){assert.equal(Number.parseInt(get(id),10),actual,id);checks.push(id);}
num('200-901',12+9);num('200-903',30-15);num('200-904',5*2);num('200-906',2*4);num('200-907',3*2);
num('400-901',50*(1-.2)-5);num('400-903',2.5*60);num('400-904',(24+12)/2);num('400-906',4+4+4);
const pairs=n=>Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i<j?1:0)).flat().reduce((a,b)=>a+b,0);
num('400-907',pairs(10));num('600-901',3*12+6);num('600-903',Math.abs(180-3.5*30));
num('600-904',Array.from({length:150},(_,i)=>i).find(age=>age/3+12===(age+12)/2));num('600-905',7+7-1);num('600-906',pairs(5)-5);
let rectangles=0;for(let top=0;top<2;top++)for(let bottom=top+1;bottom<=2;bottom++)for(let left=0;left<3;left++)for(let right=left+1;right<=3;right++)rectangles++;
num('600-907',rectangles);
const twoDigit=Array.from({length:90},(_,i)=>i+10).filter(n=>Math.floor(n/10)+n%10===11&&Number(String(n).split('').reverse().join(''))-n===27);assert.deepEqual(twoDigit,[Number(get('800-901'))]);checks.push('800-901');
num('800-903',60/5);num('800-904',Array.from({length:150},(_,i)=>i).find(age=>age>20&&age-10===3*(age/2-10)));
let squares=0;for(let size=1;size<=3;size++)for(let row=0;row<=3-size;row++)for(let col=0;col<=3-size;col++)squares++;num('800-906',squares);num('800-907',pairs(6));num('800-908',2*2+1);
let modular=1;while(!(modular%7===0&&[2,3,4,5].every(d=>modular%d===1)))modular++;num('1000-901',modular);
const ages=[];for(let me=1;me<56;me++){const you=56-me;if(me>=you&&me===2*(you-(me-you)))ages.push(me);}assert.deepEqual(ages,[Number.parseInt(get('1000-904'))]);checks.push('1000-904');
function permutations(a){if(!a.length)return [[]];return a.flatMap((x,i)=>permutations(a.filter((_,j)=>i!==j)).map(r=>[x,...r]));}
num('1000-905',permutations([0,1,2,3,4]).filter(p=>Math.abs(p.indexOf(0)-p.indexOf(1))===1).length);
const paths=(r,c)=>r===0||c===0?1:paths(r-1,c)+paths(r,c-1);num('1000-906',paths(3,3));num('1000-907',Array.from({length:100},(_,i)=>String(i+1)).join('').split('').filter(d=>d==='9').length);
// Exhaustive shortest path over every party/location state. Both directions allow one or two people.
const times=[1,2,7,10],distance=new Map([['0,0',0]]),queue=[[0,0,0]];
while(queue.length){queue.sort((a,b)=>a[0]-b[0]);const[cost,mask,side]=queue.shift();if(cost!==distance.get(mask+','+side))continue;if(mask===15&&side===1){num('1000-908',cost);break;}const here=times.map((_,i)=>i).filter(i=>((mask>>i)&1)===side);const groups=here.map(i=>[i]);for(let i=0;i<here.length;i++)for(let j=i+1;j<here.length;j++)groups.push([here[i],here[j]]);for(const g of groups){let next=mask;for(const i of g)next^=1<<i;const ncost=cost+Math.max(...g.map(i=>times[i])),key=next+','+(1-side);if(ncost<(distance.get(key)??Infinity)){distance.set(key,ncost);queue.push([ncost,next,1-side]);}}}
assert.equal(get('800-902'),'قمر');const alphabet=[...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'];assert.equal([...'كنز'].map(c=>alphabet[alphabet.indexOf(c)-1]).join(''),get('800-902'));checks.push('800-902');
assert.equal(alphabet[27-alphabet.indexOf('ذ')],'ف');assert.equal(get('1000-902'),'الفاء');checks.push('1000-902');assert.equal(get('1000-903'),'120/11 دقيقة');assert.equal(60/(6-.5),120/11);checks.push('1000-903');
console.log(JSON.stringify({verified:checks.length,checks},null,2));
