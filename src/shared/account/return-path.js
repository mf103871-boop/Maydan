const KEY = 'maydan:auth:profile-return';
const valid = value => typeof value === 'string' && /^\/profile(?:\/[A-Za-z0-9_-]{1,80})?$/.test(value);
export function rememberProfileReturn(storage, hash, now = Date.now()) {
  try {
    const path = String(hash || '').replace(/^#/, '');
    if (valid(path)) storage.setItem(KEY, JSON.stringify({ path, at: now }));
    else storage.removeItem(KEY);
  } catch { /* Authentication still works if temporary storage is unavailable. */ }
}
export function consumeProfileReturn(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(KEY); storage.removeItem(KEY);
    const saved = JSON.parse(raw);
    if (valid(saved?.path) && Number.isFinite(saved.at) && now >= saved.at && now - saved.at <= 15 * 60_000) return saved.path;
  } catch { /* A stale or malformed return target never controls navigation. */ }
  return '/';
}
