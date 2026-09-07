// يضيف أسئلة التعبئة إلى حزمة موجودة: يطبّق الأحكام، يمنع التكرار داخل الحزمة
// وعبر البنك، ويعيد ترقيم المعرّفات.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { arabicNormalize as N } from '../../src/shared/lib/arabicNormalize.js';
import path from 'node:path';

const ROOT = '/home/user/-';
const CATS = path.join(ROOT, 'src/data/categories');
const TIERS = [200, 400, 600, 800, 1000];
const w = (s) => (String(s || '').trim() ? String(s).trim().split(/\s+/).length : 0);
const leak = (na, nq) => na.length >= 4 && new RegExp(`(^| )(?:و|ف|ب|ك|ل|ال|وال|بال|فال|كال|لل|ول)?${na.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(nq);

const batch = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const add of batch.packs) {
  const file = path.join(CATS, `${add.id}.json`);
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  // كل ما في البنك عدا هذه الحزمة
  const bankQ = new Set(); const bankA = new Set();
  for (const f of readdirSync(CATS).filter((x) => x.endsWith('.json') && x !== `${add.id}.json`))
    for (const q of JSON.parse(readFileSync(path.join(CATS, f), 'utf8')).qs) { bankQ.add(N(q.q)); bankA.add(N(q.a)); }
  const seenQ = new Set(pack.qs.map((q) => N(q.q)));
  const seenA = new Set(pack.qs.map((q) => N(q.a)));
  const verdicts = new Map((add.checks || []).map((v) => [v.i, v]));
  const pool = [...pack.qs];
  let added = 0; let dropped = 0;
  add.questions.forEach((q, i) => {
    const v = verdicts.get(i);
    if (v && v.verdict === 'drop') { dropped += 1; return; }
    const item = { ...q, alt: q.alt || [] };
    if (v && v.verdict === 'fix') { if (v.q) item.q = v.q; if (v.a) item.a = v.a; if (v.alt) item.alt = v.alt; if (v.p && TIERS.includes(v.p)) item.p = v.p; }
    const nq = N(item.q); const na = N(item.a);
    if (w(item.q) > 22 || w(item.a) > 6) { dropped += 1; return; }
    if (seenQ.has(nq) || bankQ.has(nq) || seenA.has(na) || bankA.has(na)) { dropped += 1; return; }
    if (leak(na, nq)) { dropped += 1; return; }
    if (na.split(' ').length > 1 && pool.some((o) => leak(na, N(o.q)))) { dropped += 1; return; }
    if (pool.filter((o) => o.p === item.p).length >= 48) { dropped += 1; return; }
    if (pool.filter((o) => o.p === item.p && o.topic === item.topic).length >= 12) { dropped += 1; return; }
    seenQ.add(nq); seenA.add(na); pool.push(item); added += 1;
  });
  // ترقيم من جديد
  const counters = new Map(TIERS.map((t) => [t, 0]));
  const qs = [];
  for (const t of TIERS) for (const q of pool.filter((x) => x.p === t)) {
    const n = counters.get(t) + 1; counters.set(t, n);
    const out = { p: t, q: q.q.trim(), a: q.a.trim(), qid: `${add.id}-${t}-${String(n).padStart(3, '0')}`, topic: q.topic, verified: true };
    if (q.alt && q.alt.length) out.alt = q.alt;
    qs.push(out);
  }
  writeFileSync(file, `${JSON.stringify({ id: pack.id, name: pack.name, icon: pack.icon, qs }, null, 2)}\n`);
  const gaps = TIERS.filter((t) => counters.get(t) < 48).map((t) => `${t}:${48 - counters.get(t)}`);
  console.log(`${add.id.padEnd(10)} ${TIERS.map((t) => String(counters.get(t)).padStart(3)).join(' ')} = ${String(qs.length).padStart(4)}  +${added} أُسقط ${dropped}${gaps.length ? `  ⚠ ينقص ${gaps.join(' ')}` : '  ✓ مكتملة'}`);
}
