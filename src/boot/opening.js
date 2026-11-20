import { startOrbit } from './opening-motion.js';
import { hasWebPack, prepareWebPack } from './web-pack.js';
import { isBundledNative, prepareNativePack } from './native-pack.js';

const labels = {
  checking: ['فحص ملفات اللعبة', 'Checking game files'],
  loading: ['تحميل ملفات اللعبة', 'Loading game files'],
  verify: ['التحقّق من الملفات المحفوظة', 'Verifying saved files'],
  ready: ['اكتمل التحميل', 'Ready to play'],
  installed: ['ملفات اللعبة جاهزة', 'Installed game files are ready'],
  stopped: ['توقّف تحميل ميدان', 'Maydan couldn’t finish loading'],
  network: ['توقف تنزيل الملفات. تحقّق من الاتصال ثم أعد المحاولة.', 'The download was interrupted. Check your connection and try again.'],
  integrity: ['تعذّر التحقق من أحد ملفات اللعبة. أعد المحاولة.', 'A game file could not be verified. Try again.'],
  storage: ['تعذّر حفظ ملفات اللعبة. تحقّق من المساحة المتاحة ثم أعد المحاولة.', 'The game files could not be saved. Check available storage and try again.'],
  unsupported: ['يتطلب تحميل اللعبة متصفحًا يدعم تخزين الملفات محليًا.', 'To download the game, open it in a browser that supports local file storage.'],
  nativeError: ['تعذّر التحقق من ملفات ميدان على هذا الجهاز. أعد المحاولة.', 'Maydan couldn’t verify the game files on this device. Try again.'],
  artwork: ['تعذّر عرض رسوم اللعبة. أعد المحاولة لفتح الشاشة.', 'The game artwork couldn’t be displayed. Try again to open this screen.'],
};

function earlySettings() {
  try { return JSON.parse(localStorage.getItem('maydan:platform:settings')); }
  catch { return null; }
}

// This controller lives outside React so its retry and recovery controls also
// work when the application bundle cannot mount. The router retains its URL.
export function initializeOpening() {
  const board = document.getElementById('boot');
  const root = document.getElementById('root');
  const byId = name => document.getElementById('opening-' + name);
  const saved = earlySettings();
  const english = saved && typeof saved === 'object' ? saved.uiLocale === 'en' : /^en(?:-|$)/i.test(navigator.language);
  const locale = english ? 'en' : 'ar';
  const message = key => labels[key][english ? 1 : 0];
  for (const el of [document.documentElement, board, document.getElementById('fatal')]) {
    el.lang = locale;
    el.dir = english ? 'ltr' : 'rtl';
  }
  for (const el of document.querySelectorAll('#boot [data-ar],#fatal [data-ar]')) el.textContent = el.dataset[locale];
  board.dataset.reduce = String(saved?.reducedMotion === true);

  const native = isBundledNative();
  if (!native && !hasWebPack()) {
    board.hidden = true;
    return;
  }
  root.hidden = true;
  board.dataset.designScreen = 'startup';
  const digits = english ? 'en' : 'ar-JO-u-nu-arab';
  const count = new Intl.NumberFormat(digits, {maximumFractionDigits:0});
  const size = new Intl.NumberFormat(digits, {maximumFractionDigits:1});
  let lastMilestone = -1, latest, timer, controller, stopOrbit, stopped = false;
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const glint = byId('glint'), ripple = byId('ripple');
  function cancelMilestone() {
    for (const layer of [glint, ripple]) {
      for (const animation of layer.getAnimations?.() || []) animation.cancel();
    }
  }
  function motionChanged() { if (motionPreference.matches) cancelMilestone(); }
  if (motionPreference.addEventListener) motionPreference.addEventListener('change', motionChanged);
  else motionPreference.addListener(motionChanged);
  let markReady, retryView = false;
  const ready = new Promise(resolve => { markReady = resolve; });
  const handle = { ready, verified: false, stage, reveal, stop };
  function stop() {
    stopped = true;
    controller?.abort();
    clearTimeout(timer);
    stopOrbit?.();
    cancelMilestone();
    if (motionPreference.removeEventListener) motionPreference.removeEventListener('change', motionChanged);
    else motionPreference.removeListener(motionChanged);
    board.hidden = true;
    delete board.dataset.designScreen;
  }
  function stage() {
    if (!handle.verified || stopped) return;
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
    root.dataset.openingCovered = 'true';
    root.hidden = false;
  }
  // The legal boundary calls this only after choosing the first actionable
  // screen. Keep it under the cover while its visible game cards decode.
  function reveal() {
    if (!handle.verified || stopped) return;
    let cancelled = false, deadline;
    const firstView = async () => {
      const images = Array.from(root.querySelectorAll('[data-design-screen="home"] .game-card img, .terms-consent img'));
      const visible = images.filter(img => {
        const bounds = img.getBoundingClientRect();
        return bounds.height && bounds.width && bounds.bottom > 0 && bounds.top < innerHeight;
      });
      const entry = root.querySelector('.screen');
      const animations = (entry?.getAnimations?.() || []).filter(a => /^screen-in(?:-back)?$/.test(a.animationName));
      await Promise.all([...visible.map(img => img.decode()), ...animations.map(a => a.finished.catch(() => {}))]);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    Promise.race([firstView(), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('Screen artwork was not ready')), 8000);
    })]).then(() => {
      if (stopped || cancelled) return;
      root.removeAttribute('inert');
      root.removeAttribute('aria-hidden');
      delete root.dataset.openingCovered;
      stop();
      window.performance?.mark?.('maydan-opening-revealed');
    }).catch(error => {
      if (stopped || cancelled) return;
      retryView = true;
      showFailure('artwork', error);
    }).finally(() => clearTimeout(deadline));
    return () => { cancelled = true; clearTimeout(deadline); };
  }
  function showFailure(reason, error) {
    clearTimeout(timer); timer = null;
    board.dataset.phase = 'error';
    byId('title').textContent = message('stopped');
    byId('meter').hidden = true;
    byId('failure').hidden = false;
    byId('reason').textContent = message(reason);
    byId('detail').textContent = String(error?.message || error);
    byId('announce').textContent = byId('reason').textContent;
  }
  function paint(progress) {
    const { phase, totalBytes, totalFiles, completedBytes = 0, completedFiles = 0 } = progress;
    board.dataset.phase = phase;
    const verifying = phase === 'loading' && completedBytes > 0 && completedBytes === progress.cachedBytes;
    const status = phase === 'ready' && native ? message('installed') : message(verifying || phase === 'verify' ? 'verify' : phase);
    byId('state').textContent = status;
    if (!totalBytes) return;
    const fraction = phase === 'ready' ? 1 : Math.min(.999, completedBytes / totalBytes);
    const pct = Math.floor(fraction * 100);
    const percent = count.format(pct) + (english ? '%' : '٪');
    board.style.setProperty('--warmth', String(.52 + fraction * .45));
    byId('fill').style.setProperty('--fraction', String(fraction));
    byId('pct').textContent = percent;
    byId('progress').setAttribute('aria-valuenow', String(pct));
    byId('files').textContent = english ? `${count.format(completedFiles)} / ${count.format(totalFiles)} files` : `${count.format(completedFiles)} من ${count.format(totalFiles)} ملف`;
    const used = size.format(completedBytes / 1e6), total = size.format(totalBytes / 1e6);
    byId('bytes').dir = board.dir;
    byId('bytes').textContent = english ? `${used} / ${total} MB` : `${used} من ${total} م.ب.`;
    const milestone = Math.floor(pct / 25);
    if (lastMilestone === milestone) return;
    lastMilestone = milestone;
    byId('announce').textContent = status + ' ' + percent;
    if (!milestone || board.dataset.reduce === 'true' || motionPreference.matches) return;
    cancelMilestone();
    glint.animate?.([{opacity:0,backgroundPosition:'100% 0'},{opacity:.7,offset:.43},{opacity:0,backgroundPosition:'0% 0'}],{duration:650,easing:'ease-in-out'});
    ripple.animate?.([{opacity:0,transform:'scale(.74)'},{opacity:.7,offset:.25},{opacity:0,transform:'scale(1.13)'}],{duration:780,easing:'ease-out'});
  }
  function update(progress) {
    if (stopped) return;
    latest = progress;
    if (progress.phase === 'ready') { clearTimeout(timer); timer = null; paint(progress); }
    else if (!timer) timer = setTimeout(() => { timer = null; paint(latest); }, 80);
  }
  async function run() {
    if (controller || stopped) return;
    controller = new AbortController();
    lastMilestone = -1;
    byId('failure').hidden = true;
    byId('meter').hidden = false;
    byId('title').textContent = byId('title').dataset[locale];
    byId('pct').textContent = '—';
    byId('progress').removeAttribute('aria-valuenow');
    byId('fill').style.setProperty('--fraction', '0');
    byId('files').textContent = byId('bytes').textContent = '';
    paint({phase:'checking'});
    try {
      const prepare = native ? prepareNativePack : prepareWebPack;
      await prepare({ onProgress:update, signal:controller.signal });
      if (stopped) return;
      handle.verified = true;
      // Let the final, verified percentage paint before mounting the route.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (stopped) return;
      markReady();
    } catch (error) {
      if (stopped) return;
      const webReason = ['network','integrity','storage','unsupported'].includes(error?.code) ? error.code : 'network';
      showFailure(native ? 'nativeError' : webReason, error);
    } finally { controller = null; }
  }
  try { stopOrbit = startOrbit(board); } catch { /* The download can run without decoration. */ }
  byId('retry').addEventListener('click', () => retryView ? location.reload() : run());
  run();
  return handle;
}
