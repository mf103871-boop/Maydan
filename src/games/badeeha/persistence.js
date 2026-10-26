import logic, { BANK_CONTENT_VERSION } from './logic.js';
import { BADEEHA_KEYS } from './keys.js';

export const RETIRED_GAME_NOTICE = 'تجدّد بنك بديهة. ابدأ مباراة جديدة؛ المباراة المحفوظة من البنك السابق لا يمكن استئنافها، ونتائجكم السابقة ما زالت محفوظة.';

// Read without deleting anything: an old active snapshot remains on the device
// until the player starts a new game. Results, reports, accounts and settings
// are independent from the content version and keep their existing keys.
export function readBadeehaState(categories, storage = typeof localStorage === 'undefined' ? null : localStorage) {
  const read = (key) => {
    try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; }
  };
  const active = read(BADEEHA_KEYS.active);
  const valid = logic.isValidSession(categories, active);
  const retiredActive = Boolean(active && typeof active === 'object' && active.contentVersion !== BANK_CONTENT_VERSION);
  return {
    history: read(BADEEHA_KEYS.history), results: read(BADEEHA_KEYS.results),
    reports: read(BADEEHA_KEYS.reports), settings: read(BADEEHA_KEYS.settings),
    active: valid ? active : null, retiredActive, invalidActive: Boolean(active && !valid && !retiredActive),
  };
}

// Online rooms reuse the same bank/history as local games. Only revealed/played
// question IDs are recorded; the upcoming deck must never count as seen.
export function rememberBadeehaQuestions(categories, ids, { storage = typeof localStorage === 'undefined' ? null : localStorage, now = Date.now() } = {}) {
  if (!storage || !Array.isArray(ids) || !Number.isFinite(now) || now <= 0) return false;
  const valid = new Set(categories.flatMap((category) => category.qs.map((question, index) => logic.questionId(category.id, question, index))));
  try {
    const saved = JSON.parse(storage.getItem(BADEEHA_KEYS.history) || 'null');
    const history = saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {};
    let changed = false;
    for (const id of ids) if (valid.has(id) && !history[id]) { history[id] = now; changed = true; }
    if (changed) storage.setItem(BADEEHA_KEYS.history, JSON.stringify(history));
    return changed;
  } catch { return false; }
}
