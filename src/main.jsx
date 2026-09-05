import React from 'react';
import { createRoot } from 'react-dom/client';
import { PlatformApp } from './platform/PlatformApp.jsx';

const rootElement = document.getElementById('root');
try {
  createRoot(rootElement).render(<PlatformApp />);
} catch (error) {
  const fatal = document.getElementById('fatal');
  if (fatal) {
    fatal.style.display = 'block';
    fatal.textContent = `تعذّر بدء المنصة:\n${error && error.message ? error.message : error}`;
  }
}
