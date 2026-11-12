import test from 'node:test';
import assert from 'node:assert/strict';
import { premiumOf } from '../server/accounts/entitlements.mjs';
import { isPremium } from '../src/shared/account/entitlements.js';
const now = 1800000000000;
const grant = { source:'promo', product:'plus.creator.lifetime', status:'active', until:253402300799000, will_renew:0 };
test('creator lifetime grant works without a renewal and survives ordinary subscription expiry', () => {
  const p = premiumOf([grant], now);
  assert.equal(p.creatorLifetime,true);
  assert.equal(p.willRenew,false);
  assert.equal(isPremium({premium:p},now),true);
  assert.equal(isPremium({premium:p},now+200*365*86400000),true);
});
test('creator grant preserves a genuine active paid subscription and never resurrects revoked grants', () => {
  const paid={source:'apple',product:'plus.monthly',status:'active',until:now+86400000,will_renew:1};
  const p=premiumOf([grant,paid],now);
  assert.equal(p.source,'apple'); assert.equal(p.willRenew,true); assert.equal(p.creatorLifetime,true);
  assert.equal(premiumOf([grant,paid],now+2*86400000).source,'promo');
  for(const status of ['revoked','refunded']) {
    const p=premiumOf([{...grant,status}],now);
    assert.equal(p.active,false); assert.equal(p.creatorLifetime,undefined);
  }
});
