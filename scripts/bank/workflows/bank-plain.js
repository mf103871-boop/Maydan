export const meta = {
  name: 'bank-plain',
  description: 'Write plain text packs by sub-topic ownership, and top up any wip packs',
  phases: [
    { title: 'Write', detail: 'one writer owns one sub-topic across all five tiers' },
    { title: 'Fill', detail: 'close the remaining gaps in the wip packs' },
    { title: 'Check', detail: 'fact-check every new question on the web' },
  ],
}

const SPEC = '/home/user/-/.cache/fill-spec.json'
const TIERS = [
  { p: 200, name: 'سهل', who: '~90% من أفراد العائلة، حتى طفل في العاشرة', ex: '«ما عاصمة مصر؟» → القاهرة' },
  { p: 400, name: 'متوسط', who: '~60% من البالغين', ex: '«ما أعلى جبل في أفريقيا؟» → كليمنجارو' },
  { p: 600, name: 'صعب', who: '~35% — المهتمّون بالموضوع', ex: '«ما عاصمة كازاخستان؟» → أستانا' },
  { p: 800, name: 'صعب جدًا', who: '~15% — المتعمّقون', ex: '«ما أعمق بحيرة في العالم؟» → بايكال' },
  { p: 1000, name: 'مستحيل', who: '≤5% — نادرة لكنها صحيحة ومحددة وممتعة', ex: '«ما الدولة صاحبة أكبر عدد من المناطق الزمنية؟» → فرنسا' },
]
const LADDER = TIERS.map((t) => `- **${t.p} (${t.name})**: يعرف الإجابة ${t.who}. مثال: ${t.ex}`).join('\n')

const RULES = `قواعد إلزامية (docs/bank/RUBRIC.md):
- سؤال واحد = حقيقة واحدة = إجابة واحدة لا لبس فيها.
- نص السؤال ≤ 22 كلمة، والإجابة ≤ 6 كلمات. عُدّها بنفسك.
- صيغ بسيطة: ما / من / أين / كم / ما اسم. ممنوع: أسئلة مركّبة، حسابات، نفي، تواريخ إلا الأيقونية.
- المتعة من المعلومة لا من التعقيد. لا تصنع صعوبة بتعقيد الصياغة.
- عربية سليمة: همزات (أ/إ/آ) وتاء مربوطة، فصحى مبسطة.
- ممنوع: الدين والمذاهب، السياسة والحكّام، الحروب الجارية، أي إحراج أو ما لا يناسب أطفالًا.
- كل معلومة مؤكدة ومستقرة. لا رقم يتغيّر كل سنة، ولا ما فيه خلاف بين المصادر. الشك يعني لا تكتبه.
- الإجابة مختصرة، ولا تظهر داخل نص سؤالها، ولا تظهر عبارتها في نص سؤال آخر تكتبه.
- alt: صيغ أخرى مقبولة (نقل مختلف لاسم أجنبي، لقب، مرادف) — مصفوفة قد تكون فارغة.
- في source سطر واحد يذكر أين تُتحقَّق المعلومة.`

const OUT = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          p: { type: 'integer' },
          q: { type: 'string' },
          a: { type: 'string' },
          alt: { type: 'array', items: { type: 'string' } },
          source: { type: 'string' },
        },
        required: ['topic', 'p', 'q', 'a', 'source'],
      },
    },
  },
  required: ['questions'],
}

const CHECK = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          verdict: { type: 'string', enum: ['keep', 'fix', 'drop'] },
          reason: { type: 'string' },
          q: { type: 'string' },
          a: { type: 'string' },
          alt: { type: 'array', items: { type: 'string' } },
          p: { type: 'integer' },
        },
        required: ['i', 'verdict', 'reason'],
      },
    },
  },
  required: ['items'],
}

const checker = (name, questions, label) => agent(
  `دقّق صحة هذه الأسئلة العربية تدقيقًا عدائيًا، لحزمة «${name}» في لعبة عائلية. أسقط ما لا يصمد، ولا تجامل.

**تحقّق فعلًا**: WebSearch وWebFetch متاحان. استعملهما لكل رقم واسم و«أول/أكبر/أطول/أسرع». لا تعتمد على ذاكرتك وحدها.

لكل سؤال:
1. **الصحة**: حاول تكذيب المعلومة. خاطئة أو محل خلاف حقيقي بين المصادر أو رقم يتغيّر بمرور الوقت → drop مع ذكر ما وجدت.
2. **وحدانية الإجابة**: تحتمل إجابة صحيحة أخرى؟ fix بتضييق السؤال أو بإضافة الصيغ إلى alt، أو drop.
3. **الخانة**: 200=~90% حتى طفل العاشرة · 400=~60% من البالغين · 600=~35% · 800=~15% · 1000=≤5%. في غير مكانها → fix مع p الصحيحة.
4. **الحدود**: السؤال ≤ 22 كلمة والإجابة ≤ 6 كلمات. عُدّها فعلًا.
5. **اللغة**: همزات وتاء مربوطة وصياغة سليمة → fix.
6. **الملاءمة**: دين أو سياسة أو إحراج أو ما لا يناسب أطفالًا → drop.
7. **الإجابة داخل نص سؤالها** → fix.
8. **التكرار داخل هذه القائمة**: إجابتان متطابقتان أو مترادفتان (ولو بنقل مختلف للاسم الأجنبي) → أبقِ الأنسب خانةً وأسقط الأخرى.

الحقل i هو الفهرس المكتوب أمام السؤال. أعد حكمًا لكل سؤال بلا استثناء. الشك في الصحة يعني drop.

الأسئلة:
${questions.map((q, k) => `${k} | [${q.p}] [${q.topic}] ${q.q} → ${q.a}  {مصدر: ${q.source}}`).join('\n')}`,
  { label, phase: 'Check', schema: CHECK },
)

phase('Write')
const written = await parallel((args.newPacks || []).map((pack) => () =>
  parallel(pack.topics.map((topic) => () => agent(
    `اكتب 40 سؤالًا عربيًا لفئة «${pack.name}» في لعبة أسئلة عائلية، **كلها في الموضوع الفرعي «${topic}» وحده**.

الفئة: ${pack.name} — ${pack.scope}

وزّعها على خانات الصعوبة الخمس: **8 أسئلة لكل خانة بالضبط**.
${LADDER}

صنّف بالإجابة لا بالصياغة: اسأل نفسك كم واحدًا من عشرة في مجلس عائلي عربي يعرف هذه الإجابة. عشرة أو تسعة → 200 · ستة → 400 · ثلاثة أو أربعة → 600 · واحد أو اثنان → 800 · أقل من واحد → 1000.

**أنت وحدك تكتب هذا الموضوع**، فاحرص أن تكون الأربعون كلها مختلفة: لا إجابة تتكرر بين خاناتك، ولا سؤالان عن الحقيقة نفسها بصياغتين. تدرّج من المشهور في 200 إلى النادر في 1000 داخل الموضوع نفسه.

اكتب اسم الموضوع حرفيًا هكذا في حقل topic: ${topic}
واكتب رقم الخانة في حقل p.

${RULES}`,
    { label: `write:${pack.id}/${topic}`, phase: 'Write', schema: OUT },
  ))).then((parts) => ({
    pack,
    questions: parts.filter(Boolean).flatMap((r) => r.questions || []),
  }))))

phase('Fill')
const spec = args.fill || []
const filled = await parallel(spec.flatMap((pack) => pack.gaps.map((gap) => () => agent(
  `اقرأ الملف \`${SPEC}\`. اعثر على الحزمة \`${pack.id}\` وستجد فيها \`usedAnswers\` (كل إجابات هذه الحزمة) و\`room["${gap.p}"]\` (سعة كل موضوع في هذه الخانة)، وفي \`bankAnswers\` كل إجابات البنك.

اكتب **${gap.need + 10} سؤالًا** لفئة «${pack.name}» في خانة **${gap.p}** فقط.
يعرف الإجابة ${TIERS.find((t) => t.p === gap.p).who}. مثال: ${TIERS.find((t) => t.p === gap.p).ex}

**الشرط الأهم**: لا تكرّر أي إجابة في \`usedAnswers\` ولا \`bankAnswers\`، ولا مرادفًا لها ولا نقلًا آخر للاسم نفسه. اقرأ القائمتين أولًا.
المواضيع المسموحة (لا تتجاوز سعة \`room\`، واكتب الاسم حرفيًا في topic): ${pack.topics.join(' · ')}
اكتب رقم الخانة ${gap.p} في حقل p.

${RULES}

اكتب ${gap.need + 10} لا ${gap.need}: بعضها سيسقط.`,
  { label: `fill:${pack.id}-${gap.p}`, phase: 'Fill', schema: OUT },
).then((r) => ({ id: pack.id, name: pack.name, questions: (r && r.questions) || [] })))))

phase('Check')
const fillByPack = new Map()
for (const f of filled.filter(Boolean)) {
  const cur = fillByPack.get(f.id) || { name: f.name, questions: [] }
  cur.questions.push(...f.questions)
  fillByPack.set(f.id, cur)
}

const checked = await parallel([
  ...written.filter(Boolean).map((r) => () => {
    const half = Math.ceil(r.questions.length / 2)
    return parallel([r.questions.slice(0, half), r.questions.slice(half)].map((slice, si) => () =>
      checker(r.pack.name, slice, `check:${r.pack.id}-${si + 1}`).then((c) => ({ items: (c && c.items || []).map((x) => ({ ...x, i: x.i + si * half })) }))))
      .then((parts) => ({ id: r.pack.id, mode: 'new', questions: r.questions.map(({ source, ...q }) => q), checks: parts.filter(Boolean).flatMap((p) => p.items) }))
  }),
  ...[...fillByPack.entries()].map(([id, v]) => () =>
    checker(v.name, v.questions, `check:fill-${id}`)
      .then((c) => ({ id, mode: 'fill', questions: v.questions.map(({ source, ...q }) => q), checks: (c && c.items) || [] }))),
])

const packs = checked.filter(Boolean)
log(packs.map((p) => `${p.id}[${p.mode}]: ${p.questions.length} · drop ${p.checks.filter((c) => c.verdict === 'drop').length}`).join(' | '))
return { packs }
