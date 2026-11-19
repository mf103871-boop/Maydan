import React from 'react';
/** Category-only symbols: never derive a shape from the private drawing word. */
export function ErsomhaCategoryIcon({ category }) {
 const paths = {
  animals: <><circle cx="7" cy="7" r="2"/><circle cx="17" cy="7" r="2"/><path d="M5 15c0-4 4-6 7-6s7 2 7 6c0 5-4 3-7 3s-7 2-7-3Z"/></>,
  nature: <><path d="M20 3C8 2 2 8 5 15s15 3 15-12ZM4 21 15 10"/></>,
  food: <><path d="M4 3v7c0 3 6 3 6 0V3M7 3v18M20 21V3c-5 2-7 9 0 9"/></>,
  home: <><path d="m3 11 9-8 9 8M5 9v12h14V9M10 21v-7h4v7"/></>,
  places: <><path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 0 1 14 0Z"/><circle cx="12" cy="9" r="2"/></>,
  jobs: <><rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V3h8v4M3 12c4 4 14 4 18 0M12 13v4"/></>,
  sports: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M6 5c7 4 7 10 0 14M18 5c-7 4-7 10 0 14"/></>,
  transport: <><path d="m4 10 2-6h12l2 6M3 10h18v8H3Z"/><path d="M5 18v3M19 18v3M6 14h2M16 14h2"/></>,
  technology: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  actions: <><circle cx="14" cy="4" r="2"/><path d="m7 9 5-2 4 5h4M12 7l-2 8-6 5M10 15l7 5M7 9l-3 5"/></>,
  situations: <><circle cx="12" cy="12" r="9"/><path d="M7 9h.01M17 9h.01M7 14c3 5 7 5 10 0"/></>,
  expressions: <><path d="M4 4h16v13H9l-5 4ZM8 8h8M8 12h5"/></>,
 };
 return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-category-icon={category || 'general'}>{paths[category] || <><path d="m3 13 10-10h8v8L11 21Z"/><circle cx="17" cy="7" r="1"/></>}</svg>;
}
