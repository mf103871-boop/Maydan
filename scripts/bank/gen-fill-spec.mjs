import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { normalizeArabic } from '../bank.mjs'

const DIR = 'src/data/categories'
const TIERS = [200, 400, 600, 800, 1000]
const MIN = 48
const CAP = Math.ceil(MIN * 0.25) // 12 — no topic may exceed 25% of a tier

const status = JSON.parse(readFileSync('src/data/bank-status.json', 'utf8'))
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
const bankAnswers = new Set()
const packs = []

for (const f of files) {
  const d = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
  for (const q of d.qs) if (q.a) bankAnswers.add(normalizeArabic(q.a))
  const st = status.categories?.[d.id] || status[d.id]
  if (st && st.status === 'done') continue
  const byTier = Object.fromEntries(TIERS.map((p) => [p, d.qs.filter((q) => q.p === p)]))
  const gaps = TIERS.filter((p) => byTier[p].length < MIN).map((p) => ({ p, need: MIN - byTier[p].length }))
  if (!gaps.length) continue
  const topics = [...new Set(d.qs.map((q) => q.topic).filter(Boolean))]
  const room = {}
  for (const { p } of gaps) {
    room[p] = Object.fromEntries(topics.map((t) => [t, Math.max(0, CAP - byTier[p].filter((q) => q.topic === t).length)]))
  }
  packs.push({ id: d.id, name: d.name, topics, gaps, room, usedAnswers: d.qs.map((q) => q.a).filter(Boolean) })
}

writeFileSync('.cache/fill-spec.json', JSON.stringify({ packs, bankAnswers: [...bankAnswers] }, null, 1))
console.log(JSON.stringify(packs.map(({ id, name, topics, gaps }) => ({ id, name, topics, gaps }))))
