import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TERMS_DOCUMENTS, TERMS_DOCUMENT_HASHES, TERMS_VERSION, termsDocumentText, termsIdentity, termsLocale } from '../src/shared/legal/terms.js';
import { LOCAL_TERMS_KEY, readLocalTermsAcceptance, saveLocalTermsAcceptance, localTermsAcceptPayload, getGuestTermsReceipt, saveGuestTermsReceipt } from '../src/shared/legal/acceptance.js';
import { GUEST_TERMS_TTL, parseGuestTermsReceipt } from '../src/shared/legal/guest-receipt.js';
import { issueGuestTermsReceipt, verifyGuestTermsReceipt } from '../server/legal/guest-terms.mjs';
import { base64url, hmacHex } from '../server/accounts/jwt.mjs';

const env = { SESSION_SECRET: 'unit-only-terms-secret-not-a-real-key' }, origin = 'https://terms.example.test';
const request = new Request(origin + '/api/legal/accept');
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key), values }; };
const accepted = locale => ({ ...termsIdentity(locale), accepted: true });
test('both published document hashes bind the exact version/date/locale/text and parallel sections', () => {
  for (const locale of ['ar','en']) assert.equal(TERMS_DOCUMENT_HASHES[locale], createHash('sha256').update(termsDocumentText(locale)).digest('hex'));
  assert.deepEqual(TERMS_DOCUMENTS.ar.sections.map(s=>s.id),TERMS_DOCUMENTS.en.sections.map(s=>s.id));
  assert.equal(Object.isFrozen(TERMS_DOCUMENTS.ar.sections[0].paragraphs),true);
  assert.throws(()=>termsLocale('fr'),TypeError);
});
test('local acceptance needs explicit choice/current identity and remains only a client timestamp', () => {
  const s=storage(); assert.equal(readLocalTermsAcceptance(s),null);
  assert.equal(saveLocalTermsAcceptance({...accepted('en'),accepted:false},s),null);
  assert.equal(saveLocalTermsAcceptance({...accepted('en'),documentHash:'0'.repeat(64)},s),null);
  const value=saveLocalTermsAcceptance(accepted('en'),s,123456); assert.equal(value.acceptedAtClient,123456);
  assert.deepEqual(localTermsAcceptPayload(value),accepted('en')); assert.equal(value.acceptedAt,undefined);
  s.setItem(LOCAL_TERMS_KEY,JSON.stringify({...value,termsVersion:'old'})); assert.equal(readLocalTermsAcceptance(s),null);
  s.setItem(LOCAL_TERMS_KEY,'not-json'); assert.equal(readLocalTermsAcceptance(s),null);
  assert.equal(saveLocalTermsAcceptance(accepted('ar'),{setItem(){throw Error('blocked')}}),null);
});
test('guest receipt is purpose-bound, expires after180days and survives exact cryptographic verification', async () => {
  const now=Date.now(), receipt=await issueGuestTermsReceipt(env,request,termsIdentity('en'),now);
  const value=await verifyGuestTermsReceipt(env,request,receipt,now);
  assert.deepEqual(value,{...termsIdentity('en'),acceptedAt:now,expiresAt:now+GUEST_TERMS_TTL});
  assert.equal(await verifyGuestTermsReceipt(env,request,receipt,now+GUEST_TERMS_TTL),null);
  assert.equal(await verifyGuestTermsReceipt(env,new Request('https://other.test/api/legal/accept'),receipt,now),null);
  assert.equal(await verifyGuestTermsReceipt({...env,SESSION_SECRET:'different'},request,receipt,now),null);
  assert.equal(await verifyGuestTermsReceipt(env,request,receipt+'x',now),null);
});
test('even correctly signed old/purpose-swapped/future/overlong receipts do not prove current acceptance', async () => {
  const now=Date.now(), receipt=await issueGuestTermsReceipt(env,request,termsIdentity('ar'),now), payload=parseGuestTermsReceipt(receipt,origin,now).value;
  for(const change of [{purpose:'oauth'},{termsVersion:'old'},{documentHash:'0'.repeat(64)},{issuedAt:now+61_000,expiresAt:now+61_000+GUEST_TERMS_TTL},{expiresAt:now+GUEST_TERMS_TTL+1},{audience:origin+'/path'}]){
    const body='mgt1.'+base64url(JSON.stringify({...payload,...change}));
    assert.equal(await verifyGuestTermsReceipt(env,request,body+'.'+await hmacHex(env.SESSION_SECRET,body),now),null);
  }
  assert.equal(parseGuestTermsReceipt('a'.repeat(2049),origin),null);
  await assert.rejects(issueGuestTermsReceipt({AUTH_DEV_FAKE:'1'},request,termsIdentity('ar')),error=>error.code==='TERMS_UNAVAILABLE'&&error.status===503);
});
test('client receipt slots isolate APIorigin, agreementversion, hash and locale without claiming signature verification',async()=>{
  const now=Date.now(),s=storage(),receipt=await issueGuestTermsReceipt(env,request,termsIdentity('en'),now);
  assert.equal(saveGuestTermsReceipt(origin,{guestReceipt:receipt},s,now),receipt);
  assert.equal(getGuestTermsReceipt(origin,s,now),receipt); assert.equal(getGuestTermsReceipt('https://production.test',s,now),null);
  assert.equal(getGuestTermsReceipt(origin,s,now+GUEST_TERMS_TTL),null);
  assert.equal(saveGuestTermsReceipt('https://production.test',receipt,s,now),null);
  const blocked={setItem(){throw Error('blocked')},getItem(){throw Error('blocked')}};
  assert.equal(saveGuestTermsReceipt(origin,receipt,blocked,now),receipt);
  assert.equal(getGuestTermsReceipt(origin,blocked,now),receipt,'the original server receipt may survive in memory in this browser session');
  assert.equal(getGuestTermsReceipt('https://other.test',blocked,now),null);
  assert.equal(getGuestTermsReceipt(origin,blocked,now+GUEST_TERMS_TTL),null);
  const key=[...s.values.keys()][0]; assert.ok(key.includes(encodeURIComponent(origin))&&key.includes(TERMS_VERSION)&&key.includes(':en:')&&key.endsWith(TERMS_DOCUMENT_HASHES.en));
});
