import { mergeMessages, socialError } from './client.js';

const ERRORS = {
  GROUP_FULL: 'الشلّة ممتلئة؛ الحد الأقصى ١٢ عضوًا.', GROUP_LIMIT: 'وصلت إلى الحد الأقصى للشِلَل.',
  FORBIDDEN: 'هذا الإجراء غير متاح لحسابك.', CALL_UNAVAILABLE: 'المكالمة غير متاحة الآن.',
  CALL_BUSY: 'لديك مكالمة أخرى جارية.', SERVICE_UNAVAILABLE: 'الخدمة غير متاحة حاليًا. حاول لاحقًا.',
  VOICE_UNAVAILABLE: 'التسجيلات الصوتية غير متاحة حاليًا.', LIVEKIT_UNAVAILABLE: 'المكالمات غير متاحة حاليًا.',
  TOO_LARGE: 'حجم التسجيل أكبر من المسموح.', ROOM_FULL: 'الغرفة ممتلئة.', ROOM_UNAVAILABLE: 'لم تعد الدعوة متاحة.',
  CALLS_UNAVAILABLE: 'المكالمات غير متاحة حاليًا. حاول لاحقًا.', AUDIO_UNAVAILABLE: 'التسجيلات الصوتية غير متاحة حاليًا.',
  AUDIO_INVALID: 'تعذّر قراءة التسجيل. سجّله مجددًا.', CALL_ANSWERED: 'فُتحت المكالمة على جهازك الآخر.',
  CALL_RECONNECTING: 'يجري تحديث اتصال المكالمة. حاول بعد لحظة.', GROUP_INVITE_UNAVAILABLE: 'لم تعد دعوة الشلّة متاحة.',
};
export const lammaError = e => ERRORS[e?.code] || socialError(e);
export const lammaId = () => globalThis.crypto.randomUUID();
export const DEFAULT_PREFERENCES = { messages: true, friendRequests: true, groupInvites: true, calls: true, previews: false, sound: true, mutedConversations: [] };
export const emptyLamma = () => ({ groups: [], groupInvites: [], groupConversations: {}, callMembers: {}, calls: [], loading: false,
  error: '', offline: false, preferences: { ...DEFAULT_PREFERENCES }, capabilities: { voiceMessages: false, liveCalls: false, pushNotifications: false } });
const enc = encodeURIComponent;
const inaccessible = e => ['NOT_FOUND', 'FORBIDDEN', 'BLOCKED'].includes(e?.code);
const normalizedMembers = members => {
  const seen = new Set();
  return (Array.isArray(members) ? members : []).flatMap(member => {
    const profile = member?.user || member?.profile || member;
    const id = member?.userId || member?.id || profile?.userId || profile?.id;
    if (typeof id !== 'string' || !id || seen.has(id)) return [];
    seen.add(id);
    return [{ ...profile, id, userId: id, name: profile?.name || member?.name || 'لاعب ميدان',
      role: member.role, joinedAt: member.joinedAt }];
  });
};
const membershipKey = group => JSON.stringify([group?.joinedAt, group?.role, group?.ownerId, group?.memberCount]);

export async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export class LammaClient {
  constructor({ request, onDirectChange = () => {}, makeURL = blob => URL.createObjectURL(blob), revokeURL = url => URL.revokeObjectURL(url) }) {
    this.request = request; this.onDirectChange = onDirectChange; this.makeURL = makeURL; this.revokeURL = revokeURL;
    this.state = emptyLamma(); this.userId = null; this.epoch = 0; this.authorizationEpoch = 0; this.listeners = new Set(); this.urls = new Map(); this.reads = new Map(); this.groupVersions = new Map(); this.pendingText = new Map(); this.sendingText = new Map(); this.pendingInvites = new Map(); this.pendingVoice = new WeakMap();
    this.callContext = null; this.callMembersGeneration = 0; this.pendingCallMembers = new Map(); this.revokedCallGroups = new Set();
    this.pendingGroupCreates = new Map(); this.pendingCalls = new Map(); this.groupsRevision = 0;
    this.subscribe = fn => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
    this.getSnapshot = () => this.state;
  }
  update(patch) { this.state = { ...this.state, ...patch }; for (const fn of [...this.listeners]) fn(); }
  assert(epoch) { if (epoch !== this.epoch || !this.userId) throw Object.assign(new Error('تغيّر الحساب.'), { code: 'STALE' }); }
  assertVisibility(epoch, authorizationEpoch, id, version) {
    this.assert(epoch);
    if (authorizationEpoch !== this.authorizationEpoch || (id !== undefined && version !== this.groupVersions.get(id)))
      throw Object.assign(new Error('تغيّرت صلاحية المحادثة. أعد تحميلها.'), { code: 'STALE' });
  }
  async call(path, options) {
    const epoch = this.epoch; this.assert(epoch);
    try { const result = await this.request(`/api/social${path}`, options); this.assert(epoch); return result; }
    catch (e) { this.assert(epoch); throw Object.assign(new Error(lammaError(e)), { code: e?.code || 'NETWORK' }); }
  }
  start(userId) { this.stop(); this.userId = userId; if (userId) this.refresh().catch(() => {}); }
  invalidateCallMembers() {
    this.callMembersGeneration++; this.pendingCallMembers.clear();
    this.update({ callMembers: {} });
  }
  setCallContext(call) {
    const next = call?.id ? { id: call.id, scope: call.scope, conversationId: call.conversationId } : null;
    if (JSON.stringify(next) === JSON.stringify(this.callContext)) return;
    this.callContext = next; this.invalidateCallMembers();
  }
  assertCallMembers(epoch, authorizationEpoch, generation, id) {
    this.assertVisibility(epoch, authorizationEpoch);
    if (generation !== this.callMembersGeneration || this.callContext?.scope !== 'group' || this.callContext.conversationId !== id)
      throw Object.assign(new Error('تغيّرت المكالمة.'), { code: 'STALE' });
    if (this.revokedCallGroups.has(id)) throw Object.assign(new Error(ERRORS.FORBIDDEN), { code: 'FORBIDDEN' });
  }
  invalidateAudio() { this.authorizationEpoch++; this.invalidateCallMembers(); for (const url of this.urls.values()) this.revokeURL(url); this.urls.clear(); }
  stop() { this.epoch++; this.userId = null; this.activeGroup = null; this.callContext = null; this.refreshing = null; this.reads.clear(); this.groupVersions.clear(); this.pendingText.clear(); this.sendingText.clear(); this.pendingInvites.clear(); this.pendingVoice = new WeakMap(); this.pendingGroupCreates.clear(); this.pendingCalls.clear(); this.revokedCallGroups.clear(); this.invalidateAudio(); this.update(emptyLamma()); }
  async refresh({ quiet = false } = {}) {
    if (!this.userId) return;
    if (this.refreshing) return this.refreshing;
    const epoch = this.epoch, authorizationEpoch = this.authorizationEpoch, groupsRevision = this.groupsRevision;
    if (!quiet) this.update({ loading: true, error: '' });
    const task = (async () => {
      try {
        const [groups, preferences, capabilities, calls] = await Promise.all([
          this.call('/groups'), this.call('/preferences'), this.call('/capabilities'), this.call('/calls'),
        ]);
        this.assertVisibility(epoch, authorizationEpoch);
        if (groupsRevision !== this.groupsRevision) throw Object.assign(new Error('تحدّثت قائمة الشلل.'), { code: 'STALE' });
        const allowed = new Set((groups.groups || []).map(g => g.id));
        // Removing the visible snapshot must also fence detail/history reads
        // already in flight, including quiet reads with no conversation entry.
        for (const id of new Set([...this.groupVersions.keys(), ...Object.keys(this.state.groupConversations)]))
          if (!allowed.has(id)) this.groupVersions.set(id, (this.groupVersions.get(id) || 0) + 1);
        for (const [clientId, message] of this.pendingText) if (!allowed.has(message.groupId)) this.pendingText.delete(clientId);
        const callGroup = this.callContext?.scope === 'group' ? this.callContext.conversationId : null;
        if (callGroup) {
          const before = this.state.groups.find(group => group.id === callGroup);
          const after = (groups.groups || []).find(group => group.id === callGroup);
          if (!after) this.revokedCallGroups.add(callGroup); else this.revokedCallGroups.delete(callGroup);
          if (!after || (before && membershipKey(before) !== membershipKey(after))) this.invalidateCallMembers();
        }
        this.update({ groups: groups.groups || [], groupInvites: groups.incoming || [], calls: calls.calls || [],
          preferences: { ...DEFAULT_PREFERENCES, ...(preferences.preferences || preferences) }, capabilities: capabilities.capabilities || capabilities,
          groupConversations: Object.fromEntries(Object.entries(this.state.groupConversations).filter(([id]) => allowed.has(id))), loading: false, offline: false, error: '' });
        if (this.activeGroup && allowed.has(this.activeGroup)) await this.loadGroup(this.activeGroup, { quiet: true });
      } catch (e) {
        if (epoch === this.epoch && e.code !== 'STALE') this.update({ loading: false, error: e.code === 'NOT_FOUND' ? 'الشِلَل تحتاج تحديث الخدمة. محادثات الأصدقاء متاحة.' : e.message, offline: e.code === 'NETWORK' });
        throw e;
      } finally { if (epoch === this.epoch) this.refreshing = null; }
    })(); this.refreshing = task; return task;
  }
  group(id, patch) { this.update({ groupConversations: { ...this.state.groupConversations, [id]: { messages: [], ...this.state.groupConversations[id], ...patch } } }); }
  publishGroupMessage(id, message) {
    // A history snapshot started before this acknowledgement must not erase it.
    this.groupVersions.set(id, (this.groupVersions.get(id) || 0) + 1);
    this.group(id, { messages: mergeMessages(this.state.groupConversations[id]?.messages || [], [message]), loading: false, loadingOlder: false });
  }
  selectGroup(id) { this.activeGroup = id || null; }
  async loadCallMembers(id) {
    const epoch = this.epoch, authorizationEpoch = this.authorizationEpoch, generation = this.callMembersGeneration;
    this.assertCallMembers(epoch, authorizationEpoch, generation, id);
    if (this.state.callMembers[id]) return this.state.callMembers[id];
    if (this.pendingCallMembers.has(id)) return this.pendingCallMembers.get(id);
    const task = (async () => {
      try {
        // Restoring a native call needs profiles, never the group's message history.
        const detail = await this.call(`/groups/${enc(id)}`);
        this.assertCallMembers(epoch, authorizationEpoch, generation, id);
        const members = normalizedMembers(detail.members);
        this.update({ callMembers: { ...this.state.callMembers, [id]: members } });
        return members;
      } catch (e) {
        if (epoch === this.epoch && authorizationEpoch === this.authorizationEpoch && generation === this.callMembersGeneration && inaccessible(e)) {
          this.revokedCallGroups.add(id); this.invalidateCallMembers();
        }
        throw e;
      } finally { if (this.pendingCallMembers.get(id) === task) this.pendingCallMembers.delete(id); }
    })();
    this.pendingCallMembers.set(id, task); return task;
  }
  async loadGroup(id, { quiet = false } = {}) {
    const epoch = this.epoch, authorizationEpoch = this.authorizationEpoch;
    const callMembersGeneration = this.callMembersGeneration;
    const firstLoaded = this.state.groupConversations[id]?.messages.find(message => Number.isSafeInteger(message.seq))?.seq;
    const version = (this.groupVersions.get(id) || 0) + 1; this.groupVersions.set(id, version);
    if (!quiet) this.group(id, { loading: true, error: '' });
    try {
      const [detail, history] = await Promise.all([this.call(`/groups/${enc(id)}`), this.call(`/groups/${enc(id)}/messages`)]);
      this.assertVisibility(epoch, authorizationEpoch, id, version);
      // Re-authorize the whole loaded window, not only its last page. Reusing the
      // old rows would restore blocked/deleted content; replacing just the last
      // page discarded history whenever a message or recovery poll arrived.
      let page = history, authorized = history.messages || [];
      while (Number.isSafeInteger(firstLoaded) && page.hasMore && Number.isSafeInteger(page.nextBefore) && page.nextBefore > firstLoaded) {
        const before = page.nextBefore;
        page = await this.call(`/groups/${enc(id)}/messages?before=${enc(before)}`);
        this.assertVisibility(epoch, authorizationEpoch, id, version);
        if (page.hasMore && (!Number.isSafeInteger(page.nextBefore) || page.nextBefore >= before))
          throw Object.assign(new Error('تعذّر تحديث سجل المحادثة. حاول مجددًا.'), { code: 'NETWORK' });
        authorized = mergeMessages(page.messages || [], authorized);
      }
      // Only our unsent outbox survives without a fresh server authorization.
      const outbox = (this.state.groupConversations[id]?.messages || []).filter(message => !Number.isSafeInteger(message.seq) && message.senderId === this.userId);
      const messages = mergeMessages(outbox, authorized);
      for (const message of messages) if (Number.isSafeInteger(message.seq)) this.pendingText.delete(message.clientId);
      this.group(id, { ...detail, ...history, hasMore: page.hasMore, nextBefore: page.nextBefore, messages, loading: false, loadingOlder: false, error: '' });
      if (this.callContext?.scope === 'group' && this.callContext.conversationId === id && callMembersGeneration === this.callMembersGeneration && !this.revokedCallGroups.has(id))
        this.update({ callMembers: { ...this.state.callMembers, [id]: normalizedMembers(detail.members) } });
      return this.state.groupConversations[id];
    } catch (e) {
      if (epoch === this.epoch && version === this.groupVersions.get(id) && authorizationEpoch === this.authorizationEpoch) {
        this.group(id, { loading: false, error: e.message, ...(inaccessible(e) ? { messages: [], members: [] } : {}) });
        if (inaccessible(e)) for (const [clientId, message] of this.pendingText) if (message.groupId === id) this.pendingText.delete(clientId);
        if (inaccessible(e) && this.callContext?.scope === 'group' && this.callContext.conversationId === id) {
          this.revokedCallGroups.add(id); this.invalidateCallMembers();
        }
      }
      throw e;
    }
  }
  async loadOlderGroup(id) {
    const current = this.state.groupConversations[id]; if (!current?.hasMore || current.loadingOlder) return;
    const epoch = this.epoch, authorizationEpoch = this.authorizationEpoch, version = this.groupVersions.get(id); this.group(id, { loadingOlder: true });
    try { const history = await this.call(`/groups/${enc(id)}/messages?before=${enc(current.nextBefore)}`); this.assertVisibility(epoch, authorizationEpoch, id, version);
      this.group(id, { ...history, messages: mergeMessages(history.messages || [], this.state.groupConversations[id]?.messages || []), loadingOlder: false });
    } catch (e) { if (epoch === this.epoch && version === this.groupVersions.get(id) && authorizationEpoch === this.authorizationEpoch) this.group(id, { loadingOlder: false, error: e.message }); throw e; }
  }
  async groupAction(id, suffix, method = 'POST', body = {}) {
    const epoch = this.epoch;
    const result = await this.call(`/groups/${enc(id)}${suffix}`, { method, body }); this.assert(epoch);
    this.invalidateAudio(); await this.refresh({ quiet: true }); this.assert(epoch); return result;
  }
  async createGroup({ name, memberIds = [] }) {
    const epoch = this.epoch;
    name = String(name || '').trim(); memberIds = [...new Set(memberIds)].sort();
    const key = JSON.stringify([name, memberIds]);
    let attempt = this.pendingGroupCreates.get(key);
    if (!attempt) { attempt = { clientId: lammaId() }; this.pendingGroupCreates.set(key, attempt); }
    if (attempt.sending) return attempt.sending;
    const task = (async () => {
      const result = await this.call('/groups', { method: 'POST', body: { name, clientId: attempt.clientId } }); this.assert(epoch);
      const group = result.group || result; const failedInvites = [];
      for (const userId of memberIds) { try { await this.call(`/groups/${enc(group.id)}/invites`, { method: 'POST', body: { userId } }); this.assert(epoch); } catch (e) { this.assert(epoch); if (e.code === 'STALE') throw e; failedInvites.push(userId); } }
      // The mutation is already committed. A later GET must not turn it into a
      // failed creation or encourage the player to create the same group twice.
      this.groupsRevision++;
      this.update({ groups: [group, ...this.state.groups.filter(value => value.id !== group.id)], loading: false });
      if (this.pendingGroupCreates.get(key) === attempt) this.pendingGroupCreates.delete(key);
      // Drain a pre-creation list read before starting its replacement. Its
      // revision fence above prevents it from erasing this acknowledged group.
      Promise.resolve(this.refreshing).catch(() => {}).then(() => { this.assert(epoch); return this.refresh({ quiet: true }); }).catch(() => {});
      return { ...group, failedInvites };
    })();
    attempt.sending = task;
    try { return await task; }
    catch (error) {
      if (epoch === this.epoch && !['NETWORK', 'TIMEOUT', 'SERVICE_UNAVAILABLE'].includes(error.code) && this.pendingGroupCreates.get(key) === attempt)
        this.pendingGroupCreates.delete(key);
      throw error;
    } finally { if (attempt.sending === task) attempt.sending = null; }
  }
  async inviteGroupMembers(id, userIds) { const epoch = this.epoch; for (const userId of userIds) { await this.groupAction(id, '/invites', 'POST', { userId }); this.assert(epoch); } return this.loadGroup(id); }
  acceptGroupInvite(id, inviteId) { return this.groupAction(id, `/invites/${enc(inviteId)}/accept`); }
  rejectGroupInvite(id, inviteId) { return this.groupAction(id, `/invites/${enc(inviteId)}/reject`); }
  leaveGroup(id) { return this.groupAction(id, '/leave'); }
  renameGroup(id, name) { return this.groupAction(id, '', 'PATCH', { name }); }
  updateGroupAvatar(id, avatarPreset) { return this.groupAction(id, '', 'PATCH', { avatarPreset }); }
  reportGroupMessage(id, messageSeq, reason) { return this.call(`/groups/${enc(id)}/reports`, { method: 'POST', body: { messageSeq, reason } }); }
  removeGroupMember(id, userId) { return this.groupAction(id, `/members/${enc(userId)}`, 'DELETE'); }
  setGroupRole(id, userId, role) { return this.groupAction(id, `/members/${enc(userId)}`, 'PATCH', { role }); }
  transferGroupOwnership(id, userId) { return this.groupAction(id, '/ownership', 'POST', { userId }); }
  async sendGroupMessage(id, text, clientId) {
    const epoch = this.epoch, authorizationEpoch = this.authorizationEpoch;
    this.assert(epoch); text = String(text || '').trim();
    if (!text || text.length > 2000) throw Object.assign(new Error('اكتب رسالة من حرف إلى 2000 حرف.'), { code: 'INVALID' });
    const previous = [...this.pendingText.values()].find(message => message.groupId === id && message.text === text);
    clientId ||= previous?.clientId || lammaId();
    const pending = this.pendingText.get(clientId) || { groupId: id, conversationId: id, senderId: this.userId,
      kind: 'text', text, clientId, createdAt: Date.now(), status: 'pending' };
    if (pending.groupId !== id || pending.text !== text) throw Object.assign(new Error('تغيّرت الرسالة. أعد المحاولة.'), { code: 'CONFLICT' });
    if (this.sendingText.has(clientId)) return this.sendingText.get(clientId);
    this.pendingText.set(clientId, pending);
    const messages = this.state.groupConversations[id]?.messages || [];
    this.group(id, { messages: messages.some(message => message.clientId === clientId)
      ? messages.map(message => message.clientId === clientId && !Number.isSafeInteger(message.seq) ? { ...message, status: 'pending' } : message)
      : [...messages, { ...pending, status: 'pending' }] });
    const task = (async () => {
      try {
        const result = await this.call(`/groups/${enc(id)}/messages`, { method: 'POST', body: { kind: 'text', text, clientId } });
        this.assertVisibility(epoch, authorizationEpoch);
        if (!this.state.groupConversations[id]) throw Object.assign(new Error('تغيّرت صلاحية المحادثة.'), { code: 'STALE' });
        this.pendingText.delete(clientId);
        this.publishGroupMessage(id, result.message);
        this.refresh({ quiet: true }).catch(() => {}); return result.message;
      } catch (error) {
        if (epoch === this.epoch && this.state.groupConversations[id]) {
          if (inaccessible(error)) {
            this.pendingText.delete(clientId); this.group(id, { messages: [], members: [], error: error.message });
          } else this.group(id, { messages: this.state.groupConversations[id].messages.map(message => message.clientId === clientId && !Number.isSafeInteger(message.seq) ? { ...message, status: 'failed' } : message) });
        }
        throw error;
      } finally { if (this.sendingText.get(clientId) === task) this.sendingText.delete(clientId); }
    })();
    this.sendingText.set(clientId, task); return task;
  }
  retryGroupMessage(id, clientId) {
    const message = this.state.groupConversations[id]?.messages.find(value => value.clientId === clientId && value.status === 'failed' && value.senderId === this.userId && !Number.isSafeInteger(value.seq));
    return message ? this.sendGroupMessage(id, message.text, clientId) : Promise.resolve();
  }
  async changeGroupMessage(id, seq, text) {
    const epoch = this.epoch;
    const result = await this.call(`/groups/${enc(id)}/messages/${enc(seq)}`, { method: text === null ? 'DELETE' : 'PATCH', body: text === null ? undefined : { text } });
    this.assert(epoch); await this.loadGroup(id, { quiet: true }); this.assert(epoch); return result;
  }
  async markGroupRead(id, seq) {
    const epoch = this.epoch;
    if (!Number.isSafeInteger(seq) || seq <= (this.reads.get(id) || 0)) return;
    await this.call(`/groups/${enc(id)}/read`, { method: 'POST', body: { seq } }); this.assert(epoch); this.reads.set(id, seq);
    this.update({ groups: this.state.groups.map(g => g.id === id ? { ...g, unreadCount: 0 } : g) });
  }
  async sendVoiceNote({ targetType, targetId, blob, durationMs, clientId }) {
    const epoch = this.epoch, authorizationEpoch = this.authorizationEpoch; this.assert(epoch);
    if (!blob || blob.size > 3 * 1024 * 1024 || durationMs > 120_000 || durationMs <= 0) throw new Error('مدة التسجيل دقيقتان كحد أقصى.');
    if (targetType === 'group' && !this.state.groupConversations[targetId]) this.group(targetId, {});
    const key = `${targetType}:${targetId}`;
    let attempts = this.pendingVoice.get(blob); if (!attempts) { attempts = new Map(); this.pendingVoice.set(blob, attempts); }
    let attempt = attempts.get(key);
    if (!attempt || (clientId && attempt.clientId !== clientId)) { attempt = { clientId: clientId || lammaId() }; attempts.set(key, attempt); }
    if (attempt.sending) return attempt.sending;
    clientId = attempt.clientId;
    const task = (async () => {
      // A confirmed upload is reusable after a lost message acknowledgement.
      // The message POST still rechecks membership and attachment ownership.
      if (!attempt.attachment) {
        let body;
        // Negotiated in the existing capability refresh; no extra request before
        // sending. Older servers and clients keep their JSON upload protocol.
        if (this.state.capabilities.binaryVoiceUpload && typeof FormData !== 'undefined') {
          body = new FormData();
          for (const [key,value] of Object.entries({scope:targetType,conversationId:targetId,clientId,durationMs:Math.round(durationMs)})) body.append(key,String(value));
          body.append('audio',blob,'voice');
        } else {
          const dataBase64 = await blobBase64(blob);
          body = { scope: targetType, conversationId: targetId, clientId, dataBase64, mimeType: blob.type.split(';')[0], durationMs: Math.round(durationMs) };
        }
        this.assertVisibility(epoch, authorizationEpoch);
        const result = await this.call('/attachments', { method: 'POST', timeout: 60_000, body });
        this.assertVisibility(epoch, authorizationEpoch); attempt.attachment = result.attachment;
      }
      const path = targetType === 'group' ? `/groups/${enc(targetId)}/messages` : `/conversations/${enc(targetId)}/messages`;
      const result = await this.call(path, { method: 'POST', body: { kind: 'voice', attachmentId: attempt.attachment.id, clientId } });
      this.assertVisibility(epoch, authorizationEpoch);
      if (targetType === 'group') {
        if (!this.state.groupConversations[targetId]) throw Object.assign(new Error('تغيّرت صلاحية المحادثة.'), { code: 'STALE' });
        this.publishGroupMessage(targetId, result.message);
        this.refresh({ quiet: true }).catch(() => {});
      } else Promise.resolve().then(() => { this.assertVisibility(epoch, authorizationEpoch); return this.onDirectChange(result.message, targetId); }).catch(() => {});
      // Sending finishes at the server acknowledgement, never after extra history downloads.
      return result.message;
    })();
    attempt.sending = task;
    try { return await task; } finally { if (attempt.sending === task) attempt.sending = null; }
  }
  async getVoiceUrl(id) {
    const epoch = this.epoch;
    const authorizationEpoch = this.authorizationEpoch;
    // Authorize every playback; cached Blob URLs must not bypass a later block/removal.
    const blob = await this.call(`/attachments/${enc(id)}/content`, { responseType: 'blob', timeout: 60_000 });
    this.assert(epoch);
    if (authorizationEpoch !== this.authorizationEpoch) throw Object.assign(new Error('تغيّرت صلاحية الوصول للصوت؛ أعد المحاولة.'), { code: 'STALE' });
    if (this.urls.has(id)) this.revokeURL(this.urls.get(id));
    const url = this.makeURL(blob); this.urls.set(id, url); return url;
  }
  async setNotificationPreferences(patch) {
    const epoch = this.epoch;
    const body = { ...patch }; if ('enabled' in body) { body.messages = body.calls = body.groupInvites = body.friendRequests = body.enabled; delete body.enabled; }
    const result = await this.call('/preferences', { method: 'PUT', body });
    this.assert(epoch);
    this.update({ preferences: { ...this.state.preferences, ...body, ...(result.preferences || {}) } }); return result;
  }
  setConversationMuted({ targetType, targetId, muted }) {
    const rest = this.state.preferences.mutedConversations.filter(c => !(c.scope === targetType && c.conversationId === targetId));
    return this.setNotificationPreferences({ mutedConversations: muted ? [...rest, { scope: targetType, conversationId: targetId }] : rest });
  }
  async sendGameInvite({ targetType, targetId, roomCode, clientId }) {
    const epoch = this.epoch, authorizationEpoch = this.authorizationEpoch;
    const pendingKey = JSON.stringify([targetType, targetId, roomCode]);
    clientId ||= this.pendingInvites.get(pendingKey) || lammaId(); this.pendingInvites.set(pendingKey, clientId);
    const result = await this.call('/room-invitations', { method: 'POST', body: { scope: targetType, conversationId: targetId, roomCode, clientId } });
    this.assertVisibility(epoch, authorizationEpoch);
    if (this.pendingInvites.get(pendingKey) === clientId) this.pendingInvites.delete(pendingKey);
    if (targetType === 'group') {
      if (result.message && this.state.groupConversations[targetId]) this.publishGroupMessage(targetId, result.message);
      this.refresh({ quiet: true }).catch(() => {});
    } else Promise.resolve().then(() => { this.assertVisibility(epoch, authorizationEpoch); return this.onDirectChange(result.message, targetId); }).catch(() => {});
    return result;
  }
  acceptGameInvite(id) { return this.call(`/room-invitations/${enc(id)}/accept`, { method: 'POST', body: {} }); }
  rejectGameInvite(id) { return this.call(`/room-invitations/${enc(id)}/reject`, { method: 'POST', body: {} }); }
  async startCall({ targetType, targetId, deviceId }) {
    const epoch = this.epoch, key = JSON.stringify([targetType, targetId, deviceId]);
    let attempt = this.pendingCalls.get(key);
    if (!attempt) { attempt = { clientId: lammaId() }; this.pendingCalls.set(key, attempt); }
    if (attempt.sending) return attempt.sending;
    // Retrying an uncertain response re-joins the exact committed call through
    // the server's existing idempotency path, without ringing a second call.
    const task = this.call('/calls', { method: 'POST', body: { scope: targetType, conversationId: targetId, clientId: attempt.clientId, deviceId } });
    attempt.sending = task;
    try {
      const result = await task; this.assert(epoch);
      if (this.pendingCalls.get(key) === attempt) this.pendingCalls.delete(key);
      return result;
    } catch (error) {
      if (epoch === this.epoch && !['NETWORK', 'TIMEOUT', 'CALLS_UNAVAILABLE', 'CALL_RECONNECTING', 'SERVICE_UNAVAILABLE'].includes(error.code) && this.pendingCalls.get(key) === attempt)
        this.pendingCalls.delete(key);
      throw error;
    } finally { if (attempt.sending === task) attempt.sending = null; }
  }
  acceptCall(id, deviceId) { return this.call(`/calls/${enc(id)}/accept`, { method: 'POST', body: { deviceId } }); }
  callStatus(id) { return this.call(`/calls/${enc(id)}`); }
  callAction(id, action, deviceId) { return this.call(`/calls/${enc(id)}/${action}`, { method: 'POST', body: deviceId ? { deviceId } : {} }); }
}
