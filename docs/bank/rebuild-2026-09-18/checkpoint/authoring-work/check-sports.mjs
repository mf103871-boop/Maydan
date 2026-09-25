import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {validateBank,normalizeArabic} from 'file:///C:/Users/user/Desktop/maydan/scripts/bank.mjs';
const root='C:/Users/user/Desktop/maydan';
const ids=['sports','football','worldcup','ucl','premier'];
const sp=root+'/src/data/bank-status.json';
const status=JSON.parse(fs.readFileSync(sp,'utf8'));
for(const id of ids){const c=JSON.parse(fs.readFileSync(root+'/src/data/categories/'+id+'.json','utf8'));status.categories[id].counts=Object.fromEntries(status.tiers.map(p=>[p,c.qs.filter(q=>q.p===p).length]));}
fs.writeFileSync(sp,JSON.stringify(status,null,2)+'\n');
const report=[];
for(const id of ids){
 const r=await validateBank(root,{only:id});
 const current=JSON.parse(fs.readFileSync(root+'/src/data/categories/'+id+'.json','utf8'));
 const old=JSON.parse(execFileSync('git',['show','HEAD:src/data/categories/'+id+'.json'],{cwd:root,encoding:'utf8'}));
 const oldTexts=new Set(old.qs.map(q=>normalizeArabic(q.q)));
 const reused=current.qs.filter(q=>oldTexts.has(normalizeArabic(q.q))).map(q=>q.qid);
 report.push({id,errors:r.errors,warnings:r.warnings,reusedQuestionText:reused,categories:r.categories});
 console.log(JSON.stringify({id,errors:r.errors,warnings:r.warnings.length,reusedQuestionText:reused}));
}
fs.writeFileSync('C:/Users/user/Documents/Codex/2026-09-17/my-limmite/work/badeeha-rebuild/sports-validation.json',JSON.stringify(report,null,2)+'\n');
if(report.some(r=>r.errors.length||r.reusedQuestionText.length))process.exitCode=1;
