import { callNative, isNativeShell, onNativeEvent } from '../shared/account/native.js';
import { LIVEKIT_MODULE } from './media-version.js';
import { socialInterruption } from './interruption.js';

export const MAX_VOICE_MS = 120_000;
let microphoneOwner = null;
const audioOwners = new Set();
const mediaError = (message, code = 'MEDIA') => Object.assign(new Error(message), { code });
function claim(owner) { if (microphoneOwner && microphoneOwner !== owner) throw mediaError('أنهِ المكالمة أو التسجيل الحالي أولًا.', 'CALL_BUSY'); microphoneOwner = owner; }
function release(owner) { if (microphoneOwner === owner) microphoneOwner = null; }
export function audioActivity(owner, active) {
  if (active) audioOwners.add(owner); else audioOwners.delete(owner);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('maydan-social-audio', { detail: { owner, active } }));
}
export const activeAudioOwners = () => [...audioOwners];

// Each binding owns its leases. Cleanup from a previous provider must never
// release a newer recording/preview's suppression.
export function bindSocialAudio(sound) {
  const lease = Symbol('social-audio'), owners = new Set(activeAudioOwners());
  const sync = () => {
    const exclusive = [...owners].some(key => /^(recorder-|voice-)/.test(String(key)));
    sound.setSuppressed?.(exclusive, lease);
    sound.music?.setSuppressed?.(exclusive, lease);
    sound.setDucking?.(owners.size > 0, lease);
  };
  const changed = event => {
    const { owner, active } = event.detail || {};
    if (!owner) return;
    if (active) owners.add(owner); else owners.delete(owner);
    sync();
  };
  sync();
  globalThis.window?.addEventListener('maydan-social-audio', changed);
  return () => {
    globalThis.window?.removeEventListener('maydan-social-audio', changed);
    sound.setDucking?.(false, lease);
    sound.setSuppressed?.(false, lease);
    sound.music?.setSuppressed?.(false, lease);
  };
}

// Notification renders, preference changes and game audio scope resets do not
// turn one received message into several sounds. Consume even muted messages.
export function createSocialNotificationAudio(sound) {
  let identity = null, generation = 0;
  const seen = new Set();
  const setIdentity = owner => {
    if (owner === identity) return;
    identity = owner; generation++; seen.clear();
  };
  return {
    setIdentity,
    emit(notification, { owner, scope = 'direct', messageId, muted = false, guard } = {}) {
      setIdentity(owner);
      if (!owner || notification?.userId !== owner || notification?.id == null) return false;
      const kind = notification.type === 'request' ? 'social.invite' : 'social.message';
      const conversationId = notification.conversationId || notification.friend?.conversationId || notification.groupId || '';
      const id = JSON.stringify([owner, scope, kind, conversationId, messageId || notification.messageId || notification.friend?.lastMessage?.id || notification.id]);
      if (seen.has(id)) return false;
      seen.add(id);
      while (seen.size > 512) seen.delete(seen.values().next().value);
      const epoch = generation;
      return sound.emit?.(kind, { id, muted, guard: () => identity === owner && generation === epoch && (typeof guard !== 'function' || guard()) }) ?? false;
    },
  };
}
function nativeAudio(result) {
  const binary = atob(result.base64 || ''); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return { blob: new Blob([bytes], { type: result.mimeType || 'audio/mp4' }), durationMs: result.durationMs };
}

export function createVoiceRecorder({ onInterrupted = () => {} } = {}) {
  const owner = `recorder-${globalThis.crypto.randomUUID()}`;
  let recorder, stream, chunks = [], startedAt = 0, timeout, stopped, pendingStop, stopPromise, interrupted, generation = 0, unsubscribe, recordingId, recording = false;
  const native = isNativeShell();
  const finish = (epoch = generation) => { if (epoch !== generation) return; clearTimeout(timeout); stream?.getTracks().forEach(t => t.stop()); stream = null; recording = false; release(owner); audioActivity(owner, false); };
  const api = {
    async start() {
      if (recording) throw mediaError('التسجيل جارٍ بالفعل.', 'CALL_BUSY');
      claim(owner); const epoch = ++generation, captureId = `${owner}-${epoch}`; recordingId = captureId; recording = true;
      // Reserve silence before requesting permission or opening native capture.
      audioActivity(owner, true);
      unsubscribe?.(); stopped = null; stopPromise = null; interrupted = null; chunks = [];
      try {
        if (native) {
          unsubscribe = onNativeEvent('socialVoice', event => {
            if (epoch !== generation || event?.recordingId !== captureId) return;
            if (event?.base64) { stopped = nativeAudio(event); finish(epoch); }
            else if (['interrupted', 'cancelled'].includes(event?.state)) {
              interrupted = mediaError('توقف التسجيل. ابدأ تسجيلًا جديدًا عندما تكون جاهزًا.'); finish(epoch); onInterrupted(interrupted);
            }
          });
          await callNative('socialVoiceStart', { recordingId: captureId });
          if (epoch !== generation) { await callNative('socialVoiceCancel', { recordingId: captureId }); return; }
          if (interrupted) throw interrupted;
        } else {
          if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw mediaError('التسجيل غير متاح في هذا المتصفح.');
          const capture = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
          if (epoch !== generation) { capture.getTracks().forEach(t => t.stop()); return; }
          stream = capture;
          const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m));
          recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
          recorder.addEventListener('dataavailable', e => { if (epoch === generation && e.data.size) chunks.push(e.data); });
          pendingStop = new Promise(resolve => {
            recorder.addEventListener('error', () => { if (epoch === generation) { interrupted = mediaError('تعذّر إكمال التسجيل.'); finish(epoch); onInterrupted(interrupted); } resolve(null); }, { once: true });
            recorder.addEventListener('stop', () => {
              if (epoch !== generation) { resolve(null); return; }
              stopped = { blob: new Blob(chunks, { type: recorder.mimeType.split(';')[0] }), durationMs: Math.min(MAX_VOICE_MS, Date.now() - startedAt) };
              finish(epoch); resolve(stopped);
            }, { once: true });
          });
          recorder.start(1000);
        }
        if (epoch !== generation || stopped) return;
        startedAt = Date.now(); audioActivity(owner, true);
        timeout = setTimeout(() => { api.stop().catch(error => { if (epoch === generation) { interrupted = error; onInterrupted(error); } }); }, MAX_VOICE_MS);
      } catch (e) { finish(epoch); if (epoch === generation) unsubscribe?.(); throw e?.name === 'NotAllowedError' ? mediaError('اسمح باستخدام الميكروفون لتسجيل رسالة.', 'MICROPHONE_DENIED') : e; }
    },
    async stop() {
      clearTimeout(timeout);
      if (interrupted) throw interrupted;
      if (stopped) return stopped;
      if (stopPromise) return stopPromise;
      const epoch = generation;
      stopPromise = (async () => {
      try {
        if (native) {
          const result = await callNative('socialVoiceStop', { recordingId });
          if (epoch !== generation) throw mediaError('تم إلغاء التسجيل.');
          stopped = nativeAudio(result); return stopped;
        }
        if (!recorder) throw mediaError('ابدأ التسجيل أولًا.');
        if (recorder.state !== 'inactive') recorder.stop();
        const result = await pendingStop; if (interrupted) throw interrupted; return result;
      } finally { finish(epoch); if (epoch === generation) unsubscribe?.(); }
      })(); return stopPromise;
    },
    cancel() {
      generation++; clearTimeout(timeout); unsubscribe?.();
      if (native && recordingId) callNative('socialVoiceCancel', { recordingId }, { timeout: 5000 }).catch(() => {});
      else if (recorder && recorder.state !== 'inactive') recorder.stop();
      finish(); chunks = []; stopped = null;
    },
  }; return api;
}

export const emptyMedia = () => ({ connected: false, connecting: false, muted: false, participants: [], audioOutputs: [], outputId: 'default', error: '',
  userId: null, callId: null, scope: null, conversationId: null, ended: false, ending: false, localOnly: false, endReason: null,
  mediaEpoch: -1, voiceSessionId: null, nativeMediaGeneration: -1, canPublish: true, quiet: false, authorizationRequired: false });
export class CallMedia {
  constructor(onChange = () => {}, { loadSDK } = {}) {
    this.onChange = onChange; this.state = emptyMedia(); this.generation = 0; this.elements = new Set(); this.pendingTracks = new Set(); this.owner = `live-call-${globalThis.crypto.randomUUID()}`;
    this.accountId = null;
    // Native call generations survive UI teardown; a delayed session snapshot
    // must not revive a call that the player or CallKit has already ended.
    this.nativeGeneration = -1; this.closedNativeCall = null;
    this.loadSDK = loadSDK; this.desiredMuted = false; this.playbackHeld = false; this.audioInterrupted = false;
    this.unsubscribe = onNativeEvent('socialCall', event => this.applyNativeSnapshot(event));
    this.foreground = () => { if ((typeof document !== 'undefined' && document.hidden) || this.playbackHeld || this.audioInterrupted) return; this.resumeAudio({ automatic: true }).catch(() => {}); };
    this.lifecycle = event => {
      const detail = event.detail || {};
      if (detail.state === 'background') return;
      if (detail.state === 'interruption-began') { this.audioInterrupted = true; for (const element of this.elements) element.pause(); return; }
      if (detail.state === 'interruption-ended' || detail.state === 'media-reset' || (detail.state === 'session-restored' && detail.shouldResume === true)) this.audioInterrupted = false;
      if (detail.shouldResume === false) { this.playbackHeld = true; for (const element of this.elements) element.pause(); if ((this.state.connected || this.state.connecting) && !this.state.ended) this.update({ error: 'اضغط تشغيل الصوت لسماع المكالمة.' }); return; }
      if (['foreground', 'media-reset', 'session-restored', 'interruption-ended'].includes(detail.state)) this.foreground();
    };
    if (typeof window !== 'undefined') { window.addEventListener('pageshow', this.foreground); window.addEventListener('maydan-audio-lifecycle', this.lifecycle); }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.foreground);
  }
  applyNativeSnapshot(event) {
      if (!this.accountId || event?.userId !== this.accountId || !event.callId) return;
      if (this.state.callId && !this.state.ended && this.state.callId !== event.callId) return;
      if (event.scope === 'mafia' && event.callId === this.state.callId && Number.isSafeInteger(event.mediaEpoch) && event.mediaEpoch < this.state.mediaEpoch) return;
      if (event.scope === 'mafia' && event.callId === this.state.callId && this.state.voiceSessionId && event.voiceSessionId !== this.state.voiceSessionId) return;
      if (event.scope === 'mafia' && event.callId === this.state.callId && Number.isSafeInteger(event.mediaGeneration) && event.mediaGeneration < this.state.nativeMediaGeneration) return;
      if (event.scope === 'mafia' && this.pausedMafia?.callId === event.callId && event.state === 'connected' &&
        event.mediaEpoch <= this.pausedMafia.epoch && !(event.mediaGeneration > this.pausedMafia.generation)) return;
      const nativeGeneration = Number.isSafeInteger(event.mediaGeneration) && event.mediaGeneration >= 0 ? event.mediaGeneration : -1;
      if (this.closedNativeCall?.id === event.callId && this.closedNativeCall.generation < 0 && !['ended', 'failed'].includes(event.state)) {
        const joining = this.nativeJoin;
        if (joining?.epoch === this.generation && joining.id === event.callId && nativeGeneration >= (joining.snapshot?.mediaGeneration ?? -1)) joining.snapshot = event;
        return;
      }
      if (nativeGeneration >= 0) {
        if (nativeGeneration < this.nativeGeneration) return;
        if (this.closedNativeCall?.id === event.callId && nativeGeneration <= this.closedNativeCall.generation &&
          !['ended', 'failed'].includes(event.state)) return;
        this.nativeGeneration = nativeGeneration;
        if (['ended', 'failed'].includes(event.state)) this.closedNativeCall = { id: event.callId, generation: nativeGeneration };
      }
      this.nativeCall = event;
      if (event.state === 'ended' || event.state === 'failed') { release(this.owner); audioActivity(this.owner, false); }
      else { try { claim(this.owner); } catch { /* native already arbitrated microphone */ } audioActivity(this.owner, true); }
      this.update({ connected: event.state === 'connected', connecting: ['connecting', 'ringing', 'reconnecting'].includes(event.state),
        muted: !!event.muted, participants: event.participants || [], callId: event.callId, scope: event.scope,
        mediaEpoch: Number.isSafeInteger(event.mediaEpoch) ? event.mediaEpoch : -1, canPublish: event.canPublish !== false, quiet: !!event.quiet,
        voiceSessionId: event.voiceSessionId || null, nativeMediaGeneration: Number.isSafeInteger(event.mediaGeneration) ? event.mediaGeneration : -1,
        userId: event.userId, conversationId: event.conversationId, ended: ['ended', 'failed'].includes(event.state), ending: event.state === 'ending',
        localOnly: !!event.localOnly, endReason: event.endReason || null, error: event.error || (this.playbackHeld && !event.quiet ? 'اضغط تشغيل الصوت لسماع المكالمة.' : ''),
        audioOutputs: [{ deviceId: 'default', label: 'السماعة' }, { deviceId: 'speaker', label: 'مكبر الصوت' }], outputId: event.speaker ? 'speaker' : 'default' });
  }
  setAccount(userId) {
    if (this.accountId === userId) return;
    const previous = this.accountId;
    this.accountId = userId;
    if (previous) this.disconnect().catch(() => {});
    else { this.generation++; this.update(emptyMedia()); }
    this.nativeCall = null;
    this.pausedMafia = null;
  }
  update(patch) { this.state = { ...this.state, ...patch }; this.onChange(this.state); }
  prepare() {
    if (isNativeShell()) return Promise.resolve(null);
    if (!this.sdk) {
      let pending;
      try { pending = Promise.resolve(this.loadSDK ? this.loadSDK() : import(new URL(LIVEKIT_MODULE, document.baseURI).href)); }
      catch (error) { return Promise.reject(error); }
      this.sdk = pending;
      pending.catch(() => { if (this.sdk === pending) this.sdk = null; });
    }
    return this.sdk;
  }
  async connect({ call, connection, mediaEpoch = -1, canPublish = true, quiet = false }, { muted = false } = {}) {
    if (!this.accountId) throw mediaError('سجّل الدخول أولًا.', 'AUTH_REQUIRED');
    const keepPlaybackHold = this.playbackHeld && this.state.userId === this.accountId && this.state.callId === call.id && !this.state.ended;
    claim(this.owner); const epoch = ++this.generation;
    this.playbackHeld = !!keepPlaybackHold;
    this.desiredMuted = muted || !canPublish || quiet || socialInterruption.getSnapshot().privateTurn;
    muted = this.desiredMuted;
    this.update({ ...emptyMedia(), userId: this.accountId, callId: call.id, scope: call.scope, conversationId: call.conversationId,
      connecting: true, muted, mediaEpoch, canPublish, quiet, voiceSessionId: call.voiceSessionId || null,
      error: this.playbackHeld && !quiet ? 'اضغط تشغيل الصوت لسماع المكالمة.' : '' });
    audioActivity(this.owner, true);
    try {
      if (isNativeShell()) {
        const joining = { epoch, id: call.id, recover: this.closedNativeCall?.id === call.id && this.closedNativeCall.generation < 0 };
        this.nativeJoin = joining;
        try {
          const snapshot = await callNative('socialCallConnect', { userId: this.accountId, callId: call.id, scope: call.scope, conversationId: call.conversationId,
            url: connection?.url, token: connection?.token, callerName: call.name || 'ميدان', muted, mediaEpoch, canPublish, quiet, voiceSessionId: call.voiceSessionId });
          if (epoch !== this.generation) {
            // Mafia cleanup is scoped to its old epoch/session. Social rejoin
            // has no such native fence, so preserve its newer same-call intent.
            if (call.scope === 'mafia' || this.state.callId !== call.id || this.state.ended || this.state.ending) await callNative('socialCallEnd', { callId: call.id, localOnly: true, endReason: 'cancelled',
              ...(call.scope === 'mafia' ? { expectedMediaEpoch: mediaEpoch, expectedVoiceSessionId: call.voiceSessionId } : {}) }, { timeout: 5000 }).catch(() => {});
          } else if (joining.recover && snapshot?.callId === call.id && snapshot.userId === this.accountId) {
            // Only the current explicit RPC can reopen a call left before its
            // first generation was known. Retain any newer queued native event.
            if (this.closedNativeCall?.id === call.id && this.closedNativeCall.generation < 0) this.closedNativeCall = null;
            if (!this.state.connected || this.state.nativeMediaGeneration !== snapshot.mediaGeneration) this.applyNativeSnapshot(snapshot);
            if (joining.snapshot) this.applyNativeSnapshot(joining.snapshot);
          }
        } finally { if (this.nativeJoin === joining) this.nativeJoin = null; }
        return;
      }
      if (quiet) { this.update({ connecting: false, connected: false, muted: true, participants: [] }); return; }
      // The web SDK is a separate, versioned local module. Native iPhone calls
      // never fetch it, and ordinary game startup never parses it.
      const { Room, RoomEvent, Track } = await this.prepare();
      if (epoch !== this.generation) return;
      const room = new Room({ adaptiveStream: false, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.room = room;
      const sync = () => {
        if (epoch !== this.generation) return;
        const participants = [room.localParticipant, ...room.remoteParticipants.values()].map(p => ({ id: p.identity, userId: p.identity,
          name: p.name || 'لاعب', speaking: p.isSpeaking, muted: !p.isMicrophoneEnabled, local: p === room.localParticipant }));
        this.update({ participants, muted: !room.localParticipant.isMicrophoneEnabled });
      };
      for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ActiveSpeakersChanged, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished]) room.on(event, sync);
      const attach = (track, play = true) => {
        if (track.kind !== Track.Kind.Audio || epoch !== this.generation) return;
        // SDK attach() starts playback too. Defer the attachment itself while
        // the OS/user requires silence, including a newly subscribed speaker.
        if (this.playbackHeld || this.audioInterrupted) { this.pendingTracks.add(track); sync(); return; }
        const element = track.attach(); element.dataset.lammaAudio = 'call'; document.body.append(element); this.elements.add(element);
        const failed = () => { if (epoch === this.generation && this.room === room && this.elements.has(element)) this.update({ error: 'اضغط تشغيل الصوت لسماع المكالمة.' }); };
        if (play) { try { Promise.resolve(element.play()).catch(failed); } catch { failed(); } }
        sync();
      };
      this.attachRemoteTrack = track => attach(track, false);
      room.on(RoomEvent.TrackSubscribed, track => attach(track));
      room.on(RoomEvent.TrackUnsubscribed, track => { this.pendingTracks.delete(track); for (const element of track.detach()) { this.elements.delete(element); element.remove(); } });
      room.on(RoomEvent.Reconnecting, () => { if (epoch === this.generation) this.update({ connecting: true, error: 'نعيد الاتصال بالمكالمة…' }); });
      room.on(RoomEvent.Reconnected, () => {
        if (epoch !== this.generation) return;
        this.update({ connecting: false, connected: true, ...(this.playbackHeld ? { error: 'اضغط تشغيل الصوت لسماع المكالمة.' } : {}) });
        this.foreground();
      });
      room.on(RoomEvent.Disconnected, () => {
        if (epoch !== this.generation) return;
        this.generation++; this.room = null; this.desiredMuted = true;
        this.clearElements(); release(this.owner); audioActivity(this.owner, false);
        room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
        if (this.state.scope === 'mafia') {
          // The server revokes the old RTC room before broadcasting the next
          // phase. This is not a user hang-up. Fence its late SDK events and
          // require a fresh grant; never reconnect with a cached credential.
          this.update({ connected: false, connecting: true, ended: false, muted: true, canPublish: false,
            participants: [], quiet: false, authorizationRequired: true, error: '' });
          return;
        }
        this.update({ connected: false, connecting: false, ended: true, muted: true, participants: [] });
      });
      await room.connect(connection.url, connection.token, { autoSubscribe: true });
      if (epoch !== this.generation) { await room.disconnect(); return; }
      // Privacy or the mute button may change while network/permission prompts
      // are pending. Never reopen the mic using the initial connect argument.
      const enableMicrophone = canPublish && !this.desiredMuted && !socialInterruption.getSnapshot().privateTurn;
      await room.localParticipant.setMicrophoneEnabled(enableMicrophone);
      if (epoch !== this.generation) { await room.disconnect(); return; }
      // Publishing itself can wait for capture/network negotiation. A secret
      // role or mute arriving during that wait must also win after it completes.
      if (enableMicrophone && (this.desiredMuted || socialInterruption.getSnapshot().privateTurn)) {
        this.desiredMuted = true;
        await room.localParticipant.setMicrophoneEnabled(false);
        if (epoch !== this.generation) { await room.disconnect(); return; }
      }
      this.update({ connected: true, connecting: false, error: this.playbackHeld ? 'اضغط تشغيل الصوت لسماع المكالمة.' : '' }); sync();
      if (typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (epoch === this.generation) this.update({ audioOutputs: devices.filter(d => d.kind === 'audiooutput').map(d => ({ deviceId: d.deviceId, label: d.label || 'سماعة' })) });
      }
    } catch (e) {
      if (epoch === this.generation) { await this.disconnect(); this.update({ error: e?.name === 'NotAllowedError' ? 'اسمح باستخدام الميكروفون لإجراء المكالمة.' : 'تعذّر الاتصال بالمكالمة. حاول مجددًا.' }); }
      throw e;
    }
  }
  clearElements() {
    // Removing an HTML audio node does not stop it. Silence and release the old
    // stream before asynchronous SDK shutdown, account change or audience pause.
    for (const element of this.elements) {
      try { element.pause?.(); } catch { /* continue retiring the other elements */ }
      try { element.srcObject = null; } catch { /* older media elements */ }
      element.remove();
    }
    this.elements.clear(); this.pendingTracks.clear(); this.attachRemoteTrack = null;
  }
  attachPendingTracks() {
    const tracks = [...this.pendingTracks]; this.pendingTracks.clear();
    for (const track of tracks) this.attachRemoteTrack?.(track);
  }
  async pauseGame() {
    if (this.state.scope !== 'mafia') return;
    this.pausedMafia = { callId: this.state.callId, epoch: this.state.mediaEpoch, generation: this.state.nativeMediaGeneration };
    const callId = this.state.callId, epoch = ++this.generation, room = this.room;
    this.room = null; this.desiredMuted = true; this.clearElements();
    this.update({ connected: false, connecting: false, quiet: true, muted: true, canPublish: false, participants: [], authorizationRequired: false });
    if (isNativeShell()) await callNative('socialCallPauseGame', { callId, expectedMediaEpoch: this.state.mediaEpoch }, { timeout: 5000 });
    else if (room) { room.localParticipant.setMicrophoneEnabled(false).catch(() => {}); await room.disconnect(); }
    if (epoch !== this.generation) return;
  }
  async transitionGame(result, options) {
    if (result.call?.scope !== 'mafia' || !Number.isSafeInteger(result.mediaEpoch)) throw mediaError('قناة المباراة غير صالحة.');
    if (this.state.callId === result.call.id && result.mediaEpoch < this.state.mediaEpoch) return;
    if (!isNativeShell() && this.state.scope === 'mafia') {
      const epoch = this.generation + 1;
      await this.pauseGame();
      if (this.generation !== epoch) return;
    }
    this.pausedMafia = null;
    return this.connect(result, options);
  }
  async mute(muted) {
    if (!muted && this.state.scope === 'mafia' && (!this.state.canPublish || this.state.quiet)) throw mediaError('الميكروفون مغلق في هذه المرحلة.', 'AUDIO_PRIVATE');
    if (!muted && socialInterruption.getSnapshot().privateTurn) throw mediaError('الميكروفون مكتوم خلال هذا الدور.', 'AUDIO_PRIVATE');
    this.desiredMuted = muted;
    const epoch = this.generation;
    if (isNativeShell()) await callNative('socialCallMute', { callId: this.state.callId, muted });
    else if (this.room) await this.room.localParticipant.setMicrophoneEnabled(!muted);
    if (epoch === this.generation) this.update({ muted: this.desiredMuted });
  }
  async output(id) {
    const epoch = this.generation;
    if (isNativeShell()) await callNative('socialCallSpeaker', { callId: this.state.callId, speaker: id === 'speaker' });
    else if (this.room) await this.room.switchActiveDevice('audiooutput', id);
    if (epoch === this.generation) this.update({ outputId: id });
  }
  async resumeAudio({ automatic = false } = {}) {
    if (!this.accountId || !this.state.callId || !this.state.connected || this.state.ended || this.state.ending) return;
    if (this.audioInterrupted || (automatic && this.playbackHeld)) return;
    if (!automatic) this.playbackHeld = false;
    const epoch = this.generation, room = this.room, accountId = this.accountId, callId = this.state.callId;
    if (this.resuming?.epoch === epoch) {
      this.resuming.again = true; this.resuming.userInitiated ||= !automatic;
      // WebKit requires play/startAudio inside the actual tap, even when an
      // automatic foreground attempt is still waiting for an earlier promise.
      if (!automatic && room && !(typeof document !== 'undefined' && document.hidden)) {
        this.attachPendingTracks();
        try { Promise.resolve(room.startAudio()).catch(() => {}); } catch { /* shared attempt reports failure */ }
        for (const element of this.elements) { try { Promise.resolve(element.play()).catch(() => {}); } catch { /* shared attempt reports failure */ } }
      }
      return this.resuming.promise;
    }
    const current = () => epoch === this.generation && this.accountId === accountId && this.state.callId === callId && this.state.connected && !this.state.ended && !this.state.ending && this.room === room;
    const mayPlay = () => current() && !this.audioInterrupted && !this.playbackHeld && !(typeof document !== 'undefined' && document.hidden);
    const task = { epoch, promise: null, again: false, userInitiated: !automatic };
    this.resuming = task;
    task.promise = (async () => {
      try {
        do {
          task.again = false;
          let failure;
          try {
            if (isNativeShell()) await callNative('socialCallResumeAudio', { callId, userInitiated: task.userInitiated }, { timeout: 5000 });
            else if (room) {
              if (!mayPlay()) return;
              this.attachPendingTracks();
              // Start every media promise before the first await: delaying
              // element.play() until SDK readiness loses Safari's tap gesture.
              const started = room.startAudio();
              const playback = [...this.elements].map(element => element.play());
              await Promise.all([started, ...playback]);
            }
          } catch (error) { failure = error; }
          if (!mayPlay()) return;
          if (failure && !task.again) throw failure;
        } while (task.again && mayPlay());
        if (mayPlay()) this.update({ error: '' });
      } catch (error) {
        if (current()) this.update({ error: 'اضغط تشغيل الصوت لسماع المكالمة.' });
        throw error;
      } finally { if (this.resuming === task) this.resuming = null; }
    })();
    return task.promise;
  }
  async disconnect({ callId = this.state.callId, localOnly = false, endReason = null, expectedMediaEpoch, expectedVoiceSessionId } = {}) {
    if (expectedVoiceSessionId && this.state.voiceSessionId && expectedVoiceSessionId !== this.state.voiceSessionId) return;
    if (callId && this.state.callId && callId !== this.state.callId) {
      if (isNativeShell()) await callNative('socialCallEnd', { callId, localOnly, endReason, expectedMediaEpoch, expectedVoiceSessionId }, { timeout: 5000 }).catch(() => {});
      return;
    }
    const epoch = ++this.generation;
    this.desiredMuted = true;
    if (isNativeShell() && this.state.callId) {
      this.nativeGeneration = Math.max(this.nativeGeneration, this.state.nativeMediaGeneration);
      this.closedNativeCall = { id: this.state.callId, generation: this.state.nativeMediaGeneration };
    }
    const room = this.room; this.room = null;
    this.clearElements(); release(this.owner); audioActivity(this.owner, false);
    this.update(localOnly && endReason ? { connected: false, connecting: false, ending: true, muted: true, localOnly, endReason } : emptyMedia());
    if (isNativeShell() && callId) await callNative('socialCallEnd', { callId, localOnly, endReason, expectedMediaEpoch, expectedVoiceSessionId }, { timeout: 5000 }).catch(() => {});
    else if (room) {
      room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      await room.disconnect();
    }
    if (epoch === this.generation) this.update(localOnly && endReason ? { connected: false, connecting: false, ending: false, ended: true, muted: true, localOnly, endReason, participants: [] } : emptyMedia());
  }
  dispose() { this.unsubscribe?.(); if (typeof window !== 'undefined') { window.removeEventListener('pageshow', this.foreground); window.removeEventListener('maydan-audio-lifecycle', this.lifecycle); } if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.foreground); return this.disconnect(); }
}
