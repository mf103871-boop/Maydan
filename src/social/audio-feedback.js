// Local provenance only. Unread totals/history never create a live sound lease.
// The transport calls receive only for its current authenticated socket; no
// global CustomEvent, persisted state or HTTP inventory can mint a receipt.
export function createSocialLiveAudio({now=Date.now,maxAge=1000,available=()=>true}={}) {
  let owner=null,generation=0,connected=false;
  const pending=new Map(),latest=new Map();
  const clear=()=>{generation++;connected=false;pending.clear();};
  return {
    reset(value=null){clear();owner=value;latest.clear();},
    connect(){clear();connected=true;},
    disconnect:clear,
    receive(event,{visible=true,locked=false}={}) {
      const scope=event?.type==='message'?'direct':event?.type==='group'?'group':null;
      const id=scope==='direct'?event.conversationId:event?.groupId,seq=event?.messageSeq;
      if(!owner||!connected||!scope||event.reason!=='message'||typeof id!=='string'||!id||id.length>100||!Number.isSafeInteger(seq)||seq<1)return false;
      const key=JSON.stringify([scope,id]);
      if(seq<=(latest.get(key)||0))return false;
      latest.set(key,seq);while(latest.size>256)latest.delete(latest.keys().next().value);
      pending.delete(key);
      if(!visible||locked)return false; // Consume a suppressed event, never replay it.
      pending.set(key,{seq,at:now(),generation});while(pending.size>256)pending.delete(pending.keys().next().value);return true;
    },
    claim(scope,id,seq){
      const key=JSON.stringify([scope,id]),entry=pending.get(key);
      if(!entry||entry.seq!==seq)return null;
      pending.delete(key);
      const identity=owner,epoch=generation;
      const current=()=>connected&&owner===identity&&generation===epoch&&available()&&Number.isFinite(now())&&now()-entry.at>=0&&now()-entry.at<=maxAge;
      return current()?Object.freeze({owner:identity,receivedAt:entry.at,current}):null;
    },
  };
}

export function liveNotificationAudio(notification,owner) {
  const receipt=notification?.audioReceipt;
  return !!owner&&notification?.userId===owner&&receipt?.owner===owner&&typeof receipt.current==='function'&&receipt.current();
}

let sequence=0;
export function createSocialSendAudio() {
  let owner=null,scope=null,id=null,sound=null,generation=0,mounted=false;
  const tickets=new WeakSet(),seen=new Set();
  const ready=()=>mounted&&!!owner&&!!id&&typeof sound?.emit==='function';
  return {
    bind(nextOwner,nextScope,nextId,nextSound){
      if(owner!==nextOwner||scope!==nextScope||id!==nextId||sound!==nextSound)generation++;
      owner=nextOwner;scope=nextScope;id=nextId;sound=nextSound;
    },
    mount(){mounted=true;},dispose(){mounted=false;generation++;},
    get ready(){return ready();},
    begin(target){
      if(!ready())return null;
      const targetScope=target?.scope??scope,targetId=target?.id??id;
      if(!['direct','group'].includes(targetScope)||typeof targetId!=='string'||!targetId)return null;
      const ticket=Object.freeze({owner,scope,id,generation,targetScope,targetId});tickets.add(ticket);return ticket;
    },
    accepted(ticket,message){
      if(!ticket||!tickets.has(ticket))return false;tickets.delete(ticket);
      const current=()=>ready()&&ticket.owner===owner&&ticket.scope===scope&&ticket.id===id&&ticket.generation===generation;
      if(!current()||message?.senderId!==owner||message.conversationId!==ticket.targetId||!Number.isSafeInteger(message.seq)||message.seq<1||typeof message.clientId!=='string'||!message.clientId||message.deletedAt)return false;
      const key=JSON.stringify([owner,ticket.targetScope,ticket.targetId,message.clientId]);if(seen.has(key))return false;
      seen.add(key);while(seen.size>512)seen.delete(seen.values().next().value);
      try{return sound.emit('ui.confirm',{id:`social-send:${++sequence}`,guard:current})!==false;}catch{return false;}
    },
  };
}

// Both voice and room invitations already return a committed message receipt.
// A successful attachment upload or room creation alone never confirms a send.
export async function confirmSocialSend(feedback,target,send) {
  const ticket=feedback.begin(target);
  const result=await send();
  feedback.accepted(ticket,result?.message??result);
  return result;
}
