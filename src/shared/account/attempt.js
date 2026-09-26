// سرّ محاولة الدخول: يولّده هذا المتصفح قبل التحويل إلى المزوّد ويحتفظ به وحده؛ يسافر
// إلى الخادم بصمته في `state`، ولا يُقبل رمز الدخول العائد (#/auth?code=) إلا معه.
// بلا هذا كان يمكن دفع متصفح لاعب إلى رابط دخول شخص آخر فيدخل بحسابه.
const KEY = 'maydan:auth:attempt';
const TTL = 15 * 60_000;
const stores = () => {
  const list = [];
  try { if (typeof sessionStorage !== 'undefined') list.push(sessionStorage); } catch { /* unavailable */ }
  try { if (typeof localStorage !== 'undefined') list.push(localStorage); } catch { /* unavailable */ }
  return list;
};
export function beginAuthAttempt(now = Date.now()) {
  const value = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  for (const store of stores()) { try { store.setItem(KEY, JSON.stringify({ value, at: now })); } catch { /* next store */ } }
  return value;
}
export function currentAuthAttempt(now = Date.now()) {
  for (const store of stores()) {
    try {
      const saved = JSON.parse(store.getItem(KEY));
      if (/^[a-f0-9]{32}$/.test(saved?.value || '') && Number.isFinite(saved.at) && now - saved.at <= TTL) return saved.value;
    } catch { /* next store */ }
  }
  return '';
}
export function clearAuthAttempt() {
  for (const store of stores()) { try { store.removeItem(KEY); } catch { /* unavailable */ } }
}
