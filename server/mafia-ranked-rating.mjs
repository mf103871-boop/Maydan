// Experimental, deliberately uncalibrated model. Frozen classic8, ruleset1 only.
// Ratings do not buy abilities and are independent from XP, Plus and cosmetics.
export const MAFIA_RATING_MODEL='preview-elo-1';
export function rankedRatingDelta({rating=1000,games=0,faction,opponents=1000,allies=1000,won=false,draw=false,forfeited=false}) {
  if(!['town','mafia'].includes(faction)||![rating,games,opponents,allies].every(Number.isFinite))throw new TypeError('RANKED_RATING_INPUT');
  // Equal prior at the fixed6v2 template, pending actual faction calibration.
  // Team mean difference drives expectation, never head count or speaking time.
  const expected=1/(1+10**((opponents-allies)/400));
  const score=forfeited?0:draw?0.5:won?1:0;
  const base=Math.round((games<10?32:16)*(score-expected));
  const delta=Math.max(-32,Math.min(32,forfeited?Math.min(-16,base):base));
  return {model:MAFIA_RATING_MODEL,expected,delta:Math.max(0,Math.min(3000,rating+delta))-rating,provisional:games+1<10};
}
export function rankedBand(rating,games) {
  if(games<10)return 'تحديد المرتبة';
  return rating<800?'نحاسي':rating<1000?'برونزي':rating<1200?'فضي':rating<1500?'ذهبي':rating<1800?'ماسي':'أسطورة';
}
export function rankedMatchDeltas(results,ratings){
  const get=id=>ratings.get(id)||{rating:1000,games:0};
  const team=faction=>results.filter(r=>r.faction===faction).sort((a,b)=>a.playerId.localeCompare(b.playerId));
  const town=team('town'),mafia=team('mafia');
  if(town.length!==6||mafia.length!==2)throw new TypeError('RANKED_TEMPLATE');
  const mean=rows=>rows.reduce((n,r)=>n+get(r.userId).rating,0)/rows.length;
  const expectedTown=1/(1+10**((mean(mafia)-mean(town))/400));
  const draw=!results.some(r=>r.won),townWon=town.some(r=>r.won);
  // Use one experience coefficient for both teams. A match transfers the same
  // integer budget between teams despite unequal head count. Only explicit
  // forfeit penalties and the rating floor/ceiling may break conservation.
  const coefficient=results.some(r=>get(r.userId).games<10)?32:16;
  const budget=Math.round(coefficient*((draw?0.5:townWon?1:0)-expectedTown)),out=new Map();
  for(const [rows,total]of [[town,budget],[mafia,-budget]]){
    const base=Math.trunc(total/rows.length),rest=total-base*rows.length;
    rows.forEach((r,i)=>{const before=get(r.userId).rating,normal=base+(i<Math.abs(rest)?Math.sign(rest):0),delta=r.forfeited?Math.min(-16,normal):normal;out.set(r.userId,Math.max(0,Math.min(3000,before+delta))-before);});
  }
  return out;
}
