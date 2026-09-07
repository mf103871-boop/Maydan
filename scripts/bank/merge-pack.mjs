// يدمج مخرجات ورشة الحزم: يطبّق أحكام التدقيق، يُسقط التكرار داخل الحزمة وعبر
// البنك كله، ويكتب ملف الفئة. ثم يطبع ما ينقص كل خانة.
//   node .cache/merge-pack.mjs <batch.json>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { arabicNormalize as N } from '../../src/shared/lib/arabicNormalize.js';
import path from 'node:path';

const ROOT = '/home/user/-';
const CATS = path.join(ROOT, 'src/data/categories');
const TIERS = [200, 400, 600, 800, 1000];
const w = (s) => (String(s || '').trim() ? String(s).trim().split(/\s+/).length : 0);
const leak = (na, nq) => na.length >= 4 && new RegExp(`(^| )(?:و|ف|ب|ك|ل|ال|وال|بال|فال|كال|لل|ول)?${na.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(nq);

// كل ما في البنك الآن، لمنع التكرار عبر الفئات
const bankQ = new Set(); const bankA = new Set();
for (const f of readdirSync(CATS).filter((x) => x.endsWith('.json'))) {
  for (const q of JSON.parse(readFileSync(path.join(CATS, f), 'utf8')).qs) { bankQ.add(N(q.q)); bankA.add(N(q.a)); }
}

const batch = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const status = JSON.parse(readFileSync(path.join(ROOT, 'src/data/bank-status.json'), 'utf8'));

for (const pack of batch.packs) {
  const verdicts = new Map((pack.checks || []).map((v) => [v.i, v]));
  const kept = []; const drops = [];
  pack.questions.forEach((q, i) => {
    const v = verdicts.get(i);
    if (v && v.verdict === 'drop') { drops.push({ q: q.q, why: v.reason }); return; }
    const item = { ...q, alt: q.alt || [] };
    if (v && v.verdict === 'fix') { if (v.q) item.q = v.q; if (v.a) item.a = v.a; if (v.alt) item.alt = v.alt; if (v.p && TIERS.includes(v.p)) item.p = v.p; }
    if (w(item.q) > 22 || w(item.a) > 6) { drops.push({ q: item.q, why: 'تجاوز الحدود' }); return; }
    kept.push(item);
  });

  const seenQ = new Set(); const seenA = new Set(); const unique = [];
  for (const q of kept) {
    const nq = N(q.q); const na = N(q.a);
    if (seenQ.has(nq) || bankQ.has(nq)) { drops.push({ q: q.q, why: 'نص مكرر' }); continue; }
    if (seenA.has(na) || bankA.has(na)) { drops.push({ q: q.q, why: `إجابة مكررة «${q.a}»` }); continue; }
    if (leak(na, nq)) { drops.push({ q: q.q, why: 'الإجابة داخل سؤالها' }); continue; }
    seenQ.add(nq); seenA.add(na); unique.push(q);
  }
  // عبارة من كلمتين فأكثر تكشف سؤالًا آخر داخل الحزمة
  const final = unique.filter((q) => {
    const na = N(q.a);
    if (na.split(' ').length < 2) return true;
    const bad = unique.some((o) => o !== q && leak(na, N(o.q)));
    if (bad) drops.push({ q: q.q, why: `إجابته «${q.a}» مكشوفة في سؤال آخر` });
    return !bad;
  });

  const per = (t) => final.filter((q) => q.p === t);
  const gaps = TIERS.filter((t) => per(t).length < 48).map((t) => `${t}:${48 - per(t).length}`);
  // نكتب ما توفّر (حتى 48 لكل خانة) ونبلّغ بالنواقص
  const counters = new Map(TIERS.map((t) => [t, 0]));
  const qs = [];
  for (const t of TIERS) for (const q of per(t).slice(0, 48)) {
    const n = counters.get(t) + 1; counters.set(t, n);
    const out = { p: t, q: q.q.trim(), a: q.a.trim(), qid: `${pack.id}-${t}-${String(n).padStart(3, '0')}`, topic: q.topic, verified: true };
    if (q.alt && q.alt.length) out.alt = q.alt;
    qs.push(out);
  }
  const meta = status.categories[pack.id];
  writeFileSync(path.join(CATS, `${pack.id}.json`), `${JSON.stringify({ id: pack.id, name: meta.name, icon: meta.icon, qs }, null, 2)}\n`);
  for (const q of qs) { bankQ.add(N(q.q)); bankA.add(N(q.a)); }
  console.log(`${pack.id.padEnd(10)} ${TIERS.map((t) => String(counters.get(t)).padStart(3)).join(' ')} = ${String(qs.length).padStart(4)}  أُسقط ${drops.length}${gaps.length ? `  ⚠ ينقص ${gaps.join(' ')}` : '  ✓'}`);
}
