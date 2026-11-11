import test from 'node:test';
import assert from 'node:assert/strict';
import { getNodeDefinition } from '../src/design/registry.js';
import { createDefaultDesign, validateDesignDocument } from '../src/design/schema.js';

const edit = (screen, id, patch) => ({ ...createDefaultDesign(), screens: { [screen]: { nodes: { [id]: patch }, decorations: [] } } });
test('Studio cannot hide or relabel current profile/frame membership, ownership and explicit equip actions', () => {
  const protectedNodes = [['store', ['store-navigation','store-tab-library','store-membership','item-preview','item-use','store-reset','store-legacy-toggle','earned-cosmetics','plus-details']], ['store.preview', ['header','close','content','product-preview','store-detail-actions','item-use','collection-use']], ['profile', ['profile-library']]];
  for (const [screen, ids] of protectedNodes) for (const id of ids) {
    assert.equal(getNodeDefinition(screen, id)?.required, true, `${screen}:${id}`);
    assert.equal(validateDesignDocument(edit(screen, id, { visible: false })).ok, false, `cannot hide ${screen}:${id}`);
    assert.equal(validateDesignDocument(edit(screen, id, { style: { opacity: 0 } })).ok, false, `cannot fade ${screen}:${id}`);
    if (!['header','close','content'].includes(id)) assert.equal(validateDesignDocument(edit(screen, id, { text: 'دفع حقيقي مؤكد' })).ok, false, `cannot invent payment/ownership text ${screen}:${id}`);
  }
});
test('current profile/frame products and equip actions remain flow templates with protected meaning', () => {
  for (const [screen, ids] of [['store', ['store-product','item-preview','item-use']], ['store.preview', ['item-use']]]) for (const id of ids) {
    const node = getNodeDefinition(screen, id);assert.equal(node?.repeat, true, `${screen}:${id}`);assert.equal(node.editableText, false);
  }
});
test('saved store identities remain compatibility records while the real modal owns current actions', () => {
  for (const id of ['collection-use','store-tab-presets','store-monthly','permanent-quote','store-entrance-play']) { const node = getNodeDefinition('store', id);assert.equal(node.retired, true);assert.ok(node.coverageReason.length > 35); }
  for (const id of ['artwork','earned-cosmetics','store-legacy-toggle']) assert.notEqual(getNodeDefinition('store',id).retired,true,'actual profile/frame or historical-license UI is not a retired placeholder');
  assert.equal(getNodeDefinition('store.preview', 'collection-use').kind, 'button');
  assert.equal(getNodeDefinition('store.preview', 'collection-use').repeat, false);
  assert.equal(getNodeDefinition('profile', 'profile-store').editableText, false);
  assert.equal(getNodeDefinition('profile', 'profile-presets').editableText, false);
  assert.equal(getNodeDefinition('profile', 'profile-presets').retired, true);
});
