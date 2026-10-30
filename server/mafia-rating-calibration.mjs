import { canonicalMafiaRatingValue,makeMafiaRatingPolicy } from './mafia-rating-policy.mjs';

export const MAFIA_RATING_CALIBRATION_VERSION=1;
export const MAFIA_RATING_SAMPLE_LIMIT=1000;
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const allowed=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
const invalid=()=>{throw new TypeError('MAFIA_CALIBRATION_INVALID');};
const round=value=>Math.round(value*1e8)/1e8;
export async function mafiaRatingSHA256(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:canonicalMafiaRatingValue(value)));return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');}

// This export contains match aggregates only: no users, seats, roles, chat,
// tokens, audio, room codes or microphone/provider metadata. allHuman must be
// attested separately against actual session records; the ledger cannot tell.
export const MAFIA_RATING_EXPORT_SQL=`SELECT
  COALESCE(m.event_digest,REPLACE(m.match_key,'-','')) AS sampleRef,m.created_at AS at,
  CASE WHEN m.status='aborted' THEN 'technical_abort'
    WHEN SUM(CASE WHEN r.faction='town' THEN r.won ELSE 0 END)>0 AND SUM(CASE WHEN r.faction='mafia' THEN r.won ELSE 0 END)=0 THEN 'town'
    WHEN SUM(CASE WHEN r.faction='mafia' THEN r.won ELSE 0 END)>0 AND SUM(CASE WHEN r.faction='town' THEN r.won ELSE 0 END)=0 THEN 'mafia'
    WHEN SUM(r.won)>0 THEN 'invalid' ELSE 'draw' END AS outcome,
  COALESCE(AVG(CASE WHEN r.faction='town' THEN r.before_rating END),1000) AS townMeanBefore,
  COALESCE(AVG(CASE WHEN r.faction='mafia' THEN r.before_rating END),1000) AS mafiaMeanBefore,
  COALESCE(SUM(r.forfeited),0) AS forfeits,COALESCE(SUM(r.delta),0) AS netRatingDelta,
  COUNT(r.user_id) AS seats,0 AS allHuman
FROM mafia_ranked_matches m JOIN mafia_ranked_seasons z ON z.id=m.season_id
LEFT JOIN mafia_ranked_receipts r ON r.match_key=m.match_key AND r.season_id=m.season_id
WHERE m.status IN ('completed','aborted') AND z.ruleset_version=1
  AND z.rating_model='preview-elo-1'
  AND NOT EXISTS(SELECT 1 FROM mafia_ranked_season_policy b WHERE b.season_id=z.id)
GROUP BY m.match_key ORDER BY m.created_at,m.match_key LIMIT 1000`;

export function normalizeMafiaRatingDataset(value){
  if(!allowed(value,['schemaVersion','kind','evidenceKind','provenance','matches'])||value.schemaVersion!==1||value.kind!=='mafia-rating-dataset'
    ||!['real-human','synthetic','unknown'].includes(value.evidenceKind)||!Array.isArray(value.matches)||value.matches.length>MAFIA_RATING_SAMPLE_LIMIT
    ||!allowed(value.provenance,['sourceCommit','workerVersion','migrationSetSHA256','querySHA256','exportedAt']))invalid();
  const p=value.provenance;
  if(!/^[a-f0-9]{40}$/.test(p.sourceCommit||'')||typeof p.workerVersion!=='string'||!/^[a-f0-9-]{36}$/.test(p.workerVersion)
    ||!hash(p.migrationSetSHA256)||!hash(p.querySHA256)||typeof p.exportedAt!=='string'||!Number.isFinite(Date.parse(p.exportedAt)))invalid();
  const seen=new Set();
  const matches=value.matches.map(row=>{
    if(!allowed(row,['sampleRef','at','outcome','townMeanBefore','mafiaMeanBefore','forfeits','netRatingDelta','seats','allHuman'])
      ||typeof row.sampleRef!=='string'||!/^[a-f0-9]{16,64}$/.test(row.sampleRef)||seen.has(row.sampleRef)
      ||!Number.isSafeInteger(row.at)||row.at<=0||!['town','mafia','draw','technical_abort'].includes(row.outcome)
      ||![row.townMeanBefore,row.mafiaMeanBefore].every(n=>Number.isFinite(n)&&n>=0&&n<=3000)
      ||!Number.isInteger(row.forfeits)||row.forfeits<0||row.forfeits>8||!Number.isInteger(row.netRatingDelta)||Math.abs(row.netRatingDelta)>256
      ||!Number.isInteger(row.seats)||row.seats<0||row.seats>8||![true,false,0,1].includes(row.allHuman))invalid();
    seen.add(row.sampleRef);
    return {sampleRef:row.sampleRef,at:row.at,outcome:row.outcome,townMeanBefore:round(row.townMeanBefore),mafiaMeanBefore:round(row.mafiaMeanBefore),
      forfeits:row.forfeits,netRatingDelta:row.netRatingDelta,seats:row.seats,allHuman:row.allHuman===true||row.allHuman===1};
  }).sort((a,b)=>a.at-b.at||(a.sampleRef<b.sampleRef?-1:a.sampleRef>b.sampleRef?1:0));
  return {schemaVersion:1,kind:'mafia-rating-dataset',evidenceKind:value.evidenceKind,provenance:{...p},matches};
}
export function wilsonMafiaInterval(successes,count){
  if(!count)return null;
  const z=1.959963984540054,p=successes/count,denominator=1+z*z/count;
  const center=(p+z*z/(2*count))/denominator,margin=z*Math.sqrt(p*(1-p)/count+z*z/(4*count*count))/denominator;
  return {level:0.95,lower:round(center-margin),upper:round(center+margin),halfWidth:round(margin)};
}
const score=row=>row.outcome==='town'?1:row.outcome==='mafia'?0:0.5;
function fitPrior(rows){
  // Fit one intercept with a fixed Elo scale on the chronological training set.
  // A Beta(1,1) regularizer contributes one virtual win and one virtual loss;
  // neither virtual result is counted as a human observation.
  let low=-8,high=8;
  for(let iteration=0;iteration<80;iteration++){
    const middle=(low+high)/2,prior=1/(1+Math.exp(-middle));
    const gradient=rows.reduce((sum,row)=>sum+score(row)-1/(1+Math.exp(-(middle+(row.townMeanBefore-row.mafiaMeanBefore)*Math.LN10/400))),1-2*prior);
    if(gradient>0)low=middle;else high=middle;
  }
  return 1/(1+Math.exp(-(low+high)/2));
}
function performance(rows,prior){
  if(!rows.length)return null;
  const bins=Array.from({length:5},(_,index)=>({lower:index/5,upper:(index+1)/5,count:0,predicted:0,observed:0}));
  let baselineBrier=0,candidateBrier=0,baselineExpected=0,candidateExpected=0,observed=0;
  for(const row of rows){const baseline=1/(1+10**((row.mafiaMeanBefore-row.townMeanBefore)/400));
    const candidate=1/(1+Math.exp(-(Math.log(prior/(1-prior))+(row.townMeanBefore-row.mafiaMeanBefore)*Math.LN10/400))),actual=score(row);
    baselineBrier+=(baseline-actual)**2;candidateBrier+=(candidate-actual)**2;baselineExpected+=baseline;candidateExpected+=candidate;observed+=actual;
    const bin=bins[Math.min(4,Math.floor(candidate*5))];bin.count++;bin.predicted+=candidate;bin.observed+=actual;
  }
  return {count:rows.length,baselineBrier:round(baselineBrier/rows.length),candidateBrier:round(candidateBrier/rows.length),
    baselineExpected:round(baselineExpected/rows.length),candidateExpected:round(candidateExpected/rows.length),observedTownScore:round(observed/rows.length),
    bins:bins.map(bin=>({...bin,predicted:bin.count?round(bin.predicted/bin.count):null,observed:bin.count?round(bin.observed/bin.count):null}))};
}
export async function calibrateMafiaRating(value){
  const dataset=normalizeMafiaRatingDataset(value),querySHA256=await mafiaRatingSHA256(MAFIA_RATING_EXPORT_SQL);
  const inputSHA256=await mafiaRatingSHA256(dataset);
  const eligible=dataset.matches.filter(row=>row.allHuman&&row.seats===8&&row.forfeits===0&&row.outcome!=='technical_abort');
  const split=Math.floor(eligible.length*0.8),training=eligible.slice(0,split),holdout=eligible.slice(split);
  const townWins=eligible.filter(row=>row.outcome==='town').length,mafiaWins=eligible.filter(row=>row.outcome==='mafia').length,draws=eligible.length-townWins-mafiaWins;
  const decisive=townWins+mafiaWins,interval=wilsonMafiaInterval(townWins,decisive),fitted=training.length?fitPrior(training):null;
  const measured=fitted==null?null:performance(holdout,fitted),blockerCodes=[];
  if(dataset.evidenceKind!=='real-human')blockerCodes.push('HUMAN_EVIDENCE_NOT_ATTESTED');
  if(dataset.provenance.querySHA256!==querySHA256)blockerCodes.push('EXPORT_QUERY_MISMATCH');
  if(eligible.length<100)blockerCodes.push('HUMAN_MATCH_SAMPLE_BELOW_100');
  if(training.length<80||holdout.length<20)blockerCodes.push('CHRONOLOGICAL_SPLIT_TOO_SMALL');
  if(!interval||interval.halfWidth>0.1)blockerCodes.push('FACTION_INTERVAL_TOO_WIDE');
  if(fitted==null||fitted<0.2||fitted>0.8)blockerCodes.push('FACTION_PRIOR_OUTSIDE_REVIEW_RANGE');
  if(measured&&measured.candidateBrier>measured.baselineBrier+0.02)blockerCodes.push('HOLDOUT_BRIER_REGRESSION');
  const policy=blockerCodes.length?null:makeMafiaRatingPolicy(fitted,inputSHA256),policySHA256=policy?await mafiaRatingSHA256(policy):null;
  const sum=rows=>rows.reduce((total,row)=>total+row.netRatingDelta,0),ordinary=dataset.matches.filter(row=>row.seats===8&&!row.forfeits&&row.outcome!=='technical_abort');
  const report={schemaVersion:1,kind:'mafia-rating-calibration-report',rulesetVersion:1,template:'classic8-6town-2mafia',baselineModel:'preview-elo-1',candidateModel:'faction-elo-2',
    evidenceKind:dataset.evidenceKind,evidenceAuthentication:'operator-supplied-unverified',
    provenance:{...dataset.provenance,inputSHA256},samples:{total:dataset.matches.length,eligible:eligible.length,training:training.length,holdout:holdout.length,
      forfeited:dataset.matches.filter(row=>row.forfeits>0).length,technicalAborts:dataset.matches.filter(row=>row.outcome==='technical_abort').length},
    faction:{townWins,mafiaWins,draws,decisiveTownWinRate:decisive?round(townWins/decisive):null,decisiveTownWilson95:interval,fittedTownPrior:fitted==null?null:round(fitted)},
    holdout:measured,inflation:{netDelta:sum(dataset.matches),ordinaryNetDelta:sum(ordinary),ordinaryNonzeroMatches:ordinary.filter(row=>row.netRatingDelta!==0).length,
      note:'Bounds and explicit forfeit penalties can break conservation; aggregates cannot identify individual floor/ceiling attribution.'},
    policies:{inactivity:'no-decay',platformAbort:'no-rating',naturalElimination:'retain-result',forfeit:'minimum-16-point-loss-and-15-minute-cooldown',textCompletion:'normal-result'},
    status:policy?'candidate-needs-review':'insufficient-evidence',blockerCodes,policySHA256,calibrated:false,ready:false,liveVerified:false,
    limitations:['Operator human labels and provenance are not authenticated by an offline tool.','A minimum sample is an initial signal, not acceptance of fun, fairness, comprehension or voice safety.','The holdout is chronological and never used to fit the faction prior.','No automatic production activation, rank-boundary tuning or current-season mutation.']};
  return {dataset,report,policy};
}
