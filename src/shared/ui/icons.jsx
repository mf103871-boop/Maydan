// أيقونات SVG مضمّنة — بلا ملفات خارجية. كلها 24×24 بخط 2.
const base = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' };
const I = (children) => (props) => <svg {...base} {...props}>{children}</svg>;

export const IconSettings = I(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IconBack = I(<><path d="M9 5l7 7-7 7" /></>);
export const IconClose = I(<><path d="M18 6 6 18M6 6l12 12" /></>);
export const IconPlay = I(<><path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" /></>);
export const IconUsers = I(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>);
export const IconClock = I(<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>);
export const IconTrophy = I(<><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" /></>);
export const IconVolume = I(<><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" /></>);
export const IconVolumeOff = I(<><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m23 9-6 6M17 9l6 6" /></>);
export const IconVibrate = I(<><rect x="8" y="2" width="8" height="20" rx="2" /><path d="M4 8v8M20 8v8M1 10v4M23 10v4" /></>);
export const IconInfo = I(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>);
export const IconPlus = I(<><path d="M12 5v14M5 12h14" /></>);
export const IconTrash = I(<><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></>);
export const IconShare = I(<><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" /></>);
export const IconCheck = I(<><path d="M20 6 9 17l-5-5" /></>);
export const IconSkip = I(<><path d="M5 4l10 8-10 8zM19 5v14" /></>);
export const IconFlag = I(<><path d="M4 22V4a1 1 0 0 1 1-1h12l-2 4 2 4H5" /></>);
export const IconHome = I(<><path d="M3 11 12 3l9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></>);
export const IconMotion = I(<><path d="M5 12h14M12 5l7 7-7 7" /></>);
export const IconBomb = I(<><circle cx="11" cy="14" r="7" /><path d="M14 8l3-3M18 4l1-1M20 6l1 1M17 2v1" /></>);
export const IconRotate = I(<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>);
export const IconUndo = I(<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>);
export const IconStar = I(<><path d="m12 2 3 7 7 .6-5.3 4.6L18.5 21 12 17.3 5.5 21l1.8-6.8L2 9.6 9 9z" /></>);
export const IconBook = I(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z" /><path d="M4 19.5V4.5" /></>);
