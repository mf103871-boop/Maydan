import { all,first,stmt } from './lamma/common.mjs';
import { fail } from './room-model.mjs';
import { json,readJson } from './protocol.mjs';
import { requireSession } from './accounts/session.mjs';
import { isModerator,liveAccountSql } from './moderation/access.mjs';
import { MAFIA_BASE_RATING_POLICY,canonicalMafiaRatingValue,validateMafiaRatingPolicy } from './mafia-rating-policy.mjs';
import { calibrateMafiaRating,mafiaRatingSHA256,MAFIA_RATING_EXPORT_SQL } from './mafia-rating-calibration.mjs';

const preview=env=>String(env.APP_ORIGIN)==='https://maydan-mafia-preview.mf103871.workers.dev'&&String(env.MAFIA_RANKED_ENABLED)==='1';
const actorSql=`EXISTS(SELECT 1 FROM sessions s WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND (s.revoked_at IS NULL OR s.revoked_at>?) AND ${liveAccountSql('s.user_id')})`;
const args=(actor,now)=>[actor.sessionId,actor.userId,now,now];
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
export const mafiaRatingPolicySHA256=policy=>mafiaRatingSHA256(validateMafiaRatingPolicy(policy));
async function authorized(env,actor){
  if(!preview(env)||!isModerator(env,actor?.userId)||!await first(env,`SELECT 1 WHERE ${actorSql}`,...args(actor,Date.now())))fail('NOT_FOUND',404);
}
async function verifyLedgerSamples(env,dataset){
  const refs=dataset.matches.map(row=>row.sampleRef);
  const rows=await all(env,`SELECT * FROM (${MAFIA_RATING_EXPORT_SQL}) WHERE sampleRef IN (SELECT value FROM json_each(?))`,JSON.stringify(refs));
  if(rows.length!==dataset.matches.length)fail('MAFIA_CALIBRATION_LEDGER_MISMATCH',409);
  const source=new Map(rows.map(row=>[row.sampleRef,row]));
  for(const row of dataset.matches){const stored=source.get(row.sampleRef);
    if(!stored||['at','outcome','forfeits','netRatingDelta','seats'].some(key=>stored[key]!==row[key])
      ||Math.abs(stored.townMeanBefore-row.townMeanBefore)>1e-6||Math.abs(stored.mafiaMeanBefore-row.mafiaMeanBefore)>1e-6)fail('MAFIA_CALIBRATION_LEDGER_MISMATCH',409);
  }
}
export async function publishMafiaRatingPolicy(env,actor,body){
  await authorized(env,actor);
  if(!fields(body,['dataset','reviewAcknowledged'])||body.reviewAcknowledged!==true)fail('INVALID');
  let calibrated;try{calibrated=await calibrateMafiaRating(body.dataset);}catch{fail('MAFIA_CALIBRATION_INVALID',400);}
  const {dataset,report,policy}=calibrated;
  if(!policy||report.blockerCodes.length)fail('MAFIA_CALIBRATION_INSUFFICIENT',409);
  // Recompute the proposed prior on server-owned ledger outcomes. Human labels
  // still require the moderator's explicit attestation; these rows cannot prove
  // whether an actual person or a synthetic client occupied every seat.
  await verifyLedgerSamples(env,dataset);
  const policyJson=canonicalMafiaRatingValue(policy),reportJson=canonicalMafiaRatingValue(report),id=await mafiaRatingSHA256(policy);
  const reportHash=await mafiaRatingSHA256(report),now=Date.now();
  const ledgerCurrent=`NOT EXISTS(SELECT 1 FROM json_each(?) sample LEFT JOIN (${MAFIA_RATING_EXPORT_SQL}) ledger
    ON ledger.sampleRef=json_extract(sample.value,'$.sampleRef') WHERE ledger.sampleRef IS NULL
      OR ledger.at!=json_extract(sample.value,'$.at') OR ledger.outcome!=json_extract(sample.value,'$.outcome')
      OR ledger.forfeits!=json_extract(sample.value,'$.forfeits') OR ledger.netRatingDelta!=json_extract(sample.value,'$.netRatingDelta')
      OR ledger.seats!=json_extract(sample.value,'$.seats')
      OR ABS(ledger.townMeanBefore-json_extract(sample.value,'$.townMeanBefore'))>0.000001
      OR ABS(ledger.mafiaMeanBefore-json_extract(sample.value,'$.mafiaMeanBefore'))>0.000001)`;
  await env.DB.batch([stmt(env,`INSERT OR IGNORE INTO mafia_rating_policies(id,policy_json,report_json,report_sha256,dataset_sha256,status,created_at,created_by)
    SELECT ?,?,?,?,?,'reviewed-supplied-evidence',?,? WHERE ${actorSql} AND ${ledgerCurrent}`,id,policyJson,reportJson,reportHash,report.provenance.inputSHA256,now,actor.userId,...args(actor,now),JSON.stringify(dataset.matches))]);
  await authorized(env,actor);
  const stored=await first(env,`SELECT id,policy_json,report_sha256 FROM mafia_rating_policies WHERE id=? AND ${actorSql}`,id,...args(actor,Date.now()));
  if(!stored||stored.policy_json!==policyJson||stored.report_sha256!==reportHash)fail('MAFIA_RATING_POLICY_CONFLICT',409);
  return {id,model:policy.model,status:'reviewed-supplied-evidence',reportSHA256:reportHash,datasetSHA256:report.provenance.inputSHA256,
    humanLabels:'moderator-attested-not-independently-verified',active:false,productionReady:false};
}
export async function bindMafiaSeasonRatingPolicy(env,actor,body){
  await authorized(env,actor);
  if(!fields(body,['seasonId','policyId'])||typeof body.seasonId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(body.seasonId)||!/^[a-f0-9]{64}$/.test(body.policyId||''))fail('INVALID');
  const policy=await first(env,'SELECT * FROM mafia_rating_policies WHERE id=?',body.policyId);
  if(!policy||policy.status!=='reviewed-supplied-evidence')fail('NOT_FOUND',404);
  let checked;try{checked=validateMafiaRatingPolicy(JSON.parse(policy.policy_json));}catch{fail('MAFIA_RATING_POLICY_INVALID',409);}
  if(checked.model!=='faction-elo-2'||await mafiaRatingSHA256(checked)!==body.policyId)fail('MAFIA_RATING_POLICY_INVALID',409);
  const now=Date.now();
  // A D1 write may wait past the season start. Its transaction clock, not only
  // the request's earlier timestamp, must still place this binding before it.
  await env.DB.batch([stmt(env,`INSERT OR IGNORE INTO mafia_ranked_season_policy(season_id,policy_id,linked_at,linked_by)
    SELECT z.id,?,?,? FROM mafia_ranked_seasons z WHERE z.id=? AND z.status='open'
      AND z.starts_at>MAX(?,CAST(unixepoch('subsec')*1000 AS INTEGER))
      AND z.ruleset_version=1 AND z.rating_model='preview-elo-1'
      AND NOT EXISTS(SELECT 1 FROM mafia_ranked_matches m WHERE m.season_id=z.id)
      AND NOT EXISTS(SELECT 1 FROM mafia_ranked_queue q WHERE q.season_id=z.id)
      AND EXISTS(SELECT 1 FROM mafia_rating_policies p WHERE p.id=? AND p.policy_json=? AND p.status='reviewed-supplied-evidence') AND ${actorSql}`,
    body.policyId,now,actor.userId,body.seasonId,now,body.policyId,policy.policy_json,...args(actor,now))]);
  const bound=await first(env,`SELECT policy_id FROM mafia_ranked_season_policy WHERE season_id=? AND ${actorSql}`,body.seasonId,...args(actor,Date.now()));
  if(!bound||bound.policy_id!==body.policyId)fail('MAFIA_RATING_SEASON_FIXED',409);
  return {seasonId:body.seasonId,policyId:body.policyId,model:checked.model,status:'bound-before-season',productionReady:false};
}
export async function resolveMafiaSeasonRatingPolicy(env,season){
  if(!season||season.ruleset_version!==1||season.rating_model!=='preview-elo-1')fail('MAFIA_RATING_POLICY_INVALID',503);
  const row=await first(env,`SELECT b.policy_id,p.policy_json,p.status FROM mafia_ranked_season_policy b JOIN mafia_rating_policies p ON p.id=b.policy_id WHERE b.season_id=?`,season.id);
  if(!row)return MAFIA_BASE_RATING_POLICY;
  let policy;try{policy=validateMafiaRatingPolicy(JSON.parse(row.policy_json));}catch{fail('MAFIA_RATING_POLICY_INVALID',503);}
  if(row.status!=='reviewed-supplied-evidence'||policy.model!=='faction-elo-2'||await mafiaRatingSHA256(policy)!==row.policy_id)fail('MAFIA_RATING_POLICY_INVALID',503);
  return policy;
}
export async function routeMafiaRatingPolicy(request,env,url=new URL(request.url),charge){
  if(!['/api/mafia/rating-policy','/api/mafia/rating-policy/bind'].includes(url.pathname))return null;
  const {user,session}=await requireSession(env,request,{rotate:false}),actor={userId:user.id,sessionId:session.id};
  await authorized(env,actor);if(charge)await charge('socialWrite','RATE_LIMIT',user.id);
  if(request.method!=='POST')fail('NOT_FOUND',404);
  const body=await readJson(request,256*1024);
  return json(url.pathname.endsWith('/bind')?await bindMafiaSeasonRatingPolicy(env,actor,body):await publishMafiaRatingPolicy(env,actor,body));
}
export function mafiaRatingPolicyDeleteStatements(env,id){return [stmt(env,'UPDATE mafia_rating_policies SET created_by=NULL WHERE created_by=?',id),stmt(env,'UPDATE mafia_ranked_season_policy SET linked_by=NULL WHERE linked_by=?',id)];}
