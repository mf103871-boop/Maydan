// A match owns one visible call. Credentials belong to a server-selected media
// epoch, never to the faction named by the UI. No credentials are persisted.
const closed = new Set(['over', 'closed']);
const terminalDenials = new Set(['AUTH','AUTH_REQUIRED','AUTH_EXPIRED','ACCOUNT_SUSPENDED','NOT_FOUND','CALL_NOT_FOUND','CALL_UNAVAILABLE','CALL_FORBIDDEN','FORBIDDEN','BLOCKED','CALL_ANSWERED','MAFIA_VOICE_DEVICE','MAFIA_ACTIVE_ELSEWHERE','MAFIA_VOICE_SESSION','MAFIA_VOICE_CAPACITY']);
export const mafiaCommunicationLocked = state => state?.game === 'mafia' && state.phase !== 'lobby' && !closed.has(state.phase) && !!state.you?.roleId && state.members?.some(member => member.id === state.you.id && member.alive);
export const emptyMafiaVoice = () => ({ requested: false, status: 'off', mediaEpoch: -1, muted: true, canPublish: false, participants: [], error: '', previousCall: null });
export class MafiaVoiceSession {
  constructor({ request, deviceId, media, native = false, beforeJoin = async () => null, setCall = () => {}, onChange = () => {} }) {
    Object.assign(this, { request, deviceId, media, native, beforeJoin, setCall, onChange });
    this.state = emptyMafiaVoice(); this.generation = 0; this.epoch = -1; this.room = null; this.call = null; this.userMuted = true;
  }
  update(patch) { this.state = { ...this.state, ...patch }; this.onChange(this.state); }
  configure(room) {
    const next = room?.game === 'mafia' && !closed.has(room.phase) && room.settings?.voiceMode !== 'off' && !room.you?.spectator && (room.you?.roleId || room.phase === 'lobby' && room.you?.id) && room.mafiaVoice?.available !== false && (room.mafiaVoice?.callId || room.phase === 'lobby') ? room : null;
    if(this.room?.phase==='lobby'&&next&&next.phase!=='lobby') {this.userMuted=true;this.media.mute(true).catch(()=>{});this.update({muted:true});}
    if (this.room && (!next || this.room.code !== next.code || this.room.mafiaVoice.callId && next.mafiaVoice.callId && this.room.mafiaVoice.callId !== next.mafiaVoice.callId)) {
      this.stop().catch(() => {});
    }
    this.room = next;
    if (!next) return;
    this.update({ canPublish: !!next.mafiaVoice.canPublish });
    this.restoreNative(this.media.state);
    // A provider outage stops voice for everyone while the match continues over
    // text. Keep the logical call silent and wait for the server's next secured
    // epoch rather than asking again on every snapshot.
    if (next.mafiaVoice.outage) {
      if (this.state.requested) {
        if (this.epoch !== -1) { this.epoch = -1; this.media.pauseGame().catch(() => {}); }
        this.update({ status: 'reconnecting', mediaEpoch: -1, participants: [], muted: true, canPublish: false, error: '' });
      }
      return;
    }
    if (this.state.requested && this.epoch !== next.mafiaVoice.mediaEpoch) this.sync().catch(() => {});
  }
  async start() {
    // A voluntary leave revokes tokens for this same match/call ID. Its server
    // acknowledgment must finish before a later join can mint replacements.
    if (this.stopping) await this.stopping;
    if (!this.room) throw new Error('الصوت متاح بعد تجهيز المباراة.');
    if (this.state.requested) return this.sync();
    const generation = ++this.generation;
    this.voiceSessionId = crypto.randomUUID(); this.joined = false;
    this.update({ requested: true, status: 'connecting', error: '' });
    this.media.prepare().catch(() => {});
    try {
      const previousCall = await this.beforeJoin();
      if (generation !== this.generation) return;
      this.update({ previousCall });
      await this.sync();
    } catch (error) {
      if (generation === this.generation) this.update({ requested: false, status: 'off', error: error.message });
      throw error;
    }
  }
  async sync() {
    if (!this.state.requested || !this.room) return;
    if (this.pending) { this.again = true; return this.pending; }
    const generation = this.generation, code = this.room.code;
    const current = () => generation === this.generation && this.room?.code === code && this.state.requested;
    const task = (async () => {
      let staleReplies = 0;
      const transitionDeadline = Date.now() + 5000;
      do {
        this.again = false;
        const deviceId = await this.deviceId();
        if (!current()) return;
        let response;
        try {
          response = await this.request(code, { deviceId, voiceSessionId: this.voiceSessionId, operation: this.joined ? 'sync' : 'join', knownEpoch: this.epoch });
        } catch (error) {
          if (error.code === 'MAFIA_VOICE_TRANSITION' && current() && Date.now() < transitionDeadline) {
            await new Promise(resolve => setTimeout(resolve, 200)); this.again = true; continue;
          }
          throw error;
        }
        if (!current()) return;
        if (response.voiceSessionId !== this.voiceSessionId) throw new Error('انتهت صلاحية جلسة الصوت. أعد الانضمام.');
        this.joined = true;
        if (!response.call?.id || !Number.isSafeInteger(response.mediaEpoch)) throw new Error('تعذّر التحقق من قناة المباراة.');
        if (this.room.mafiaVoice.callId && response.call.id !== this.room.mafiaVoice.callId || response.mediaEpoch < (this.room.mafiaVoice.mediaEpoch || 0)) {
          if (++staleReplies >= 3) throw new Error('تغيّرت مرحلة المباراة. أعد الاتصال.');
          this.again = true; continue;
        }
        if (response.mediaEpoch < this.epoch) return;
        if(!this.room.mafiaVoice.callId)this.room={...this.room,mafiaVoice:{...this.room.mafiaVoice,callId:response.call.id}};
        // A provider retirement may invalidate our transport while an earlier
        // same-epoch sync is in flight. Its unchanged reply has no credential.
        if (response.unchanged && this.epoch !== response.mediaEpoch) {
          if (++staleReplies >= 3) throw new Error('تغيّرت قناة الصوت. نعيد التحقق من الاتصال.');
          this.again = true; continue;
        }
        this.call = { ...response.call, scope: 'mafia', name: 'مافيا ميدان', conversationId: code };
        this.setCall(this.call);
        if (!response.unchanged || this.epoch !== response.mediaEpoch) {
          this.update({ status: 'connecting', mediaEpoch: -1, participants: [], error: '' });
          await this.media.transitionGame({ ...response, call: this.call }, { muted: this.userMuted || !response.canPublish });
          if (!current()) return;
          this.epoch = response.mediaEpoch;
        }
        const nativeConnected = this.media.state.connected && this.media.state.callId === this.call.id &&
          this.media.state.voiceSessionId === this.voiceSessionId && this.media.state.mediaEpoch === response.mediaEpoch;
        this.update({ status: response.quiet ? 'silent' : this.native && !nativeConnected ? 'connecting' : 'connected', mediaEpoch: this.epoch, muted: this.media.state.muted,
          canPublish: !!response.canPublish, error: '' });
      } while (this.again && current());
    })();
    this.pending = task;
    try { return await task; }
    catch (error) {
      if (current()) {
        if (terminalDenials.has(error.code)) {
          await this.stop({ notify: false });
          this.update({ error: error.code === 'MAFIA_VOICE_CAPACITY' ? 'السعة الصوتية ممتلئة الآن. حاول لاحقًا؛ الغرفة لم تتحول إلى كتابية.' : 'انتهت صلاحية صوت المباراة. أعد الانضمام عند توفره.' });
          throw error;
        }
        // A transport may be healthy while authorization is lost. Stop audible
        // media immediately and require fresh server proof before reconnecting.
        await this.media.pauseGame();
        this.epoch = -1;
        this.update({ status: 'reconnecting', mediaEpoch: -1, participants: [], muted: true, error: 'تعذّر التحقق من صوت المباراة. نعيد الاتصال بأمان…' });
      }
      throw error;
    } finally { if (this.pending === task) this.pending = null; }
  }
  restoreNative(media) {
    if (!this.native || this.state.requested || !this.room || media.scope !== 'mafia' || media.ended || media.ending ||
      media.callId !== this.room.mafiaVoice.callId || media.conversationId !== this.room.code || !media.voiceSessionId ||
      (!media.connected && !media.connecting && !media.quiet)) return;
    this.voiceSessionId = media.voiceSessionId; this.joined = true;
    this.epoch = Number.isSafeInteger(media.mediaEpoch) ? media.mediaEpoch : -1;
    this.call = { id: media.callId, scope: 'mafia', conversationId: this.room.code, name: 'مافيا ميدان', voiceSessionId: media.voiceSessionId };
    this.setCall(this.call);
    this.update({ requested: true, status: 'reconnecting', mediaEpoch: -1, muted: !!media.muted, canPublish: false });
    this.sync().catch(() => {});
  }
  mediaChanged(media) {
    this.restoreNative(media);
    if (!this.state.requested || media.callId !== this.call?.id) return;
    if (media.voiceSessionId && media.voiceSessionId !== this.voiceSessionId) return;
    if (Number.isSafeInteger(media.mediaEpoch) && media.mediaEpoch < this.epoch) return;
    if (media.scope === 'mafia' && media.authorizationRequired) {
      this.epoch = -1;
      this.update({ status: 'reconnecting', mediaEpoch: -1, muted: true, canPublish: false, participants: [] });
      this.sync().catch(() => {});
      return;
    }
    if (this.native && Number.isSafeInteger(media.mediaEpoch)) this.epoch = Math.max(this.epoch, media.mediaEpoch);
    const participants = (media.participants || []).map(participant => {
      const seat = this.call.participants?.find(member => member.userId === (participant.userId || participant.id));
      return { ...participant, ...(seat?.seatId ? { id: seat.seatId, seatId: seat.seatId } : {}) };
    });
    this.update({ participants, mediaEpoch: this.epoch, muted: !!media.muted,
      ...(typeof media.canPublish === 'boolean' ? { canPublish: media.canPublish } : {}),
      status: media.quiet ? 'silent' : media.connecting ? 'connecting' : media.connected ? 'connected' : media.ended ? 'off' : this.state.status,
      ...(media.error ? { error: media.error } : {}) });
  }
  async mute(muted) {
    if (!muted && !this.state.canPublish) throw new Error('الميكروفون مغلق في هذه المرحلة.');
    await this.media.mute(muted); this.userMuted = muted; this.update({ muted });
  }
  stop({ notify = true } = {}) {
    if (this.stopping) return this.stopping;
    const code = this.room?.code, callId = this.call?.id, epoch = this.epoch, voiceSessionId = this.voiceSessionId;
    this.generation++; this.call = null; this.epoch = -1; this.userMuted = true;
    this.pending = null; this.again = false;
    this.update({ ...emptyMafiaVoice(), previousCall: this.state.previousCall });
    this.setCall(null);
    const task = (async () => {
      if (callId) await this.media.disconnect({ callId, localOnly: true, endReason: 'game-voice-left', expectedMediaEpoch: epoch, expectedVoiceSessionId: voiceSessionId });
      if (notify && code && callId) {
        try { await this.request(code, { deviceId: await this.deviceId(), operation: 'leave', callId, voiceSessionId }); } catch { /* A new join retires this session; late leave cannot revoke its replacement. */ }
      }
    })();
    this.stopping = task;
    task.finally(() => { if (this.stopping === task) this.stopping = null; }).catch(() => {});
    return task;
  }
  clear() { this.stop({ notify: false }).catch(() => {}); this.room = null; this.update(emptyMafiaVoice()); }
}
