// Read-only, synthetic account responses for the real Store in Studio previews.
// There is deliberately no fetch, account token, grant or mutation path here.
import { EMPTY_COSMETICS, PLUS_CATALOG_VERSION } from '../plus/catalog.js';

const COSMETICS = '/api/me/cosmetics';
const INVENTORY = '/api/me/cosmetics/inventory';
const previewError = (code) => Object.assign(new Error(code), { code });

export async function readPreviewCosmetics(path, options = {}, { previewState = 'normal', now = Date.UTC(2026, 10, 2) } = {}) {
  if ((options.method || 'GET').toUpperCase() !== 'GET') throw previewError('PREVIEW_MUTATION_BLOCKED');
  if (path !== COSMETICS && path !== INVENTORY) throw previewError('PREVIEW_ROUTE_BLOCKED');
  if (previewState === 'guest') throw previewError('AUTH_REQUIRED');
  if (previewState === 'error') throw previewError('NETWORK');
  if (previewState === 'loading') return new Promise(() => {});
  const state = {
    preferred: { ...EMPTY_COSMETICS }, effective: { ...EMPTY_COSMETICS },
    grants: [], revision: 1, eligible: false, plusActive: false, serverTime: now,
  };
  return path === INVENTORY ? {
    ...state, catalogVersion: PLUS_CATALOG_VERSION, ownedItemIds: [], subscriptionItemIds: [],
  } : state;
}
