// مفاتيح تخزين «بَديهة» تحت نطاق المنصة، مع ترحيل المفاتيح القديمة كي لا تضيع
// مباراة محفوظة أو سجل نتائج عند التحديث من نسخة «ميدان» التجريبية.
export const LEGACY_KEYS = Object.freeze({
  history: 'maydan-question-history-v4',
  results: 'maydan-results-v2',
  active: 'maydan-active-game-v2',
  settings: 'maydan-settings-v2',
  reports: 'maydan-question-reports-v1',
});

export const BADEEHA_KEYS = Object.freeze({
  history: 'maydan:badeeha:question-history-v4',
  results: 'maydan:badeeha:results-v2',
  active: 'maydan:badeeha:active-game-v2',
  settings: 'maydan:badeeha:settings-v2',
  reports: 'maydan:badeeha:question-reports-v1',
});

// Copies each legacy value to its namespaced key when the new key is still
// empty, then removes the legacy key so the two can never drift apart.
// Returns the names of the keys that were migrated.
export function migrateLegacyKeys(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return [];
  const migrated = [];
  for (const name of Object.keys(LEGACY_KEYS)) {
    try {
      const oldKey = LEGACY_KEYS[name];
      const newKey = BADEEHA_KEYS[name];
      const oldValue = store.getItem(oldKey);
      if (oldValue === null) continue;
      if (store.getItem(newKey) === null) {
        store.setItem(newKey, oldValue);
        migrated.push(name);
      }
      store.removeItem(oldKey);
    } catch (error) {
      // Storage can be unavailable (private mode, quota); the game already
      // tolerates empty storage, so a failed migration is not fatal.
    }
  }
  return migrated;
}
