// أدوات JOSE مصغّرة فوق crypto.subtle وحدها: لا اعتماديات npm، وتعمل في workerd وNode معًا.
import { failure } from './errors.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64urlFromBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function bytesFromBase64url(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export const base64url = (value) => base64urlFromBytes(typeof value === 'string' ? encoder.encode(value) : value);
export function randomToken(bytes = 32) { return base64urlFromBytes(crypto.getRandomValues(new Uint8Array(bytes))); }
export function randomHex(bytes = 8) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

// قراءة الحمولة بلا تحقق: تُستعمل فقط كتلميح قبل أن نسأل المزوّد نفسه.
export function decodeJws(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) failure('INVALID');
  try {
    return {
      header: JSON.parse(decoder.decode(bytesFromBase64url(parts[0]))),
      payload: JSON.parse(decoder.decode(bytesFromBase64url(parts[1]))),
      signature: bytesFromBase64url(parts[2]),
      signingInput: `${parts[0]}.${parts[1]}`,
    };
  } catch { return failure('INVALID'); }
}

const ALGORITHMS = {
  RS256: { importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verifyParams: { name: 'RSASSA-PKCS1-v1_5' } },
  ES256: { importParams: { name: 'ECDSA', namedCurve: 'P-256' }, verifyParams: { name: 'ECDSA', hash: 'SHA-256' } },
};

// ذاكرة مفاتيح المزوّدين داخل النسخة الحية فقط؛ workerd يعيد تشغيلها متى شاء.
const jwksCache = new Map();
export function clearJwksCache() { jwksCache.clear(); }
const JWKS_TTL = 10 * 60 * 1000;

async function jwks(url) {
  const cached = jwksCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.keys;
  let response;
  try { response = await fetch(url, { headers: { accept: 'application/json' } }); }
  catch { return failure('PROVIDER'); }
  if (!response.ok) failure('PROVIDER');
  let keys;
  try { keys = (await response.json()).keys; } catch { return failure('PROVIDER'); }
  if (!Array.isArray(keys)) failure('PROVIDER');
  jwksCache.set(url, { keys, expires: Date.now() + JWKS_TTL });
  return keys;
}

// تحقق كامل: توقيع بمفتاح JWKS المطابق لـkid، ثم iss/aud/exp/nonce.
export async function verifyJwt(token, { jwksUrl, issuer, audience, nonce, now = Date.now(), skew = 300_000 }) {
  const { header, payload, signature, signingInput } = decodeJws(token);
  const algorithm = ALGORITHMS[header.alg];
  if (!algorithm) failure('SIGNATURE');
  const keys = await jwks(jwksUrl);
  const candidates = keys.filter((key) => (!header.kid || key.kid === header.kid) && (!key.alg || key.alg === header.alg));
  let verified = false;
  for (const jwk of candidates) {
    let key;
    try { key = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['verify'], ext: true }, algorithm.importParams, false, ['verify']); }
    catch { continue; }
    if (await crypto.subtle.verify(algorithm.verifyParams, key, signature, encoder.encode(signingInput))) { verified = true; break; }
  }
  if (!verified) failure('SIGNATURE');
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const wanted = (Array.isArray(audience) ? audience : [audience]).filter(Boolean);
  if (issuer && payload.iss !== issuer) failure('SIGNATURE');
  if (wanted.length && !audiences.some((value) => wanted.includes(value))) failure('SIGNATURE');
  if (Number.isFinite(payload.exp) && payload.exp * 1000 + skew < now) failure('SIGNATURE');
  if (Number.isFinite(payload.iat) && payload.iat * 1000 - skew > now) failure('SIGNATURE');
  if (nonce && payload.nonce !== nonce) failure('SIGNATURE');
  return payload;
}

// مفتاح آبل يصل كـPEM بصيغة PKCS#8 داخل سر Worker (قد تصل أسطره كـ\n حرفية).
function pkcs8Bytes(pem) {
  const body = String(pem || '').replace(/\\n/g, '\n').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  if (!body) failure('INTERNAL');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export async function importEs256PrivateKey(pem) {
  try { return await crypto.subtle.importKey('pkcs8', pkcs8Bytes(pem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); }
  catch { return failure('INTERNAL'); }
}
// توقيع ES256: سر عميل آبل لتسجيل الدخول، ورمز App Store Server API.
export async function signEs256(header, payload, pem) {
  const key = await importEs256PrivateKey(pem);
  const signingInput = `${base64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', ...header }))}.${base64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput));
  return `${signingInput}.${base64urlFromBytes(new Uint8Array(signature))}`;
}

export async function hmacSha256(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(String(data))));
}
export async function hmacHex(secret, data) {
  return Array.from(await hmacSha256(secret, data), (b) => b.toString(16).padStart(2, '0')).join('');
}
// مقارنة بزمن ثابت: المقارنة العادية تسرّب الفارق عبر زمن التنفيذ.
export function safeEqual(a, b) {
  const left = String(a || ''); const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

// نداء مزوّد خارجي: أي فشل شبكة أو رد غير JSON يصير PROVIDER بدل 500 غامض.
export async function providerFetch(url, init = {}) {
  let response;
  try { response = await fetch(url, init); } catch { return failure('PROVIDER'); }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: response.ok, status: response.status, data, text };
}
export async function providerJson(url, init) {
  const result = await providerFetch(url, init);
  if (!result.ok || !result.data) failure('PROVIDER');
  return result.data;
}
