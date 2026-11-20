// Public ink protocol. Never change a released palette or translate its HEX IDs.
export const ERSOMHA_PALETTE = Object.freeze(['#35224a', '#ffffff', '#118d96', '#9250bd', '#ed6a5a', '#f4b942', '#64a66f', '#3b72b8', '#f08db4', '#8a563d', '#ef8a38', '#83929b']);
export const ERSOMHA_LAVENDER = '#efd3fa';
export const ERSOMHA_PALETTE_V2 = Object.freeze([...ERSOMHA_PALETTE, ERSOMHA_LAVENDER]);
export const ERSOMHA_PALETTE_VERSIONS = Object.freeze([1, 2]);
// Only absence means legacy. Malformed/unknown versions must not become v1.
export const drawingPaletteVersion = value => value === undefined ? 1 : ERSOMHA_PALETTE_VERSIONS.includes(value) ? value : null;
export const drawingPalette = value => drawingPaletteVersion(value) === 1 ? ERSOMHA_PALETTE : drawingPaletteVersion(value) === 2 ? ERSOMHA_PALETTE_V2 : null;
export function drawingPaletteSupported(version, advertised) {
  const resolved = drawingPaletteVersion(version);
  return resolved === 1 || (resolved === 2 && Array.isArray(advertised) && advertised.includes(2));
}
