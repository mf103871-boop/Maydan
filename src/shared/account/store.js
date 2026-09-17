// تخزين الحساب على الجهاز: رمز الجلسة، نسخة /api/me المخزّنة، وعلامات التجارب.
// كل قراءة تُطبّع الشكل كي لا تُسقط بياناتٌ تالفة الواجهةَ (JSON آمن دائمًا).
import { createStorage } from '../lib/storage.js';
import { TRIAL_GAMES } from './config.js';

// البادئة التي يحميها «مسح البيانات» في الإعدادات (keep).
export const ACCOUNT_PREFIX = 'maydan:account:';
export const KEYS = { session: 'session', me: 'me', trials: 'trials', promo: 'promo' };

function normalizeTrials(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const source = raw.marks && typeof raw.marks === 'object' ? raw.marks : {};
  const marks = {};
  for (const game of TRIAL_GAMES) if (source[game]) marks[game] = true;
  const pending = Array.isArray(raw.pending) ? raw.pending.filter((g) => TRIAL_GAMES.includes(g)) : [];
  return { marks, pending: [...new Set(pending)] };
}

export function createAccountStore(backend) {
  const storage = createStorage('account', backend);
  const api = {
    storage,
    prefix: storage.prefix,
    persistent: storage.persistent,
    // ── الجلسة ──────────────────────────────────────────────
    readSession() {
      const token = storage.get(KEYS.session, null);
      return typeof token === 'string' && token ? token : null;
    },
    writeSession(token) {
      if (typeof token === 'string' && token) storage.set(KEYS.session, token);
      else storage.remove(KEYS.session);
      return api.readSession();
    },
    clearSession() { storage.remove(KEYS.session); },
    // ── نسخة me المخزّنة: { data, fetchedAt } ───────────────
    readMe() {
      const raw = storage.get(KEYS.me, null);
      if (!raw || typeof raw !== 'object' || !raw.data || typeof raw.data !== 'object') return { data: null, fetchedAt: 0 };
      const fetchedAt = Number(raw.fetchedAt);
      return { data: raw.data, fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0 };
    },
    writeMe(data, fetchedAt = Date.now()) {
      if (!data || typeof data !== 'object') { storage.remove(KEYS.me); return { data: null, fetchedAt: 0 }; }
      const entry = { data, fetchedAt: Number.isFinite(Number(fetchedAt)) ? Number(fetchedAt) : Date.now() };
      storage.set(KEYS.me, entry);
      return entry;
    },
    clearMe() { storage.remove(KEYS.me); },
    // ── التجارب: { marks, pending } ─────────────────────────
    readTrials() { return normalizeTrials(storage.get(KEYS.trials, null)); },
    writeTrials(next) {
      const value = normalizeTrials(next);
      storage.set(KEYS.trials, value);
      return value;
    },
    addMark(game) {
      const trials = api.readTrials();
      if (!TRIAL_GAMES.includes(game) || trials.marks[game]) return trials;
      return api.writeTrials({ marks: { ...trials.marks, [game]: true }, pending: trials.pending });
    },
    // علامة لم تصل الخادم بعد: تُعاد المحاولة عند أول نجاح لاحق.
    addPending(game) {
      const trials = api.readTrials();
      if (!TRIAL_GAMES.includes(game) || trials.pending.includes(game)) return trials;
      return api.writeTrials({ marks: trials.marks, pending: [...trials.pending, game] });
    },
    clearPending(games) {
      const trials = api.readTrials();
      const drop = Array.isArray(games) ? new Set(games) : null;
      return api.writeTrials({ marks: trials.marks, pending: drop ? trials.pending.filter((g) => !drop.has(g)) : [] });
    },
    // ترحيل الرموز المحلية القديمة: لا تُخزن الرموز ولا تمنح صلاحيات على الجهاز.
    readPromo() {
      storage.remove(KEYS.promo);
      return null;
    },
    writePromo() { return api.readPromo(); },
    markPromoSynced() { return api.readPromo(); },
    clearPromo() { storage.remove(KEYS.promo); },
    // الخروج يمسح الهوية وأي رمز قديم؛ تبقى علامات التجارب.
    clearAuth() { api.clearSession(); api.clearMe(); api.clearPromo(); },
    clear() { storage.clear(); },
  };
  return api;
}

export const accountStore = createAccountStore();
