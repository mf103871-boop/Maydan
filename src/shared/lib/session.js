// حفظ جلسة لعبة على جهاز واحد واستئنافها: مفتاح واحد في مخزن اللعبة، ولقطة الـreducer
// كما هي مع بذرة المصدر وموضعه. كل لعبة تصدّر restoreSession(raw) يفحص كل حقل تقرأه
// واجهتها قبل قبوله — لقطة تالفة (نسخة أقدم، يد عابثة) تُرمى بصمت لا تُسقط الشاشة.
export const SESSION_KEY = 'session-v1';

export const isNonNegInt = (value) => Number.isSafeInteger(value) && value >= 0;
export const isText = (value, max = 80) => typeof value === 'string' && value.length > 0 && value.length <= max;
const isColor = (value) => value === undefined || value === null || (typeof value === 'string' && value.length <= 40);

// لاعبون أو فرق: معرّفات نصية فريدة، أسماء نصية، وحقول العرض إن وُجدت نصوص قصيرة.
export function isPlayerList(list, { min = 2, max = 12 } = {}) {
  if (!Array.isArray(list) || list.length < min || list.length > max) return false;
  const ids = new Set();
  for (const player of list) {
    if (!player || typeof player !== 'object' || !isText(player.id, 80) || !isText(player.name, 80)) return false;
    if (!isColor(player.color) || !isColor(player.emoji)) return false;
    if (ids.has(player.id)) return false;
    ids.add(player.id);
  }
  return true;
}

// خريطة معرّف → عدد صحيح غير سالب، بمفاتيح تطابق قائمة المعرّفات تمامًا.
export function isCountMap(ids, map, { allowNegative = false } = {}) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  const keys = Object.keys(map);
  if (keys.length !== ids.length || keys.some((id) => !ids.includes(id))) return false;
  return ids.every((id) => Number.isSafeInteger(map[id]) && (allowNegative || map[id] >= 0));
}

export const isSeed = (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

export function loadSession(storage, restore, key = SESSION_KEY) {
  try { return restore(storage.get(key)) || null; } catch { return null; }
}
export function saveSession(storage, snapshot, key = SESSION_KEY) {
  const ok = storage.set(key, { ...snapshot, savedAt: Date.now() });
  return ok && storage.persistent !== false;
}
export function clearSession(storage, key = SESSION_KEY) {
  try { storage.remove(key); } catch { /* ignore */ }
}
