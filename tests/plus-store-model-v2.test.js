import test from 'node:test';
import assert from 'node:assert/strict';
import { cosmeticSelection, permanentItemIds, offerArtworkReady, validateOwnedQuote, isLocalTestQuote } from '../src/plus/store-model.js';

const offer = { id: 'sahra.bundle.permanent', itemIds: ['sahra.frame', 'sahra.avatar', 'sahra.cover'] };
const quote = () => ({ offerId: offer.id, ownership: 'permanent', itemIds: [...offer.itemIds], alreadyOwned: ['sahra.frame'], missingItemIds: ['sahra.avatar', 'sahra.cover'], allOwned: false, localOnly: true, pricing: { configured: true, currency: 'TEST', amountMinor: 200 } });
test('store previews select real supported slots without forging membership or equipping stickers', () => {
  assert.deepEqual(cosmeticSelection([{ id: 'x.frame', kind: 'frame' }, { id: 'x.name', kind: 'nameColor' }, { id: 'x.entrance', kind: 'entrance' }, { id: 'x.sticker', kind: 'sticker' }]), { frameId: 'x.frame', nameColorId: 'x.name', entranceId: 'x.entrance' });
});
test('ownership comes from inventory or active grants, never the preferred cosmetic or subscription loan', () => {
  const inventory = { ownedItemIds: ['owned'], subscriptionItemIds: ['loan'], preferred: { frameId: 'loan' } };
  assert.deepEqual([...permanentItemIds(inventory, [{ itemId: 'earned' }, { itemId: 'revoked', revokedAt: 1 }])], ['owned', 'earned']);
});
test('every offered item must exist with ready artwork before a quote action is available', () => {
  const items = offer.itemIds.map(id => ({ id, artReady: true }));
  assert.equal(offerArtworkReady(offer, items), true);
  assert.equal(offerArtworkReady(offer, items.slice(1)), false);
  assert.equal(offerArtworkReady(offer, [{ ...items[0], artReady: false }, ...items.slice(1)]), false);
  assert.equal(offerArtworkReady({ itemIds: [] }, items), false);
});
test('a partial bundle quote must partition the exact offer once, without double-charging owned items', () => {
  assert.equal(validateOwnedQuote(quote(), offer), true);
  for (const patch of [{ offerId: 'different' }, { ownership: 'subscription' }, { itemIds: ['other'] }, { alreadyOwned: ['sahra.frame', 'sahra.frame'] }, { missingItemIds: [...offer.itemIds] }, { missingItemIds: ['sahra.avatar'] }, { allOwned: true }]) assert.equal(validateOwnedQuote({ ...quote(), ...patch }, offer), false, JSON.stringify(patch));
});
test('a fully owned bundle never enables even a local simulated purchase', () => {
  const owned = { ...quote(), alreadyOwned: [...offer.itemIds], missingItemIds: [], allOwned: true, pricing: { configured: true, currency: 'TEST', amountMinor: 0 } };
  assert.equal(validateOwnedQuote(owned, offer), true);
  assert.equal(isLocalTestQuote(owned, offer, 'http://127.0.0.1:4000'), false);
});
test('only explicit local TEST quotes at loopback may enable the simulated checkout', () => {
  for (const server of ['http://127.0.0.1:4000', 'http://localhost:4000', 'http://[::1]:4000']) assert.equal(isLocalTestQuote(quote(), offer, server), true);
  for (const server of ['https://maydan-game.mf103871.workers.dev', 'https://maydan-mafia-preview.mf103871.workers.dev', 'http://localhost.example.com', '']) assert.equal(isLocalTestQuote(quote(), offer, server), false);
  for (const patch of [{ localOnly: false }, { pricing: { configured: false, currency: null, amountMinor: null } }, { pricing: { configured: true, currency: 'USD', amountMinor: 100 } }, { pricing: { configured: true, currency: 'TEST', amountMinor: -1 } }, { pricing: { configured: true, currency: 'TEST', amountMinor: 1.2 } }]) assert.equal(isLocalTestQuote({ ...quote(), ...patch }, offer, 'http://localhost'), false);
});
