// اختبار انحدار للمؤقت: يثبت أن «ممنوع» و«قبل ما يطق» يعيدان تشغيل المؤقت في كل دور/قنبلة،
// وأن useTimer نفسه لم يعد يعلق على صفر بعد انتهاء العدّ ويتبع مدة جديدة عندما يكون متوقفًا.
//
// useTimer يحتاج React (hooks) لا DOM؛ لذلك نبنيه بـ esbuild مع استبدال 'react' بمشغّل hooks
// صغير داخل .cache، فنقود المصدر الحقيقي (لا نسخة منه) بساعة وهمية.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { initialState as mamnooInit, reduce as mamnooReduce, currentTeam } from '../src/games/mamnoo/logic.js';
import { initialState as beepInit, reduce as beepReduce, currentPlayer, createPromptSource, bombPromptArgs, BOMB_LEVELS, nextBombSeconds, BOMB_RANGE } from '../src/games/beep/logic.js';
import { seeded } from './helpers.js';

const root = process.cwd();
mkdirSync(path.join(root, '.cache'), { recursive: true });
const temp = mkdtempSync(path.join(root, '.cache', 'timer-regression-'));
after(() => rmSync(temp, { recursive: true, force: true }));

// ── مشغّل hooks صغير: useState/useRef/useCallback/useEffect بإعادة تصيير متزامنة ──
const miniReact = path.join(temp, 'mini-react.js');
writeFileSync(miniReact, `
let hooks = [], idx = 0, dirty = false, pending = [], root = null, result;
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
export function useState(init) {
  const i = idx++;
  if (hooks[i] === undefined) hooks[i] = { v: typeof init === 'function' ? init() : init };
  const h = hooks[i];
  return [h.v, (next) => { const v = typeof next === 'function' ? next(h.v) : next; if (!Object.is(v, h.v)) { h.v = v; dirty = true; } }];
}
export function useRef(init) { const i = idx++; if (hooks[i] === undefined) hooks[i] = { current: init }; return hooks[i]; }
export function useCallback(fn, deps) { const i = idx++; if (hooks[i] === undefined || !same(hooks[i].deps, deps)) hooks[i] = { fn, deps }; return hooks[i].fn; }
export function useMemo(fn, deps) { const i = idx++; if (hooks[i] === undefined || !same(hooks[i].deps, deps)) hooks[i] = { value: fn(), deps }; return hooks[i].value; }
export function useEffect(fn, deps) {
  const i = idx++;
  const prev = hooks[i];
  if (prev === undefined || !same(prev.deps, deps)) {
    pending.push({ i, fn, cleanup: prev ? prev.cleanup : null });
    hooks[i] = { deps, cleanup: prev ? prev.cleanup : null };
  }
}
function runEffects() {
  const queue = pending; pending = [];
  for (const e of queue) { if (e.cleanup) e.cleanup(); const c = e.fn(); hooks[e.i].cleanup = typeof c === 'function' ? c : null; }
}
export function __mount(fn, props) { hooks = []; pending = []; root = { fn, props }; return __render(props); }
export function __render(props) {
  if (props !== undefined) root.props = props;
  let guard = 0;
  do { dirty = false; idx = 0; result = root.fn(root.props); runEffects(); guard += 1; } while (dirty && guard < 200);
  return result;
}
export default { useState, useRef, useCallback, useMemo, useEffect };
`);

await build({
  stdin: { contents: "export { useTimer } from './src/shared/ui/useTimer.js';\nexport { __mount, __render } from 'react';\n", resolveDir: root, loader: 'js' },
  outfile: path.join(temp, 'timer.mjs'), bundle: true, platform: 'node', format: 'esm', alias: { react: miniReact }, logLevel: 'silent',
});
const { useTimer, __mount, __render } = await import(pathToFileURL(path.join(temp, 'timer.mjs')));

// ── ساعة وهمية + document وهمي ──
const realNow = Date.now;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const realSetTimeout = globalThis.setTimeout;
const realDocument = globalThis.document;
let now = 1_700_000_000_000;
const intervals = new Map();
let nextId = 1;
Date.now = () => now;
globalThis.setInterval = (fn) => { const id = nextId++; intervals.set(id, fn); return id; };
globalThis.clearInterval = (id) => { intervals.delete(id); };
globalThis.setTimeout = (fn, ms) => realSetTimeout(fn, ms); // 3-2-1 لا يُستخدم هنا
if (!globalThis.document) globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
after(() => {
  Date.now = realNow; globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval; globalThis.setTimeout = realSetTimeout;
  if (realDocument === undefined) delete globalThis.document;
});

function mountTimer(opts) {
  const state = { ...opts };
  const timer = __mount((p) => useTimer(p), state);
  const api = {
    get current() { return api._t; },
    _t: timer,
    setSeconds(seconds) { state.seconds = seconds; api._t = __render(state); return api._t; },
    flush() { api._t = __render(undefined); return api._t; },
    advance(seconds) { // يقدّم الساعة ثانية بثانية ويشغّل نبضات المؤقت
      for (let i = 0; i < seconds; i += 1) { now += 1000; for (const fn of [...intervals.values()]) fn(); api.flush(); }
      return api._t;
    },
  };
  return api;
}

test('useTimer: بعد انتهاء العدّ يعيد reset المؤقت إلى المدة الكاملة ويشتغل من جديد', () => {
  let ended = 0;
  const h = mountTimer({ seconds: 10, onEnd: () => { ended += 1; } });
  assert.equal(h.current.left, 10);
  h.current.start(); h.flush();
  assert.equal(h.current.running, true);
  h.advance(4);
  assert.equal(h.current.left, 6, 'العدّ ينزل مع الوقت');
  h.advance(6);
  assert.equal(ended, 1);
  assert.equal(h.current.running, false);
  assert.equal(h.current.left, 0, 'يعلق على صفر — وهذا سبب العطل عندما يُنتظر left === seconds');

  // الإصلاح: كل دور جديد يصفّر صراحةً ثم يشغّل (نمط jabeen/ThreeRound الذي نتبعه الآن في mamnoo/bomb)
  h.current.reset(10); h.flush();
  assert.equal(h.current.left, 10);
  assert.equal(h.current.running, false);
  h.current.start(); h.flush();
  assert.equal(h.current.running, true);
  h.advance(3);
  assert.equal(h.current.left, 7, 'الدور الثاني يعدّ فعليًا');
  h.advance(7);
  assert.equal(ended, 2, 'onEnd يُطلق في الدور الثاني أيضًا');
});

test('useTimer: start بعد انتهاء العدّ لا ينتهي فورًا حتى بدون reset', () => {
  let ended = 0;
  const h = mountTimer({ seconds: 5, onEnd: () => { ended += 1; } });
  h.current.start(); h.flush(); h.advance(5);
  assert.equal(ended, 1);
  h.current.start(); h.flush();
  assert.equal(h.current.running, true);
  assert.equal(h.current.left, 5, 'يبدأ من المدة الكاملة لا من صفر');
  assert.equal(ended, 1, 'لا انفجار فوري');
  h.advance(5);
  assert.equal(ended, 2);
});

test('useTimer: تغيّر المدة والمؤقت متوقف يحدّث left، ولا يقاطع عدًّا جاريًا', () => {
  const h = mountTimer({ seconds: 25, onEnd: () => {} });
  assert.equal(h.current.left, 25);
  h.setSeconds(48); // قنبلة جديدة بمدة عشوائية جديدة
  assert.equal(h.current.left, 48, 'left يتبع المدة الجديدة وهو متوقف');
  assert.equal(h.current.total, 48);
  h.current.start(); h.flush(); h.advance(5);
  assert.equal(h.current.left, 43);
  h.setSeconds(60); // تغيّر أثناء العدّ: لا يُعاد الضبط
  assert.equal(h.current.left, 43, 'العدّ الجاري لا يُقاطع');
  assert.equal(h.current.running, true);
});

// ── المصدر: لا مساواة هشّة، وreset صريح في بداية كل دور ──
const mamnooSrc = readFileSync(path.join(root, 'src/games/mamnoo/Game.jsx'), 'utf8');
const beepSrc = readFileSync(path.join(root, 'src/games/beep/Game.jsx'), 'utf8');

test('لا شرط تشغيل هشّ مبني على مساواة timer.left في أي من اللعبتين', () => {
  for (const [name, src] of [['mamnoo', mamnooSrc], ['beep', beepSrc]]) {
    assert.doesNotMatch(src, /timer\.left\s*===/, `${name}: تشغيل المؤقت لا يجوز أن يعتمد على مساواة left`);
  }
  assert.match(mamnooSrc, /state\.phase === 'play'\) \{ timer\.reset\(state\.seconds\); timer\.start\(\); \}/);
  assert.match(beepSrc, /state\.phase === 'prompt'\) \{ timer\.reset\(state\.bombSeconds\); timer\.start\(\); \}/);
  assert.doesNotMatch(beepSrc, /source\.next\(1, 1\)/, 'وضع القنبلة لا يسحب أصعب الطلبات');
  assert.match(beepSrc, /bombPromptArgs\(/);
});

// نقتطع تأثير تشغيل المؤقت من ملف اللعبة نفسه ونشغّله كما يشغّله React (عند تغيّر مصفوفة الاعتماد)،
// فيختبر الاختبار الشيفرة المشحونة لا نسخة منها.
function extractTimerEffect(src, marker) {
  const line = src.split('\n').find((l) => l.includes('useEffect(') && l.includes('timer.') && l.includes(marker));
  assert.ok(line, `لم يُعثر على تأثير المؤقت (${marker})`);
  const m = /useEffect\(\(\) => \{(.*)\}, \[(.*?)\]\)/.exec(line);
  assert.ok(m, `تعذّر تحليل التأثير: ${line}`);
  return { run: new Function('state', 'timer', m[1]), deps: new Function('state', `return [${m[2]}]`) };
}

function makeEffectRunner(effect, timerHandle) {
  let prev = null;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return (state) => { // = تصيير React: props ثم التأثير عند تغيّر الاعتمادات
    const next = effect.deps(state);
    if (same(prev, next)) return;
    prev = next;
    effect.run(state, timerHandle.current);
    timerHandle.flush();
  };
}

// ── ممنوع: جولتان كاملتان، المؤقت الحقيقي يُقاد بتأثير Game.jsx الحقيقي ──
test('ممنوع: المؤقت يعمل في كل دور من الجولة الأولى حتى الأخيرة', () => {
  const teams = [{ id: 't1', name: 'أ', color: '#111' }, { id: 't2', name: 'ب', color: '#222' }];
  const cards = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, word: `w${i}`, forbidden: ['1'], category: 'x', difficulty: 1 }));
  let deck = 0;
  const draw = () => cards[deck++] || null;
  let s = mamnooInit(teams, { seconds: 45, rounds: 2 });
  const h = mountTimer({ seconds: s.seconds, onEnd: () => { s = mamnooReduce(s, { type: 'TIME_UP' }); } });
  const runEffect = makeEffectRunner(extractTimerEffect(mamnooSrc, "state.phase === 'play'"), h);
  const keys = new Set();
  const timedOut = [];

  runEffect(s); // تصيير أول على شاشة التمهيد
  for (let turnNo = 0; turnNo < 4; turnNo += 1) {
    assert.equal(s.phase, 'intro', `الدور ${turnNo + 1} يبدأ من شاشة التمهيد`);
    const team = currentTeam(s);
    s = mamnooReduce(s, { type: 'BEGIN', card: draw() });
    assert.equal(s.phase, 'play');
    keys.add(`${s.phase}|${s.round}|${s.turn}`);
    runEffect(s); // ← تأثير Game.jsx الحقيقي
    assert.equal(h.current.running, true, `المؤقت يعمل في الدور ${turnNo + 1}`);
    assert.equal(h.current.left, 45);
    h.advance(20);
    assert.equal(h.current.left, 25, `المؤقت ينزل فعليًا في الدور ${turnNo + 1}`);
    s = mamnooReduce(s, { type: 'CORRECT', card: draw() });
    h.advance(25);
    timedOut.push({ turnNo, team: team.id, phase: s.phase });
    assert.equal(s.phase, 'roundEnd', `TIME_UP أنهى الدور ${turnNo + 1} تلقائيًا`);
    runEffect(s);
    s = mamnooReduce(s, { type: 'NEXT' });
    runEffect(s);
  }
  assert.equal(s.phase, 'over');
  assert.equal(keys.size, 4, 'مفتاح التأثير [phase, round, turn] يتغيّر في كل دور');
  assert.deepEqual(timedOut.map((t) => t.team), ['t1', 't2', 't1', 't2']);
  assert.ok(deck < 60, 'الجولة انتهت بالمؤقت لا باستنفاد البطاقات');
});

// ── القنبلة: تنفجر مرة بعد مرة بمدة جديدة في كل مرة ──
test('قبل ما يطق (القنبلة): كل قنبلة جديدة تعمل وتنفجر، لا الأولى فقط', () => {
  const players = [{ id: 'a', name: 'أ' }, { id: 'b', name: 'ب' }, { id: 'c', name: 'ج' }];
  const prompts = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, text: `t${i}`, difficulty: (i % 3) + 1, category: 'x' }));
  const random = seeded(7);
  const src = createPromptSource(prompts, { random: seeded(11) });
  let s = beepInit(players, { mode: 'bomb' }, { random });
  const h = mountTimer({ seconds: s.bombSeconds, onEnd: () => { s = beepReduce(s, { type: 'EXPLODE' }); } });
  const effect = extractTimerEffect(beepSrc, 'state.bombSeconds');
  const runEffect0 = makeEffectRunner(effect, h);
  const runEffect = (state) => { h.setSeconds(state.bombSeconds); runEffect0(state); }; // props ثم التأثير
  const booms = [];
  const durations = [];
  let guard = 0;

  runEffect(s);
  while (s.phase !== 'over') {
    assert.ok((guard += 1) < 40, 'حلقة لا تنتهي');
    if (s.phase === 'intro') {
      const before = s.bombSeconds;
      s = beepReduce(s, { type: 'BEGIN', prompt: src.next(...bombPromptArgs(s.history.length)) });
      assert.equal(s.phase, 'prompt');
      runEffect(s); // ← تأثير BombRound الحقيقي من Game.jsx
      assert.equal(h.current.running, true, `القنبلة رقم ${booms.length + 1} تعمل`);
      assert.equal(h.current.left, before);
      durations.push(before);
    } else if (s.phase === 'prompt') {
      // تمريرتان ثم ننتظر الانفجار — المؤقت يستمر عبر التمرير
      const holder = currentPlayer(s).id;
      s = beepReduce(s, { type: 'PASS', prompt: src.next(...bombPromptArgs(s.history.length)) });
      runEffect(s);
      assert.notEqual(currentPlayer(s).id, holder);
      assert.equal(h.current.running, true, 'التمرير لا يوقف القنبلة');
      const left = h.current.left;
      h.advance(3);
      if (s.phase === 'prompt') assert.equal(h.current.left, left - 3, 'القنبلة تواصل العدّ بين التمريرات');
      if (s.phase === 'prompt') h.advance(h.current.left);
    } else if (s.phase === 'boom') {
      booms.push({ victim: s.boomPlayerId, lives: s.lives[s.boomPlayerId] });
      const bombSeconds = nextBombSeconds(random);
      assert.ok(bombSeconds >= BOMB_RANGE[0] && bombSeconds <= BOMB_RANGE[1]);
      s = beepReduce(s, { type: 'CONTINUE', bombSeconds });
      assert.equal(s.phase, 'intro');
      runEffect(s);
    }
  }
  assert.ok(booms.length >= 5, `انفجرت ${booms.length} مرات (القنبلة لا تعمل مرة واحدة فقط)`);
  assert.ok(new Set(durations).size > 1, 'كل قنبلة بمدة عشوائية مختلفة');
});

// ── صعوبة طلبات القنبلة ──
test('القنبلة تسحب طلبات سهلة/متوسطة لا أصعب المستويات', () => {
  assert.deepEqual(BOMB_LEVELS.includes(3), false);
  for (let i = 0; i < 12; i += 1) {
    const [round, rounds] = bombPromptArgs(i);
    const level = Math.min(3, Math.max(1, Math.ceil((round / Math.max(1, rounds)) * 3)));
    assert.ok(level <= 2, `السحبة ${i} مستواها ${level}`);
  }
  assert.deepEqual(bombPromptArgs(-1), bombPromptArgs(1));
  assert.deepEqual(bombPromptArgs('x'), bombPromptArgs(0));

  const prompts = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, text: `t${i}`, difficulty: (i % 3) + 1, category: 'x' }));
  const src = createPromptSource(prompts, { random: seeded(4) });
  const levels = [];
  for (let i = 0; i < 18; i += 1) levels.push(src.next(...bombPromptArgs(i)).difficulty);
  assert.equal(levels.filter((l) => l === 3).length, 0, 'لا يُستهلك المستوى 3 في وضع القنبلة');
  assert.ok(levels.includes(1) && levels.includes(2), 'تنويع بين السهل والمتوسط');
  // بينما القديم (source.next(1, 1)) كان يبدأ بالمستوى 3 دائمًا
  const old = createPromptSource(prompts, { random: seeded(4) });
  assert.equal(old.next(1, 1).difficulty, 3, 'السلوك القديم كان يبدأ بالأصعب');
});
