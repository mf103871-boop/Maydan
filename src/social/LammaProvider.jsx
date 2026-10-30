import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAccount } from '../shared/account/context.js';
import { resolveAccountServer } from '../shared/account/api.js';
import { callNative, isNativeShell, onNativeEvent } from '../shared/account/native.js';
import { usePlatform } from '../platform/context.js';
import { getRoute, navigate } from '../platform/router.js';
import { useSocial } from './SocialProvider.jsx';
import { LammaClient, emptyLamma, lammaId } from './lamma-client.js';
import { CallMedia, emptyMedia, bindSocialAudio } from './media.js';
import { socialInterruption } from './interruption.js';
import { createCallAuthorization } from './call-authorization.js';
import { LAMMA_POLL_MS, lammaPollDue, refreshesLamma, rechecksCall } from './sync-policy.js';
import { joinSocialGameRoom } from './game-launch.js';
import { MafiaVoiceSession, emptyMafiaVoice } from './mafia-voice-session.js';

const Context = createContext(null);
export const LammaContext = Context;
export const useLamma = () => useContext(Context);
const METHODS = ['createGroup', 'loadGroup', 'loadCallMembers', 'loadOlderGroup', 'sendGroupMessage', 'sendGroupSticker', 'inviteGroupMembers', 'removeGroupMember',
  'leaveGroup', 'renameGroup', 'acceptGroupInvite', 'rejectGroupInvite', 'setGroupRole', 'transferGroupOwnership', 'selectGroup',
  'markGroupRead', 'changeGroupMessage', 'retryGroupMessage', 'sendVoiceNote', 'getVoiceUrl', 'setNotificationPreferences', 'setConversationMuted',
  'sendGameInvite', 'rejectGameInvite', 'updateGroupAvatar', 'reportGroupMessage'];
const ended = call => !call || ['ended', 'rejected', 'cancelled', 'missed', 'expired'].includes(call.status);
const callEndNotice = reason => reason === 'ownership-lost' ? 'انتقلت المكالمة إلى جهازك الآخر.' :
  reason === 'authorization-timeout' ? 'انتهت المكالمة لتعذّر التحقق من الاتصال. حاول مجددًا.' :
    reason === 'authorization-revoked' ? 'انتهت المكالمة لأن الوصول إليها لم يعد متاحًا.' : null;

export function LammaProvider({ children }) {
  const account = useAccount(), social = useSocial(), { sound } = usePlatform();
  const owner = account.ready && account.signedIn ? account.user?.id || null : null;
  useEffect(() => { sound.resetIdentity?.(owner || 'guest'); }, [owner, sound]);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const accountRef = useRef(account); accountRef.current = account;
  const socialRef = useRef(social); socialRef.current = social;
  const [media, setMedia] = useState(emptyMedia);
  const [activeCall, setActiveCall] = useState(null);
  const [connectingCall, setConnectingCall] = useState(null);
  const ownedCall = activeCall?._ownerId === owner ? activeCall : null;
  const ownedCallId = ownedCall?.id;
  const activeRef = useRef(ownedCall); activeRef.current = ownedCall;
  const [notification, setNotification] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState('unknown');
  const [mafiaVoice, setMafiaVoice] = useState(emptyMafiaVoice);
  const mafiaRef = useRef(null);
  const connecting = useRef(false), connectGeneration = useRef(0), deviceRef = useRef(isNativeShell() ? null : lammaId()), deviceReady = useRef(null);
  const clientRef = useRef(null), mediaRef = useRef(null);
  if (!clientRef.current) {
    clientRef.current = new LammaClient({ request: (path, options) => accountRef.current.requestAuthenticated(path, options),
      onDirectChange: (message, conversationId) => {
        if (message) socialRef.current?.receiveOwnMessage(message, conversationId);
        return socialRef.current?.refresh({ quiet: true });
      } });
    clientRef.current.actions = Object.fromEntries(METHODS.map(name => [name, clientRef.current[name].bind(clientRef.current)]));
  }
  if (!mediaRef.current) mediaRef.current = new CallMedia(setMedia);
  const client = clientRef.current, engine = mediaRef.current;
  const authorization = () => accountRef.current.authHeaders?.().Authorization || null;
  const callIdentity = (expectedOwner = ownerRef.current) => ({ owner: expectedOwner, epoch: client.epoch,
    authorizationEpoch: client.authorizationEpoch, authorization: authorization() });
  const currentIdentity = identity => Boolean(identity.owner && ownerRef.current === identity.owner && client.userId === identity.owner &&
    client.epoch === identity.epoch && client.authorizationEpoch === identity.authorizationEpoch && authorization() === identity.authorization);
  const staleCall = () => Object.assign(new Error('تغيّر الحساب أو الاتصال. حاول مجددًا.'), { code: 'STALE' });
  const assertIdentity = identity => { if (!currentIdentity(identity)) throw staleCall(); };
  if (!mafiaRef.current) mafiaRef.current = new MafiaVoiceSession({
    request: (code, body) => accountRef.current.requestAuthenticated('/api/rooms/' + encodeURIComponent(code) + '/voice', { method: 'POST', body }),
    captureRequest: () => {
      const identity = callIdentity(), request = accountRef.current.requestAuthenticated;
      return (code, body) => { assertIdentity(identity); return request('/api/rooms/' + encodeURIComponent(code) + '/voice', { method: 'POST', body }); };
    },
    deviceId: async () => { await deviceReady.current; return deviceRef.current; },
    media: engine, native: isNativeShell(), onChange: setMafiaVoice,
    beforeJoin: async () => {
      const before = activeRef.current, identity = callIdentity(), attempt = connectGeneration.current;
      const current = () => currentIdentity(identity) && attempt === connectGeneration.current && (!activeRef.current || activeRef.current.id === before?.id);
      if (!current()) throw staleCall();
      if (before?.scope === 'mafia') return null;
      if (before) {
        await engine.disconnect({ callId: before.id, localOnly: true, endReason: 'game-voice' });
        if (!current()) throw staleCall();
        await client.callAction(before.id, 'leave', deviceRef.current).catch(() => {});
        if (!current()) throw staleCall();
        activeRef.current = null; setActiveCall(null); client.setCallContext(null);
      }
      return before ? { scope: before.scope, conversationId: before.conversationId, name: before.name } : null;
    },
    setCall: call => {
      if (!call) { if (activeRef.current?.scope === 'mafia') { activeRef.current = null; setActiveCall(null); client.setCallContext(null); } return; }
      const owned = { ...call, _ownerId: ownerRef.current };
      activeRef.current = owned; setActiveCall(owned); client.setCallContext(owned);
    },
  });
  const mafiaSession = mafiaRef.current;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const safe = client.userId === owner ? state : emptyLamma();
  const ownedMedia = client.userId === owner && media.userId === owner ? media : emptyMedia();
  const previous = useRef(null);
  useEffect(() => {
    const connectionEpoch = connectGeneration;
    connectGeneration.current++; client.start(owner); engine.setAccount(owner);
    mafiaSession.clear();
    setActiveCall(null); setConnectingCall(null); setNotification(null); previous.current = null; connecting.current = false;
    if (owner && isNativeShell()) {
      deviceRef.current = null;
      deviceReady.current = accountRef.current.ensureNativeSocialSession().then(result => {
        if (ownerRef.current !== owner || result?.userId !== owner || !result.deviceId) throw new Error('انتظر اكتمال تسجيل الدخول ثم حاول مجددًا.');
        deviceRef.current = result.deviceId;
        engine.applyNativeSnapshot(result.call);
        return result.deviceId;
      });
      deviceReady.current.catch(() => {});
    } else deviceReady.current = Promise.resolve(deviceRef.current);
    return () => { connectionEpoch.current++; client.stop(); };
  }, [client, engine, owner, mafiaSession]);
  useEffect(() => { mafiaSession.mediaChanged(media); }, [mafiaSession, media]);
  useEffect(() => {
    if (!owner || !mafiaVoice.requested || isNativeShell()) return;
    const tick = () => mafiaSession.sync().catch(() => {});
    const timer = setInterval(tick, 1000);
    window.addEventListener('online', tick);
    return () => { clearInterval(timer); window.removeEventListener('online', tick); };
  }, [owner, mafiaVoice.requested, mafiaSession]);
  useEffect(() => () => { engine.dispose().catch(() => {}); }, [engine]);
  useEffect(() => {
    if (!owner) return;
    let timer, lastRefreshAt = Date.now();
    const refresh = () => { if (document.hidden) return; lastRefreshAt = Date.now(); client.refresh({ quiet: true }).catch(() => {}); };
    const event = e => {
      const { type, reason } = e.detail || {};
      if ((type === 'refresh' && !['read', 'presence'].includes(reason)) || (type === 'group' && ['membership', 'removed', 'closed', 'deleted'].includes(reason)) ||
        (type === 'message' && reason === 'deleted')) client.invalidateAudio();
      if (!refreshesLamma(e.detail)) return;
      clearTimeout(timer); timer = setTimeout(refresh, 200);
    };
    const interval = setInterval(() => { if (lammaPollDue(lastRefreshAt, Date.now(), socialRef.current?.connected)) refresh(); }, LAMMA_POLL_MS);
    window.addEventListener('maydan-social-event', event); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); clearInterval(interval); window.removeEventListener('maydan-social-event', event); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [client, owner]);
  useEffect(() => bindSocialAudio(sound), [sound]);
  useEffect(() => {
    const sync = () => {
    const { privateTurn, communicationLocked } = socialInterruption.getSnapshot();
    if (isNativeShell()) callNative('socialAudioPrivacy', { privateTurn, communicationLocked }, { timeout: 5000 }).catch(() => {});
    if (privateTurn && (engine.state.connected || engine.state.connecting)) engine.mute(true).catch(() => {});
    }; sync(); return socialInterruption.subscribe(sync);
  }, [engine]);
  useEffect(() => onNativeEvent('socialNotification', payload => {
    if (!ownerRef.current || (payload?.userId && payload.userId !== ownerRef.current)) return;
    window.dispatchEvent(new CustomEvent('maydan-social-open', { detail: payload }));
    client.refresh({ quiet: true }).catch(() => {});
  }), [client]);
  useEffect(() => {
    if (!owner || safe.loading) return;
    const before = previous.current;
    if (before && safe.preferences.messages) {
      const group = safe.groups.find(g => g.unreadCount > (before[g.id] || 0) && client.activeGroup !== g.id &&
        !safe.preferences.mutedConversations.some(m => m.scope === 'group' && m.conversationId === g.id));
      if (group) setNotification({ id: lammaId(), messageId: group.lastMessage?.id, userId: owner, scope: 'group', groupId: group.id, conversationId: group.id,
        title: socialInterruption.getSnapshot().local || socialInterruption.getSnapshot().communicationLocked || !safe.preferences.previews ? 'رسالة جديدة في ميدان' : `رسالة جديدة في ${group.name}` });
    }
    previous.current = Object.fromEntries(safe.groups.map(g => [g.id, g.unreadCount]));
  }, [safe.groups, safe.loading, safe.preferences, owner, client]);
  useEffect(() => {
    const active = activeRef.current;
    if (active && ((ownedMedia.callId === active.id && ownedMedia.ended) || safe.calls.some(c => c.id === active.id && ended(c)))) {
      const localOnly = ownedMedia.callId === active.id && ownedMedia.localOnly;
      const title = callEndNotice(ownedMedia.endReason);
      if (title) setNotification({ id: lammaId(), userId: owner, scope: active.scope, conversationId: active.conversationId, title });
      activeRef.current = null; client.setCallContext(null); setActiveCall(null);
      engine.disconnect({ callId: active.id, localOnly, endReason: ownedMedia.endReason }).catch(() => {});
      if (active.scope === 'mafia') mafiaSession.stop().catch(() => {});
      else if (!localOnly && client.userId) client.callAction(active.id, 'leave', deviceRef.current).catch(() => {});
    }
    // A native incoming call can be accepted from the lock screen before React exists.
    if (!active && owner && ownedMedia.connected && ownedMedia.callId) {
      const call = safe.calls.find(c => c.id === ownedMedia.callId);
      if (call && !ended(call)) {
        const restored = { ...call, _ownerId: owner };
        activeRef.current = restored; client.setCallContext(restored); setActiveCall(restored);
      }
    }
  }, [ownedMedia.ended, ownedMedia.connected, ownedMedia.callId, ownedMedia.localOnly, ownedMedia.endReason, safe.calls, owner, client, engine, mafiaSession]);
  // The list intentionally omits ended and unauthorized calls. Ask for the exact
  // active call to distinguish a real revocation from a stale list response.
  useEffect(() => {
    // The native coordinator owns the same authorization check while locked or
    // foregrounded, and emits authoritative end/ownership events. Duplicating it
    // in WebKit doubled traffic on every iPhone without improving revocation.
    if (!ownedCallId || !owner || isNativeShell() || activeRef.current?.scope === 'mafia') return;
    const id = ownedCallId, epoch = client.epoch;
    let cancelled = false, checking = false;
    const authorization = createCallAuthorization();
    const terminate = async reason => {
      if (cancelled || epoch !== client.epoch || activeRef.current?.id !== id) return;
      cancelled = true;
      const call = activeRef.current, title = callEndNotice(reason);
      if (title) setNotification({ id: lammaId(), userId: owner, scope: call.scope, conversationId: call.conversationId, title });
      activeRef.current = null; client.setCallContext(null); setActiveCall(null);
      await engine.disconnect({ callId: id, localOnly: true, endReason: reason });
    };
    const check = async () => {
      if (cancelled) return;
      // This also runs while an HTTP request is pending, so a stalled request
      // cannot extend the authorization grace period after two failures.
      if (authorization.expired()) { await terminate('authorization-timeout'); return; }
      if (checking) return; checking = true;
      try {
        const response = await client.callStatus(id);
        if (cancelled || epoch !== client.epoch || activeRef.current?.id !== id) return;
        const reason = authorization.response(response.call, owner, deviceRef.current);
        if (reason) await terminate(reason);
      } catch (error) {
        const reason = authorization.failure(error);
        if (reason) await terminate(reason);
      } finally { checking = false; }
    };
    const event = e => { if (rechecksCall(e.detail, id)) check(); };
    const timer = setInterval(check, 5000); check();
    window.addEventListener('maydan-social-event', event);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('maydan-social-event', event); };
  }, [ownedCallId, owner, client, engine]);
  const incomingCall = !ownedCall && safe.preferences.calls ? safe.calls.find(call => call.scope === 'direct' && call.initiatorId !== owner &&
    !ended(call) && call.expiresAt > Date.now() && call.participants?.some(p => p.userId === owner && ['invited', 'ringing'].includes(p.state)) &&
    !safe.preferences.mutedConversations.some(m => m.scope === 'direct' && m.conversationId === call.conversationId)) || null : null;

  async function connect(action, { isCurrent = () => true, muted } = {}) {
    const identity = callIdentity(owner); assertIdentity(identity);
    if (!isCurrent()) throw staleCall();
    if (socialInterruption.getSnapshot().communicationLocked) throw new Error('التواصل خلال المباراة متاح داخل مجلس مافيا فقط.');
    if (connecting.current || activeRef.current) throw new Error('لديك مكالمة جارية بالفعل.');
    connecting.current = true; const epoch = client.epoch, attempt = ++connectGeneration.current; let result;
    setConnectingCall({ owner, attempt });
    // Fetch the web SDK alongside the authenticated call request, rather than
    // waiting for its response to start loading it. This never opens a microphone.
    engine.prepare().catch(() => {});
    try {
      const deviceId = await deviceReady.current; assertIdentity(identity);
      if (!isCurrent()) throw staleCall();
      if (!deviceId || attempt !== connectGeneration.current) throw new Error('تم إلغاء المكالمة.');
      result = await action(deviceId); assertIdentity(identity);
      if (!isCurrent()) throw staleCall();
      if (attempt !== connectGeneration.current) throw new Error('تم إلغاء المكالمة.');
      const call = { ...result.call, _ownerId: owner };
      client.setCallContext(call); setActiveCall(call); activeRef.current = call;
      await engine.connect(result, { muted: muted ?? socialInterruption.getSnapshot().privateTurn }); assertIdentity(identity);
      if (!isCurrent()) throw staleCall();
      if (attempt !== connectGeneration.current) throw new Error('تم إلغاء المكالمة.');
      client.refresh({ quiet: true }).catch(() => {}); return result.call;
    } catch (e) {
      // A newer account, authorization or call intent owns its own cleanup.
      // Releasing an old result here could also release a reused current call.
      if (currentIdentity(identity) && attempt === connectGeneration.current && isCurrent()) {
        if (result?.call?.id) await client.callAction(result.call.id, 'leave', deviceRef.current).catch(() => {});
        if (currentIdentity(identity) && attempt === connectGeneration.current && isCurrent()) { client.setCallContext(null); setActiveCall(null); activeRef.current = null; }
      }
      // Authorization may rotate while this exact transport is opening. Retire
      // only our still-owned attempt locally, without a request under new auth.
      if (epoch === client.epoch && attempt === connectGeneration.current && ownerRef.current === owner &&
        result?.call?.id && activeRef.current?.id === result.call.id && activeRef.current._ownerId === owner && (!currentIdentity(identity) || !isCurrent())) {
        activeRef.current = null; client.setCallContext(null); setActiveCall(null);
        await engine.disconnect({ callId: result.call.id, localOnly: true, endReason: 'stale-authorization' }).catch(() => {});
      }
      throw e;
    } finally {
      if (epoch === client.epoch && attempt === connectGeneration.current && ownerRef.current === owner) {
        connecting.current = false;
        setConnectingCall(current => current?.owner === owner && current?.attempt === attempt ? null : current);
      }
    }
  }
  async function endCall() {
    const identity = callIdentity(owner); assertIdentity(identity);
    const attempt = ++connectGeneration.current;
    connecting.current = false; setConnectingCall(null);
    if (activeRef.current?.scope === 'mafia') { await mafiaSession.stop(); return; }
    const call = activeRef.current; activeRef.current = null; client.setCallContext(null); setActiveCall(null);
    await engine.disconnect({ callId: call?.id || engine.state.callId });
    if (!currentIdentity(identity) || attempt !== connectGeneration.current) return;
    if (call) {
      await client.callAction(call.id, 'leave', deviceRef.current);
      if (currentIdentity(identity) && attempt === connectGeneration.current) await client.refresh({ quiet: true });
    }
  }
  function joinMafiaVoice() {
    assertIdentity(callIdentity(owner)); connectGeneration.current++;
    return mafiaSession.start();
  }
  function leaveMafiaVoice() {
    assertIdentity(callIdentity(owner)); connectGeneration.current++;
    return mafiaSession.stop();
  }
  async function returnFromMafiaVoice() {
    const identity = callIdentity(owner); assertIdentity(identity);
    const previous = mafiaSession.state.previousCall;
    if (!previous) return;
    if (connecting.current || activeRef.current && activeRef.current.scope !== 'mafia') throw staleCall();
    const attempt = ++connectGeneration.current, code = mafiaSession.room?.code;
    const stopping = mafiaSession.stop(), generation = mafiaSession.generation;
    await stopping;
    const isCurrent = () => currentIdentity(identity) && mafiaSession.generation === generation && mafiaSession.room?.code === code;
    if (!isCurrent() || attempt !== connectGeneration.current || connecting.current || activeRef.current) throw staleCall();
    return connect(deviceId => client.startCall({ targetType: previous.scope, targetId: previous.conversationId, deviceId }), { isCurrent, muted: true });
  }
  async function requestNotifications() {
    if (!isNativeShell()) { setNotificationPermission('foreground'); return { authorized: false, status: 'foreground' }; }
    const result = await callNative('socialNotifications', { request: true });
    setNotificationPermission(result?.authorized ? 'granted' : 'denied'); return result;
  }
  async function acceptGameInvite(id) {
    const epoch = client.epoch, ownerId = ownerRef.current, account = accountRef.current;
    const result = await client.acceptGameInvite(id); client.assert(epoch);
    // A match may reject navigation until its own exit confirmation succeeds.
    // Do not allocate a seat elsewhere while the player can still choose to stay.
    if (['play', 'room'].includes(getRoute().name)) {
      navigate(`/room/${encodeURIComponent(result.roomCode)}`);
      return { ...result, joined: false };
    }
    const joined = await joinSocialGameRoom({ account, roomCode: result.roomCode, server: resolveAccountServer(),
      isCurrent: () => client.epoch === epoch && ownerRef.current === ownerId });
    client.assert(epoch); navigate(`/room/${encodeURIComponent(result.roomCode)}`);
    return { ...result, ...joined };
  }
  const notifications = { ...safe.preferences, enabled: safe.preferences.messages, permission: notificationPermission };
  return <Context.Provider value={{ ...safe, ...client.actions, notifications, activeCall: ownedCall, incomingCall, media: ownedMedia,
    callConnecting: connectingCall?.owner === owner && connectingCall?.attempt === connectGeneration.current,
    notification: notification?.userId === owner ? notification : null,
    clearNotification: () => setNotification(null), refreshGroups: options => client.refresh(options), requestNotifications, acceptGameInvite,
    startCall: target => connect(deviceId => client.startCall({ ...target, deviceId })),
    acceptCall: id => connect(deviceId => client.acceptCall(id, deviceId)),
    declineCall: async id => { await client.callAction(id, 'reject', await deviceReady.current); await client.refresh({ quiet: true }); },
    endCall, setCallMuted: muted => engine.mute(muted), setAudioOutput: id => engine.output(id), resumeCallAudio: () => engine.resumeAudio(),
    mafiaVoice, configureMafiaRoom: state => mafiaSession.configure(state),
    joinMafiaVoice, leaveMafiaVoice, muteMafiaVoice: muted => mafiaSession.mute(muted), returnFromMafiaVoice,
  }}>{children}</Context.Provider>;
}
