// مصدر مواضيع حزم الوسائط: ويكي بيانات.
//
// لماذا: النسخة السابقة من الحزم بُنيت ببحث نصي حر في كومنز، فجاءت صور لا تمتّ للجواب
// بصلة (سؤال «مفتاح» بصورة طائر، و«مطرقة» بتمثال). ويكي بيانات تربط الموضوع بصورته
// المعتمدة (P18) وباسمه العربي الموثّق، فيصير تطابق الصورة مع الجواب مضمونًا بالبناء.
//
// وعدد روابط ويكيبيديا (sitelinks) مقياس شهرة موضوعي: الأشهر يصلح للخانات السهلة
// والأقلّ شهرة للخانات الصعبة، فتُبنى الصعوبة على بيانات لا على تخمين.
const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'MaydanBank/1.0 (https://github.com/mf103871-boop/maydan; bank media build)';
const TIMEOUT_MS = 120_000;

export async function sparql(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/sparql-results+json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ويكي بيانات ردّت ${response.status} ${response.statusText}`);
    const data = await response.json();
    return data.results.bindings;
  } finally {
    clearTimeout(timer);
  }
}

// اسم ملف كومنز من رابط الصورة في ويكي بيانات.
export const fileOf = (url) => `File:${decodeURIComponent(String(url).split('/').pop()).replace(/_/g, ' ')}`;

// صفٌّ موحّد لكل موضوع. imageProperty: P18 صورة، P41 علم، P154 شعار.
export async function subjects(where, { imageProperty = 'P18', limit = 400, lang = 'ar' } = {}) {
  const rows = await sparql(`SELECT ?item ?ar ?en ?img (COUNT(DISTINCT ?site) AS ?fame) WHERE {
  ${where}
  ?item wdt:${imageProperty} ?img .
  ?item rdfs:label ?ar . FILTER(LANG(?ar) = "${lang}")
  OPTIONAL { ?item rdfs:label ?en . FILTER(LANG(?en) = "en") }
  OPTIONAL { ?site schema:about ?item ; schema:isPartOf/wikibase:wikiGroup "wikipedia" }
} GROUP BY ?item ?ar ?en ?img ORDER BY DESC(?fame) LIMIT ${limit}`);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const id = row.item.value.split('/').pop();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id, ar: row.ar.value, en: row.en?.value || '', file: fileOf(row.img.value), fame: Number(row.fame.value),
    });
  }
  return out;
}
