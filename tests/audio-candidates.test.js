import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';
const PREVIEW = 'https://maydan-mafia-preview.mf103871.workers.dev';
const PRODUCTION = 'https://maydan-game.mf103871.workers.dev';

async function compiled(origin, flag = true) {
  const define = { __MAYDAN_ROOMS_URL__: JSON.stringify(origin) };
  if (flag !== 'absent') define.__MAYDAN_AUDIO_PREVIEW__ = JSON.stringify(flag);
  const built = await build({ stdin: { contents: `export * from './src/shared/fx/audio-candidate-policy.js';export * from './src/shared/fx/audio-candidate-catalog.js';export {resolveAudioScene} from './src/shared/fx/audio-scenes.js';export {createSound,CUE_SAMPLES} from './src/shared/fx/sound.js';`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs', define, logLevel: 'silent' });
  const sandbox = { module: { exports: {} }, exports: {}, console, URL, Date, setTimeout, clearTimeout, setInterval, clearInterval, Response, AbortController,
    location: { origin: PREVIEW, search: '?audioPreview=1' }, localStorage: { getItem: () => '1' } };
  vm.runInNewContext(built.outputFiles[0].text, sandbox);
  return { ...sandbox.module.exports, sandbox };
}

test('private audio requires both release flags and the exact compiled preview origin', async () => {
  for (const [origin, flag, allowed] of [[PREVIEW,true,true],[PREVIEW,false,false],[PREVIEW,'absent',false],
    [PRODUCTION,true,false],['same-origin',true,false],['',true,false],[PREVIEW,1,false]]) {
    const module = await compiled(origin, flag);
    assert.equal(module.isPrivateAudioCandidateBuild(), allowed, `${origin}/${flag}`);
    assert.equal(Object.keys(module.privateCandidateEffects(module.CANDIDATE_EFFECTS)).length, allowed ? 10 : 0);
  }
});

test('candidate metadata rejects malformed, remote, approved or inconsistent entries without promoting them', async () => {
  const module = await compiled(PREVIEW), good = module.CANDIDATE_AUDITIONS.menus;
  assert.equal(module.validPrivateAudioCandidate(good), true);
  for (const patch of [{candidateForPrivateTest:false},{licenseVerified:false},{listeningApproved:true},{sha256:'bad'},
    {url:'https://example.com/song.m4a'},{url:'audio/other/song.m4a'},{sourceUrl:'https://pixabay.com.example.net/'},
    {frames:0},{bytes:0},{seconds:good.seconds+1},{channels:3}]) {
    assert.equal(module.validPrivateAudioCandidate({...good,...patch}), false, JSON.stringify(patch));
  }
  assert.equal(module.validPrivateAudioCandidate(good, {effect:true}), false, 'full recordings are not admitted as short effect buffers');
  assert.equal(module.CUE_SAMPLES.fanfare, 'win');
  assert.equal(module.CANDIDATE_EFFECTS.win.listeningApproved, false);
});

test('private scenes use candidates, retain silence rules and fall back when a candidate is unavailable', async () => {
  const preview = await compiled(PREVIEW), production = await compiled(PRODUCTION);
  const selected = preview.resolveAudioScene('home','idle');
  assert.equal(selected.track.id, preview.CANDIDATE_SCENES.home.id);
  assert.equal(selected.track.listeningApproved, false);
  assert.equal(production.resolveAudioScene('home','idle').track, null);
  for (const phase of ['opening','discussion','defense']) assert.equal(preview.resolveAudioScene('mafia',phase).track,null);
  for (const phase of ['play','bomb','three']) assert.equal(preview.resolveAudioScene('beep',phase).fallback,null);
  assert.equal(preview.resolveAudioScene('mafia','night').track.id,preview.CANDIDATE_SCENES.mafia.id);
  const blocked = preview.resolveAudioScene('home','idle',{unavailableTracks:new Set([selected.track.url])});
  assert.equal(blocked.track,null); assert.equal(blocked.fallback,'home');
});

function element() {
  const attrs = new Map();
  return { paused:true, pauses:0, loads:0, setAttribute:(key,value)=>attrs.set(key,value),getAttribute:key=>attrs.get(key)??null,
    removeAttribute:key=>attrs.delete(key),pause(){this.paused=true;this.pauses++;},load(){this.loads++;} };
}
function leasedSound() {
  const effects=new Set(['another-owner']),music=new Set(['another-owner']),duck=new Set(['another-owner']);
  const set=(owners,value,owner)=>value?owners.add(owner):owners.delete(owner);
  return { effects,music,duck, sound:{enabled:false,setSuppressed:(v,o)=>set(effects,v,o),setDucking:(v,o)=>set(duck,v,o),music:{setSuppressed:(v,o)=>set(music,v,o)}} };
}

test('native auditions are single-player, retire pending playback on priority loss and preserve independent leases', async () => {
  const module=await compiled(PREVIEW), leases=leasedSound(),activity=[];
  let available=true;
  const session=module.createCandidatePlaybackSession(leases.sound,{owner:'lab',available:()=>available,activity:v=>activity.push(v)});
  const first=element(),second=element();
  session.register(first,module.CANDIDATE_AUDITIONS.menus);session.register(second,module.CANDIDATE_AUDITIONS.badeeha);
  assert.equal(first.getAttribute('src'),null);session.activate();
  first.paused=false;assert.equal(session.onPlay(first),true);
  second.paused=false;assert.equal(session.onPlay(second),true);assert.equal(first.paused,true);
  available=false;session.interrupt();
  assert.equal(first.getAttribute('src'),null);assert.equal(second.getAttribute('src'),null);assert.equal(second.paused,true);
  available=true;session.restore();assert.ok(second.getAttribute('src'));assert.equal(second.paused,true,'priority release never calls play');
  assert.equal(session.onPlay(second),false,'a late queued event cannot resurrect paused playback');
  session.dispose();assert.deepEqual([...leases.effects],['another-owner']);assert.deepEqual([...leases.music],['another-owner']);assert.deepEqual([...leases.duck],['another-owner']);
  assert.equal(leases.sound.enabled,false);assert.equal(activity.at(-1),false);
  session.activate();assert.equal(first.paused,true,'StrictMode reactivation restores sources without autoplay');session.dispose();
});

test('a production playback session never acquires audition leases or assigns private sources', async () => {
  const module=await compiled(PRODUCTION),leases=leasedSound(),audio=element();
  const session=module.createCandidatePlaybackSession(leases.sound);
  session.register(audio,module.CANDIDATE_AUDITIONS.menus);assert.equal(session.activate(),false);assert.equal(audio.getAttribute('src'),null);
  assert.equal(leases.effects.size,1);assert.equal(leases.music.size,1);
});

function audioEnvironment(module) {
  const fetched=[],contexts=[];
  const node=(extra={})=>({connect(){},disconnect(){},...extra});
  const param=()=>({value:0,setValueAtTime(v){this.value=v;},setTargetAtTime(v){this.value=v;},cancelScheduledValues(){}});
  class Context {
    constructor(){this.state='running';this.currentTime=1;this.destination={};this.sources=[];contexts.push(this);}
    createGain(){return node({gain:param()});}
    createDynamicsCompressor(){return node(Object.fromEntries(['threshold','knee','ratio','attack','release'].map(key=>[key,param()])));}
    createBufferSource(){const source=node({playbackRate:param(),start(){},stop(){this.onended?.();}});this.sources.push(source);return source;}
    decodeAudioData(data){return data.byteLength===1?Promise.reject(Error('damaged candidate')):Promise.resolve({length:data.byteLength,duration:data.byteLength/48000});}
    resume(){this.state='running';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
  }
  const listeners={addEventListener(){},removeEventListener(){}};
  module.sandbox.window={...listeners,AudioContext:Context};module.sandbox.document={...listeners,hidden:false};
  module.sandbox.fetch=async url=>{
    fetched.push(url);
    if(url===module.CANDIDATE_EFFECTS.click.url)return new Response('missing',{status:404});
    if(url===module.CANDIDATE_EFFECTS.correct.url)return new Response(new Uint8Array(1));
    const entry=[...Object.values(module.CANDIDATE_EFFECTS),...Object.values(SAMPLE_BANK)].find(item=>item.url===url);
    return entry?new Response(new Uint8Array(entry.frames)):new Response('missing',{status:404});
  };
  return {fetched,contexts};
}

test('a missing or undecodable private effect falls back to its existing sample without bypassing recording priority', async () => {
  const module=await compiled(PREVIEW),env=audioEnvironment(module),sound=module.createSound({music:false});
  assert.equal(await sound.preload(),true);
  assert.ok(env.fetched.includes(SAMPLE_BANK.click.url),'404 candidate falls back to the legacy click');
  assert.ok(env.fetched.includes(SAMPLE_BANK.correct.url),'damaged candidate falls back after decode failure');
  assert.equal(sound.play('click'),true);
  sound.setSuppressed(true,'recording');assert.equal(sound.play('correct'),false);
  sound.setSuppressed(false,'recording');assert.equal(sound.play('correct'),true);
  sound.dispose();
});
