import { SAVE_KEY, restoreSession } from './logic.js';
import { trimSeen } from '../../shared/lib/noRepeat.js';

export const OPTIONS_KEY = 'options';
export const SEEN_KEY = 'seen';
export const RESULT_KEY = 'last-result-v2';
export const loadSession = (storage) => restoreSession(storage.get(SAVE_KEY));
export const loadResult = (storage) => {
  const latest = restoreSession(storage.get(SAVE_KEY), { includeOver: true });
  if (latest?.phase === 'over') return latest;
  const result = restoreSession(storage.get(RESULT_KEY), { includeOver: true });
  return result?.phase === 'over' ? result : null;
};

export function saveSession(storage, state, now = Date.now()) {
  // Persist before recording seen facts; only displayed questions are consumed.
  const snapshot = { ...state, ready: false, savedAt: now };
  const saved = storage.set(SAVE_KEY, snapshot);
  const resultSaved = state.phase !== 'over' || storage.set(RESULT_KEY, snapshot);
  const seen = { ...(storage.get(SEEN_KEY, {}) || {}) };
  for (const id of [...state.usedFacts, ...state.usedQuestions]) if (!seen[id]) seen[id] = now;
  const seenSaved = storage.set(SEEN_KEY, trimSeen(seen, 800));
  return saved && seenSaved && resultSaved && storage.persistent !== false;
}
