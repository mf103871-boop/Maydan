// تخزين الحساب على الجهاز: رمز الجلسة، نسخة /api/me المخزّنة، وعلامات التجارب.
// كل قراءة تُطبّع الشكل كي لا تُسقط بياناتٌ تالفة الواجهةَ (JSON آمن دائمًا).
import { createStorage } from '../lib/storage.js';
import { TRIAL_GAMES, REDEEM_CODE_HASHES } from './config.js';

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
    // ── رمز الهدية: { code, hash, redeemedAt, syncedFor } ──────
    // بصمة لم تعد ضمن REDEEM_CODE_HASHES (رمز أُلغي بنشر جديد) تُعامل كأن لا رمز.
    // syncedFor = معرّف الحساب الذي رُبط به الرمز على الخادم (null قبل الربط).
    readPromo() {
      const raw = storage.get(KEYS.promo, null);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.hash !== 'string') return null;
      const hash = raw.hash.toLowerCase();
      if (!REDEEM_CODE_HASHES.some((known) => String(known).toLowerCase() === hash)) return null;
      const redeemedAt = Number(raw.redeemedAt);
      return {
        code: typeof raw.code === 'string' ? raw.code : '', hash,
        redeemedAt: Number.isFinite(redeemedAt) ? redeemedAt : 0,
        syncedFor: typeof raw.syncedFor === 'string' && raw.syncedFor ? raw.syncedFor : null,
      };
    },
    writePromo(code, hash, redeemedAt = Date.now()) {
      if (typeof hash !== 'string' || !hash) { storage.remove(KEYS.promo); return null; }
      storage.set(KEYS.promo, { code: String(code || ''), hash: hash.toLowerCase(), redeemedAt, syncedFor: null });
      return api.readPromo();
    },
    markPromoSynced(userId) {
      const current = api.readPromo();
      if (!current) return null;
      storage.set(KEYS.promo, { ...current, syncedFor: typeof userId === 'string' && userId ? userId : null });
      return api.readPromo();
    },
    clearPromo() { storage.remove(KEYS.promo); },
    // الخروج يمسح الجلسة والنسخة المخزّنة فقط: علامات التجارب ورمز الهدية خاصان بالجهاز فيبقيان.
    clearAuth() { api.clearSession(); api.clearMe(); },
    clear() { storage.clear(); },
  };
  return api;
}

export const accountStore = createAccountStore();
