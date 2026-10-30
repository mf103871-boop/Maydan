import React from 'react';
import { createRoot } from 'react-dom/client';
import { PlatformApp } from './platform/PlatformApp.jsx';

const rootElement = document.getElementById('root');

// لوحة العطل الأخيرة: try/catch لا يلتقط أخطاء التصيير، وحدود الخطأ داخل
// المنصة تلتقط ما تقدر عليه؛ ما يفلت منها يصل إلى onUncaughtError.
function showFatal(error) {
  const fatal = document.getElementById('fatal');
  if (!fatal) return;
  const detail = document.getElementById('fatal-detail');
  fatal.style.display = 'block';
  const message = `تعذّر عرض المنصة:\n${(error && error.message) || error}`;
  if (detail) detail.textContent = message;
  else fatal.textContent = message;
}

const log = (label, value) => { try { console.error(label, value); } catch (e) { /* ignore */ } };

// بعد التركيب تصبح أخطاء التصيير من اختصاص onUncaughtError وحدود الخطأ؛ أما
// أخطاء معالجات الأحداث والوعود فتُسجَّل ولا تُغلق الشاشة: لوحة العطل في القالب
// كانت تظهر لأي خطأ عابر وتخفي جولة تعمل. تنبيه ResizeObserver ليس خطأً أصلًا.
function armRuntimeErrorHandlers() {
  window.__maydanBooted = true;
  window.onerror = (message) => {
    if (/ResizeObserver loop/.test(String(message))) return true;
    log('[ميدان]', message);
    return false;
  };
  window.addEventListener('unhandledrejection', (event) => log('[ميدان] وعد مرفوض', event && event.reason));
}

try {
  const appRoot = createRoot(rootElement, {
    onUncaughtError: (error) => showFatal(error),
    onCaughtError: (error) => log('[ميدان]', error),
  });
  // Keep the build flag on the import branch itself: an intermediate runtime
  // variable prevents esbuild from removing the local tool module completely.
  if (typeof __MAYDAN_UI_PREVIEW__ !== 'undefined' && __MAYDAN_UI_PREVIEW__
    && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
    && location.pathname === '/__preview__/scene') {
    import('./preview/LocalUIScenes.jsx').then(({ LocalUIScenes }) => appRoot.render(<LocalUIScenes />)).catch(showFatal);
  } else appRoot.render(<PlatformApp />);
  armRuntimeErrorHandlers();
} catch (error) {
  showFatal(error);
}
