// موجّه بسيط على الـ hash: #/ ، #/game/:id ، #/play/:id ، #/players ، #/settings ، #/about ، #/terms ، #/privacy
// مع زر رجوع (popstate) وحارس خروج أثناء اللعب.
import { useEffect, useState } from 'react';

const ROUTES = [
  ['home', /^\/?$/],
  ['game', /^\/game\/([a-z0-9-]+)$/],
  ['play', /^\/play\/([a-z0-9-]+)$/],
  ['online', /^\/online(?:\/(meenfina|fabraka|ersomha|badeeha))?$/],
  ['room', /^\/room\/(\d{6})$/],
  ['players', /^\/players$/],
  ['friend-group', /^\/friends\/group\/([a-zA-Z0-9_-]+)$/],
  ['friends', /^\/friends(?:\/([a-zA-Z0-9_-]+))?$/],
  ['profile', /^\/profile(?:\/([a-zA-Z0-9_-]+))?$/],
  ['settings', /^\/settings$/],
  ['store', /^\/store$/],
  ['moderation', /^\/moderation$/],
  ['about', /^\/about$/],
  ['terms', /^\/terms$/],
  ['privacy', /^\/privacy$/],
  ['auth', /^\/auth$/],
];

// عودة الدخول تصل كـ `#/auth?code=…`: الاستعلام يُفصل عن المسار (فيبقى المكدس
// والمطابقة على المسار وحده) ثم يُدمج في params كي يقرأ AccountProvider الرمز.
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/';
  const full = raw.startsWith('/') ? raw : `/${raw}`;
  const mark = full.indexOf('?');
  const path = mark === -1 ? full : full.slice(0, mark) || '/';
  const query = {};
  if (mark !== -1) {
    try { for (const [key, value] of new URLSearchParams(full.slice(mark + 1))) query[key] = value; }
    catch (error) { /* استعلام تالف: يُتجاهل */ }
  }
  for (const [name, re] of ROUTES) {
    const m = path.match(re);
    if (m) return { name, path, params: m[1] ? { ...query, id: m[1] } : { ...query } };
  }
  return { name: 'home', path: '/', params: {} };
}

const listeners = new Set();
let current = typeof location !== 'undefined' ? parseHash(location.hash) : parseHash('');
let stack = [current.path];
let direction = 'forward';
let exitGuard = null;
let restoring = null;
// المسار الذي حاول اللاعب الوصول إليه حين اعترضه حارس الخروج: الحارس يعيد
// المسار السابق بدفع مُدخل جديد فوق مُدخله، فالخروج إليه لاحقًا = رجوع خطوة.
let guardRestore = null;
let plannedNavigation = null;
const backLayers = [];

// Dialogs and the in-game friends drawer consume Back before a match exit.
// A busy layer still consumes Back when its listener intentionally does nothing.
export function registerBackLayer(listener, { priority = 0 } = {}) {
  const layer = { listener, priority };
  backLayers.push(layer);
  return () => { const index = backLayers.indexOf(layer); if (index >= 0) backLayers.splice(index, 1); };
}
function topBackLayer() {
  return backLayers.reduce((top, layer) => !top || layer.priority >= top.priority ? layer : top, null);
}
function consumeBackLayer() {
  const layer = topBackLayer();
  if (!layer) return false;
  layer.listener();
  return true;
}

export function getRoute() { return current; }
export function getDirection() { return direction; }
export function getPreviousPath() { return stack.length > 1 ? stack[stack.length - 2] : null; }

function emit() { listeners.forEach((fn) => fn(current)); }

export function navigate(path, { replace = false } = {}) {
  if (typeof location === 'undefined') return;
  const target = path.startsWith('/') ? path : `/${path}`;
  if (target === current.path && location.hash === `#${target}`) return;
  if (replace && guardRestore === target && typeof history !== 'undefined') {
    // الخروج بعد أن اعترض الحارس زر الرجوع: لا نستبدل مُدخل الاستعادة بنفس
    // العنوان (فيصير مُدخلان متطابقان ويُبتلع ضغط الرجوع التالي) بل نرجع
    // خطوة إلى المُدخل الذي كان اللاعب ذاهبًا إليه أصلًا.
    guardRestore = null;
    direction = 'back';
    // بعد دورة أحداث: حدث hashchange الخاص بالاستعادة ما يزال في الطابور.
    setTimeout(() => history.back(), 0);
    return;
  }
  direction = 'forward';
  if (replace) {
    plannedNavigation = null;
    guardRestore = null;
    stack[stack.length - 1] = target;
    history.replaceState(null, '', `#${target}`);
    current = parseHash(`#${target}`);
    emit();
  } else {
    plannedNavigation = parseHash(`#${target}`).path;
    stack.push(target);
    location.hash = target; // triggers hashchange → handled below
  }
}

export function back() {
  if (consumeBackLayer()) return;
  if (typeof history === 'undefined') return;
  if (stack.length > 1) history.back();
  else if (['play', 'room'].includes(current.name) && exitGuard) exitGuard('/');
  else navigate('/', { replace: true });
}

// The native edge/accessibility gesture uses the same layers and exit guards
// as web Back. Keep Badeeha's legacy internal handler inside GameFrame only.
export function installNativeBackBridge(environment = typeof window === 'undefined' ? null : window) {
  if (!environment) return () => {};
  const previous = environment.maydanNavigateBack;
  const target = environment.document;
  let composing = false;
  let active = true;
  const composition = event => { composing = event.type === 'compositionstart'; };
  const nativeBack = () => {
    if (!active) return false;
    if (!composing) back();
    return true;
  };
  target?.addEventListener('compositionstart', composition, true);
  target?.addEventListener('compositionend', composition, true);
  environment.maydanNavigateBack = nativeBack;
  return () => {
    active = false;
    target?.removeEventListener('compositionstart', composition, true);
    target?.removeEventListener('compositionend', composition, true);
    if (environment.maydanNavigateBack === nativeBack) {
      if (previous === undefined) delete environment.maydanNavigateBack;
      else environment.maydanNavigateBack = previous;
    }
  };
}

// fn(targetPath) → true إذا تولّى الحارس الأمر (أوقف الخروج وعرض تأكيدًا مثلًا)
export function setExitGuard(fn) { exitGuard = fn; }

function onHashChange() {
  const next = parseHash(location.hash);
  if (restoring) {
    const expected = restoring;
    restoring = null;
    // WebKit can deliver another Back before the restoration hash event.
    // Only swallow the restoration itself, never that newer Back request.
    if (next.path === expected) { current = next; return; }
  }
  const previous = current;
  const requested = plannedNavigation === next.path;
  plannedNavigation = null;
  // Consecutive hash changes can be delivered after a second quick tab press.
  // Reading the latest URL twice must not dismiss an unrelated open layer.
  if (next.path === previous.path && JSON.stringify(next.params) === JSON.stringify(previous.params)) {
    // A browser Back may cancel a just-requested hash before its first event.
    // Keep the app's history in sync instead of retaining that cancelled entry.
    if (stack[stack.length - 1] !== next.path) {
      const index = stack.lastIndexOf(next.path);
      stack = index >= 0 ? stack.slice(0, index + 1) : [...stack, next.path];
    }
    return;
  }
  if (!requested && topBackLayer()) {
    restoring = previous.path;
    guardRestore = null;
    location.hash = previous.path;
    if (stack[stack.length - 1] !== previous.path) stack.push(previous.path);
    consumeBackLayer();
    return;
  }
  const leavingPlay = (previous.name === 'play' && next.path !== previous.path) || (previous.name === 'room' && next.path !== previous.path);
  if (leavingPlay && exitGuard) {
    // أعد المسار كما كان، ثم اسأل الحارس؛ الحارس ينادي navigate بنفسه عند التأكيد.
    // الاستعادة تدفع مُدخلًا جديدًا فوق مُدخل الوجهة، فالمكدس يبقى مطابقًا
    // لسجل المتصفح ويصحّ الرجوع خطوة عند تأكيد الخروج.
    restoring = previous.path;
    guardRestore = next.path;
    location.hash = previous.path;
    if (stack[stack.length - 1] !== previous.path) stack.push(previous.path);
    exitGuard(next.path);
    return;
  }
  guardRestore = null;
  if (stack.length > 1 && stack[stack.length - 2] === next.path) {
    stack.pop();
    direction = 'back';
  } else if (stack[stack.length - 1] !== next.path) {
    stack.push(next.path);
    direction = 'forward';
  }
  current = next;
  emit();
}

if (typeof window !== 'undefined') window.addEventListener('hashchange', onHashChange);

export function useRoute() {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    listeners.add(setRoute);
    // أي emit وقع قبل الاشتراك (ملاحة أثناء أول تصيير) يضيع وإلا تبقى الشاشة فارغة.
    setRoute(current);
    return () => listeners.delete(setRoute);
  }, []);
  return route;
}

// للاختبارات: إعادة الموجّه إلى حالة معروفة بعد تغيير location الوهمي.
export function resetRouterForTests() {
  current = parseHash(typeof location !== 'undefined' ? location.hash : '');
  stack = [current.path];
  direction = 'forward';
  exitGuard = null;
  restoring = null;
  guardRestore = null;
  plannedNavigation = null;
  backLayers.length = 0;
  listeners.clear();
}
