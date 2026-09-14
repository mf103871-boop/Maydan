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

try {
  createRoot(rootElement, {
    onUncaughtError: (error) => showFatal(error),
    onCaughtError: (error) => { try { console.error('[ميدان]', error); } catch (e) { /* ignore */ } },
  }).render(<PlatformApp />);
} catch (error) {
  showFatal(error);
}
