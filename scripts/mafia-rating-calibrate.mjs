// Offline authoring only: no database, subprocess, credentials or network.
// Local output files are created exclusively; an existing artifact is never
// overwritten implicitly. Do not label synthetic ledger fixtures as human.
import { readFile,writeFile,stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calibrateMafiaRating,normalizeMafiaRatingDataset,mafiaRatingSHA256,MAFIA_RATING_EXPORT_SQL } from '../server/mafia-rating-calibration.mjs';

async function load(file){if(!file||(await stat(file)).size>1024*1024)throw new Error('MAFIA_CALIBRATION_INPUT_SIZE');return JSON.parse(await readFile(file,'utf8'));}
async function save(file,value,inputFiles=[]){
  if(!file||inputFiles.some(input=>path.resolve(input)===path.resolve(file)))throw new Error('MAFIA_CALIBRATION_OUTPUT_PATH');
  await writeFile(file,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx'});
}
function rowsOf(value){
  if(Array.isArray(value)&&value.every(row=>row&&typeof row==='object'&&Object.hasOwn(row,'sampleRef')))return value;
  const groups=Array.isArray(value)?value:value?.success===true&&Array.isArray(value.result)?value.result:null;
  if(!groups||!groups.every(group=>group&&Array.isArray(group.results)))throw new Error('MAFIA_CALIBRATION_EXPORT_SHAPE');
  return groups.flatMap(group=>group.results);
}
export async function runMafiaRatingCalibration(argv=[]){
  const options={},allowed=new Set(['--input','--output','--candidate','--export-plan','--wrap-export','--provenance','--evidence-kind']);
  for(let index=0;index<argv.length;index+=2){const flag=argv[index];if(!allowed.has(flag)||Object.hasOwn(options,flag)||typeof argv[index+1]!=='string')throw new Error('MAFIA_CALIBRATION_ARGUMENT');options[flag]=argv[index+1];}
  if(options['--export-plan']){
    if(Object.keys(options).length!==1)throw new Error('MAFIA_CALIBRATION_ARGUMENT');
    const plan={schemaVersion:1,kind:'mafia-rating-aggregate-export-plan',querySHA256:await mafiaRatingSHA256(MAFIA_RATING_EXPORT_SQL),
      sql:MAFIA_RATING_EXPORT_SQL,params:[],maxRows:1000,readOnly:true,executed:false,
      limitations:['Run only against the explicitly reviewed preview database.','The query cannot establish whether seats were human.','No credentials or Cloudflare access is used by this authoring tool.']};
    await save(options['--export-plan'],plan);return {kind:plan.kind,file:options['--export-plan'],executed:false};
  }
  if(options['--wrap-export']){
    if(options['--input']||options['--candidate']||!options['--provenance']||!options['--output'])throw new Error('MAFIA_CALIBRATION_ARGUMENT');
    const evidenceKind=options['--evidence-kind']||'unknown';
    if(!['unknown','synthetic','real-human'].includes(evidenceKind))throw new Error('MAFIA_CALIBRATION_ARGUMENT');
    const dataset=normalizeMafiaRatingDataset({schemaVersion:1,kind:'mafia-rating-dataset',evidenceKind,
      provenance:await load(options['--provenance']),matches:rowsOf(await load(options['--wrap-export'])).map(row=>({...row,allHuman:false}))});
    await save(options['--output'],dataset,[options['--wrap-export'],options['--provenance']]);
    return {kind:dataset.kind,file:options['--output'],samples:dataset.matches.length,humanLabels:'unset-requires-real-session-review'};
  }
  if(!options['--input']||!options['--output']||options['--provenance']||options['--evidence-kind'])throw new Error('MAFIA_CALIBRATION_ARGUMENT');
  const {report,policy}=await calibrateMafiaRating(await load(options['--input']));
  if(options['--candidate']&&path.resolve(options['--candidate'])===path.resolve(options['--output']))throw new Error('MAFIA_CALIBRATION_OUTPUT_PATH');
  await save(options['--output'],report,[options['--input']]);
  if(options['--candidate'])await save(options['--candidate'],{schemaVersion:1,kind:'mafia-rating-policy-candidate',status:report.status,
    policy,policySHA256:report.policySHA256,reportSHA256:await mafiaRatingSHA256(report),inputSHA256:report.provenance.inputSHA256,
    requiresModeratorReview:true,active:false,calibrated:false,ready:false},[options['--input'],options['--output']]);
  return {kind:report.kind,file:options['--output'],status:report.status,samples:report.samples,blockerCodes:report.blockerCodes,policySHA256:report.policySHA256,calibrated:false,ready:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runMafiaRatingCalibration(process.argv.slice(2)),null,2));}
  catch(error){console.error(error?.code==='EEXIST'?'MAFIA_CALIBRATION_OUTPUT_EXISTS':/^MAFIA_[A-Z_]+$/.test(error?.message||'')?error.message:'MAFIA_CALIBRATION_FAILED');process.exitCode=1;}
}
