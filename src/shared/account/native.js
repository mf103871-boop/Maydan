// جسر الغلاف الأصلي (iOS): نفس قناة `maydan` المستعملة في shared/fx/haptics.js،
// لكن بوعود: كل نداء يحمل معرّفًا، والغلاف يردّ عبر window.maydanNative.resolve(id, …)
// ويبثّ أحداثًا (عودة المصادقة مثلًا) عبر window.maydanNative.event(name, payload).
import { ClientError } from '../../online/client.js';

export const NATIVE_TIMEOUT = 60_000;

// أصل الغلاف الحقيقي: مخطط maydan: يخدمه WKURLSchemeHandler.
// الاحتياط (window.MaydanNative) يبقي أغلفة أقدم/اختبارات تعمل.
export function isNativeShell() {
  try {
    if (typeof window === 'undefined') return false;
    const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.maydan;
    const bridged = !!(handler && typeof handler.postMessage === 'function');
    const scheme = typeof location !== 'undefined' && location.protocol === 'maydan:';
    if (bridged && scheme) return true;
    return !!(window.MaydanNative && typeof window.MaydanNative === 'object');
  } catch (error) {
    return false;
  }
}

function postToNative(message) {
  if (typeof window === 'undefined') return false;
  try {
    const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.maydan;
    if (handler && typeof handler.postMessage === 'function') { handler.postMessage(message); return true; }
    if (window.MaydanNative && typeof window.MaydanNative.postMessage === 'function') { window.MaydanNative.postMessage(JSON.stringify(message)); return true; }
  } catch (error) {
    // تحت
  }
  return false;
}

const pending = new Map();
const listeners = new Map();
let counter = 0;

// callNative('products') → Promise<result>؛ الرفض دائمًا ClientError بكود من errors.js.
export function callNative(type, payload = {}, { timeout = NATIVE_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    installNativeBridge();
    const id = `mdn-${Date.now().toString(36)}-${(counter += 1)}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new ClientError('NETWORK')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    if (!postToNative({ type, id, ...payload })) {
      clearTimeout(timer);
      pending.delete(id);
      reject(new ClientError('NETWORK'));
    }
  });
}

// اشتراك بحدث من الغلاف؛ يعيد دالة إلغاء.
export function onNativeEvent(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => { const set = listeners.get(name); if (set) set.delete(fn); };
}

export function resolveNative(id, { ok = true, result = null, error = null } = {}) {
  const entry = pending.get(String(id));
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(String(id));
  if (ok) entry.resolve(result);
  else entry.reject(new ClientError(error || 'NETWORK'));
  return true;
}

export function emitNativeEvent(name, payload) {
  const set = listeners.get(name);
  if (!set) return false;
  for (const fn of [...set]) { try { fn(payload); } catch (error) { /* مستمع واحد لا يوقف البقية */ } }
  return true;
}

// يُركَّب مرة واحدة: الغلاف ينادي window.maydanNative.resolve / .event
export function installNativeBridge(target) {
  const host = target || (typeof window === 'undefined' ? null : window);
  if (!host) return null;
  if (!host.maydanNative || !host.maydanNative.__maydan) {
    host.maydanNative = {
      __maydan: true,
      resolve: (id, response) => resolveNative(id, response || {}),
      event: (name, payload) => emitNativeEvent(name, payload),
    };
  }
  return host.maydanNative;
}

// للاختبارات: إفراغ الانتظار والمستمعين بين الحالات.
export function resetNativeForTests() {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  listeners.clear();
}

installNativeBridge();
