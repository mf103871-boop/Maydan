// إبقاء الشاشة مضاءة أثناء اللعب. يعيد الطلب تلقائيًا عند العودة إلى الصفحة
// لأن المتصفح يحرر القفل عند إخفاء الصفحة.
export function createWakeLock() {
  let sentinel = null;
  let wanted = false;

  async function request() {
    wanted = true;
    try {
      if (typeof navigator === 'undefined' || !navigator.wakeLock || typeof document === 'undefined') return false;
      if (document.visibilityState !== 'visible') return false;
      if (sentinel && !sentinel.released) return true;
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  async function release() {
    wanted = false;
    try {
      if (sentinel) await sentinel.release();
    } catch (error) {
      // ignore
    }
    sentinel = null;
  }

  function onVisibility() {
    if (wanted && document.visibilityState === 'visible') request();
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return {
    request,
    release,
    get active() {
      return !!sentinel && !sentinel.released;
    },
    dispose() {
      release();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
