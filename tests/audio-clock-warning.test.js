import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioEvents } from '../src/shared/fx/audio-events.js';
import { createDeadlineAudio } from '../src/shared/fx/deadline-audio.js';

test('the ordinary warning stays pop; only local candidate mode selects the short clock', () => {
  for (const candidateMode of [false,true]) {
    const calls=[];
    const events=createAudioEvents((cue,options)=>{calls.push({cue,options});return true;},{candidateMode,now:()=>1000});
    assert.equal(events.emit('game.timer-warning',{id:'q1',deadlineAt:5000}),true);
    assert.equal(calls[0].cue,candidateMode?'timerWarning':'pop');
    assert.equal(events.emit('game.timer-warning',{id:'q1',deadlineAt:5000}),false);
  }
});
test('a late or missing deadline cannot start the clock; decode guard reserves the full clip duration', () => {
  let time=1000;const calls=[];
  const events=createAudioEvents((cue,options)=>{calls.push({cue,options});return true;},{candidateMode:true,now:()=>time});
  assert.equal(events.emit('game.timer-warning',{id:'missing'}),false);
  assert.equal(events.emit('game.timer-warning',{id:'late',deadlineAt:1800}),false);
  assert.equal(events.emit('game.timer-warning',{id:'padding-reserve',deadlineAt:1949}),false);
  assert.equal(events.emit('game.timer-warning',{id:'okay',deadlineAt:2000}),true);
  time=1200;assert.equal(calls[0].options.guard(),false);
  assert.equal(events.emit('game.timer-warning',{id:'okay',deadlineAt:9000}),false,'expired cue is consumed, not replayed');
});
test('public deadline warning stops on early answer, pause, end, identity change and unmount', () => {
  let time=0; const calls=[],stops=[];
  const events=createAudioEvents((cue,options)=>{calls.push({cue,options});return true;},{candidateMode:true,now:()=>time});
  const controller=createDeadlineAudio({emit:events.emit,stopCues:ids=>stops.push(ids)},{now:()=>time,warningOnly:true});
  controller.update('public:q1',8);controller.update('public:q1',5);
  assert.equal(calls.length,1);assert.equal(calls[0].cue,'timerWarning');
  controller.update('public:q1',4,{active:false});assert.equal(calls[0].options.guard(),false);
  const n=stops.length;controller.update('public:q1',3);controller.update('public:q1',2);controller.update('public:q1',0);
  assert.equal(calls.length,1);assert.equal(stops.length,n,'a consumed warning does not keep stopping unrelated later audio');
  controller.update('public:q2',7);time=2000;controller.update('public:q2',4);assert.equal(calls.length,2);
  controller.suspend();assert.equal(calls[1].options.guard(),false);
  controller.update('public:q3',10);time=4000;controller.update('public:q3',5);assert.equal(calls.length,3);
  controller.dispose();assert.equal(calls[2].options.guard(),false);
  assert.ok(stops.every(ids=>ids.length===1&&ids[0]==='timerWarning'));
});
test('a silent or inactive deadline controller cannot stop a different active clock owner', () => {
  const stops=[];
  const controller=createDeadlineAudio({stopCues:ids=>stops.push(ids)},{warningOnly:true});
  controller.update(null,0,{active:false});controller.update('preview',4,{hidden:true});controller.suspend();controller.dispose();
  assert.deepEqual(stops,[]);
});
test('last-second jump does not queue a clock; hidden and resumed baselines stay silent', () => {
  let time=0;const calls=[];
  const events=createAudioEvents((cue)=>{calls.push(cue);return true;},{candidateMode:true,now:()=>time});
  const controller=createDeadlineAudio({emit:events.emit},{now:()=>time,warningOnly:true});
  controller.update('q1',8);controller.update('q1',1);assert.deepEqual(calls,[]);
  controller.update('q2',8);controller.update('q2',5,{hidden:true});controller.update('q2',4);assert.deepEqual(calls,[]);
  controller.update('q3',8);controller.update('q3',5);assert.deepEqual(calls,['timerWarning']);
});
