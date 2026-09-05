// الاهتزاز: navigator.vibrate حيث يتوفر (أندرويد)، أو جسر التطبيق الأصلي إن وُجد.
// iOS لا يوفر vibrate في المتصفح، فالنداء يمر بصمت.
export const PATTERNS = {
  selection: 12,
  light: 18,
  medium: 32,
  heavy: 55,
  success: [25, 28, 55],
  warning: [42, 28, 42],
  error: 85,
  win: [28, 24, 28, 32, 75],
  tick: 8,
  explosion: [120, 40, 160],
};

function nativeMessage(payload) {
  try {
    if (typeof window === 'undefined') return false;
    if (window.MaydanNative && typeof window.MaydanNative.postMessage === 'function') {
      window.MaydanNative.postMessage(JSON.stringify(payload));
      return true;
    }
    const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.maydan;
    if (handler && typeof handler.postMessage === 'function') {
      handler.postMessage(payload);
      return true;
    }
  } catch (error) {
    // ignore
  }
  return false;
}

export function createHaptics({ enabled = true } = {}) {
  let on = enabled;
  return {
    vibrate(kind) {
      if (!on) return;
      const pattern = typeof kind === 'string' ? PATTERNS[kind] || PATTERNS.selection : kind;
      if (nativeMessage({ type: 'haptic', style: typeof kind === 'string' ? kind : 'custom', pattern })) return;
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
      } catch (error) {
        // ignore
      }
    },
    get enabled() {
      return on;
    },
    enable(value) {
      on = !!value;
    },
  };
}

// المشاركة عبر الجسر الأصلي أو Web Share أو الحافظة. تعيد 'shared' | 'copied' | 'failed'.
export async function shareText(title, text) {
  if (nativeMessage({ type: 'share', title, text })) return 'shared';
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title, text });
      return 'shared';
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch (error) {
    if (error && error.name === 'AbortError') return 'shared';
  }
  return 'failed';
}
