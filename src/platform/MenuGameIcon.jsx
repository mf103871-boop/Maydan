import React from 'react';

// The small outline illustrations from the platform menu blueprint. Game
// artwork remains available on its own screens at its intended larger scale.
const pictures = {
  badeeha: <><path fill="#f9cf55" d="M12 4.5a5.4 5.4 0 0 0-3.4 9.6c.9.7 1.4 1.6 1.4 2.9h4c0-1.3.5-2.2 1.4-2.9A5.4 5.4 0 0 0 12 4.5Z"/><path fill="#ad7863" d="M10 17h4v2.5h-4z"/><path d="M11 21h2M12 1v1M4.5 3.5l1 1M2 9h2m16 0h2m-3.5-5.5-1 1M4 15l1.4-.8m14.6.8-1.4-.8"/></>,
  mafia: <><path fill="#aa5052" d="m6.4 9.5 1.1-5a1.8 1.8 0 0 1 2.7-1.1l1.8 1 2-1a1.7 1.7 0 0 1 2.5 1.1l1.2 5z"/><path fill="#5c414d" d="M6 8.4h12l.7 2.1H5.3z"/><ellipse cx="12" cy="11" rx="10" ry="2.3" fill="#af6362"/><path fill="#4f4852" d="M5 15.1c2-1.2 4.9-.4 7 .3 2.1-.7 5-1.5 7-.3l-.9 3c-.6 1.6-3.2 1.9-4.6 1l-1.5-1-1.5 1c-1.4.9-4 .6-4.6-1z"/><path stroke="#fff1df" d="M7.8 16.9h1.3m5.8 0h1.3"/></>,
  ersomha: <><path fill="#ffd16b" d="m4 16.5 12-12 3.5 3.5-12 12L3 21z"/><path fill="#e88075" d="m16 4.5 2-2a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2l-2 2z"/><path fill="#f5e4cf" d="m4 16.5 3.5 3.5L3 21z"/><path d="m5.8 18.2 12-12M2 22h7m1 0c2-2 5-.1 7-1.5"/></>,
  beep: <><path fill="#f2a263" d="M5 15h14l-1.7-2.4V9a5.3 5.3 0 0 0-10.6 0v3.6zM9.5 16a2.5 2.5 0 0 0 5 0M12 2v1.7"/><path d="M4.5 5.1a7 7 0 0 0-2.2 5.4m17.2-5.4a7 7 0 0 1 2.2 5.4"/></>,
  mamnoo: <><circle cx="12" cy="12" r="9.1" fill="#e36c65"/><circle cx="12" cy="12" r="6.4" fill="#fae1c9" strokeWidth=".5"/><path d="m6.6 17.4 10.8-10.8" stroke="#d4574c" strokeWidth="2.5"/></>,
  jabeen: <><path fill="#ae6265" d="M2.7 12.5c.7-4.4 4-7 9.3-7s8.6 2.6 9.3 7c.4 2.7-.8 5.2-3 6.5 1.5-3-1.9-5.6-6.3-5.6S4.2 16 5.7 19c-2.2-1.3-3.4-3.8-3-6.5Z"/><rect x="8" y="3" width="8" height="7" rx=".6" fill="#ffcf55"/></>,
  fabraka: <><rect x="3" y="10" width="18" height="11" rx="1.2" fill="#675b5e"/><path fill="#f7e8d2" d="m2.5 6 16.8-4.2 1.1 4.4-16.8 4.2z"/><path d="m6 5.1 3 3m2-4.2 3 3m2-4.2 3 3M3 12.3h18"/><path fill="#fff4e7" stroke="none" d="m10 14 5 2.8-5 2.7z"/></>,
  meenfina: <><circle cx="12" cy="6" r="4.6" fill="#dc726b"/><path d="M11 4.7a1.1 1.1 0 0 1 2.2 0c0 .9-1.2.9-1.2 1.8m0 1.5h.01" stroke="#fff6eb"/><circle cx="6" cy="14" r="2.6" fill="#be7770"/><circle cx="18" cy="14" r="2.6" fill="#be7770"/><path fill="#be7770" d="M2 21v-.7a4 4 0 0 1 8 0v.7zM14 21v-.7a4 4 0 0 1 8 0v.7z"/></>,
};

export function MenuGameIcon({ id, className = '' }) {
  return <span className={'menu-game-art ' + className} aria-hidden="true"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#422a37" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">{pictures[id] || pictures.badeeha}</svg></span>;
}
