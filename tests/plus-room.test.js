import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceRefreshNeeded, prepareRoomAppearance, selectRoomAppearance } from '../server/plus/room-appearance.mjs';
import { PLUS_COLLECTIONS, PLUS_ITEMS, getCosmetic, availableItems } from '../src/plus/catalog.js';
import { reactionsAllowed } from '../src/online/shared.js';
const room = (phase='lobby') => ({phase,hostId:'a',members:[{id:'a'},{id:'b'}],appearance:{themeId:'sahra.roomTheme',version:1},appearanceCheckedAt:100000});
test('catalog keeps future monthly content unavailable and preserves identifiers',()=>{
  assert.equal(PLUS_COLLECTIONS.length,5);
  assert.equal(new Set(PLUS_ITEMS.map(item=>item.id)).size,PLUS_ITEMS.length);
  assert.equal(availableItems(Date.UTC(2026,9,28)).filter(item=>item.kind==='sticker').length,18);
  assert.equal(getCosmetic('olive.frame',{now:Date.UTC(2026,9,28)}),null);
  assert.ok(getCosmetic('olive.frame',{now:Number.MAX_SAFE_INTEGER}));
  assert.equal(getCosmetic('sahra.frame',{kind:'sticker'}),null);
});
test('room appearance stays stable through active match and refreshes at safe boundaries',()=>{
  assert.equal(appearanceRefreshNeeded(room('night'),room('discussion'),999999),false);
  assert.equal(appearanceRefreshNeeded(room('night'),{...room('night'),hostId:'b'},999999),false);
  assert.equal(appearanceRefreshNeeded(room(),room('night'),100001),true);
  assert.equal(appearanceRefreshNeeded(room('over'),room(),100001),true);
  assert.equal(appearanceRefreshNeeded(room(),{...room(),hostId:'b'},100001),true);
  assert.equal(appearanceRefreshNeeded(room(),room(),100001),false);
});
test('missing cosmetics service falls back without denying free match',async()=>{
  const candidate=room('draw');candidate.members[0].accountUserId='user';
  await prepareRoomAppearance({},room(),candidate,100001);
  assert.equal(candidate.appearance,null);
  const ongoing=room('draw');await prepareRoomAppearance({},room('draw'),ongoing,999999);
  assert.equal(ongoing.appearance.themeId,'sahra.roomTheme');
});
test('theme mutations require lobby host and premium; free fallback remains available',async()=>{
  await assert.rejects(selectRoomAppearance({},room(),'b',null),e=>e.code==='HOST_ONLY');
  await assert.rejects(selectRoomAppearance({},room('draw'),'a',null),e=>e.code==='PHASE');
  await assert.rejects(selectRoomAppearance({},room(),'a','sahra.roomTheme'),e=>e.code==='PLUS_REQUIRED');
  await assert.rejects(selectRoomAppearance({},room(),'a','sahra.sticker.1'),e=>e.code==='INVALID');
  const candidate=room();await selectRoomAppearance({},candidate,'a',null);assert.equal(candidate.appearance,null);
});
test('premium reactions never override Mafia secrecy or the drawing silence',()=>{
  for(const phase of ['night','discussion','defense','verdict'])assert.equal(reactionsAllowed({game:'mafia',phase},'a'),false);
  for(const phase of ['lobby','over'])assert.equal(reactionsAllowed({game:'mafia',phase},'a'),true);
  assert.equal(reactionsAllowed({game:'ersomha',phase:'draw',drawerId:'a'},'a'),false);
});
