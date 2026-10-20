import { accountStore } from '../shared/account/store.js';

export class StudioError extends Error {
  constructor(message, status = 0, payload = null) { super(message); this.name = 'StudioError'; this.status = status; this.payload = payload; }
}
const rotations = new Map();
export function isStudioSessionRotation(previous, next) {
  let token = previous;
  for (let i = 0; i < 32 && rotations.has(token); i += 1) { token = rotations.get(token); if (token === next) return true; }
  return false;
}
export function createStudioApi({ fetchImpl = (...args) => fetch(...args), store = accountStore, base = '', timeoutMs = 20_000 } = {}) {
  return async function request(path, { method = 'GET', body, binary = false, headers: extraHeaders = {}, raw = false, signal } = {}) {
    const token = store.readSession();
    if (!token) throw new StudioError('سجّل دخولك إلى حساب ميدان أولًا.', 401);
    const controller = new AbortController();
    const relay = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', relay, { once: true });
    if (signal?.aborted) controller.abort(signal.reason);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, { method, headers: { ...(body !== undefined && !binary ? { 'content-type': 'application/json' } : {}), ...extraHeaders, authorization: `Bearer ${token}` }, ...(body !== undefined ? { body: binary ? body : JSON.stringify(body) } : {}), signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      // A response for an old account must never establish a new account's session.
      if (store.readSession() !== token && !isStudioSessionRotation(token, store.readSession())) throw new StudioError('تغيّر الحساب. أعد فتح الاستوديو.', 401);
      const rotated = response.headers?.get?.('x-maydan-session');
      if (rotated) { rotations.set(store.readSession(), rotated); if (rotations.size > 64) rotations.delete(rotations.keys().next().value); store.writeSession(rotated); }
      if (response.status === 204) return null;
      if (raw && response.ok) return response;
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new StudioError(response.status === 409 ? 'حُفظت تعديلات من تبويب آخر. احتفظ بنسختك ثم حمّل المسودة الأحدث.' : response.status === 403 ? 'حسابك لا يملك صلاحية هذه العملية.' : response.status === 401 ? 'انتهت جلسة الحساب. سجّل الدخول مجددًا.' : result?.message || result?.error || 'تعذّر إتمام الطلب. حاول مجددًا.', response.status, result);
      if (result === null) throw new StudioError('وصل رد غير صالح من الخادم.', response.status);
      return result;
    } catch (error) {
      if (error instanceof StudioError) throw error;
      throw new StudioError(controller.signal.aborted ? 'استغرق الاتصال وقتًا طويلًا. بقيت تعديلاتك في الصفحة.' : 'تعذّر الاتصال. بقيت تعديلاتك في الصفحة.', 0);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', relay); }
  };
}
export const studioApi = createStudioApi();
