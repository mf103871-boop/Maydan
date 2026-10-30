import React,{useEffect,useState} from 'react';
import {Button} from '../../../../shared/ui/components.jsx';
import {navigate} from '../../../../platform/router.js';
import {useLamma} from '../../../../social/LammaProvider.jsx';
import {TutorialSession} from '../MafiaTutorial.jsx';
import {MAFIA_LABS,LAB_HUMAN} from './scenarios.mjs';
import {createMafiaLab} from './adapter.mjs';
import {useLabProgress,readLabRecord} from './progress.js';
import css from '../tutorial.css';
import noirCss from '../../../../online/mafia.css';

const hub='/tutorial/mafia?labs=1';
export function MafiaLabs({courseId}) {
  const selected=Object.hasOwn(MAFIA_LABS,courseId)?courseId:null;
  const context=useLabProgress(selected||'doctor'),lamma=useLamma();
  const key=`${context.owner}:${context.generation}:${selected}`,[choice,setChoice]=useState({key:null,mode:null});
  useEffect(()=>{if(context.record&&choice.key!==key)setChoice({key,mode:context.record.progress?'prompt':'new'});},[context.record,choice.key,key]);
  if(!context.owner||!context.record)return <p role="status">نجهّز التدريب المحلي…</p>;
  if(lamma?.activeCall?.scope==='mafia')return <section dir="rtl"><p>أكمل مجلس مافيا الحالي أولًا. التدريب لا يغيّر اتصالاتك.</p><Button onClick={()=>navigate('/online/mafia')}>إلى المجلس</Button></section>;
  if(!selected)return <section className="mafia-noir mafia-tutorial-resume" dir="rtl" aria-label="تمارين تخصص مافيا"><style>{noirCss}{css}</style><h1>تمارين التخصص</h1><p>شخصيات محلية وقرارات قصيرة. دون لاعبين حقيقيين أو ميكروفون أو XP.</p>
    {Object.entries(MAFIA_LABS).map(([id,lab])=>{let store;try{store=globalThis.localStorage;}catch{/* memory fallback */}const record=readLabRecord(store,context.owner,id);
      return <article key={id}><h2>{lab.title}</h2><p>{lab.description}</p><Button onClick={()=>navigate('/tutorial/mafia?lab='+id)}>{record.status==='completed'?'أعد التمرين':record.progress?'استكمل':'ابدأ التمرين'}</Button></article>;})}
    <Button variant="ghost" onClick={()=>navigate('/tutorial/mafia')}>درس أول ليلة الكامل</Button><Button variant="ghost" onClick={()=>navigate('/online/mafia')}>إلى الغرف</Button></section>;
  const mode=choice.key===key?choice.mode:null;
  if(!mode)return <p role="status">نجهّز التمرين…</p>;
  if(mode==='prompt')return <section className="mafia-noir mafia-tutorial-resume" dir="rtl"><style>{noirCss}{css}</style><h1>{MAFIA_LABS[selected].title}</h1><p>عندك قرارات محفوظة لهذا التمرين على هذا الجهاز. لا ترتبط بإحصاءات ميدان.</p>
    <Button onClick={()=>setChoice({key,mode:'resume'})}>استكمل التمرين</Button><Button onClick={()=>setChoice({key,mode:'new'})}>ابدأ من جديد</Button><Button variant="ghost" onClick={()=>navigate(hub)}>تمرين آخر</Button></section>;
  return <TutorialSession key={key} owner={context.owner} progress={mode==='new'?null:context.record.progress} update={context.update} mark={context.mark} isCurrentOwner={context.isCurrentOwner}
    factory={({progress})=>createMafiaLab({courseId:selected,progress})} humanId={LAB_HUMAN} title={MAFIA_LABS[selected].title}
    disclosure={`تدريب محلي · ${MAFIA_LABS[selected].roles.length-1} شخصيات تدريب · دون صوت أو XP`} finishTarget={hub} finishLabel="تمرين آخر" privateCover/>;
}
