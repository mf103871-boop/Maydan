import React from 'react';

// ?sheet resolves to a local hashed resource for web/iOS and inline CSS in
// standalone previews. Keep the element at its call site so cascade order is
// preserved; React removes it on unmount without a process-wide mutable cache.
export function PresentationStyles({ sheet }) {
  // Existing isolated browser harnesses use esbuild's plain text CSS loader.
  // They remain standalone documents without an asset-serving route.
  if (typeof sheet === 'string') return <style data-presentation-sheet="inline">{sheet}</style>;
  if (typeof sheet?.href === 'string') return <link rel="stylesheet" href={sheet.href} data-presentation-sheet="file" />;
  if (typeof sheet?.inline === 'string') return <style data-presentation-sheet="inline">{sheet.inline}</style>;
  return null;
}
