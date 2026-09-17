// من اسم الموضوع إلى ملف كومنز الذي يصوّره فعلًا.
//
// السلسلة: صورة صدر مقالة ويكيبيديا العربية ← الإنجليزية ← صورة ويكي بيانات (P18/P41)
// ← بحث كومنز مقيّد. صورة صدر المقالة هي التي اختارها محرّرو الموسوعة لتمثيل الموضوع،
// فهي أضمن تطابقًا مع الجواب من أي بحث نصي حر.
const UA = 'MaydanBank/1.0 (https://github.com/mf103871-boop/maydan; bank media build)';
const TIMEOUT_MS = 30_000;
// تهدئة تصاعدية تبلغ الدقيقة. ويكيميديا تقيّد المعدل بشدة حين تُبنى عدة حزم معًا،
// وسلّم من ثماني ثوانٍ كان يُسقط المواضيع وهي سليمة.
const RETRY_DELAYS = [1000, 3000, 8000, 20_000, 45_000, 90_000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// واجهات ويكيميديا تردّ أحيانًا 429 أو صفحة HTML عند الضغط؛ نعيد المحاولة بهدوء.
export async function apiJson(url, label = 'ويكيميديا') {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt) await sleep(RETRY_DELAYS[attempt - 1]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        // الخادم يقول متى يقبل الطلب التالي؛ احترام قوله أسرع من تخمين أقصر منه.
        const advised = Number(response.headers.get('retry-after')) * 1000;
        if (Number.isFinite(advised) && advised > 0) await sleep(advised);
        throw new Error(`${label} ردّت ${response.status}`);
      }
      try { return JSON.parse(text); } catch { throw new Error(`${label} ردّت محتوى ليس JSON`); }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

const wikiApi = (host, params) => `https://${host}/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params })}`;

// صور الصدر لعدة عناوين في طلب واحد (حدّ الواجهة 50 عنوانًا).
export async function leadImages(host, titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const slice = titles.slice(i, i + 40);
    const data = await apiJson(wikiApi(host, { prop: 'pageimages', piprop: 'name', pilimit: 'max', titles: slice.join('|'), redirects: '1' }), host);
    const normalized = new Map((data.query?.normalized || []).map((n) => [n.to, n.from]));
    const redirects = new Map((data.query?.redirects || []).map((r) => [r.to, r.from]));
    for (const page of data.query?.pages || []) {
      const asked = redirects.get(page.title) ?? page.title;
      const original = normalized.get(asked) ?? asked;
      if (page.pageimage) out.set(original, `File:${decodeURIComponent(page.pageimage).replace(/_/g, ' ')}`);
    }
    if (i + 40 < titles.length) await sleep(400);
  }
  return out;
}

// بحث كومنز مقيّد بنوع الملف — للمواضيع التي لا مقالة لها، ولحزمة الظل (ملفات SVG شفافة).
export async function searchCommons(search, { mime = null, limit = 10 } = {}) {
  const query = mime ? `${search} filemime:${mime}` : search;
  const data = await apiJson(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6',
    gsrsearch: query, gsrlimit: String(limit), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
    iiextmetadatafilter: 'LicenseShortName',
  })}`, 'كومنز');
  return (data.query?.pages || [])
    .slice()
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((page) => ({ title: page.title, mime: page.imageinfo?.[0]?.mime || '', width: page.imageinfo?.[0]?.width || 0 }));
}

// صورة ويكي بيانات مباشرة، بالبحث عن العنصر باسمه.
export async function wikidataImage(label, property = 'P18', lang = 'ar') {
  const search = await apiJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({
    action: 'wbsearchentities', format: 'json', language: lang, uselang: lang, search: label, limit: '1', type: 'item',
  })}`, 'ويكي بيانات');
  const id = search.search?.[0]?.id;
  if (!id) return null;
  const entity = await apiJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({
    action: 'wbgetclaims', format: 'json', formatversion: '2', entity: id, property,
  })}`, 'ويكي بيانات');
  const name = entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  return name ? `File:${String(name).replace(/_/g, ' ')}` : null;
}

// يحلّ قائمة مواضيع دفعةً واحدة. كل موضوع: { key, ar, en?, commons?, search?, mime? }
// ويعيد { ...subject, file, via } أو { ...subject, file: null } إن لم يُعثر على شيء.
export async function resolveSubjects(list) {
  const pending = list.map((s) => ({ ...s, file: s.commons || null, via: s.commons ? 'محدد يدويًا' : null }));
  const needArabic = pending.filter((s) => !s.file && s.ar);
  if (needArabic.length) {
    const found = await leadImages('ar.wikipedia.org', needArabic.map((s) => s.ar));
    for (const s of needArabic) { const f = found.get(s.ar); if (f) { s.file = f; s.via = 'ويكيبيديا العربية'; } }
  }
  const needEnglish = pending.filter((s) => !s.file && s.en);
  if (needEnglish.length) {
    const found = await leadImages('en.wikipedia.org', needEnglish.map((s) => s.en));
    for (const s of needEnglish) { const f = found.get(s.en); if (f) { s.file = f; s.via = 'ويكيبيديا الإنجليزية'; } }
  }
  for (const s of pending.filter((x) => !x.file)) {
    if (s.search) {
      const [hit] = await searchCommons(s.search, { mime: s.mime, limit: 1 });
      if (hit) { s.file = hit.title; s.via = 'بحث كومنز'; continue; }
    }
    const viaData = await wikidataImage(s.ar || s.en, s.property || 'P18');
    if (viaData) { s.file = viaData; s.via = 'ويكي بيانات'; }
    await sleep(250);
  }
  return pending;
}
