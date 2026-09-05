// موجّه بسيط على الـ hash: #/ ، #/game/:id ، #/play/:id ، #/players ، #/settings ، #/about
// مع زر رجوع (popstate) وحارس خروج أثناء اللعب.
import { useEffect, useState } from 'react';

const ROUTES = [
  ['home', /^\/?$/],
  ['game', /^\/game\/([a-z0-9-]+)$/],
  ['play', /^\/play\/([a-z0-9-]+)$/],
  ['players', /^\/players$/],
  ['settings', /^\/settings$/],
  ['about', /^\/about$/],
];

export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  for (const [name, re] of ROUTES) {
    const m = path.match(re);
    if (m) return { name, path, params: m[1] ? { id: m[1] } : {} };
  }
  return { name: 'home', path: '/', params: {} };
}

const listeners = new Set();
let current = typeof location !== 'undefined' ? parseHash(location.hash) : parseHash('');
let stack = [current.path];
let direction = 'forward';
let exitGuard = null;
let restoring = false;

export function getRoute() { return current; }
export function getDirection() { return direction; }

function emit() { listeners.forEach((fn) => fn(current)); }

export function navigate(path, { replace = false } = {}) {
  if (typeof location === 'undefined') return;
  const target = path.startsWith('/') ? path : `/${path}`;
  if (target === current.path) return;
  direction = 'forward';
  if (replace) {
    stack[stack.length - 1] = target;
    history.replaceState(null, '', `#${target}`);
    current = parseHash(`#${target}`);
    emit();
  } else {
    stack.push(target);
    location.hash = target; // triggers hashchange → handled below
  }
}

export function back() {
  if (typeof history === 'undefined') return;
  if (stack.length > 1) history.back();
  else navigate('/', { replace: true });
}

// fn(targetPath) → true إذا تولّى الحارس الأمر (أوقف الخروج وعرض تأكيدًا مثلًا)
export function setExitGuard(fn) { exitGuard = fn; }

function onHashChange() {
  const next = parseHash(location.hash);
  if (restoring) { restoring = false; current = next; return; }
  const previous = current;
  const leavingPlay = previous.name === 'play' && next.name !== 'play';
  if (leavingPlay && exitGuard) {
    // أعد المسار كما كان، ثم اسأل الحارس؛ الحارس ينادي navigate بنفسه عند التأكيد.
    restoring = true;
    location.hash = previous.path;
    stack = stack.filter((p) => p !== next.path);
    if (stack[stack.length - 1] !== previous.path) stack.push(previous.path);
    exitGuard(next.path);
    return;
  }
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
    return () => listeners.delete(setRoute);
  }, []);
  return route;
}
