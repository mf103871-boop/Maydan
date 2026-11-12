import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIAL_LESSONS, TUTORIAL_DIALOGUE, TUTORIAL_HUMAN_ID } from '../src/games/mafia/tutorial/scenario.mjs';
import { createMafiaTutorial } from '../src/games/mafia/tutorial/adapter.mjs';
import { MAFIA_LABS, LAB_HUMAN, labActors } from '../src/games/mafia/tutorial/labs/scenarios.mjs';
import { createMafiaLab } from '../src/games/mafia/tutorial/labs/adapter.mjs';
import { localizeLessonText, localizeTutorialView } from '../src/games/mafia/tutorial/localize.js';

const english = text => { if (text !== undefined) assert.doesNotMatch(text, /[\u0600-\u06ff]/u); };
test('every authored tutorial lesson, answer choice and scripted dialogue has an English presentation', () => {
  for(const lesson of Object.values(TUTORIAL_LESSONS)){
    for(const field of ['title','text','buttonLabel'])english(localizeLessonText(lesson[field],'en'));
    for(const choice of lesson.choices||[])english(localizeLessonText(choice.label,'en'));
  }
  for(const lines of Object.values(TUTORIAL_DIALOGUE))for(const [,text]of lines)english(localizeLessonText(text,'en'));
});

test('changing tutorial presentation preserves a learner message, decisions, IDs and restore checkpoint', async () => {
  const tutorial=createMafiaTutorial();tutorial.guide('continue');
  const learnerText='ليان — رسالة كتبها اللاعب';await tutorial.act('chat',{text:learnerText,channel:'public'});
  tutorial.guide('voice-joined');tutorial.guide('voice-unmuted');await tutorial.act('ready',{ready:true});await tutorial.act('start');tutorial.guide('role-open');tutorial.guide('role-close');
  await tutorial.act('chat',{text:learnerText,channel:'public'});
  const raw=tutorial.getState(),saved=tutorial.exportProgress();
  const localized=localizeTutorialView(raw,TUTORIAL_HUMAN_ID,'en');
  assert.deepEqual(tutorial.getState(),raw);assert.deepEqual(tutorial.exportProgress(),saved);
  assert.equal(localizeTutorialView(raw,TUTORIAL_HUMAN_ID,'ar'),raw);
  assert.deepEqual(localized.snapshot.members.map(p=>p.id),raw.snapshot.members.map(p=>p.id));
  assert.ok(localized.snapshot.members.some(p=>p.name==='Layan'));
  const human=localized.snapshot.chats.public.find(m=>m.playerId===TUTORIAL_HUMAN_ID);
  assert.equal(human.text,learnerText);
  const bots=localized.snapshot.chats.public.filter(m=>m.playerId!==TUTORIAL_HUMAN_ID);assert.ok(bots.length>0);bots.forEach(m=>english(m.text));
  const restored=createMafiaTutorial({progress:saved});assert.equal(restored.getState().coach.stepId,raw.coach.stepId);
  assert.equal(localized.snapshot.you.roleId,raw.snapshot.you.roleId);assert.deepEqual(localized.snapshot.you.resources,raw.snapshot.you.resources);
});

for(const course of Object.keys(MAFIA_LABS))test(`English ${course} exercise uses unchanged real decisions and translates each dynamic lesson`,async()=>{
  const lab=createMafiaLab({courseId:course}),by=role=>labActors(course).find(actor=>actor.roleId===role)?.id;
  const targets={self:LAB_HUMAN,protect:by('investigator'),repeat:by('citizen'),mask:by('mafia'),block:by('doctor'),shield:by('guard'),investigate:by('mafia'),'after-conversion':by('citizen'),trace:by('doctor'),'trace-quiet':by('investigator'),'trace-blocked':by('doctor')};
  for(let steps=0;steps<20;steps++){
    const raw=lab.getState(),saved=lab.exportProgress(),view=localizeTutorialView(raw,LAB_HUMAN,'en',MAFIA_LABS[course].title);
    english(view.coach.title);english(view.coach.text);english(view.coach.buttonLabel);english(view.snapshot.settings.roomName);
    assert.deepEqual(lab.getState(),raw);assert.deepEqual(lab.exportProgress(),saved);
    if(raw.status==='completed')return;
    const step=raw.coach.stepId;
    const accepted=targets[step]?await lab.act('night_action',{targetId:targets[step]}):step==='nominate'?await lab.act('nominate',{targetId:null}):lab.guide(['recruit','verdict'].includes(step)?'abstain':'continue');
    assert.equal(accepted,true);assert.equal(lab.getState().feedback,null);
  }
  assert.fail('Exercise did not complete');
});
