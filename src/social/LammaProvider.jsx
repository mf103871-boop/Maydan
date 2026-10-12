import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAccount } from '../shared/account/context.js';
import { callNative, isNativeShell, onNativeEvent } from '../shared/account/native.js';
import { usePlatform } from '../platform/context.js';
import { navigate } from '../platform/router.js';
import { useSocial } from './SocialProvider.jsx';
import { LammaClient, emptyLamma, lammaId } from './lamma-client.js';
import { CallMedia, emptyMedia } from './media.js';
import { socialInterruption } from './interruption.js';
import { createCallAuthorization } from './call-authorization.js';

const Context = createContext(null);
export const useLamma = () => useContext(Context);
const METHODS = ['createGroup', 'loadGroup', 'loadOlderGroup', 'sendGroupMessage', 'inviteGroupMembers', 'removeGroupMember',
  'leaveGroup', 'renameGroup', 'acceptGroupInvite', 'rejectGroupInvite', 'setGroupRole', 'transferGroupOwnership', 'selectGroup',
  'markGroupRead', 'changeGroupMessage', 'sendVoiceNote', 'getVoiceUrl', 'setNotificationPreferences', 'setConversationMuted',
  'sendGameInvite', 'rejectGameInvite', 'updateGroupAvatar', 'reportGroupMessage'];
const ended = call => !call || ['ended', 'rejected', 'cancelled', 'missed', 'expired'].includes(call.status);
const callEndNotice = reason => reason === 'ownership-lost' ? 'انتقلت المكالمة إلى جهازك الآخر.' :
  reason === 'authorization-timeout' ? 'انتهت المكالمة لتعذّر التحقق من الاتصال. حاول مجددًا.' :
    reason === 'authorization-revoked' ? 'انتهت المكالمة لأن الوصول إليها لم يعد متاحًا.' : null;

export function LammaProvider({ children }) {
  const account = useAccount(), social = useSocial(), { sound } = usePlatform();
  const owner = account.ready && account.signedIn ? account.user?.id || null : null;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const accountRef = useRef(account); accountRef.current = account;
  const socialRef = useRef(social); socialRef.current = social;
  const [media, setMedia] = useState(emptyMedia);
  const [activeCall, setActiveCall] = useState(null);
  const ownedCall = activeCall?._ownerId === owner ? activeCall : null;
  const ownedCallId = ownedCall?.id;
  const activeRef = useRef(ownedCall); activeRef.current = ownedCall;
  const [notification, setNotification] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState('unknown');
  const connecting = useRef(false), connectGeneration = useRef(0), deviceRef = useRef(isNativeShell() ? null : lammaId()), deviceReady = useRef(null);
  const clientRef = useRef(null), mediaRef = useRef(null);
  if (!clientRef.current) {
    clientRef.current = new LammaClient({ request: (path, options) => accountRef.current.requestAuthenticated(path, options),
      onDirectChange: () => socialRef.current?.refresh({ quiet: true }) });
    clientRef.current.actions = Object.fromEntries(METHODS.map(name => [name, clientRef.current[name].bind(clientRef.current)]));
  }
  if (!mediaRef.current) mediaRef.current = new CallMedia(setMedia);
  const client = clientRef.current, engine = mediaRef.current;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const safe = client.userId === owner ? state : emptyLamma();
  const ownedMedia = client.userId === owner && media.userId === owner ? media : emptyMedia();
  const previous = useRef(null);
  useEffect(() => {
    const connectionEpoch = connectGeneration;
    connectGeneration.current++; client.start(owner); engine.setAccount(owner);
    setActiveCall(null); setNotification(null); previous.current = null; connecting.current = false;
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
  }, [client, engine, owner]);
  useEffect(() => () => { engine.dispose().catch(() => {}); }, [engine]);
  useEffect(() => {
    if (!owner) return;
    let timer;
    const refresh = () => { if (document.hidden) return; client.refresh({ quiet: true }).catch(() => {}); };
    const event = e => {
      if (['typing', 'pong'].includes(e.detail?.type)) return;
      const { type, reason } = e.detail || {};
      if ((type === 'refresh' && !['read', 'presence'].includes(reason)) || (type === 'group' && ['membership', 'removed', 'closed', 'deleted'].includes(reason)) ||
        (type === 'message' && reason === 'deleted')) client.invalidateAudio();
      clearTimeout(timer); timer = setTimeout(refresh, 200);
    };
    const interval = setInterval(refresh, 15_000);
    window.addEventListener('maydan-social-event', event); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); clearInterval(interval); window.removeEventListener('maydan-social-event', event); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [client, owner]);
  useEffect(() => {
    const owners = new Set();
    const changed = event => { const { owner: key, active } = event.detail || {}; if (!key) return;
      if (active) owners.add(key); else owners.delete(key); sound.setDucking(owners.size > 0, 'lamma'); };
    window.addEventListener('maydan-social-audio', changed);
    return () => { window.removeEventListener('maydan-social-audio', changed); sound.setDucking(false, 'lamma'); };
  }, [sound]);
  useEffect(() => {
    const sync = () => {
    const { privateTurn } = socialInterruption.getSnapshot();
    if (isNativeShell()) callNative('socialAudioPrivacy', { privateTurn }, { timeout: 5000 }).catch(() => {});
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
      if (group) setNotification({ id: lammaId(), userId: owner, scope: 'group', groupId: group.id, conversationId: group.id,
        title: socialInterruption.getSnapshot().local || !safe.preferences.previews ? 'رسالة جديدة في ميدان' : `رسالة جديدة في ${group.name}` });
    }
    previous.current = Object.fromEntries(safe.groups.map(g => [g.id, g.unreadCount]));
  }, [safe.groups, safe.loading, safe.preferences, owner, client]);
  useEffect(() => {
    const active = activeRef.current;
    if (active && ((ownedMedia.callId === active.id && ownedMedia.ended) || safe.calls.some(c => c.id === active.id && ended(c)))) {
      const localOnly = ownedMedia.callId === active.id && ownedMedia.localOnly;
      const title = callEndNotice(ownedMedia.endReason);
      if (title) setNotification({ id: lammaId(), userId: owner, scope: active.scope, conversationId: active.conversationId, title });
      activeRef.current = null; setActiveCall(null);
      engine.disconnect({ callId: active.id, localOnly, endReason: ownedMedia.endReason }).catch(() => {});
      if (!localOnly && client.userId) client.callAction(active.id, 'leave', deviceRef.current).catch(() => {});
    }
    // A native incoming call can be accepted from the lock screen before React exists.
    if (!active && owner && ownedMedia.connected && ownedMedia.callId) {
      const call = safe.calls.find(c => c.id === ownedMedia.callId);
      if (call && !ended(call)) setActiveCall({ ...call, _ownerId: owner });
    }
  }, [ownedMedia.ended, ownedMedia.connected, ownedMedia.callId, ownedMedia.localOnly, ownedMedia.endReason, safe.calls, owner, client, engine]);
  // The list intentionally omits ended and unauthorized calls. Ask for the exact
  // active call to distinguish a real revocation from a stale list response.
  useEffect(() => {
    if (!ownedCallId || !owner) return;
    const id = ownedCallId, epoch = client.epoch;
    let cancelled = false, checking = false;
    const authorization = createCallAuthorization();
    const terminate = async reason => {
      if (cancelled || epoch !== client.epoch || activeRef.current?.id !== id) return;
      cancelled = true;
      const call = activeRef.current, title = callEndNotice(reason);
      if (title) setNotification({ id: lammaId(), userId: owner, scope: call.scope, conversationId: call.conversationId, title });
      activeRef.current = null; setActiveCall(null);
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
    const timer = setInterval(check, 5000); check();
    window.addEventListener('maydan-social-event', check);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('maydan-social-event', check); };
  }, [ownedCallId, owner, client, engine]);
  const incomingCall = !ownedCall && safe.preferences.calls ? safe.calls.find(call => call.scope === 'direct' && call.initiatorId !== owner &&
    !ended(call) && call.expiresAt > Date.now() && call.participants?.some(p => p.userId === owner && ['invited', 'ringing'].includes(p.state)) &&
    !safe.preferences.mutedConversations.some(m => m.scope === 'direct' && m.conversationId === call.conversationId)) || null : null;

  async function connect(action) {
    if (connecting.current || activeRef.current) throw new Error('لديك مكالمة جارية بالفعل.');
    connecting.current = true; const epoch = client.epoch, attempt = ++connectGeneration.current; let result;
    try {
      const deviceId = await deviceReady.current; client.assert(epoch);
      if (!deviceId || attempt !== connectGeneration.current) throw new Error('تم إلغاء المكالمة.');
      result = await action(deviceId); client.assert(epoch);
      if (attempt !== connectGeneration.current) throw new Error('تم إلغاء المكالمة.');
      const call = { ...result.call, _ownerId: owner };
      setActiveCall(call); activeRef.current = call;
      await engine.connect(result, { muted: socialInterruption.getSnapshot().privateTurn }); client.assert(epoch);
      if (attempt !== connectGeneration.current) throw new Error('تم إلغاء المكالمة.');
      client.refresh({ quiet: true }).catch(() => {}); return result.call;
    } catch (e) {
      if (epoch === client.epoch) {
        if (result?.call?.id) await client.callAction(result.call.id, 'leave', deviceRef.current).catch(() => {});
        if (attempt === connectGeneration.current) { setActiveCall(null); activeRef.current = null; }
      }
      throw e;
    } finally { if (epoch === client.epoch && attempt === connectGeneration.current) connecting.current = false; }
  }
  async function endCall() {
    connectGeneration.current++; connecting.current = false;
    const call = activeRef.current; activeRef.current = null; setActiveCall(null);
    await engine.disconnect({ callId: call?.id || engine.state.callId });
    if (call && client.userId) { await client.callAction(call.id, 'leave', deviceRef.current); await client.refresh({ quiet: true }); }
  }
  async function requestNotifications() {
    if (!isNativeShell()) { setNotificationPermission('foreground'); return { authorized: false, status: 'foreground' }; }
    const result = await callNative('socialNotifications', { request: true });
    setNotificationPermission(result?.authorized ? 'granted' : 'denied'); return result;
  }
  async function acceptGameInvite(id) {
    const result = await client.acceptGameInvite(id); navigate(`/room/${encodeURIComponent(result.roomCode)}`); return result;
  }
  const notifications = { ...safe.preferences, enabled: safe.preferences.messages, permission: notificationPermission };
  return <Context.Provider value={{ ...safe, ...client.actions, notifications, activeCall: ownedCall, incomingCall, media: ownedMedia,
    notification: notification?.userId === owner ? notification : null,
    clearNotification: () => setNotification(null), refreshGroups: options => client.refresh(options), requestNotifications, acceptGameInvite,
    startCall: target => connect(deviceId => client.startCall({ ...target, deviceId })),
    acceptCall: id => connect(deviceId => client.acceptCall(id, deviceId)),
    declineCall: async id => { await client.callAction(id, 'reject', await deviceReady.current); await client.refresh({ quiet: true }); },
    endCall, setCallMuted: muted => engine.mute(muted), setAudioOutput: id => engine.output(id), resumeCallAudio: () => engine.resumeAudio(),
  }}>{children}</Context.Provider>;
}
