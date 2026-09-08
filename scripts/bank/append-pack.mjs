// يضيف أسئلة التعبئة إلى حزمة موجودة: يطبّق الأحكام، يمنع التكرار داخل الحزمة
// وعبر البنك، ويحفظ المعرّفات والحقول القديمة.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { arabicNormalize as N } from '../../src/shared/lib/arabicNormalize.js';
import path from 'node:path';
import { ROOT, fabricatedContentReasons, readRetiredQids } from '../bank.mjs';

const CATS = path.join(ROOT, 'src/data/categories');
const TIERS = [200, 400, 600, 800, 1000];
const w = (s) => (String(s || '').trim() ? String(s).trim().split(/\s+/).length : 0);
const leak = (na, nq) => na.length >= 4 && new RegExp(`(^| )(?:و|ف|ب|ك|ل|ال|وال|بال|فال|كال|لل|ول)?${na.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(nq);

const batch = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const status = JSON.parse(readFileSync(path.join(ROOT, 'src/data/bank-status.json'), 'utf8'));
const retiredQids = await readRetiredQids(ROOT);
for (const add of batch.packs) {
  if (!Object.hasOwn(status.categories, add.id)) throw new Error(`فئة غير معتمدة: ${add.id}`);
  const file = path.join(CATS, `${add.id}.json`);
  const originalText = readFileSync(file, 'utf8');
  const pack = JSON.parse(originalText);
  const indent = originalText.match(/\n([ \t]+)"/)?.[1] || '  ';
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
    if (!v || !['keep', 'fix', 'drop'].includes(v.verdict)) { dropped += 1; return; }
    if (v && v.verdict === 'drop') { dropped += 1; return; }
    const item = { ...q, alt: q.alt || [] };
    if (v && v.verdict === 'fix') { if (v.q) item.q = v.q; if (v.a) item.a = v.a; if (v.alt) item.alt = v.alt; if (v.p && TIERS.includes(v.p)) item.p = v.p; }
    if (!TIERS.includes(item.p) || !item.q?.trim() || !item.a?.trim() || !item.topic?.trim()) { dropped += 1; return; }
    const nq = N(item.q); const na = N(item.a);
    if (w(item.q) > 22 || w(item.a) > 6) { dropped += 1; return; }
    if (fabricatedContentReasons(item).length) { dropped += 1; return; }
    if (seenQ.has(nq) || bankQ.has(nq) || seenA.has(na)) { dropped += 1; return; }
    // RUBRIC §6: تكرار الإجابة بين فئتين تحذير؛ المنع داخل الفئة فقط.
    if (bankA.has(na)) console.warn(`${add.id}: إجابة تتكرر في فئة أخرى «${item.a}» — راجع الملاءمة`);
    if (leak(na, nq)) { dropped += 1; return; }
    if (na.split(' ').length > 1 && pool.some((o) => leak(na, N(o.q)))) { dropped += 1; return; }
    if (pool.filter((o) => o.p === item.p).length >= 48) { dropped += 1; return; }
    if (pool.filter((o) => o.p === item.p && o.topic === item.topic).length >= 12) { dropped += 1; return; }
    seenQ.add(nq); seenA.add(na); pool.push({ ...item, qid: undefined }); added += 1;
  });
  // المعرّفات القديمة ثابتة، حتى بعد الحذف أو إعادة تصنيف الصعوبة.
  const usedIds = new Set([...pack.qs.map((q) => q.qid), ...retiredQids]);
  const nextIds = new Map(TIERS.map((t) => [t, Math.max(0, ...[...usedIds]
    .filter((qid) => qid?.startsWith(`${add.id}-${t}-`))
    .map((qid) => Number(qid.split('-').at(-1))))]));
  const counters = new Map(TIERS.map((t) => [t, 0]));
  const qs = [];
  for (const t of TIERS) for (const q of pool.filter((x) => x.p === t)) {
    const n = counters.get(t) + 1; counters.set(t, n);
    let qid = q.qid;
    if (!qid) {
      let serial = nextIds.get(t);
      do { serial += 1; qid = `${add.id}-${t}-${String(serial).padStart(3, '0')}`; } while (usedIds.has(qid));
      if (serial > 999) throw new Error(`نفدت المعرّفات في ${add.id}-${t}`);
      nextIds.set(t, serial); usedIds.add(qid);
    }
    const out = q.qid ? q : { ...q, q: q.q.trim(), a: q.a.trim(), qid, verified: true };
    qs.push(out);
  }
  qs.sort((a, b) => a.p - b.p || a.qid.localeCompare(b.qid));
  writeFileSync(file, `${JSON.stringify({ ...pack, qs }, null, indent)}\n`);
  const gaps = TIERS.filter((t) => counters.get(t) < 48).map((t) => `${t}:${48 - counters.get(t)}`);
  console.log(`${add.id.padEnd(10)} ${TIERS.map((t) => String(counters.get(t)).padStart(3)).join(' ')} = ${String(qs.length).padStart(4)}  +${added} أُسقط ${dropped}${gaps.length ? `  ⚠ ينقص ${gaps.join(' ')}` : '  ✓ مكتملة'}`);
}
