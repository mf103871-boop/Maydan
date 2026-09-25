// Account-scoped social state. No private message history is written to browser storage.
export const SOCIAL_ERRORS = {
  AUTH_REQUIRED: 'سجّل الدخول للتواصل مع أصدقائك.', AUTH_EXPIRED: 'انتهت جلستك، سجّل الدخول من جديد.',
  NOT_FRIENDS: 'تحتاجان إلى قبول طلب الصداقة أولًا.', BLOCKED: 'التواصل مع هذا الحساب غير متاح.',
  NOT_FOUND: 'لم يعد هذا العنصر متاحًا.', INVALID: 'راجع البيانات وحاول مجددًا.',
  CONFLICT: 'تغيّر هذا الطلب، حدّث القائمة وحاول مجددًا.', RATE_LIMIT: 'طلبات كثيرة، انتظر قليلًا ثم حاول.',
  NETWORK: 'تعذّر الاتصال. يمكنك إعادة المحاولة عند عودة الإنترنت.',
  SOCIAL_UNAVAILABLE: 'التحديث المباشر غير متاح مؤقتًا.', STALE: 'تغيّر الحساب أثناء الطلب.',
};
export const socialError = error => SOCIAL_ERRORS[error?.code] || SOCIAL_ERRORS.NETWORK;
export const emptyConversation = () => ({ id: null, messages: [], loading: false, loadingOlder: false, hasMore: false,
  nextBefore: null, error: '', typing: false, readSeq: 0, peerReadSeq: 0 });
export const emptySocialState = () => ({ profile: null, friends: [], incoming: [], outgoing: [], blocked: [], conversationList: [],
  conversations: {}, loading: false, error: '', offline: false, connected: false });
const initial = emptySocialState;

export function mergeMessages(current, incoming, peerReadSeq = 0) {
  const bySeq = new Map(current.filter(m => Number.isSafeInteger(m.seq)).map(m => [m.seq, m]));
  for (const message of incoming) {
    const previous = bySeq.get(message.seq);
    // History and live notifications can arrive out of order. Deletion is final.
    if (previous?.deletedAt || (!message.deletedAt && (previous?.editedAt || 0) > (message.editedAt || 0))) continue;
    bySeq.set(message.seq, { ...message, status: 'sent' });
  }
  const sent = [...bySeq.values()].sort((a,b) => a.seq-b.seq).map(m => ({ ...m, read: m.seq <= peerReadSeq }));
  const delivered = new Set(sent.map(m => m.clientId));
  return [...sent, ...current.filter(m => !Number.isSafeInteger(m.seq) && !delivered.has(m.clientId))];
}

export class SocialClient {
  constructor({ request, server, socketFactory = url => new WebSocket(url), now = () => Date.now() }) {
    this.request = request; this.server = server; this.socketFactory = socketFactory; this.now = now;
    this.state = initial(); this.listeners = new Set(); this.epoch = 0; this.userId = null;
    this.typingTimers = new Map(); this.sentTyping = new Map(); this.sending = new Map(); this.reading = new Map();
    this.subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    this.getSnapshot = () => this.state;
  }
  update(patch) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  conversation(friendId, patch) {
    this.update({ conversations: { ...this.state.conversations, [friendId]: { ...emptyConversation(),
      ...this.state.conversations[friendId], ...patch } } });
  }
  async call(path, options) {
    const epoch = this.epoch;
    if (!this.userId) throw Object.assign(new Error(SOCIAL_ERRORS.AUTH_REQUIRED), { code: 'AUTH_REQUIRED' });
    try {
      const result = await this.request(`/api/social${path}`, options);
      if (epoch !== this.epoch) throw Object.assign(new Error(SOCIAL_ERRORS.STALE), { code: 'STALE' });
      return result;
    } catch (error) {
      if (epoch !== this.epoch) throw Object.assign(new Error(SOCIAL_ERRORS.STALE), { code: 'STALE' });
      const next = Object.assign(new Error(socialError(error)), { code: error?.code || 'NETWORK' });
      throw next;
    }
  }
  start(userId) {
    this.stop(); this.userId = userId; this.update({ ...initial(), loading: true });
    if (!userId) return;
    this.refresh().catch(() => {}); this.connect();
    this.poll = setInterval(() => { if (this.visible()) this.refresh({ quiet: true }).catch(() => {}); }, 30_000);
  }
  stop() {
    this.epoch++; this.userId = null; this.activeFriend = null; this.refreshing = null;
    this.refreshAgain = false; this.connecting = false; this.attempt = 0;
    clearInterval(this.poll); clearInterval(this.ping); clearTimeout(this.reconnect); clearTimeout(this.refreshTimer);
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear(); this.sentTyping.clear(); this.sending.clear(); this.reading.clear();
    const socket = this.socket; this.socket = null; if (socket) { socket.onclose = null; socket.close(); }
    this.update(initial());
  }
  visible() { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; }
  visibilityChanged() {
    if (!this.userId) return;
    if (!this.visible()) {
      clearTimeout(this.reconnect); clearInterval(this.ping); this.sentTyping.clear();
      const socket = this.socket; this.socket = null;
      if (socket) { socket.onclose = null; socket.close(1000, 'background'); }
      this.update({ connected: false });
    } else { this.refresh({ quiet: true }).catch(() => {}); this.connect(); }
  }
  async refresh({ quiet = false } = {}) {
    if (!this.userId) return;
    if (this.refreshing) { this.refreshAgain = true; return this.refreshing; }
    const epoch = this.epoch;
    if (!quiet) this.update({ loading: true, error: '' });
    const task = (async () => {
      try {
        const [me, friends, requests, blocks, conversations] = await Promise.all([
          this.call('/me'), this.call('/friends'), this.call('/requests'), this.call('/blocks'), this.call('/conversations'),
        ]);
        if (epoch !== this.epoch) return;
        const list = conversations.conversations || [];
        this.update({ profile: me.user, friends: (friends.friends || []).map(friend => {
          const conversation = list.find(c => c.user.id === friend.id);
          return { ...friend, lastMessage: conversation?.lastMessage || null, unreadCount: conversation?.unreadCount || 0 };
        }), incoming: requests.incoming || [], outgoing: requests.outgoing || [], blocked: blocks.users || [],
        conversationList: list, loading: false, error: '', offline: false });
        const allowed = new Set(this.state.friends.map(f => f.id));
        const loaded = Object.fromEntries(Object.entries(this.state.conversations).filter(([id]) => allowed.has(id)));
        this.update({ conversations: loaded });
        if (this.activeFriend && allowed.has(this.activeFriend)) await this.openConversation(this.activeFriend, { quiet: true });
      } catch (error) {
        if (epoch === this.epoch) this.update({ loading: false, error: error.message, offline: error.code === 'NETWORK' });
        throw error;
      } finally {
        if (epoch === this.epoch) {
          this.refreshing = null;
          if (this.refreshAgain) { this.refreshAgain = false; this.scheduleRefresh(); }
        }
      }
    })();
    this.refreshing = task; return task;
  }
  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh({ quiet: true }).catch(() => {}), 180);
  }
  async action(path, method, body) {
    const epoch = this.epoch;
    const result = await this.call(path, { method, ...(body === undefined ? {} : { body }) });
    this.assertEpoch(epoch);
    await this.refresh({ quiet: true }).catch(() => {});
    this.assertEpoch(epoch); return result;
  }
  assertEpoch(epoch) {
    if (epoch !== this.epoch) throw Object.assign(new Error(SOCIAL_ERRORS.STALE), { code: 'STALE' });
  }
  currentConversation(epoch, friendId, id) {
    return epoch === this.epoch && this.findConversation(friendId) === id && this.state.conversations[friendId]?.id === id;
  }
  async searchUsers(query) {
    const epoch = this.epoch;
    const result = await this.call(`/search?q=${encodeURIComponent(query.trim())}`);
    this.assertEpoch(epoch); return result.users || [];
  }
  sendRequest(userId) { return this.action('/requests', 'POST', { userId }); }
  acceptRequest(id) { return this.action(`/requests/${encodeURIComponent(id)}/accept`, 'POST', {}); }
  rejectRequest(id) { return this.action(`/requests/${encodeURIComponent(id)}/reject`, 'POST', {}); }
  cancelRequest(id) { return this.action(`/requests/${encodeURIComponent(id)}`, 'DELETE'); }
  removeFriend(id) { return this.action(`/friends/${encodeURIComponent(id)}`, 'DELETE'); }
  blockUser(userId) { return this.action('/blocks', 'POST', { userId }); }
  unblockUser(id) { return this.action(`/blocks/${encodeURIComponent(id)}`, 'DELETE'); }
  reportUser(userId, value) { return this.action('/reports', 'POST', { userId, ...value }); }
  selectConversation(friendId) { this.activeFriend = friendId || null; }
  findConversation(friendId) {
    return this.state.friends.find(f => f.id === friendId)?.conversationId || this.state.conversationList.find(c => c.user.id === friendId)?.id;
  }
  async openConversation(friendId, { quiet = false } = {}) {
    const id = this.findConversation(friendId); if (!id) return;
    const epoch = this.epoch;
    const previous = this.state.conversations[friendId];
    if (previous?.loading) return;
    if (!quiet) this.conversation(friendId, { id, loading: true, error: '' });
    try {
      const result = await this.call(`/conversations/${encodeURIComponent(id)}/messages?limit=50`);
      if (epoch !== this.epoch || this.findConversation(friendId) !== id) return;
      const current = this.state.conversations[friendId] || emptyConversation();
      const peerReadSeq = Math.max(current.peerReadSeq, result.peerReadSeq || 0);
      this.conversation(friendId, { id, messages: mergeMessages(current.messages, result.messages, peerReadSeq),
        loading: false, error: '', readSeq: Math.max(current.readSeq, result.readSeq || 0), peerReadSeq,
        ...(!current.messages.some(m => m.seq) ? { nextBefore: result.nextBefore, hasMore: result.hasMore } : {}) });
      const loaded = current.messages.filter(m => m.seq);
      if (loaded.length && result.messages.length && loaded[0].seq < result.messages[0].seq) {
        await this.resyncLoaded(friendId, id, loaded[0].seq, Math.max(loaded.at(-1).seq, result.messages.at(-1).seq), epoch);
      }
    } catch (error) {
      if (epoch === this.epoch && this.findConversation(friendId) === id) this.conversation(friendId, { loading: false, error: error.message });
      throw error;
    }
  }
  async resyncLoaded(friendId, id, first, last, epoch) {
    // Revalidate already loaded pages after a missed event; keep the scroll position and pending drafts.
    let after = first - 1;
    while (after < last && this.currentConversation(epoch, friendId, id)) {
      const result = await this.call(`/conversations/${encodeURIComponent(id)}/messages?after=${after}&limit=100`);
      if (!this.currentConversation(epoch, friendId, id)) return;
      const current = this.state.conversations[friendId];
      const peerReadSeq = Math.max(current.peerReadSeq, result.peerReadSeq || 0);
      this.conversation(friendId, { messages: mergeMessages(current.messages, result.messages, peerReadSeq),
        peerReadSeq, readSeq: Math.max(current.readSeq, result.readSeq || 0) });
      const next = result.messages.at(-1)?.seq;
      if (!next || next <= after || !result.hasMore) break;
      after = next;
    }
  }
  async loadOlder(friendId) {
    const chat = this.state.conversations[friendId]; if (!chat?.hasMore || chat.loadingOlder) return;
    const epoch = this.epoch; this.conversation(friendId, { loadingOlder: true });
    try {
      const result = await this.call(`/conversations/${encodeURIComponent(chat.id)}/messages?before=${chat.nextBefore}&limit=50`);
      if (!this.currentConversation(epoch, friendId, chat.id)) return;
      const current = this.state.conversations[friendId];
      const peerReadSeq = Math.max(current.peerReadSeq, result.peerReadSeq || 0);
      this.conversation(friendId, { messages: mergeMessages(current.messages, result.messages, peerReadSeq),
        nextBefore: result.nextBefore, hasMore: result.hasMore, loadingOlder: false, error: '', peerReadSeq, readSeq: Math.max(current.readSeq, result.readSeq || 0) });
    } catch (error) {
      if (this.currentConversation(epoch, friendId, chat.id)) this.conversation(friendId, { loadingOlder: false, error: error.message });
      throw error;
    }
  }
  async sendMessage(friendId, text) {
    text = String(text).trim();
    if (!text || text.length > 2000) throw Object.assign(new Error('اكتب رسالة من حرف إلى 2000 حرف.'), { code: 'INVALID' });
    const id = this.findConversation(friendId); if (!id) throw new Error(SOCIAL_ERRORS.NOT_FRIENDS);
    const message = { clientId: crypto.randomUUID(), conversationId: id, senderId: this.userId, text,
      createdAt: this.now(), editedAt: null, deletedAt: null, status: 'pending' };
    const current = this.state.conversations[friendId] || emptyConversation();
    this.conversation(friendId, { id, messages: [...current.messages, message] });
    this.setTyping(friendId, false); return this.deliver(friendId, message);
  }
  async deliver(friendId, pending) {
    if (this.sending.has(pending.clientId)) return this.sending.get(pending.clientId);
    const epoch = this.epoch;
    const task = (async () => {
      try {
        const { message } = await this.call(`/conversations/${encodeURIComponent(pending.conversationId)}/messages`,
          { method: 'POST', body: { text: pending.text, clientId: pending.clientId } });
        if (!this.currentConversation(epoch, friendId, pending.conversationId)) return;
        const current = this.state.conversations[friendId];
        if (current) this.conversation(friendId, { messages: mergeMessages(current.messages, [message], current.peerReadSeq) });
        this.scheduleRefresh(); return message;
      } catch (error) {
        if (epoch === this.epoch) {
          const current = this.state.conversations[friendId];
          if (current) this.conversation(friendId, { messages: current.messages.map(m => m.clientId === pending.clientId && !m.seq ? { ...m, status: 'failed' } : m) });
        }
        throw error;
      } finally { this.sending.delete(pending.clientId); }
    })(); this.sending.set(pending.clientId, task); return task;
  }
  retryMessage(friendId, clientId) {
    const current = this.state.conversations[friendId]; const pending = current?.messages.find(m => m.clientId === clientId && m.status === 'failed');
    if (!pending) return Promise.resolve();
    this.conversation(friendId, { messages: current.messages.map(m => m === pending ? { ...m, status: 'pending' } : m) });
    return this.deliver(friendId, pending);
  }
  async changeMessage(friendId, seq, method, body) {
    const epoch = this.epoch; const id = this.findConversation(friendId);
    const { message } = await this.call(`/messages/${encodeURIComponent(seq)}`, { method, ...(body ? { body } : {}) });
    this.assertEpoch(epoch);
    if (!this.currentConversation(epoch, friendId, id) || message.conversationId !== id) return;
    const current = this.state.conversations[friendId];
    if (current) this.conversation(friendId, { messages: mergeMessages(current.messages, [message], current.peerReadSeq) });
    this.scheduleRefresh(); return message;
  }
  editMessage(friendId, seq, text) { return this.changeMessage(friendId, seq, 'PATCH', { text }); }
  deleteMessage(friendId, seq) { return this.changeMessage(friendId, seq, 'DELETE'); }
  async markRead(friendId) {
    if (!this.visible() || this.activeFriend !== friendId) return;
    const chat = this.state.conversations[friendId];
    const seq = Math.max(0, ...(chat?.messages || []).map(m => m.seq || 0));
    if (!chat?.id || seq <= (chat.readSeq || 0) || seq <= (this.reading.get(friendId) || 0)) return;
    this.reading.set(friendId, seq); const epoch = this.epoch;
    try {
      const result = await this.call(`/conversations/${encodeURIComponent(chat.id)}/read`, { method: 'POST', body: { seq } });
      if (!this.currentConversation(epoch, friendId, chat.id)) return;
      this.conversation(friendId, { readSeq: Math.max(this.state.conversations[friendId].readSeq, result.readSeq) }); this.scheduleRefresh();
    } finally { if (epoch === this.epoch) this.reading.delete(friendId); }
  }
  setTyping(peerId, active) {
    if (this.socket?.readyState !== 1) return;
    active = !!active;
    const previous = this.sentTyping.get(peerId);
    // Blur, submit and send completion may all stop typing in the same tick.
    if (!active && !previous?.active) return;
    if (active && previous?.active && this.now() - previous.at < 2000) return;
    this.socket.send(JSON.stringify({ type: 'typing', peerId, active }));
    this.sentTyping.set(peerId, { active, at: this.now() });
  }
  async receive(event) {
    const epoch = this.epoch;
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'pong') { this.lastPong = this.now(); return; }
    if (message.type === 'typing' && this.state.friends.some(f => f.id === message.userId)) {
      const id = message.userId; clearTimeout(this.typingTimers.get(id));
      this.conversation(id, { typing: !!message.active });
      if (message.active) this.typingTimers.set(id, setTimeout(() => {
        if (epoch === this.epoch && this.state.conversations[id]) this.conversation(id, { typing: false });
      }, 6000));
    } else if (message.type === 'message') {
      const friendId = this.state.friends.find(f => f.conversationId === message.conversationId)?.id;
      if (friendId && this.state.conversations[friendId]) {
        try {
          const result = await this.call(`/messages/${encodeURIComponent(message.messageSeq)}`);
          if (!this.currentConversation(epoch, friendId, message.conversationId) || result.message.conversationId !== message.conversationId) return;
          const current = this.state.conversations[friendId];
          if (current) this.conversation(friendId, { messages: mergeMessages(current.messages, [result.message], current.peerReadSeq) });
        } catch { /* Removal/block or disconnected account: refresh resolves visibility. */ }
      }
      if (epoch === this.epoch) this.scheduleRefresh();
    } else if (message.type === 'refresh') this.scheduleRefresh();
  }
  async connect() {
    if (!this.userId || !this.visible() || this.socket || this.connecting) return;
    const epoch = this.epoch; this.connecting = true;
    try {
      const ticket = await this.call('/live-ticket', { method: 'POST', body: {} });
      if (epoch !== this.epoch || !this.visible()) return;
      const url = new URL('/api/social/socket', this.server());
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('userId', ticket.userId); url.searchParams.set('ticket', ticket.ticket);
      const socket = this.socketFactory(url.href); this.socket = socket;
      socket.onopen = () => {
        if (epoch !== this.epoch) { socket.close(); return; }
        this.attempt = 0; this.lastPong = this.now(); this.update({ connected: true });
        clearInterval(this.ping);
        this.ping = setInterval(() => {
          if (this.now() - this.lastPong > 45_000) { socket.close(); return; }
          if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'ping' }));
        }, 20_000);
        this.scheduleRefresh();
      };
      socket.onmessage = event => { if (epoch === this.epoch) this.receive(event).catch(() => {}); };
      socket.onerror = () => { try { socket.close(); } catch { /* Already closed. */ } };
      socket.onclose = () => {
        if (epoch !== this.epoch) return;
        this.socket = null; this.sentTyping.clear(); clearInterval(this.ping); this.update({ connected: false }); this.reconnectLater();
      };
    } catch { if (epoch === this.epoch) this.reconnectLater(); }
    finally { if (epoch === this.epoch) this.connecting = false; }
  }
  reconnectLater() {
    if (!this.userId || !this.visible()) return;
    clearTimeout(this.reconnect); this.attempt = (this.attempt || 0) + 1;
    this.reconnect = setTimeout(() => this.connect(), Math.min(30_000, 1000 * 2 ** Math.min(this.attempt, 5)));
  }
}
