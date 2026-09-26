export const MODERATION_ERRORS = {
  FORBIDDEN: 'هذه الصفحة مخصّصة لفريق المراجعة.', AUTH_REQUIRED: 'سجّل الدخول إلى حساب المراجعة.',
  AUTH_EXPIRED: 'انتهت الجلسة. سجّل الدخول من جديد.', ACCOUNT_SUSPENDED: 'هذا الحساب معلّق. تواصل مع الدعم.',
  CONTENT_REJECTED: 'يحتوي النص على محتوى غير مسموح. عدّله وحاول مجددًا.',
  CONFLICT: 'تغيّر المحتوى أو سُبق تنفيذ قرار آخر. حدّث القائمة وراجع النسخة الحالية.',
  NOT_FOUND: 'لم يعد هذا المحتوى متاحًا. حدّث القائمة.', INVALID: 'اكتب سببًا واضحًا من 3 إلى 500 حرف.',
  RATE_LIMIT: 'طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
  NETWORK: 'تعذّر الاتصال. أعد المحاولة؛ سيُستخدم القرار نفسه دون تكراره.',
  STALE: 'تغيّر الحساب أثناء الطلب.',
};
export const moderationError = error => MODERATION_ERRORS[error?.code] || MODERATION_ERRORS.NETWORK;
export const emptyModeration = () => ({ userId: null, ready: false, moderator: false, loading: false, saving: false,
  reports: [], images: [], actions: [], nextBefore: null, section: 'reports', status: 'open', error: '' });
const denied = code => ['FORBIDDEN', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'ACCOUNT_SUSPENDED'].includes(code);

export class ModerationClient {
  constructor({ request }) {
    this.request = request; this.state = emptyModeration(); this.epoch = 0; this.listeners = new Set();
    this.subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    this.getSnapshot = () => this.state;
  }
  update(patch) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  current(epoch) { if (epoch !== this.epoch) throw Object.assign(new Error(MODERATION_ERRORS.STALE), { code: 'STALE' }); }
  async call(path, options) {
    const epoch = this.epoch;
    try { const result = await this.request('/api/moderation' + path, options); this.current(epoch); return result; }
    catch (error) {
      this.current(epoch);
      if (denied(error?.code)) this.update({ ...emptyModeration(), userId: this.state.userId, ready: true, error: moderationError(error) });
      throw error;
    }
  }
  async start(userId) {
    const epoch = ++this.epoch;
    this.update({ ...emptyModeration(), userId, ready: !userId });
    if (!userId) return;
    try { const result = await this.call('/me'); this.current(epoch); this.update({ ready: true, moderator: result.moderator === true }); }
    catch (error) { if (epoch === this.epoch) this.update({ ready: true, error: moderationError(error) }); }
  }
  async load(section = this.state.section, status = this.state.status, older = false) {
    if (!this.state.moderator || this.state.loading || this.state.saving) return;
    const epoch = this.epoch;
    const before = older ? this.state.nextBefore : null;
    const key = section === 'audit' ? 'actions' : section;
    if (!['reports', 'images', 'audit'].includes(section)) return;
    this.update({ section, status, loading: true, error: '', ...(!older ? { reports: [], images: [], actions: [], nextBefore: null } : {}) });
    try {
      const params = new URLSearchParams({ limit: '30', ...(section === 'reports' ? { status } : {}), ...(before ? { before: String(before) } : {}) });
      const result = await this.call(`/${section}?${params}`); this.current(epoch);
      const rows = Array.isArray(result[key]) ? result[key] : [];
      this.update({ [key]: older ? [...this.state[key], ...rows.filter(row => !this.state[key].some(previous => previous.id === row.id))] : rows,
        nextBefore: result.nextBefore || null });
    } catch (error) { if (epoch === this.epoch) this.update({ error: moderationError(error) }); }
    finally { if (epoch === this.epoch) this.update({ loading: false }); }
  }
  async act(body) {
    if (!this.state.moderator || this.state.saving) throw Object.assign(new Error(), { code: 'FORBIDDEN' });
    const epoch = this.epoch; this.update({ saving: true, error: '' });
    try { const result = await this.call('/actions', { method: 'POST', body }); this.current(epoch); return result; }
    finally { if (epoch === this.epoch) this.update({ saving: false }); }
  }
}

// Preview URLs are API paths, never public URLs or credential-bearing URLs.
export function reviewPreviewPath(value) {
  return typeof value === 'string' && (/^\/api\/moderation\/images\/[a-zA-Z0-9_-]+\/[a-f0-9]{64}$/.test(value)
    || /^\/api\/profiles\/me\/images\/(avatar|cover)\/pending\/[a-f0-9]{64}$/.test(value)) ? value : null;
}
