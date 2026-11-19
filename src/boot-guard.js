import { clearLocalDataKeepingAccount } from './shared/account/local-data.js';
import { initializeOpening } from './boot/opening.js';

// Install recovery before starting any optional graphics or application code.
function showFatal(detail) {
  window.__maydanStartupFailed = true;
  window.__maydanOpening?.stop();
  document.getElementById('boot').hidden = true;
  document.getElementById('root').hidden = true;
  document.getElementById('fatal-detail').textContent = String(detail);
  const fatal = document.getElementById('fatal');
  fatal.hidden = false;
  fatal.focus?.();
}
window.__maydanShowFatal = showFatal;
window.onerror = function (message, source, line, column) {
  if (window.__maydanBooted || /ResizeObserver loop/.test(String(message))) return false;
  showFatal(`${message}\n${line}:${column}`);
  return false;
};

function home() {
  location.hash = '#/';
  location.reload();
}
document.getElementById('fatal-reload').addEventListener('click', () => location.reload());
document.getElementById('fatal-home').addEventListener('click', home);
document.getElementById('fatal-clear').addEventListener('click', () => {
  clearLocalDataKeepingAccount();
  home();
});

if (document.querySelector) {
  try { window.__maydanOpening = initializeOpening(); }
  catch (error) { showFatal(error?.message || error); }
}
