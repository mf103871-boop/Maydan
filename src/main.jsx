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
  createRoot(rootElement, {
    onUncaughtError: (error) => showFatal(error),
    onCaughtError: (error) => log('[ميدان]', error),
  }).render(<PlatformApp />);
  armRuntimeErrorHandlers();
} catch (error) {
  showFatal(error);
}
