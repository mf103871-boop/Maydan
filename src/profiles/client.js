import { profileAssetUrl } from './identity.js';
export const emptyProfiles = () => ({ mine: null, profiles: {}, loading: {}, errors: {}, saving: false });
export const PROFILE_ERRORS = {
  AUTH_REQUIRED: 'سجّل الدخول لفتح الملفات الشخصية.', AUTH_EXPIRED: 'انتهت الجلسة، سجّل الدخول من جديد.',
  NOT_FOUND: 'هذا البروفايل غير متاح.', BLOCKED: 'هذا البروفايل غير متاح.',
  INVALID: 'راجع الاسم والنبذة والاختيارات، ثم حاول مجددًا.', CONFLICT: 'تغيّر البروفايل على جهاز آخر. حدّث الصفحة وراجع التعديلات قبل الحفظ.',
  RATE_LIMIT: 'تعديلات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.',
  IMAGE_INVALID: 'الصورة غير صالحة. اختر صورة جديدة وأعد قصّها.', IMAGE_TOO_LARGE: 'الصورة أكبر من الحجم المسموح.',
  NOT_EARNED: 'هذا اللقب أو الإنجاز لم يُفتح بعد.', STALE: 'تغيّر الحساب أثناء الطلب.',
  SESSION_TOO_SHORT: 'تُحتسب الجلسات المكتملة التي استمرت نصف دقيقة على الأقل.',
  NETWORK: 'تعذّر الاتصال. حاول مجددًا عند عودة الإنترنت.', BUSY: 'جارٍ حفظ تعديلك الحالي.',
};
export class ProfilesClient {
  constructor({ request, server, changed = () => {} }) {
    this.request = request; this.server = server; this.changed = changed; this.epoch = 0; this.userId = null;
    this.state = emptyProfiles(); this.listeners = new Set(); this.reading = new Map(); this.sessions = new Map();
    this.subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    this.getSnapshot = () => this.state;
  }
  update(patch) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  assertCurrent(epoch) { if (epoch !== this.epoch) throw Object.assign(new Error(PROFILE_ERRORS.STALE), { code: 'STALE' }); }
  start(userId) {
    this.epoch++; this.userId = userId; this.reading.clear(); this.sessions.clear(); this.update(emptyProfiles());
    if (userId) this.loadProfile().catch(() => {});
  }
  async call(path, options) {
    const epoch = this.epoch;
    if (!this.userId) throw Object.assign(new Error(PROFILE_ERRORS.AUTH_REQUIRED), { code: 'AUTH_REQUIRED' });
    try {
      const result = await this.request(`/api/profiles${path}`, options); this.assertCurrent(epoch); return result;
    } catch (error) {
      this.assertCurrent(epoch);
      throw Object.assign(new Error(PROFILE_ERRORS[error.code] || PROFILE_ERRORS.NETWORK), { code: error.code || 'NETWORK' });
    }
  }
  normalize(profile) {
    const imageUrl = value => profileAssetUrl(value, this.server());
    return { ...profile, avatarUrl: imageUrl(profile.avatarUrl), coverUrl: imageUrl(profile.coverUrl) };
  }
  apply(profile) {
    const next = this.normalize(profile); const previous = this.state.profiles[next.id];
    if (previous && Number(previous.revision) > Number(next.revision)) return previous;
    this.update({ profiles: { ...this.state.profiles, [next.id]: next }, ...(next.id === this.userId ? { mine: next } : {}) });
    return next;
  }
  async loadProfile(id = 'me') {
    const key = id === this.userId ? 'me' : id;
    if (!this.userId) return null;
    if (this.reading.has(key)) return this.reading.get(key);
    const epoch = this.epoch;
    this.update({ loading: { ...this.state.loading, [key]: true }, errors: { ...this.state.errors, [key]: '' } });
    const task = (async () => {
      try {
        const { profile } = await this.call(`/${encodeURIComponent(key)}`); this.assertCurrent(epoch); return this.apply(profile);
      } catch (error) {
        if (epoch === this.epoch) {
          const profiles = { ...this.state.profiles };
          if (error.code === 'NOT_FOUND' || error.code === 'BLOCKED') delete profiles[key === 'me' ? this.userId : key];
          this.update({ profiles, errors: { ...this.state.errors, [key]: error.message } });
        }
        throw error;
      } finally {
        if (epoch === this.epoch) { this.reading.delete(key); this.update({ loading: { ...this.state.loading, [key]: false } }); }
      }
    })();
    this.reading.set(key, task); return task;
  }
  async mutate(path, method, body) {
    if (this.state.saving) throw Object.assign(new Error(PROFILE_ERRORS.BUSY), { code: 'BUSY' });
    const epoch = this.epoch; this.update({ saving: true });
    try {
      const result = await this.call(path, { method, ...(body === undefined ? {} : { body }) }); this.assertCurrent(epoch);
      const profile = this.apply(result.profile);
      // Refreshes are best effort after the successful write, not a second save.
      Promise.resolve().then(() => { if (epoch === this.epoch) return this.changed(profile); }).catch(() => {}); return profile;
    } finally { if (epoch === this.epoch) this.update({ saving: false }); }
  }
  saveProfile(patch) { return this.mutate('/me', 'PATCH', { ...(this.state.mine ? { revision: this.state.mine.revision } : {}), ...patch }); }
  uploadImage(kind, dataUrl, revision = this.state.mine?.revision) { return this.mutate(`/me/images/${encodeURIComponent(kind)}`, 'PUT', { dataUrl, ...(revision === undefined ? {} : { revision }) }); }
  removeImage(kind, revision = this.state.mine?.revision) { return this.mutate(`/me/images/${encodeURIComponent(kind)}`, 'DELETE', revision === undefined ? {} : { revision }); }
  async beginSession(game) {
    if (!this.userId) return null;
    const epoch = this.epoch; const result = await this.call('/me/sessions', { method: 'POST', body: { game } });
    this.assertCurrent(epoch); if (result.sessionId) this.sessions.set(result.sessionId, this.userId); return result;
  }
  async completeSession(sessionId) {
    if (!this.userId || (this.sessions.has(sessionId) && this.sessions.get(sessionId) !== this.userId)) return null;
    const epoch = this.epoch;
    const result = await this.call(`/me/sessions/${encodeURIComponent(sessionId)}/complete`, { method: 'POST', body: {} });
    this.assertCurrent(epoch);
    if (result.profile) this.apply(result.profile);
    else this.loadProfile().catch(() => {});
    return result;
  }
}
