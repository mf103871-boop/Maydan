// تحقق سلسلة x5c في توقيعات آبل (JWS من App Store Server API وإشعارات V2):
// قارئ DER صغير يكفي شهادات X.509 بمفاتيح EC، ثم التحقق من كل توقيع في السلسلة
// بـWebCrypto، وتثبيت الجذر ببصمة SHA-256 (Apple Root CA - G3 افتراضيًا).
// بلا هذا كان أي طرف يستطيع إرسال إشعار مزوّر بـnotificationUUID حقيقي فيُسقط
// الإشعار الأصلي عند فحص التكرار.
import { failure } from './errors.mjs';
import { bytesFromBase64url } from './jwt.mjs';

// https://www.apple.com/certificateauthority/AppleRootCA-G3.cer — بصمة SHA-256 للـDER.
export const APPLE_ROOT_CA_G3_SHA256 = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';
// الامتدادات التي تميّز شهادات توقيع المتجر (كما يفحصها app-store-server-library).
export const APPLE_LEAF_OID = '1.2.840.113635.100.6.11.1';
export const APPLE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';

const OIDS = {
  '1.2.840.10045.2.1': 'ecPublicKey',
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '1.2.840.10045.4.3.2': 'SHA-256',
  '1.2.840.10045.4.3.3': 'SHA-384',
  '1.2.840.10045.4.3.4': 'SHA-512',
};
const CURVE_BYTES = { 'P-256': 32, 'P-384': 48, 'P-521': 66 };

// ── DER ─────────────────────────────────────────────────────────────────────
function tlv(bytes, offset) {
  if (offset + 2 > bytes.length) failure('SIGNATURE');
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let cursor = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4 || cursor + count > bytes.length) failure('SIGNATURE');
    length = 0;
    for (let i = 0; i < count; i += 1) length = (length << 8) | bytes[cursor + i];
    cursor += count;
  }
  const end = cursor + length;
  if (end > bytes.length) failure('SIGNATURE');
  return { tag, start: cursor, end, offset };
}
function children(bytes, node) {
  const list = [];
  let cursor = node.start;
  while (cursor < node.end) {
    const child = tlv(bytes, cursor);
    list.push(child);
    cursor = child.end;
  }
  return list;
}
const slice = (bytes, node) => bytes.subarray(node.offset, node.end);
const content = (bytes, node) => bytes.subarray(node.start, node.end);

function oid(bytes, node) {
  if (node.tag !== 0x06) failure('SIGNATURE');
  const body = content(bytes, node);
  const parts = [Math.floor(body[0] / 40), body[0] % 40];
  let value = 0;
  for (let i = 1; i < body.length; i += 1) {
    value = value * 128 + (body[i] & 0x7f);
    if (!(body[i] & 0x80)) { parts.push(value); value = 0; }
  }
  return parts.join('.');
}
function time(bytes, node) {
  const text = new TextDecoder().decode(content(bytes, node));
  const full = node.tag === 0x17 ? `${Number(text.slice(0, 2)) < 50 ? '20' : '19'}${text}` : text; // UTCTime | GeneralizedTime
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(full);
  if (!m) failure('SIGNATURE');
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}
// توقيع ECDSA بصيغة DER (SEQUENCE من عددين) → r||s الخام الذي يفهمه WebCrypto.
function rawEcdsaSignature(der, size) {
  const seq = tlv(der, 0);
  const [r, s] = children(der, seq);
  const out = new Uint8Array(size * 2);
  for (const [index, node] of [[0, r], [1, s]]) {
    let body = content(der, node);
    while (body.length > size && body[0] === 0) body = body.subarray(1);
    if (body.length > size) failure('SIGNATURE');
    out.set(body, index * size + (size - body.length));
  }
  return out;
}

export function parseCertificate(der) {
  const cert = tlv(der, 0);
  const [tbs, sigAlg, sigVal] = children(der, cert);
  if (!tbs || !sigAlg || !sigVal) failure('SIGNATURE');
  const fields = children(der, tbs);
  let index = fields[0] && fields[0].tag === 0xa0 ? 1 : 0;
  index += 3; // serial, signature algorithm, issuer
  const validity = children(der, fields[index]);
  const spki = fields[index + 2];
  const spkiParts = children(der, children(der, spki)[0]);
  if (oid(der, spkiParts[0]) !== '1.2.840.10045.2.1') failure('SIGNATURE');
  const curve = OIDS[oid(der, spkiParts[1])];
  if (!CURVE_BYTES[curve]) failure('SIGNATURE');
  const extensions = new Set();
  const extNode = fields.slice(index + 3).find((node) => node.tag === 0xa3);
  if (extNode) {
    for (const ext of children(der, children(der, extNode)[0])) extensions.add(oid(der, children(der, ext)[0]));
  }
  const hash = OIDS[oid(der, children(der, sigAlg)[0])];
  if (!hash || hash === 'ecPublicKey') failure('SIGNATURE');
  return {
    der, tbs: slice(der, tbs), spki: slice(der, spki), curve, hash, extensions,
    notBefore: time(der, validity[0]), notAfter: time(der, validity[1]),
    signature: content(der, sigVal).subarray(1), // BIT STRING: أول بايت عدد البتات غير المستعملة
  };
}

async function importPublicKey(cert) {
  return crypto.subtle.importKey('spki', cert.spki, { name: 'ECDSA', namedCurve: cert.curve }, false, ['verify']);
}
async function sha256Hex(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// يتحقق أن كل شهادة موقّعة بالتي تليها، وأن الأخيرة هي الجذر المثبّت، وأنها كلها سارية.
export async function verifyChain(certs, { now = Date.now(), rootSha256 = APPLE_ROOT_CA_G3_SHA256 } = {}) {
  if (!Array.isArray(certs) || certs.length < 2 || certs.length > 5) failure('SIGNATURE');
  const parsed = certs.map(parseCertificate);
  for (const cert of parsed) if (now < cert.notBefore || now > cert.notAfter) failure('SIGNATURE');
  const root = parsed[parsed.length - 1];
  if ((await sha256Hex(root.der)) !== String(rootSha256 || '').toLowerCase()) failure('SIGNATURE');
  for (let i = 0; i < parsed.length; i += 1) {
    const cert = parsed[i];
    const issuer = parsed[Math.min(i + 1, parsed.length - 1)]; // الجذر يوقّع نفسه
    const key = await importPublicKey(issuer);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: cert.hash }, key, rawEcdsaSignature(cert.signature, CURVE_BYTES[issuer.curve]), cert.tbs);
    if (!ok) failure('SIGNATURE');
  }
  return parsed;
}

// JWS من آبل: ES256 برأس x5c (ورقة، وسيط، جذر). يعيد الحمولة بعد التحقق الكامل.
export async function verifyAppleJws(token, { now = Date.now(), rootSha256 = APPLE_ROOT_CA_G3_SHA256 } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) failure('INVALID');
  let header; let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(bytesFromBase64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(bytesFromBase64url(parts[1])));
  } catch { return failure('INVALID'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) failure('INVALID');
  if (header?.alg !== 'ES256' || !Array.isArray(header.x5c) || !header.x5c.length) failure('SIGNATURE');
  const chain = header.x5c.map((entry) => bytesFromBase64url(String(entry).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')));
  // Offline verification uses the signed date, as Apple's verifier does: a restored
  // transaction can legitimately outlive the certificate that signed it.
  const signedAt = payload.signedDate === undefined ? now : Number(payload.signedDate);
  if (!Number.isFinite(signedAt) || signedAt <= 0 || signedAt > now + 300_000) failure('SIGNATURE');
  const parsed = await verifyChain(chain, { now: signedAt, rootSha256 });
  const leaf = parsed[0];
  if (leaf.curve !== 'P-256' || !leaf.extensions.has(APPLE_LEAF_OID)) failure('SIGNATURE');
  if (parsed.length > 2 && !parsed[1].extensions.has(APPLE_INTERMEDIATE_OID)) failure('SIGNATURE');
  const key = await importPublicKey(leaf);
  const signature = bytesFromBase64url(parts[2]);
  if (signature.length !== 64) failure('SIGNATURE');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) failure('SIGNATURE');
  return payload;
}

// بصمة الجذر: افتراضيًا جذر آبل G3، وتُبدَّل في الاختبارات بسلسلة وهمية.
export const rootFingerprint = (env) => String(env.APPLE_ROOT_CA_SHA256 || APPLE_ROOT_CA_G3_SHA256).toLowerCase();
