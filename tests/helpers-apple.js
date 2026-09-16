// توقيع JWS كما تفعل آبل (ES256 + x5c) بسلسلة الاختبار في tests/fixtures/apple-chain:
// جذر P-384 وهمي، وسيط يحمل امتداد 1.2.840.113635.100.6.2.1، وورقة P-256 تحمل
// 1.2.840.113635.100.6.11.1. المفتاح الخاص للورقة مخزّن هنا لأنه للاختبار فقط.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'tests/fixtures/apple-chain');
const pemToDer = (pem) => Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
const b64u = (input) => Buffer.from(input).toString('base64url');

export function appleChain({ root = 'root.pem' } = {}) {
  const leaf = pemToDer(readFileSync(path.join(DIR, 'leaf.pem'), 'utf8'));
  const intermediate = pemToDer(readFileSync(path.join(DIR, 'intermediate.pem'), 'utf8'));
  const rootDer = pemToDer(readFileSync(path.join(DIR, root), 'utf8'));
  const key = createPrivateKey(readFileSync(path.join(DIR, 'leaf-key.pkcs8.pem'), 'utf8'));
  const rootSha256 = createHash('sha256').update(rootDer).digest('hex');
  const x5c = [leaf, intermediate, rootDer].map((der) => der.toString('base64'));
  // sign(payload, { header }) → JWS موقّع بورقة السلسلة؛ header يبدّل الرأس (لاختبار الرفض).
  const signJws = (payload, { header, x5c: chain = x5c } = {}) => {
    const head = b64u(JSON.stringify(header || { alg: 'ES256', x5c: chain }));
    const body = b64u(JSON.stringify(payload));
    const signature = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
    return `${head}.${body}.${b64u(signature)}`;
  };
  return { sign: signJws, x5c, rootSha256, leafDer: leaf, intermediateDer: intermediate, rootDer };
}
