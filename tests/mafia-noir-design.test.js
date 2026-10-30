import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_SCREENS, getNodeDefinition } from '../src/design/registry.js';
import { createDefaultDesign, validateDesignDocument } from '../src/design/schema.js';
import { createDesignFixture } from '../src/design/screen-catalog.js';

const customized = (screen, id, patch) => ({ ...createDefaultDesign(), screens: { [screen]: { nodes: { [id]: patch }, decorations: [] } } });
const allowed = (screen, id, patch) => validateDesignDocument(customized(screen, id, patch)).ok;

test('Mafia private modal has its own registered layout without revealing the card in ordinary scene fixtures', () => {
  const card = createDesignFixture('online.mafia.role-card');
  assert.equal(card.state._designPreview, true);
  assert.equal(card.state.phase, 'role');
  assert.equal(card.state.previewScene, 'online.mafia.role', 'surrounding council retains its public phase root');
  assert.equal(card.state.previewReveal, true);
  assert.equal(createDesignFixture('online.mafia.night').state.previewReveal, false);
  assert.ok(getNodeDefinition('online.mafia.role-card', 'role-content'));
  assert.equal(getNodeDefinition('online.mafia.night', 'role-content'), null, 'private modal contents are not a public phase child');
});

test('Studio cannot hide Mafia disconnect, audio recovery, private-card close or the only report/block path', () => {
  const controls = [
    ['online.mafia.role-card', 'role-hide'], ['online.mafia.role-card', 'close'], ['online.mafia.role-card', 'role-content'],
    ['online.mafia.discussion', 'voice'], ['online.mafia.discussion', 'voice-leave'], ['online.mafia.discussion', 'voice-resume'],
    ['online.mafia.discussion', 'player-rail'], ['online.mafia.discussion', 'players'], ['online.mafia.discussion', 'player-seat'],
    ['online.mafia.nomination', 'action-open'], ['online.mafia.verdict', 'action-open'], ['online.mafia.discussion', 'mafia-tools'],
    ['online.mafia.clues', 'close'], ['online.mafia.clues', 'content'], ['online.mafia.notes', 'close'], ['online.mafia.notes', 'content'],
    ['online.mafia.over', 'timeline-toggle'], ['online.mafia.closed', 'timeline-toggle'],
  ];
  for (const [screen, id] of controls) {
    assert.equal(getNodeDefinition(screen, id)?.required, true, `${screen}:${id}`);
    assert.equal(allowed(screen, id, { visible: false }), false, `${screen}:${id}:hidden`);
    assert.equal(allowed(screen, id, { style: { opacity: .5 } }), false, `${screen}:${id}:opacity`);
    assert.equal(allowed(screen, id, { style: { borderRadius: 12 } }), true, `${screen}:${id}:style`);
  }
});

test('Studio keeps saved legacy patches valid without allowing new entry or action paths to be hidden', () => {
  for (const [screen, id] of [['home', 'rooms'], ['home', 'roster'], ['game-details', 'online'], ['game-details', 'local']]) {
    assert.equal(allowed(screen, id, { visible: false, style: { borderRadius: 12 } }), true, `${screen}:${id}: legacy document compatibility`);
  }
  for (const [screen, id] of [['home.game-mode', 'online-mode'], ['home.game-mode', 'local-mode'], ['game-details', 'skip-instructions'], ['settings', 'manage-roster'], ['online.ersomha.directory', 'toolbar']]) {
    assert.equal(allowed(screen, id, { visible: false }), false, `${screen}:${id}:hidden`);
    assert.equal(allowed(screen, id, { style: { opacity: .5 } }), false, `${screen}:${id}:opacity`);
    assert.equal(allowed(screen, id, { style: { borderRadius: 12 } }), true, `${screen}:${id}:styling`);
  }
});

test('finished history has real conditional IDs without exposing an ended composer or action dock', () => {
  for (const screen of ['online.mafia.over','online.mafia.closed']) {
    assert.equal(getNodeDefinition(screen, 'timeline-toggle').required, true);
    for (const id of ['chat','messages','event','chat-channel','load-older','new-messages'])
      assert.ok(getNodeDefinition(screen, id)?.coverageReason.length > 35, `${screen}:${id}`);
    for (const id of ['composer','message-input','send','ability','action-open']) assert.equal(getNodeDefinition(screen, id), null, `${screen}:${id}`);
  }
});

test('new narrative and event templates retain authoritative text while optional decoration and public-room actions remain editable', () => {
  assert.equal(getNodeDefinition('online.mafia.directory', 'create-public-room').kind, 'button');
  assert.equal(allowed('online.mafia.directory', 'create-public-room', { style: { borderRadius: 12 } }), true);
  for (const id of ['narrative', 'event']) {
    assert.equal(getNodeDefinition('online.mafia.discussion', id).editableText, false);
    assert.equal(allowed('online.mafia.discussion', id, { text: 'رسالة مزيفة عن دور اللاعب' }), false);
  }
  assert.equal(getNodeDefinition('online.mafia.discussion', 'event').repeat, true);
  assert.equal(allowed('online.mafia.discussion', 'narrative', { visible: false }), true);
});

test('all live Mafia seat rails protect nested safety access and retired folded-seat controls are not offered by Studio', () => {
  for (const screen of DESIGN_SCREENS.filter(screen => screen.id.startsWith('online.mafia.'))) {
    if (getNodeDefinition(screen.id, 'player-rail')) {
      for (const id of ['player-rail', 'players', 'player-seat']) assert.equal(getNodeDefinition(screen.id, id)?.required, true, `${screen.id}:${id}`);
    }
    for (const removed of ['players-fold', 'players-toggle', 'events']) assert.equal(getNodeDefinition(screen.id, removed), null, `${screen.id}:${removed}`);
  }
});
