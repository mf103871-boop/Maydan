// Project only the already-authorized room view. No role, answer, target,
// private report, message text or drawing coordinates are audio inputs.
import {minimumOnlinePlayers} from '../../online/shared.js';
const ACK_TYPES = new Set(['settings','vote','truth','lie','help','tool','undo','drawing_undo','drawing_redo','drawing_clear','night_action','mafia_vote','nominate','verdict']);
const PRIORITIES={'room.started':100,'game.reveal':90,'game.correct':90,'game.wrong':90,'room.all-ready':80,'draw.correct':80,'game.turn':70,'room.members':60,'room.host':50,'room.ready':40,'game.hint':30};
const phaseKey = state => JSON.stringify([state.game,state.matchId,state.round,state.phase,state.phaseId || '']);
const scopeKey = options => JSON.stringify([options.ownerId || '',options.code || '',options.seatId || '']);
const active = state => (state.members || []).filter(member => !member.left&&!member.spectator);
const allReady = state => {
  const members = active(state);
  const minimum = state.game === 'mafia' ? (state.settings?.mode === 'shadow' ? 9 : state.rulesetVersion===2 ? 8 : 6) : minimumOnlinePlayers(state.game,state.settings);
  return members.length >= minimum && members.every(member => member.connected && member.ready);
};
const publicView = state => ({
  game: state.game, matchId: state.matchId, round: state.round, phase: state.phase,
  phaseId: state.phaseId, revision: state.revision, hostId: state.hostId,
  reason: state.reason, roundReason: state.roundReason,
  members: (state.members || []).map(({id,left,connected,ready,spectator}) => ({id,left,connected,ready,spectator})),
  settings:{mode:state.settings?.mode},rulesetVersion:state.rulesetVersion,
  // These fields are public in their respective game's snapshot contract.
  ...(state.game === 'badeeha' ? {questionId:state.current?.qid,
    verdict:state.verdict ? {qid:state.verdict.qid,teamId:state.verdict.teamId,steal:state.verdict.steal} : null} : {}),
  ...(state.game === 'fabraka' ? {revealKey:(state.reveal?.options || []).map(option => option.id).join(','),shown:state.reveal?.shown === true} : {}),
  ...(state.game === 'ersomha' ? {guessedIds:[...(state.guessedIds || [])],hintCount:(state.publicWord?.letters || []).length,
    lengthsKnown:(state.publicWord?.wordLengths || []).length > 0} : {}),
});

function project(before, state) {
  if (['result','over','closed'].includes(state.phase)) return null; // Existing completion owner.
  if (before.phase === 'lobby' && state.phase !== 'lobby') return 'room.started';
  if (state.phase === 'lobby' && before.phase === 'lobby') {
    if (!allReady(before) && allReady(state)) return 'room.all-ready';
    const old = new Map(active(before).map(member => [member.id,member]));
    const members = active(state);
    if (members.length !== old.size || members.some(member => !old.has(member.id))) return 'room.members';
    if (state.hostId !== before.hostId) return 'room.host';
    if (members.some(member => old.get(member.id)?.ready !== member.ready)) return 'room.ready';
    return null; // Reconnect/presence is not a new member.
  }
  if (state.game === 'mafia') return null; // Existing phase/public-log owners.
  if (state.game === 'badeeha') {
    if (state.verdict && JSON.stringify(state.verdict) !== JSON.stringify(before.verdict)) return state.verdict.teamId ? 'game.correct' : 'game.wrong';
    if (state.phase === 'reveal' && before.phase !== 'reveal') return 'game.reveal';
    if (state.phase === 'question' && (before.phase !== 'question' || before.questionId !== state.questionId)) return 'game.turn';
  } else if (state.game === 'fabraka') {
    if (state.phase === 'reveal') {
      if (state.shown && (!before.shown || before.revealKey !== state.revealKey)) return 'game.reveal';
      if (!state.shown && (before.phase !== 'reveal' || before.revealKey !== state.revealKey)) return 'game.turn';
    } else if (['host','write','discussion','vote'].includes(state.phase) && (state.phase !== before.phase||state.round!==before.round)) return 'game.turn';
  } else if (state.game === 'ersomha') {
    if (state.phase === 'draw' && before.phase === 'draw' && state.round === before.round) {
      if (state.guessedIds.some(id => !before.guessedIds.includes(id))) return 'draw.correct';
      if (state.hintCount > before.hintCount || (state.lengthsKnown && !before.lengthsKnown)) return 'game.hint';
    }
    if (['select','draw'].includes(state.phase) && (before.phase !== state.phase || before.round !== state.round)) return 'game.turn';
  } else if (state.game === 'meenfina' && state.phase === 'vote' && (before.phase !== 'vote' || before.round !== state.round)) return 'game.turn';
  return null;
}

export function createRoomAudioAdapter(sound, {now=Date.now,schedule=setTimeout,cancel=clearTimeout,available=()=>true}={}) {
  let scope=null, previous=null, phase=null, generation=0, disposed=false, connected=false, hadConnection=false;
  let hidden=false, preview=false, restore=false, sequence=0, pending=null, lastProjection=-1;
  const tickets=new WeakSet();
  const clear=()=>{if(pending){cancel(pending.timer);pending=null;}};
  const invalidate=()=>{generation++;clear();};
  const usable=()=>!disposed&&!hidden&&!preview&&available();
  const emit=(type,id,at=now(),requireConnection=true)=>{
    const epoch=generation,owner=scope;
    try{return sound?.emit?.(type,{id:JSON.stringify([scope,type,id]),at,
      guard:()=>usable()&&scope===owner&&generation===epoch&&(!requireConnection||connected)}) ?? false;}catch{return false;}
  };
  const setScope=options=>{
    const next=scopeKey(options);
    if(scope!==next){invalidate();scope=next;previous=null;phase=null;lastProjection=-1;hadConnection=false;restore=false;connected=false;}
  };
  return {
    connection(status, options={}) {
      if(disposed)return;
      setScope(options);hidden=!!options.hidden;preview=!!options.preview;
      const next=status==='connected';
      if(next===connected)return;
      const was=connected;connected=next;previous=null;invalidate();
      if(next){restore=hadConnection;hadConnection=true;}
      else if(was&&hadConnection&&usable())emit('room.connection-lost',++sequence,now(),false);
    },
    update(state, options={}) {
      if(disposed||!state)return null;
      setScope({...options,code:options.code||state.code});
      hidden=!!options.hidden;preview=!!options.preview||!!state._designPreview;
      if(options.code&&state.code&&options.code!==state.code){invalidate();previous=null;return null;}
      if(!connected||!usable()){invalidate();previous=null;return null;}
      const receivedAt=options.receivedAt??now();
      if(!Number.isSafeInteger(state.revision)||!Number.isFinite(receivedAt)) {previous=null;invalidate();return null;}
      const next=publicView(state),nextPhase=phaseKey(next);
      if(previous&&next.revision<=previous.revision)return null;
      const before=previous;previous=next;
      const changed=phase!==nextPhase;
      if(changed){phase=nextPhase;invalidate();}
      if(!connected||!usable()||now()-receivedAt>400||receivedAt>now()+1000){invalidate();previous=null;return null;}
      if(!before||before.game!==next.game){
        lastProjection=-1;
        if(restore){restore=false;emit('room.connection-restored',++sequence,receivedAt);}
        return null;
      }
      restore=false;
      // A revision gap cannot prove which intervening actions were seen live.
      if(next.revision!==before.revision+1){invalidate();return null;}
      const type=project(before,next);
      if(!type)return null;
      lastProjection=next.revision;
      if(pending&&(PRIORITIES[pending.type]||0)>(PRIORITIES[type]||0))return null;
      clear();
      const id=JSON.stringify([next.matchId,next.round,next.phaseId||next.phase,next.revision]);
      if(['room.members','room.ready','room.all-ready','draw.correct'].includes(type)) {
        const epoch=generation;
        pending={type,timer:schedule(()=>{pending=null;if(epoch===generation&&usable()&&connected)emit(type,id,receivedAt);},100)};
      } else emit(type,id,receivedAt);
      return type;
    },
    capture(type, requestId) {
      if(!ACK_TYPES.has(type)||!previous||!connected||!usable()||typeof requestId!=='string'||requestId.length>100||!requestId)return null;
      const ticket=Object.freeze({type,requestId,scope,phase,generation,revision:previous.revision,at:now()});
      tickets.add(ticket);return ticket;
    },
    accepted(ticket, ack) {
      if(!ticket||!tickets.has(ticket))return false;
      tickets.delete(ticket);
      if(ack?.ok!==true||ack.requestId!==ticket.requestId||!usable()||!connected||ticket.scope!==scope||ticket.phase!==phase||ticket.generation!==generation||lastProjection>ticket.revision)return false;
      // The ACK is the acceptance time; a slow network is not a new history cue.
      return emit('ui.confirm',ticket.requestId);
    },
    suspend(){if(disposed)return;invalidate();previous=null;restore=false;},
    dispose(){disposed=true;invalidate();previous=null;},
  };
}

// Preserve the client's original Promise (including requestId/then/await). Only
// accepted whitelisted commands attach a side effect; drawing points/sync never do.
export function bindRoomAudioCommands(client,audio) {
  const original=client.command;
  const wrapped=function(type,...args){
    const promise=original.call(this,type,...args);
    const ticket=audio.capture(type,promise?.requestId);
    if(ticket)promise.then(ack=>audio.accepted(ticket,ack),()=>{});
    return promise;
  };
  client.command=wrapped;
  return()=>{if(client.command===wrapped)client.command=original;};
}

// HTTP success already passed the caller's ownership/epoch check. The shared
// bus still fences identity/mute/decode; this helper cannot manufacture success.
export function emitRoomReceipt(sound,type,{id,guard,at=Date.now()}={}) {
  if(!['room.admitted','room.exit'].includes(type)||!id||typeof guard!=='function'||!guard())return false;
  try{return sound?.emit?.(type,{id,at,guard}) ?? false;}catch{return false;}
}
