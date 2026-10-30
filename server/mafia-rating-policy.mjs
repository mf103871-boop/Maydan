import { rankedMatchDeltas } from './mafia-ranked-rating.mjs';

// Version 1 remains a dispatch to the shipped algorithm. No learned value can
// alter a current season; a separately reviewed binding is required for v2.
export const MAFIA_BASE_RATING_POLICY=Object.freeze({schemaVersion:1,model:'preview-elo-1',rulesetVersion:1,template:'classic8-6town-2mafia'});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export const canonicalMafiaRatingValue=value=>JSON.stringify(value,(_,item)=>object(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const issue=()=>{throw new TypeError('MAFIA_RATING_POLICY_INVALID');};
export function validateMafiaRatingPolicy(value){
  if(value?.model==='preview-elo-1'){
    if(canonicalMafiaRatingValue(value)!==canonicalMafiaRatingValue(MAFIA_BASE_RATING_POLICY))issue();
    return MAFIA_BASE_RATING_POLICY;
  }
  const keys=['schemaVersion','model','rulesetVersion','template','townWinPrior','scale','placementMatches','placementBudget','settledBudget','forfeitMinimumLoss','cooldownMs','ratingMinimum','ratingMaximum','inactivity','platformAbort','evidenceSHA256'];
  if(!exact(value,keys)||value.schemaVersion!==1||value.model!=='faction-elo-2'||value.rulesetVersion!==1||value.template!=='classic8-6town-2mafia'
    ||!Number.isFinite(value.townWinPrior)||value.townWinPrior<0.2||value.townWinPrior>0.8||value.scale!==400
    ||value.placementMatches!==10||value.placementBudget!==32||value.settledBudget!==16||value.forfeitMinimumLoss!==16
    ||value.cooldownMs!==900000||value.ratingMinimum!==0||value.ratingMaximum!==3000||value.inactivity!=='no-decay'
    ||value.platformAbort!=='no-rating'||!hex(value.evidenceSHA256))issue();
  return Object.freeze({...value});
}
export function makeMafiaRatingPolicy(townWinPrior,evidenceSHA256){
  return validateMafiaRatingPolicy({schemaVersion:1,model:'faction-elo-2',rulesetVersion:1,template:'classic8-6town-2mafia',
    townWinPrior:Math.round(townWinPrior*1e8)/1e8,scale:400,placementMatches:10,placementBudget:32,settledBudget:16,
    forfeitMinimumLoss:16,cooldownMs:900000,ratingMinimum:0,ratingMaximum:3000,inactivity:'no-decay',platformAbort:'no-rating',evidenceSHA256});
}
export function expectedMafiaTownScore(townMean,mafiaMean,policy=MAFIA_BASE_RATING_POLICY){
  const checked=validateMafiaRatingPolicy(policy);
  if(![townMean,mafiaMean].every(value=>Number.isFinite(value)&&value>=0&&value<=3000))issue();
  const prior=checked.model==='preview-elo-1'?0.5:checked.townWinPrior;
  return 1/(1+Math.exp(-(Math.log(prior/(1-prior))+(townMean-mafiaMean)*Math.LN10/400)));
}
export function ratingDeltasForPolicy(results,ratings,policy=MAFIA_BASE_RATING_POLICY,{draw=false,technicalAbort=false}={}){
  const checked=validateMafiaRatingPolicy(policy);
  if(checked.model==='preview-elo-1')return technicalAbort?new Map(results.map(row=>[row.userId,0])):rankedMatchDeltas(results,ratings);
  if(!Array.isArray(results)||results.length!==8||new Set(results.map(row=>row.userId)).size!==8||new Set(results.map(row=>row.playerId)).size!==8
    ||results.some(row=>typeof row.userId!=='string'||typeof row.playerId!=='string'||!['town','mafia'].includes(row.faction)||typeof row.won!=='boolean'||typeof row.forfeited!=='boolean'))issue();
  const get=id=>ratings.get(id)||{rating:1000,games:0};
  if(results.some(row=>{const state=get(row.userId);return !Number.isInteger(state.rating)||state.rating<0||state.rating>3000||!Number.isSafeInteger(state.games)||state.games<0;}))issue();
  const team=faction=>results.filter(row=>row.faction===faction).sort((a,b)=>a.playerId<b.playerId?-1:a.playerId>b.playerId?1:0);
  const town=team('town'),mafia=team('mafia');if(town.length!==6||mafia.length!==2)issue();
  if(technicalAbort)return new Map(results.map(row=>[row.userId,0]));
  const winners=results.filter(row=>row.won);
  const winningFactions=new Set(winners.map(row=>row.faction));
  if(draw?winners.length!==0:winningFactions.size!==1||results.some(row=>row.won!==(row.faction===winners[0]?.faction&&!row.forfeited)))issue();
  const mean=rows=>rows.reduce((sum,row)=>sum+get(row.userId).rating,0)/rows.length;
  const expected=expectedMafiaTownScore(mean(town),mean(mafia),checked),score=draw?0.5:town.some(row=>row.won)?1:0;
  const coefficient=results.some(row=>get(row.userId).games<checked.placementMatches)?checked.placementBudget:checked.settledBudget;
  const budget=Math.round(coefficient*(score-expected)),out=new Map();
  for(const [rows,total]of [[town,budget],[mafia,-budget]]){
    const base=Math.trunc(total/rows.length),remainder=total-base*rows.length;
    rows.forEach((row,index)=>{const before=get(row.userId).rating,normal=base+(index<Math.abs(remainder)?Math.sign(remainder):0);
      const delta=row.forfeited?Math.min(-checked.forfeitMinimumLoss,normal):normal;
      out.set(row.userId,Math.max(checked.ratingMinimum,Math.min(checked.ratingMaximum,before+delta))-before);
    });
  }
  return out;
}
