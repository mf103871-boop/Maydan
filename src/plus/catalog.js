// Original, curated Maydan artwork. IDs are public cosmetics, never gameplay rights.
import assetManifest from '../../assets/plus/v1/manifest.json' with { type: 'json' };
export const PLUS_CATALOG_VERSION = 1;
export const PLUS_COLLECTIONS = Object.freeze([
  { id: 'sahra', label: 'سهرة ميدان', description: 'دفء السهرة، فيروز ولمعة ذهبية هادئة.', availableFrom: 0, palette: { bg: '#173b45', accent: '#f0bc61', text: '#fff5dd' } },
  { id: 'artist', label: 'رسّام الشلّة', description: 'ألوان جريئة وروح رسّام يحب المفاجآت.', availableFrom: 0, palette: { bg: '#493568', accent: '#65e3d6', text: '#fff7eb' } },
  { id: 'noir', label: 'ليلة مافيا', description: 'غموض الليل والنحاس؛ مظهر لا يكشف دورك.', availableFrom: 0, palette: { bg: '#141f30', accent: '#d9a36d', text: '#f9ebd6' } },
  { id: 'olive', label: 'ظل الزيتون', description: 'مجموعة شهرية بألوان الزيتون ودفء الحجر.', availableFrom: Date.UTC(2026, 10, 28), palette: { bg: '#294c40', accent: '#dfc581', text: '#fff8e8' }, monthly: true },
  { id: 'starlight', label: 'سهرانين', description: 'مجموعة شهرية من ضوء النجوم والليالي البنفسجية.', availableFrom: Date.UTC(2026, 11, 28), palette: { bg: '#302653', accent: '#beadff', text: '#fff5e8' }, monthly: true },
].map(c => Object.freeze({ ...c, coverUrl: `/assets/plus/v1/${c.id}.webp` })));

const words = {
  sahra: ['كفو', 'يا كبير', 'عافية عليك', 'نوّرت', 'اللمة أحلى', 'يا سلام'],
  artist: ['فنان', 'عرفتها', 'يا رسّام', 'شو هالإبداع', 'قريبة', 'ضحكتني'],
  noir: ['مكشوف يا مافيا', 'عيني عليك', 'مين الصادق', 'شفتك', 'هدوء يا جماعة', 'لعبتها صح'],
  olive: ['على راسي', 'يا أصيل', 'يسعدك', 'عال العال', 'مع بعض', 'جمعة خير'],
  starlight: ['سهرانين', 'نجم السهرة', 'لسه بدري', 'دورك', 'ولّعت', 'مرة ثانية'],
};
const emojis = ['👏', '🔥', '❤️', '😮', '😅', '😂'];
export const PLUS_ITEMS = Object.freeze(PLUS_COLLECTIONS.flatMap(c => {
  const base = { collectionId: c.id, availableFrom: c.availableFrom, version: PLUS_CATALOG_VERSION, minClientVersion: '1.9', color: c.palette.bg, accent: c.palette.accent, textColor: c.palette.text, fallback: 'default' };
  const kinds = c.monthly ? ['frame', 'cover'] : ['frame', 'avatar', 'cover', 'roomTheme', 'nameColor'];
  const names = { frame: 'إطار', avatar: 'شخصية', cover: 'غلاف', roomTheme: 'ستايل المجلس', nameColor: 'لون الاسم' };
  return [
    ...kinds.map(kind => Object.freeze({ ...base, id: `${c.id}.${kind}`, kind, label: `${names[kind]} ${c.label}`, assetUrl: c.coverUrl, assetHash: assetManifest.artwork[c.id]?.sha256 })),
    ...words[c.id].map((label, index) => Object.freeze({ ...base, id: `${c.id}.sticker.${index + 1}`, kind: 'sticker', label, assetUrl: `/assets/plus/v1/${c.id}-sticker-${index + 1}.svg`, assetHash: assetManifest.stickers[`${c.id}.sticker.${index + 1}`]?.sha256, fallback: emojis[index], emoji: emojis[index] })),
  ];
}));
const byId = new Map(PLUS_ITEMS.map(item => [item.id, item]));
export function getCosmetic(id, { kind, now = Date.now() } = {}) {
  const item = byId.get(id);
  return item && (!kind || item.kind === kind) && item.availableFrom <= now ? item : null;
}
export function availableCollections(now = Date.now()) { return PLUS_COLLECTIONS.filter(c => c.availableFrom <= now); }
export function availableItems(now = Date.now()) { return PLUS_ITEMS.filter(item => item.availableFrom <= now); }
export const EMPTY_COSMETICS = Object.freeze({ frameId: null, avatarId: null, coverId: null, nameColorId: null, roomThemeId: null, badge: false });
