// Presentation helpers only. Ownership, pricing and grants are server decisions.
export const COSMETIC_SLOTS = Object.freeze({ frame: 'frameId', avatar: 'avatarId', cover: 'coverId', nameColor: 'nameColorId', roomTheme: 'roomThemeId', entrance: 'entranceId',profileSkin:'profileSkinId',councilSkin:'councilSkinId' });
export const COSMETIC_LABELS = Object.freeze({ frame: 'الإطارات', avatar: 'الشخصيات', cover: 'الأغلفة', nameColor: 'بطاقات الاسم', roomTheme: 'زينة المجلس', sticker: 'الملصقات', entrance: 'الدخول',profileSkin:'البروفايل الكامل',councilSkin:'المجلس الكامل' });
export function cosmeticSelection(items) {
  return Object.fromEntries(items.filter(item => COSMETIC_SLOTS[item.kind]).map(item => [COSMETIC_SLOTS[item.kind], item.id]));
}
export function permanentItemIds(inventory, grants = []) {
  return new Set([...(inventory?.ownedItemIds || []), ...grants.filter(grant => grant.revokedAt == null && grant.revoked_at == null).map(grant => grant.itemId)].filter(id => typeof id === 'string'));
}
export function offerArtworkReady(offer, items) {
  return Array.isArray(offer?.itemIds) && offer.itemIds.length > 0 && offer.itemIds.every(id => {
    const item = items.find(value => value.id === id);
    return item && item.artReady !== false;
  });
}
export function validateOwnedQuote(quote, offer) {
  if (!quote || !offer || quote.offerId !== offer.id || quote.ownership !== 'permanent') return false;
  const expected = [...new Set(offer.itemIds || [])].sort();
  const groups = [quote.itemIds, quote.alreadyOwned, quote.missingItemIds];
  if (!expected.length || groups.some(group => !Array.isArray(group) || group.some(id => typeof id !== 'string') || new Set(group).size !== group.length)) return false;
  return JSON.stringify([...quote.itemIds].sort()) === JSON.stringify(expected) &&
    JSON.stringify([...quote.alreadyOwned, ...quote.missingItemIds].sort()) === JSON.stringify(expected) &&
    new Set([...quote.alreadyOwned, ...quote.missingItemIds]).size === expected.length &&
    quote.allOwned === (quote.missingItemIds.length === 0);
}
export function isLocalTestQuote(quote, offer, server) {
  if (!validateOwnedQuote(quote, offer) || quote.allOwned || quote.localOnly !== true || quote.pricing?.configured !== true || quote.pricing.currency !== 'TEST') return false;
  try { if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(server).hostname)) return false; } catch { return false; }
  return Number.isSafeInteger(quote.pricing.amountMinor) && quote.pricing.amountMinor >= 0 && quote.pricing.amountMinor <= 100_000_000;
}
