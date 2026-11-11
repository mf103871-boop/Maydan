import { fail } from '../room-model.mjs';

const KEY_URL = Object.freeze({
  test: 'https://www.gstatic.com/admob/reward/verifier-keys-test.json',
  production: 'https://www.gstatic.com/admob/reward/verifier-keys.json',
});
const fields = ['ad_network', 'ad_unit', 'custom_data', 'reward_amount', 'reward_item', 'timestamp', 'transaction_id'];
const curve = { name: 'ECDSA', namedCurve: 'P-256' };
const invalid = () => fail('REWARDED_SIGNATURE', 400);

function decodeBase64(text) {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) invalid();
  try { return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)); }
  catch { invalid(); }
}

function decodeField(text) {
  try { return decodeURIComponent(text); } catch { invalid(); }
}

// AdMob uses DER, while WebCrypto accepts the fixed-width P1363 pair r || s.
function p1363(der) {
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) invalid();
  const result = new Uint8Array(64);
  let position = 2;
  for (let offset = 0; offset < 64; offset += 32) {
    if (der[position++] !== 2) invalid();
    const length = der[position++];
    if (!length || length > 33 || position + length > der.length || der[position] & 0x80) invalid();
    const padding = length > 1 && der[position] === 0 ? 1 : 0;
    if (padding && !(der[position + 1] & 0x80) || length - padding > 32) invalid();
    result.set(der.subarray(position + padding, position + length), offset + 32 - length + padding);
    position += length;
  }
  if (position !== der.length) invalid();
  return result;
}

async function readGoogleKey(endpoint, keyId, fresh) {
  try {
    const response = await fetch(endpoint, {
      redirect: 'manual', signal: AbortSignal.timeout(4000),
      ...(fresh ? { cache: 'no-store' } : { cf: { cacheTtl: 600 } }),
    });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    return Array.isArray(payload?.keys) && payload.keys.find(entry => String(entry.keyId) === keyId);
  } catch { fail('REWARDED_KEYS', 503); }
}

async function getGoogleKey(tier, keyId) {
  const endpoint = KEY_URL[tier];
  if (!endpoint) invalid();
  // An unfamiliar ID might be a rotation. Verify against fresh official keys
  // immediately so a short provider retry window cannot miss it.
  const key = await readGoogleKey(endpoint, keyId, false) || await readGoogleKey(endpoint, keyId, true);
  if (!key || typeof key.base64 !== 'string') fail('REWARDED_KEYS', 503);
  try { return await crypto.subtle.importKey('spki', decodeBase64(key.base64), curve, false, ['verify']); }
  catch { fail('REWARDED_KEYS', 503); }
}

// Google Tink's reference verifies URI.getQuery(): one percent decode of the
// intact prefix, preserving byte order and literal '+' (never form decoding).
async function verifyCallback(url, tier, getKey, validUnit, validTransaction) {
  const raw = new URL(url).search.slice(1);
  if (raw.length > 4096) invalid();
  const [content, sig, keyId] = /^(.+)&signature=([^&]+)&key_id=(\d{1,10})$/.exec(raw)?.slice(1) || [];
  if (!content || !KEY_URL[tier]) invalid();
  const values = Object.create(null);
  for (const pair of content.split('&')) {
    const match = /^([a-z_]+)=(.+)$/.exec(pair);
    if (!match || !fields.includes(match[1]) || Object.hasOwn(values, match[1])) invalid();
    const value = decodeField(match[2]);
    if (/[&=\u0000-\u001f\u007f]/.test(value)) invalid();
    values[match[1]] = value;
  }
  if (!/^\d{1,24}$/.test(values.ad_network || '') || !validUnit(values.ad_unit)
    || !/^[a-f\d]{64}$/.test(values.custom_data || '') || values.reward_amount !== '1'
    || !values.reward_item || values.reward_item.length > 100 || !validTransaction(values.transaction_id)
    || !/^\d{13}(?:\d{3})?$/.test(values.timestamp || '')) invalid();

  const signature = p1363(decodeBase64(decodeField(sig)));
  const key = await getKey(tier, keyId);
  const verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(decodeField(content)));
  if (!verified) invalid();
  const rawTimestamp = Number(values.timestamp);
  const timestamp = values.timestamp.length === 16 ? Math.trunc(rawTimestamp / 1000) : rawTimestamp;
  return { customData: values.custom_data, adUnit: values.ad_unit, rewardItem: values.reward_item, timestamp,
    transactionId: values.transaction_id.toLowerCase() };
}

export const verifyAdMobCallback = (url, tier, getKey = getGoogleKey) =>
  verifyCallback(url, tier, getKey, value => /^(?:ca-app-pub-\d{16}\/)?\d{10}$/.test(value || ''),
    value => /^[a-f\d]{16,128}$/i.test(value || ''));

// The Dashboard signs a fixed synthetic transaction and a placeholder ad unit.
// This verifier is exclusively for the preview's no-grant URL setup route.
export const verifyAdMobPreviewSetup = url =>
  verifyCallback(url, 'production', getGoogleKey, value => /^\d{1,24}$/.test(value || ''), value => value === '123456789');
