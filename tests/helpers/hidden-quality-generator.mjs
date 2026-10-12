// Reproducible authored search boards, deliberately using bird silhouettes in
// the upper tiers. This is a data fixture, not a change to the game mechanic.
export const TARGET = '🦆';
export const SEED_VERSION = 'hidden-quality-2026-10-08';
export const HIDDEN_TIERS = [
  { p: 200, side: 4, nearFraction: 0.2 },
  { p: 400, side: 5, nearFraction: 0.4 },
  { p: 600, side: 6, nearFraction: 0.65 },
  { p: 800, side: 7, nearFraction: 0.9 },
  { p: 1000, side: 8, nearFraction: 1 },
];
export const HIDDEN_THEMES = [
  {topic:'المزرعة وطيورها',distinct:['🐄','🐖','🐑','🐐','🐎'],similar:['🐔','🐓','🦃','🪿','🐦','🐥']},
  {topic:'كائنات مائية',distinct:['🐟','🐠','🐸','🐢','🦀'],similar:['🦢','🪿','🐧','🦩','🐦']},
  {topic:'الغابة وطيورها',distinct:['🐻','🦊','🦝','🐿️','🐇'],similar:['🦜','🦚','🐦','🕊️','🦉','🦅']},
  {topic:'طيور الحديقة',distinct:['🌷','🌼','🍃','🌳','🍂'],similar:['🕊️','🐦','🐤','🐔','🪿']},
  {topic:'طيور الحقول',distinct:['🌾','🌽','🌻','🍀','🌱'],similar:['🐔','🐓','🦃','🐦','🪿','🕊️']},
  {topic:'طيور البحيرات',distinct:['🪷','🌿','🐸','🐟','🐢'],similar:['🪿','🦢','🦩','🐧','🐦']},
  {topic:'طيور مختلطة',distinct:['🦕','🦖','🐊','🦎','🐍'],similar:['🦤','🦢','🪿','🐓','🦃','🐦']},
  {topic:'طيور بين الثدييات',distinct:['🐗','🦦','🦫','🦔','🦥'],similar:['🦉','🦅','🐦','🦃','🪿','🦤']},
];
const targets={200:.8,400:.6,600:.4,800:.25,1000:.15};
function random(seed){let n=2166136261;for(const c of seed){n^=c.codePointAt(0);n=Math.imul(n,16777619);}return()=>{n+=0x6d2b79f5;let t=n;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function shuffled(a,r){let b=[...a];for(let i=b.length-1;i>0;i--){let j=Math.floor(r()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
export function targetQuadrant(row,col,side){const split=Math.ceil(side/2);return(row>=split?2:0)+(col>=split?1:0);}
function targetPositions(p,side){
 const r=random(`${SEED_VERSION}:positions:${p}`),cells=Array.from({length:side*side},(_,i)=>i);
 const interior=i=>{let row=Math.floor(i/side),col=i%side;return row>0&&row<side-1&&col>0&&col<side-1;};
 return Array.from({length:8},(_,i)=>{let quad=(i+Math.floor(p/200))%4;let pool=cells.filter(k=>targetQuadrant(Math.floor(k/side),k%side,side)===quad&&interior(k)===(i<4));return shuffled(pool,r)[0];});
}
export function buildHiddenPack(){
 const qs=HIDDEN_TIERS.flatMap((tier,ti)=>{
  const positions=targetPositions(tier.p,tier.side);
  return HIDDEN_THEMES.map((theme,i)=>{
   const qid=`hidden-${tier.p}-${901+i}`,r=random(`${SEED_VERSION}:${qid}`),length=tier.side*tier.side,target=positions[i];
   const positionsWithout=shuffled(Array.from({length},(_,k)=>k).filter(k=>k!==target),r);
   const nearCount=Math.round((length-1)*tier.nearFraction);const cells=Array(length);
   for(const [indices,palette]of [[positionsWithout.slice(0,nearCount),theme.similar],[positionsWithout.slice(nearCount),theme.distinct]]){
    const values=shuffled(indices.map((_,k)=>palette[(k+i+ti)%palette.length]),r);indices.forEach((k,j)=>cells[k]=values[j]);
   }
   cells[target]=TARGET;const row='٠١٢٣٤٥٦٧٨٩'[Math.floor(target/tier.side)+1],col='٠١٢٣٤٥٦٧٨٩'[target%tier.side+1];
   return {p:tier.p,q:'',a:`الصف ${row}، العمود ${col} من اليسار`,qid,type:'grid',topic:theme.topic,verified:true,difficultyTarget:targets[tier.p],sourceUrl:'docs/bank/quality-2026-10-08/hidden-boards-proof.json',target:TARGET,grid:Array.from({length:tier.side},(_,row)=>cells.slice(row*tier.side,(row+1)*tier.side))};
  });
 });
 return {id:'hidden',name:'البطة المخفية',icon:TARGET,qs};
}
