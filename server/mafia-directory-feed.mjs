import { requireSession } from './accounts/session.mjs';
import { all,first } from './lamma/common.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { json } from './protocol.mjs';
// Dedicated logical object within the existing ROOMS namespace. It carries no
// game state, account list or room payload: clients refetch their block-filtered page.
export class MafiaDirectoryFeed {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.state=null;this.ready=ctx.storage.get('mafia:directory').then(value=>{this.state=value||null;});}
  sockets(){return this.ctx.getWebSockets().filter(ws=>ws.readyState===1);}
  attachment(ws){try{return ws.deserializeAttachment()||{};}catch{return {};}}
  send(ws,data){try{ws.send(typeof data==='string'?data:JSON.stringify(data));}catch{/* socket closed */}}
  close(ws,code=4401){try{ws.close(code,'AUTH');}catch{/* socket closed */}}
  async active(){await this.ready;return Boolean(this.state);}
  async activate(){await this.ready;if(!this.state){this.state={revision:0,pendingAt:null};await this.ctx.storage.put('mafia:directory',this.state);}}
  async schedule(){const now=Date.now();await this.ctx.storage.setAlarm(Math.min(this.state.pendingAt||Infinity,now+30000,...this.sockets().map(ws=>{const a=this.attachment(ws);return a.accountExpiresAt||a.authDeadline||now+10000;})));}
  async invalidate(){await this.activate();this.state={revision:this.state.revision+1,pendingAt:this.state.pendingAt||Date.now()+750};await this.ctx.storage.put('mafia:directory',this.state);await this.schedule();return json({ok:true});}
  async accept(ws){await this.activate();if(this.sockets().length>=1000){this.close(ws,4429);return;}this.ctx.acceptWebSocket(ws);ws.serializeAttachment({scope:'directory',authDeadline:Date.now()+10000});await this.schedule();}
  async message(ws,message){await this.ready;if(typeof message!=='string'||new TextEncoder().encode(message).length>2048){this.close(ws,4400);return;}const a=this.attachment(ws),now=Date.now();if(now-(a.windowAt||0)>=10000){a.windowAt=now;a.count=0;}a.count=(a.count||0)+1;ws.serializeAttachment(a);if(a.count>20){this.close(ws,4429);return;}if(message==='ping'&&a.accountUserId){this.send(ws,'pong');return;}let command;try{command=JSON.parse(message);}catch{this.close(ws);return;}
    if(command.type!=='auth'||a.accountUserId||Date.now()>a.authDeadline||typeof command.accountAuthorization!=='string'||command.accountAuthorization.length>512){this.close(ws);return;}
    try{const auth=await requireSession(this.env,new Request('https://internal/api/rooms/public/stream',{headers:{authorization:command.accountAuthorization}}),{rotate:false});if(await first(this.env,'SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND expires_at>?',auth.user.id,Date.now())){this.close(ws);return;}for(const other of this.sockets())if(other!==ws&&this.attachment(other).accountUserId===auth.user.id)this.close(other,4409);ws.serializeAttachment({scope:'directory',accountUserId:auth.user.id,accountSessionId:auth.session.id,accountExpiresAt:Math.min(auth.session.expires_at,auth.session.revoked_at??Number.MAX_SAFE_INTEGER)});this.send(ws,{type:'directory-ready',revision:this.state.revision});await this.schedule();}catch{this.close(ws);}
  }
  async alarm(){await this.ready;const now=Date.now(),publish=this.state.pendingAt!=null&&this.state.pendingAt<=now;
    const sockets=this.sockets().map(ws=>({ws,...this.attachment(ws)})),ids=[...new Set(sockets.map(a=>a.accountSessionId).filter(Boolean))],valid=new Set();
    for(let i=0;i<ids.length;i+=90){const batch=ids.slice(i,i+90);for(const row of await all(this.env,`SELECT id,user_id FROM sessions WHERE id IN (${batch.map(()=>'?')}) AND expires_at>? AND (revoked_at IS NULL OR revoked_at>?) AND ${liveAccountSql('sessions.user_id')} AND NOT EXISTS(SELECT 1 FROM mafia_observer_memberships o WHERE o.user_id=sessions.user_id AND o.expires_at>?)`,...batch,now,now,now))valid.add(`${row.id}:${row.user_id}`);}
    for(const a of sockets){if(!a.accountUserId){if(now>=a.authDeadline)this.close(a.ws);continue;}if(!valid.has(`${a.accountSessionId}:${a.accountUserId}`)){this.close(a.ws);continue;}if(publish)this.send(a.ws,{type:'directory-invalidated',revision:this.state.revision});}
    if(publish){this.state.pendingAt=null;await this.ctx.storage.put('mafia:directory',this.state);}if(this.sockets().length||this.state.pendingAt)await this.schedule();else await this.ctx.storage.deleteAlarm();
  }
}
