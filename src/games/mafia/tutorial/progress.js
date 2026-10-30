import { MAFIA_TUTORIAL_SCENARIO_VERSION, MAFIA_TUTORIAL_RULESET_VERSION } from './version.mjs';

const PREFIX = 'maydan:mafia-tutorial:';
const MAX_BYTES = 64 * 1024;
// Owner-scoped fallback keeps a just-skipped intro dismissed if storage fails.
const volatileRecords = new Map();
const statuses = new Set(['unseen', 'in-progress', 'skipped', 'completed']);
const currentVersions = value => value?.scenarioVersion === MAFIA_TUTORIAL_SCENARIO_VERSION && value?.rulesetVersion === MAFIA_TUTORIAL_RULESET_VERSION;
export function tutorialOwner(account, server) {
  if (!account?.ready) return null;
  if (account.signedIn && !account.user?.id) return null;
  let origin;
  try { origin = server ? new URL(server).origin : (globalThis.location?.origin && globalThis.location.origin !== 'null' ? new URL(globalThis.location.origin).origin : 'local://maydan'); } catch { return null; }
  const userId = account.signedIn && account.user?.id ? String(account.user.id) : 'guest';
  return `${origin}|${userId}`;
}
export const tutorialStorageKey = owner => `${PREFIX}${encodeURIComponent(owner)}`;
export function emptyTutorialRecord(owner) {
  return { storageVersion: 1, owner, scenarioVersion: MAFIA_TUTORIAL_SCENARIO_VERSION, rulesetVersion: MAFIA_TUTORIAL_RULESET_VERSION, status: 'unseen', progress: null, pendingStatus: null, updatedAt: null };
}
export function readTutorialRecord(storage, owner, validateProgress = () => null) {
  const empty = emptyTutorialRecord(owner);
  if (!owner) return empty;
  try {
    let raw;
    try { raw = storage?.getItem(tutorialStorageKey(owner)); } catch { /* Session fallback only. */ }
    raw ||= volatileRecords.get(owner);
    if (!raw) return empty;
    if (raw.length > MAX_BYTES) return { ...empty, invalid: true };
    const value = JSON.parse(raw);
    if (value?.owner !== owner || value.storageVersion !== 1 || !statuses.has(value.status)) return { ...empty, invalid: true };
    if (!currentVersions(value)) return { ...empty, outdated: true };
    const progress = value.progress ? validateProgress(value.progress) : null;
    return { ...empty, status: value.status, progress, pendingStatus: ['completed', 'skipped'].includes(value.pendingStatus) ? value.pendingStatus : null, updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : null, invalid: Boolean(value.progress && !progress) };
  } catch { return { ...empty, invalid: true }; }
}
export function saveTutorialRecord(storage, owner, record) {
  if (!owner || record.owner !== owner || !statuses.has(record.status) || !currentVersions(record)) return false;
  try {
    const data = JSON.stringify({ ...emptyTutorialRecord(owner), status: record.status, progress: record.progress || null, pendingStatus: ['completed','skipped'].includes(record.pendingStatus) ? record.pendingStatus : null, updatedAt: Date.now() });
    if (data.length > MAX_BYTES) return false;
    volatileRecords.set(owner,data);
    storage?.setItem(tutorialStorageKey(owner), data);
    return Boolean(storage);
  } catch { return false; }
}
export function clearTutorialOwner(storage, owner) {
  if (!owner) return;
  volatileRecords.delete(owner);
  try { storage?.removeItem(tutorialStorageKey(owner)); } catch { /* Storage may be unavailable. */ }
}
export function clearDeletedTutorialAccount({ userId, server, storage } = {}) {
  if (!userId) return;
  try {
    const owner = `${new URL(server).origin}|${String(userId)}`;
    let available=storage;
    try { available ||= globalThis.localStorage; } catch { /* Still clear this owner's memory. */ }
    clearTutorialOwner(available, owner);
  } catch { /* A successful account deletion must survive unavailable storage. */ }
}
export function hasOwnedRoomRestore(readSaved, accountId) {
  if (!accountId) return false;
  for (const [last, sessionPrefix, ownerPrefix] of [['lastRoom', '', 'roomOwner:'], ['lastObserverRoom', 'observer:', 'observerOwner:']]) {
    const code = readSaved(last);
    if (typeof code === 'string' && /^\d{6}$/.test(code) && readSaved(`${sessionPrefix}${code}`) && readSaved(`${ownerPrefix}${code}`) === accountId) return true;
  }
  return false;
}
export function shouldStartTutorial({ normalEntry, ready, hasRestore, record }) {
  return Boolean(normalEntry && ready && !hasRestore && record?.status === 'unseen' && !record.progress && !record.outdated && !record.invalid);
}
export function mergeTutorialStatus(record, response) {
  if (response?.tutorialId !== 'mafia' || !currentVersions(response) || !['unseen','skipped','completed'].includes(response.status)) return record;
  const status = record.status === 'completed' || response.status === 'completed' ? 'completed' : record.status === 'skipped' || response.status === 'skipped' ? 'skipped' : record.status;
  return { ...record, status, outdated: Boolean(response.outdated), pendingStatus: response.status === status ? null : record.pendingStatus };
}
// The transport is injected. This helper can never create a room or start media.
// A late response after an owner change/unmount cannot persist or emit anything.
export function createTutorialStatusSync({ owner, request, isCurrent, read, write, onStatus = () => {} }) {
  let alive = true;
  const valid = () => alive && Boolean(owner) && isCurrent(owner);
  async function run(status) {
    if (!valid()) return null;
    const options = status ? { method: 'PUT', body: { scenarioVersion: MAFIA_TUTORIAL_SCENARIO_VERSION, rulesetVersion: MAFIA_TUTORIAL_RULESET_VERSION, status } } : undefined;
    if (status && !['skipped','completed'].includes(status)) throw new Error('INVALID_TUTORIAL_STATUS');
    try {
      const response = await request('/api/me/tutorials/mafia', options);
      if (!valid()) return null;
      if (response?.tutorialId !== 'mafia' || !currentVersions(response) || !['unseen','skipped','completed'].includes(response.status)) return null;
      const next = mergeTutorialStatus(read(), response);
      write(next); onStatus(next);
      return next;
    } catch { return null; }
  }
  return { load: () => run(), publish: status => run(status), dispose: () => { alive = false; } };
}
