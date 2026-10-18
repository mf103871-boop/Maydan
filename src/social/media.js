import { callNative, isNativeShell, onNativeEvent } from '../shared/account/native.js';
import { LIVEKIT_MODULE } from './media-version.js';
import { socialInterruption } from './interruption.js';

export const MAX_VOICE_MS = 120_000;
let microphoneOwner = null;
const mediaError = (message, code = 'MEDIA') => Object.assign(new Error(message), { code });
function claim(owner) { if (microphoneOwner && microphoneOwner !== owner) throw mediaError('أنهِ المكالمة أو التسجيل الحالي أولًا.', 'CALL_BUSY'); microphoneOwner = owner; }
function release(owner) { if (microphoneOwner === owner) microphoneOwner = null; }
function audioActivity(owner, active) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('maydan-social-audio', { detail: { owner, active } }));
}
function nativeAudio(result) {
  const binary = atob(result.base64 || ''); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return { blob: new Blob([bytes], { type: result.mimeType || 'audio/mp4' }), durationMs: result.durationMs };
}

export function createVoiceRecorder({ onInterrupted = () => {} } = {}) {
  const owner = `recorder-${globalThis.crypto.randomUUID()}`;
  let recorder, stream, chunks = [], startedAt = 0, timeout, stopped, pendingStop, stopPromise, interrupted, generation = 0, unsubscribe;
  const native = isNativeShell();
  const finish = () => { clearTimeout(timeout); stream?.getTracks().forEach(t => t.stop()); stream = null; release(owner); audioActivity(owner, false); };
  const api = {
    async start() {
      claim(owner); const epoch = ++generation; stopped = null; stopPromise = null; interrupted = null; chunks = [];
      try {
        if (native) {
          unsubscribe = onNativeEvent('socialVoice', event => {
            if (epoch !== generation || event?.recordingId !== owner) return;
            if (event?.base64) { stopped = nativeAudio(event); finish(); }
            else if (['interrupted', 'cancelled'].includes(event?.state)) {
              interrupted = mediaError('توقف التسجيل. ابدأ تسجيلًا جديدًا عندما تكون جاهزًا.'); finish(); onInterrupted(interrupted);
            }
          });
          await callNative('socialVoiceStart', { recordingId: owner });
          if (epoch !== generation) { await callNative('socialVoiceCancel', { recordingId: owner }); return; }
          if (interrupted) throw interrupted;
        } else {
          if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw mediaError('التسجيل غير متاح في هذا المتصفح.');
          const capture = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
          if (epoch !== generation) { capture.getTracks().forEach(t => t.stop()); return; }
          stream = capture;
          const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m));
          recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
          recorder.addEventListener('dataavailable', e => { if (e.data.size) chunks.push(e.data); });
          pendingStop = new Promise(resolve => {
            recorder.addEventListener('error', () => { interrupted = mediaError('تعذّر إكمال التسجيل.'); finish(); onInterrupted(interrupted); resolve(null); }, { once: true });
            recorder.addEventListener('stop', () => {
              stopped = { blob: new Blob(chunks, { type: recorder.mimeType.split(';')[0] }), durationMs: Math.min(MAX_VOICE_MS, Date.now() - startedAt) };
              finish(); resolve(stopped);
            }, { once: true });
          });
          recorder.start(1000);
        }
        startedAt = Date.now(); audioActivity(owner, true);
        timeout = setTimeout(() => { api.stop().catch(error => { if (epoch === generation) { interrupted = error; onInterrupted(error); } }); }, MAX_VOICE_MS);
      } catch (e) { finish(); unsubscribe?.(); throw e?.name === 'NotAllowedError' ? mediaError('اسمح باستخدام الميكروفون لتسجيل رسالة.', 'MICROPHONE_DENIED') : e; }
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
          const result = await callNative('socialVoiceStop', { recordingId: owner });
          if (epoch !== generation) throw mediaError('تم إلغاء التسجيل.');
          stopped = nativeAudio(result); return stopped;
        }
        if (!recorder) throw mediaError('ابدأ التسجيل أولًا.');
        if (recorder.state !== 'inactive') recorder.stop();
        const result = await pendingStop; if (interrupted) throw interrupted; return result;
      } finally { finish(); unsubscribe?.(); }
      })(); return stopPromise;
    },
    cancel() {
      generation++; clearTimeout(timeout); unsubscribe?.();
      if (native) callNative('socialVoiceCancel', { recordingId: owner }, { timeout: 5000 }).catch(() => {});
      else if (recorder && recorder.state !== 'inactive') recorder.stop();
      finish(); chunks = []; stopped = null;
    },
  }; return api;
}

export const emptyMedia = () => ({ connected: false, connecting: false, muted: false, participants: [], audioOutputs: [], outputId: 'default', error: '',
  userId: null, callId: null, scope: null, conversationId: null, ended: false, ending: false, localOnly: false, endReason: null });
export class CallMedia {
  constructor(onChange = () => {}, { loadSDK } = {}) {
    this.onChange = onChange; this.state = emptyMedia(); this.generation = 0; this.elements = new Set(); this.owner = `live-call-${globalThis.crypto.randomUUID()}`;
    this.accountId = null;
    this.loadSDK = loadSDK; this.desiredMuted = false;
    this.unsubscribe = onNativeEvent('socialCall', event => this.applyNativeSnapshot(event));
  }
  applyNativeSnapshot(event) {
      if (!this.accountId || event?.userId !== this.accountId || !event.callId) return;
      if (this.state.callId && !this.state.ended && this.state.callId !== event.callId) return;
      this.nativeCall = event;
      if (event.state === 'ended' || event.state === 'failed') { release(this.owner); audioActivity(this.owner, false); }
      else { try { claim(this.owner); } catch { /* native already arbitrated microphone */ } audioActivity(this.owner, true); }
      this.update({ connected: event.state === 'connected', connecting: ['connecting', 'ringing', 'reconnecting'].includes(event.state),
        muted: !!event.muted, participants: event.participants || [], callId: event.callId, scope: event.scope,
        userId: event.userId, conversationId: event.conversationId, ended: ['ended', 'failed'].includes(event.state), ending: event.state === 'ending',
        localOnly: !!event.localOnly, endReason: event.endReason || null, error: event.error || '',
        audioOutputs: [{ deviceId: 'default', label: 'السماعة' }, { deviceId: 'speaker', label: 'مكبر الصوت' }], outputId: event.speaker ? 'speaker' : 'default' });
  }
  setAccount(userId) {
    if (this.accountId === userId) return;
    const previous = this.accountId;
    this.accountId = userId;
    if (previous) this.disconnect().catch(() => {});
    else { this.generation++; this.update(emptyMedia()); }
    this.nativeCall = null;
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
  async connect({ call, connection }, { muted = false } = {}) {
    if (!this.accountId) throw mediaError('سجّل الدخول أولًا.', 'AUTH_REQUIRED');
    claim(this.owner); const epoch = ++this.generation;
    this.desiredMuted = muted || socialInterruption.getSnapshot().privateTurn;
    muted = this.desiredMuted;
    this.update({ ...emptyMedia(), userId: this.accountId, callId: call.id, connecting: true, muted });
    audioActivity(this.owner, true);
    try {
      if (isNativeShell()) {
        await callNative('socialCallConnect', { userId: this.accountId, callId: call.id, scope: call.scope, conversationId: call.conversationId,
          url: connection.url, token: connection.token, callerName: call.name || 'ميدان', muted });
        if (epoch !== this.generation) await callNative('socialCallEnd', { callId: call.id, localOnly: true, endReason: 'cancelled' }, { timeout: 5000 }).catch(() => {});
        return;
      }
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
      room.on(RoomEvent.TrackSubscribed, track => {
        if (track.kind !== Track.Kind.Audio || epoch !== this.generation) return;
        const element = track.attach(); element.dataset.lammaAudio = 'call'; document.body.append(element); this.elements.add(element);
        element.play().catch(() => this.update({ error: 'اضغط تشغيل الصوت لسماع المكالمة.' })); sync();
      });
      room.on(RoomEvent.TrackUnsubscribed, track => { for (const element of track.detach()) { this.elements.delete(element); element.remove(); } });
      room.on(RoomEvent.Reconnecting, () => { if (epoch === this.generation) this.update({ connecting: true, error: 'نعيد الاتصال بالمكالمة…' }); });
      room.on(RoomEvent.Reconnected, () => { if (epoch === this.generation) this.update({ connecting: false, connected: true, error: '' }); });
      room.on(RoomEvent.Disconnected, () => {
        if (epoch !== this.generation) return;
        this.clearElements(); release(this.owner); audioActivity(this.owner, false); this.update({ connected: false, connecting: false, ended: true });
      });
      await room.connect(connection.url, connection.token, { autoSubscribe: true });
      if (epoch !== this.generation) { await room.disconnect(); return; }
      // Privacy or the mute button may change while network/permission prompts
      // are pending. Never reopen the mic using the initial connect argument.
      await room.localParticipant.setMicrophoneEnabled(!this.desiredMuted && !socialInterruption.getSnapshot().privateTurn);
      if (epoch !== this.generation) { await room.disconnect(); return; }
      this.update({ connected: true, connecting: false, error: '' }); sync();
      if (typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (epoch === this.generation) this.update({ audioOutputs: devices.filter(d => d.kind === 'audiooutput').map(d => ({ deviceId: d.deviceId, label: d.label || 'سماعة' })) });
      }
    } catch (e) {
      if (epoch === this.generation) { await this.disconnect(); this.update({ error: e?.name === 'NotAllowedError' ? 'اسمح باستخدام الميكروفون لإجراء المكالمة.' : 'تعذّر الاتصال بالمكالمة. حاول مجددًا.' }); }
      throw e;
    }
  }
  clearElements() { for (const element of this.elements) element.remove(); this.elements.clear(); }
  async mute(muted) {
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
  async resumeAudio() { if (this.room) await this.room.startAudio(); this.update({ error: '' }); }
  async disconnect({ callId = this.state.callId, localOnly = false, endReason = null } = {}) {
    if (callId && this.state.callId && callId !== this.state.callId) {
      if (isNativeShell()) await callNative('socialCallEnd', { callId, localOnly, endReason }, { timeout: 5000 }).catch(() => {});
      return;
    }
    const epoch = ++this.generation;
    this.desiredMuted = true;
    const room = this.room; this.room = null;
    this.clearElements(); release(this.owner); audioActivity(this.owner, false);
    this.update(localOnly && endReason ? { connected: false, connecting: false, ending: true, muted: true, localOnly, endReason } : emptyMedia());
    if (isNativeShell() && callId) await callNative('socialCallEnd', { callId, localOnly, endReason }, { timeout: 5000 }).catch(() => {});
    else if (room) {
      room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      await room.disconnect();
    }
    if (epoch === this.generation) this.update(localOnly && endReason ? { connected: false, connecting: false, ending: false, ended: true, muted: true, localOnly, endReason, participants: [] } : emptyMedia());
  }
  dispose() { this.unsubscribe?.(); return this.disconnect(); }
}
