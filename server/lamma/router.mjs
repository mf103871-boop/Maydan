import { json,readJson } from '../protocol.mjs';
import { fail } from '../room-model.mjs';
import { pagination,sequenceOf,userId } from '../social/model.mjs';
import * as groups from './groups.mjs';
import * as messages from './group-messages.mjs';
import { uploadAttachment,readBinaryAudio,audioResponse,deleteAttachment,MAX_AUDIO_BYTES } from './media.mjs';
import { startCall,getCall,listCalls,joinCall,callAction,revokeInvalidCalls } from './calls.mjs';
import { liveKitConfigured } from './provider.mjs';
import { pushConfigured,preferences,setPreferences,registerDevice,deleteDevice } from './notifications.mjs';
import { roomInvitation,respondRoomInvitation } from './room-invitations.mjs';
const body=req=>req.body?readJson(req,16384):Promise.resolve({});
export async function routeLamma(request,env,path,id,sessionId,context){const method=request.method;
  if(path==='/capabilities'&&method==='GET')return json({groups:true,groupMessageSummary:true,stickers:true,voiceMessages:!!env.SOCIAL_AUDIO,binaryVoiceUpload:!!env.SOCIAL_AUDIO,liveCalls:liveKitConfigured(env),pushNotifications:pushConfigured(env),maxGroupMembers:12,maxVoiceDurationMs:120000,maxVoiceBytes:MAX_AUDIO_BYTES});
  if(path==='/preferences'){if(method==='GET')return json(await preferences(env,id));if(method==='PUT')return json(await setPreferences(env,id,await body(request)));}
  if(path==='/devices'&&method==='PUT')return json(await registerDevice(env,id,sessionId,await body(request)));
  let m=/^\/devices\/([A-Za-z0-9_-]+)$/.exec(path);if(m&&method==='DELETE'){await deleteDevice(env,id,m[1],sessionId);return json({ok:true});}
  if(path==='/attachments'&&method==='POST'){
    if(request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')){const {body,bytes}=await readBinaryAudio(request);return json(await uploadAttachment(env,id,body,bytes));}
    return json(await uploadAttachment(env,id,await readJson(request,Math.ceil(MAX_AUDIO_BYTES/3)*4+4096)));
  }
  m=/^\/attachments\/([A-Za-z0-9_-]+)(\/content)?$/.exec(path);if(m){if(m[2]&&method==='GET')return audioResponse(env,id,m[1],request);if(!m[2]&&method==='DELETE')return json(await deleteAttachment(env,id,m[1]));}
  if(path==='/groups'){if(method==='GET')return json(await groups.listGroups(env,id));if(method==='POST')return json(await groups.createGroup(env,id,await body(request)));}
  m=/^\/groups\/([A-Za-z0-9_-]+)(?:\/(.*))?$/.exec(path);if(m){const g=userId(m[1]),tail=m[2]||'';
    if(!tail){if(method==='GET')return json(await groups.groupDetail(env,id,g));if(method==='PATCH')return json(await groups.renameGroup(env,id,g,await body(request)));if(method==='DELETE'){const result=await groups.closeGroup(env,id,g);await revokeInvalidCalls(env,null,null,{groupId:g});return json(result);}}
    if(tail==='messages'){if(method==='GET')return json(await messages.groupMessages(env,id,g,pagination(new URL(request.url).searchParams)));if(method==='POST')return json(await messages.sendGroupMessage(env,id,g,await body(request),undefined,context));}
    const msg=/^messages\/(\d+)$/.exec(tail);if(msg&&['PATCH','DELETE'].includes(method))return json(await messages.changeGroupMessage(env,id,g,sequenceOf(msg[1]),method==='DELETE'?null:(await body(request)).text));
    if(tail==='read'&&method==='POST')return json(await messages.readGroup(env,id,g,(await body(request)).seq));
    if(tail==='reports'&&method==='POST')return json(await messages.reportGroup(env,id,g,await body(request)));
    if(tail==='invites'&&method==='POST')return json(await groups.inviteMember(env,id,g,(await body(request)).userId));
    const invite=/^invites\/([A-Za-z0-9_-]+)(?:\/(accept|reject))?$/.exec(tail);if(invite&&!invite[2]&&method==='GET')return json(await groups.previewInvite(env,id,g,invite[1]));if(invite&&((invite[2]&&method==='POST')||(!invite[2]&&method==='DELETE')))return json(await groups.respondInvite(env,id,g,invite[1],invite[2]||'cancel'));
    if(tail==='leave'&&method==='POST'){const result=await groups.leaveGroup(env,id,g);await revokeInvalidCalls(env,null,null,{groupId:g,userIds:[id]});return json(result);}
    if(tail==='ownership'&&method==='POST')return json(await groups.transferOwner(env,id,g,(await body(request)).userId));
    const target=/^members\/([A-Za-z0-9_-]+)$/.exec(tail);if(target){if(method==='PATCH')return json(await groups.setRole(env,id,g,target[1],(await body(request)).role));if(method==='DELETE'){const result=await groups.leaveGroup(env,id,g,target[1]);await revokeInvalidCalls(env,null,null,{groupId:g,userIds:[target[1]]});return json(result);}}
    fail('NOT_FOUND',404);
  }
  if(path==='/calls'){if(method==='GET')return json(await listCalls(env,id,context));if(method==='POST')return json(await startCall(env,id,await body(request),context));}
  m=/^\/calls\/([A-Za-z0-9_-]+)(?:\/(accept|join|reject|leave|end))?$/.exec(path);if(m){if(!m[2]&&method==='GET')return json({call:await getCall(env,id,m[1])});if(method==='POST'&&m[2])return json(['join','accept'].includes(m[2])?await joinCall(env,id,m[1],await body(request),context):await callAction(env,id,m[1],m[2],await body(request)));}
  if(path==='/room-invitations'&&method==='POST')return json(await roomInvitation(env,id,await body(request),context));
  m=/^\/room-invitations\/([A-Za-z0-9_-]+)\/(accept|reject)$/.exec(path);if(m&&method==='POST')return json(await respondRoomInvitation(env,id,m[1],m[2]));
  return null;
}
