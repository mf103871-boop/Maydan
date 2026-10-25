import React, { useId } from 'react';
import toolsCss from './ersomha-tools.css';

/** Render once beside the canvas. Drawing commands and hit targets stay on buttons. */
export function ErsomhaToolStyles() { return <style>{toolsCss}</style>; }

/** Small sculpted tools: decorative, uniquely scoped SVG paints, no image requests. */
export function ErsomhaToolIcon({ name = 'pen', ink = '#35224a', className = '' }) {
  const id = `ers-tool-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const paint = value => `url(#${id}-${value})`;
  const arrow = 'M23 17 10 29l13 12V33h12c9 0 15 5 17 13 5-17-3-26-17-26H23Z';
  let shape;
  switch (name) {
    case 'pen':
      shape = <>
        <path d="m14 42 10 10 28-28c3-3 3-6 0-9l-2-2c-3-3-6-3-9 0Z" fill="#087381" transform="translate(0 2)" />
        <path d="m14 40 10 10 27-27c3-3 3-6 0-9l-1-1c-3-3-6-3-9 0Z" fill={paint('teal')} />
        <path d="m16 40 5 5 25-25c2-2 2-4 0-6Z" fill="#b6fff0" opacity=".67" />
        <path d="m14 40-5 15 15-5Z" fill={paint('wood')} />
        <path d="m9 55 3-8 5 5Z" fill={ink} />
        <path d="m38 16 10 10 4-4c3-3 2-6 0-8l-2-2c-2-2-5-2-8 0Z" fill={paint('purple')} />
        <path d="m36 19 10 10 3-3-10-10Z" fill="#fff4d8" />
        <path d="m39 20 6 6" stroke="#fffdf0" strokeWidth="2" strokeLinecap="round" />
        <path d="M28 54c5-4 10-4 14-2" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" opacity=".85" />
      </>;
      break;
    case 'eraser':
      shape = <>
        <path d="m12 36 19-23c2-2 5-2 7-1l14 10c3 2 3 5 1 8L34 53c-2 2-5 3-8 1L13 44c-3-2-3-5-1-8Z" fill="#b46a9e" />
        <path d="m12 32 19-22c2-2 5-2 7 0l14 10c3 2 3 5 1 7L34 50c-2 2-5 2-8 0L13 40c-3-2-3-5-1-8Z" fill={paint('pink')} />
        <path d="m22 20 19 14 12-14-15-11c-2-1-5-1-7 1Z" fill={paint('purple')} />
        <path d="m25 18 15 11" stroke="#f1d9ff" strokeWidth="3" strokeLinecap="round" opacity=".85" />
        <path d="m16 34 8-9" stroke="#fff6ef" strokeWidth="3" strokeLinecap="round" opacity=".75" />
        <path d="m34 50 19-23v5L36 53c-2 2-5 3-8 1l-2-4c3 2 6 2 8 0Z" fill="#b875a5" opacity=".58" />
        <path d="M43 52h4m3-6h3" stroke="#cc97b9" strokeWidth="3" strokeLinecap="round" />
      </>;
      break;
    case 'undo':
    case 'redo':
      shape = <g transform={name === 'redo' ? 'translate(64 0) scale(-1 1)' : undefined}>
        <path d={arrow} fill="#086f7a" transform="translate(0 3)" />
        <path d={arrow} fill={paint('teal')} stroke="#0e8288" strokeWidth="1" strokeLinejoin="round" />
        <path d="m17 28 4-4m6 0h8c8 0 14 3 17 8" stroke="#c4fff1" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity=".7" />
      </g>;
      break;
    case 'clear':
      shape = <>
        <path d="m18 23 3 29c1 4 20 4 22 0l3-29Z" fill="#77519a" transform="translate(0 2)" />
        <path d="m18 22 3 27c1 5 20 5 22 0l3-27Z" fill={paint('purple')} />
        <path d="m23 25 2 22" stroke="#f0d9ff" strokeWidth="3" strokeLinecap="round" opacity=".7" />
        <path d="M33 28v20m8-21-2 20" stroke="#7848a1" strokeWidth="3" strokeLinecap="round" opacity=".6" />
        <path d="M25 16v-3c0-5 14-5 14 0v3" fill="none" stroke="#8a5aaf" strokeWidth="5" strokeLinecap="round" />
        <rect x="14" y="16" width="36" height="9" rx="4.5" fill={paint('cream')} stroke="#d5b88e" strokeWidth="1" />
        <path d="M19 18h25" stroke="#fffef4" strokeWidth="2" strokeLinecap="round" />
      </>;
      break;
    case 'expand':
    case 'fit': {
      const corners = name === 'expand'
        ? 'M24 12H12v12m28-12h12v12M12 40v12h12m28-12v12H40'
        : 'M12 24h12V12m16 0v12h12M24 52V40H12m40 0H40v12';
      shape = <>
        <path d={corners} fill="none" stroke="#74499b" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 3)" />
        <path d={corners} fill="none" stroke={paint('purple')} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M28 32h8m-4-4v8" stroke="#32a8a8" strokeWidth="3" strokeLinecap="round" />
      </>;
      break;
    }
    case 'hand':
      shape = <>
        <path d="M19 33V17c0-5 7-5 7 0V9c0-5 7-5 7 0v1c0-5 7-5 7 0v6c0-5 7-5 7 0v20c0 12-7 20-17 20-7 0-11-5-14-10l-7-11c-3-5 2-9 6-5l4 5" fill="#c6945d" transform="translate(0 2)" />
        <path d="M19 32V16c0-5 7-5 7 0V8c0-5 7-5 7 0v1c0-5 7-5 7 0v6c0-5 7-5 7 0v20c0 12-7 20-17 20-7 0-11-5-14-10L9 34c-3-5 2-9 6-5l4 5" fill={paint('wood')} stroke="#d7a66b" strokeWidth="1" strokeLinejoin="round" />
        <path d="M26 18v11m7-13v11m7-7v10" stroke="#d5a66e" strokeWidth="2" strokeLinecap="round" />
        <path d="M22 34c4-2 8-2 12 0m-9 5c3-1 6-1 8 0" fill="none" stroke="#be8e5e" strokeWidth="2" strokeLinecap="round" opacity=".7" />
        <path d="M21 14v11M28 8v8" fill="none" stroke="#fff2d7" strokeWidth="2" strokeLinecap="round" opacity=".85" />
        <path d="M23 51c6 2 12 1 17-3v5c-6 5-12 6-17 2Z" fill={paint('teal')} />
      </>;
      break;
    case 'palette':
      shape = <>
        <path d="M53 24c-5-14-22-18-35-9C6 23 7 42 19 49c5 3 10 4 12-1 1-3-2-5-1-7 2-4 8 1 13-1 7-2 13-8 10-16Z" fill="#d2b085" transform="translate(0 3)" />
        <path d="M53 22c-5-14-22-18-35-9C6 21 7 40 19 47c5 3 10 4 12-1 1-3-2-5-1-7 2-4 8 1 13-1 7-2 13-8 10-16Z" fill={paint('cream')} stroke="#dabd94" strokeWidth="1" />
        <ellipse cx="37" cy="29" rx="5" ry="6" fill="#fff8e9" stroke="#cfad80" strokeWidth="2" transform="rotate(20 37 29)" />
        <circle cx="18" cy="29" r="5" fill="#23a2a5" />
        <circle cx="24" cy="18" r="5" fill="#a872d0" />
        <circle cx="38" cy="17" r="4.5" fill="#efba4e" />
        <circle cx="21" cy="40" r="4.5" fill="#ee8c9c" />
        <path d="M16 27h3m3-11h3m11-1h2m-18 23h2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" opacity=".75" />
      </>;
      break;
    case 'rotate':
      shape = <>
        <rect x="22" y="13" width="23" height="39" rx="6" fill="#74479a" transform="rotate(17 34 32) translate(0 2)" />
        <g transform="rotate(17 34 32)"><rect x="22" y="11" width="23" height="39" rx="6" fill={paint('purple')} /><rect x="26" y="16" width="15" height="25" rx="2.5" fill={paint('cream')} /><path d="M31 46h5" stroke="#eee1f7" strokeWidth="2" strokeLinecap="round" /></g>
        <path d="M16 27c-4 5-4 12 0 17l-5-1 6 8 7-6-5 1c-4-4-5-9-2-14" fill={paint('teal')} />
      </>;
      break;
    default: return null;
  }
  return <svg className={`ers-tool-icon ers-tool-icon-${name} ${className}`.trim()} viewBox="0 0 64 64" width="32" height="32" aria-hidden="true" focusable="false" data-ers-tool-icon={name}>
    <defs>
      <linearGradient id={`${id}-teal`} x1="0" y1="0" x2=".9" y2="1"><stop stopColor="#a4eee1" /><stop offset=".42" stopColor="#35b4b1" /><stop offset="1" stopColor="#0c8290" /></linearGradient>
      <linearGradient id={`${id}-purple`} x1="0" y1="0" x2=".7" y2="1"><stop stopColor="#e5c8f6" /><stop offset=".4" stopColor="#b58ad8" /><stop offset="1" stopColor="#8654b0" /></linearGradient>
      <linearGradient id={`${id}-cream`} x1="0" y1="0" x2=".55" y2="1"><stop stopColor="#fffef5" /><stop offset=".5" stopColor="#fff0d2" /><stop offset="1" stopColor="#e8cda1" /></linearGradient>
      <linearGradient id={`${id}-wood`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffebbf" /><stop offset=".5" stopColor="#f5d296" /><stop offset="1" stopColor="#dca765" /></linearGradient>
      <linearGradient id={`${id}-pink`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#fff1f4" /><stop offset=".38" stopColor="#f5cade" /><stop offset="1" stopColor="#e8a1c0" /></linearGradient>
    </defs>
    <ellipse className="ers-tool-ground" cx="32" cy="57" rx="19" ry="3" fill="#603c6b" opacity=".12" />
    <g className="ers-tool-object">{shape}</g>
  </svg>;
}
