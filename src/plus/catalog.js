// Original, curated Maydan artwork. IDs are public cosmetics, never gameplay rights.
import assetManifest from '../../assets/plus/v1/manifest.json' with { type: 'json' };
import craftedManifest from '../../assets/plus/v2/manifest.json' with { type: 'json' };
export const PLUS_CATALOG_VERSION = 3;
// Subscription scope is presentation-only. Keep archived IDs below readable so
// existing preferences, permanent grants and old messages are never destroyed.
export function subscriptionIncludesKind(kind) { return kind === 'profileSkin' || kind === 'frame'; }
const PROFILE_BACKGROUND = '/assets/plus/v2/profile-sahra-background.webp';
export const PLUS_COLLECTIONS = Object.freeze([
  { id: 'sahra', label: 'سهرة ميدان', description: 'دفء السهرة، فيروز ولمعة ذهبية هادئة.', availableFrom: 0, palette: { bg: '#173b45', accent: '#f0bc61', text: '#fff5dd' } },
  { id: 'artist', label: 'رسّام الشلّة', description: 'ألوان جريئة وروح رسّام يحب المفاجآت.', availableFrom: 0, palette: { bg: '#493568', accent: '#65e3d6', text: '#fff7eb' } },
  { id: 'noir', label: 'ليلة مافيا', description: 'غموض الليل والنحاس؛ مظهر لا يكشف دورك.', availableFrom: 0, palette: { bg: '#141f30', accent: '#d9a36d', text: '#f9ebd6' } },
  { id: 'olive', label: 'ظل الزيتون', description: 'مجموعة بألوان الزيتون ودفء الحجر.', availableFrom: Date.UTC(2026, 10, 28), palette: { bg: '#294c40', accent: '#dfc581', text: '#fff8e8' }, monthly: true },
  { id: 'starlight', label: 'سهرانين', description: 'مجموعة من ضوء النجوم والليالي البنفسجية.', availableFrom: Date.UTC(2026, 11, 28), palette: { bg: '#302653', accent: '#beadff', text: '#fff5e8' }, monthly: true },
].map(c => Object.freeze({ ...c, coverUrl: ['sahra','artist','noir'].includes(c.id) ? `/assets/plus/v2/${c.id}-cover.webp` : `/assets/plus/v1/${c.id}.webp` })));

const words = {
  sahra: ['كفو', 'يا كبير', 'عافية عليك', 'نوّرت', 'اللمة أحلى', 'يا سلام'],
  artist: ['فنان', 'عرفتها', 'يا رسّام', 'شو هالإبداع', 'قريبة', 'ضحكتني'],
  noir: ['مكشوف يا مافيا', 'عيني عليك', 'مين الصادق', 'شفتك', 'هدوء يا جماعة', 'لعبتها صح'],
  olive: ['على راسي', 'يا أصيل', 'يسعدك', 'عال العال', 'مع بعض', 'جمعة خير'],
  starlight: ['سهرانين', 'نجم السهرة', 'لسه بدري', 'دورك', 'ولّعت', 'مرة ثانية'],
};
const emojis = ['👏', '🔥', '❤️', '😮', '😅', '😂'];
export const PLUS_ITEMS = Object.freeze(PLUS_COLLECTIONS.flatMap(c => {
  const base = { collectionId: c.id, availableFrom: c.availableFrom, version: 2, minClientVersion: '1.9', color: c.palette.bg, accent: c.palette.accent, textColor: c.palette.text, fallback: 'default' };
  const kinds = c.monthly ? ['frame', 'cover'] : ['frame', 'avatar', 'cover', 'roomTheme', 'nameColor', 'entrance'];
  const names = { frame: 'إطار', avatar: 'شخصية', cover: 'غلاف', roomTheme: 'هوية المجلس', nameColor: 'بطاقة اسم', entrance: 'ترحيب الدخول' };
  const crafted = ['sahra','artist','noir'].includes(c.id);
  const artFor = kind => crafted ? `/assets/plus/v2/${c.id}-${({ nameColor:'name-card',roomTheme:'room',entrance:'entrance' })[kind] || kind}.webp` : c.coverUrl;
  return [
    ...kinds.map(kind => Object.freeze({ ...base, id: `${c.id}.${kind}`, kind, label: `${names[kind]} ${c.label}`,
      entitlement:'plus', ownership:'subscription', purchaseOfferId:crafted ? `${c.id}.${kind}.permanent` : null,
      offerId:crafted ? `${c.id}.${kind}.permanent` : null,
      assetUrl: artFor(kind), assetHash: craftedManifest.assets?.[artFor(kind)]?.sha256 || assetManifest.artwork[c.id]?.sha256,
      artReady:crafted ? !!craftedManifest.assets?.[artFor(kind)]?.sha256 : true,
      posterUrl: artFor(kind),
      ...(crafted && kind==='frame' ? { frameAssets:{ small:`/assets/plus/v2/${c.id}-frame-small.svg`,medium:`/assets/plus/v2/${c.id}-frame-medium.webp`,large:`/assets/plus/v2/${c.id}-frame.webp` },motionKind:'light-sweep' } : {}),
      ...(crafted && kind==='nameColor' ? { nameCardAsset:`/assets/plus/v2/${c.id}-name-card.webp`,nameCardTextColor:c.id==='noir'?'#F8EAD7':'#30203F' } : {}),
      ...(crafted && kind==='roomTheme' ? { layerAssets:{background:`/assets/plus/v2/${c.id}-room.webp`,table:`/assets/plus/v2/${c.id}-table.webp`},layout:'social-waiting' } : {}),
      ...(crafted && kind==='entrance' ? { motionKind:'welcome',durationMs:1200,sensitivePhases:'defer' } : {}),
    })),
    // Sticker art did not change: keep its immutable version so old messages
    // and old clients still resolve their original local artwork.
    ...words[c.id].map((label, index) => Object.freeze({ ...base, version:1,id: `${c.id}.sticker.${index + 1}`, kind: 'sticker', label, assetUrl: `/assets/plus/v1/${c.id}-sticker-${index + 1}.svg`, assetHash: assetManifest.stickers[`${c.id}.sticker.${index + 1}`]?.sha256, fallback: emojis[index], emoji: emojis[index] })),
  ];
}).concat([
  Object.freeze({ id:'plus.signature.frame',kind:'frame',collectionId:'sahra',label:'إطار عضوية ميدان بلس',description:'إطار ذهبي هادئ بلمعة بطيئة في البروفايل وتفاصيل ثابتة في الصور الصغيرة. علامة بلس مستقلة عن الإطار.',
    availableFrom:0,version:PLUS_CATALOG_VERSION,minClientVersion:'1.9',entitlement:'plus',ownership:'subscription',membershipOnly:true,
    assetUrl:'/assets/plus/v2/signature-frame.webp',posterUrl:'/assets/plus/v2/signature-frame.webp',
    frameAssets:{small:'/assets/plus/v2/signature-frame-small.svg',medium:'/assets/plus/v2/signature-frame-medium.webp',large:'/assets/plus/v2/signature-frame.webp'},
    assetHash:craftedManifest.assets?.['/assets/plus/v2/signature-frame.webp']?.sha256,artReady:!!craftedManifest.assets?.['/assets/plus/v2/signature-frame.webp']?.sha256,motionKind:'calm',color:'#30203F',accent:'#FFBF36',fallback:'default' }),
  ...['profileSkin','councilSkin'].map(kind=>Object.freeze({
    id:`sahra.${kind}`,kind,collectionId:'sahra',label:kind==='profileSkin'?'بروفايل سهرة ميدان الكامل':'مجلس سهرة ميدان الكامل',
    description:kind==='profileSkin'?'ألوان وخامات وبطاقات متناسقة لكل ملفك. صورتك الشخصية تبقى كما اخترتها.':'طاولة ومقاعد وبيئة وإضاءة متناسقة يشاهدها ضيوفك جميعًا.',
    availableFrom:0,version:1,minClientVersion:'1.9',entitlement:'plus',ownership:'subscription',membershipOnly:true,
    assetUrl:PROFILE_BACKGROUND,posterUrl:PROFILE_BACKGROUND,
    assetHash:craftedManifest.assets?.[PROFILE_BACKGROUND]?.sha256,
    artReady:kind==='profileSkin'?!!craftedManifest.assets?.[PROFILE_BACKGROUND]?.sha256:false,
    color:'#173b45',accent:'#f2c466',textColor:'#fff3d6',fallback:'default',
  })),
]));

// A library license and a purchased permanent license may cover the same item.
// Neither the offer nor a gold-colored asset is proof of account ownership.
export const COSMETIC_OFFERS = Object.freeze(PLUS_COLLECTIONS.filter(c=>['sahra','artist','noir'].includes(c.id)).flatMap(c=>{
  const products=PLUS_ITEMS.filter(item=>item.collectionId===c.id&&item.purchaseOfferId);
  return [
    ...products.map(item=>Object.freeze({id:item.purchaseOfferId,label:item.label,collectionId:c.id,itemIds:Object.freeze([item.id]),ownership:'permanent',kind:'item',availableFrom:0})),
    Object.freeze({id:`${c.id}.bundle.permanent`,label:`طقم ${c.label}`,collectionId:c.id,itemIds:Object.freeze(products.map(item=>item.id)),ownership:'permanent',kind:'bundle',availableFrom:0}),
  ];
}));
export const PLUS_OFFERS = COSMETIC_OFFERS;
export function getCosmeticOffer(id,{now=Date.now()}={}) { return COSMETIC_OFFERS.find(offer=>offer.id===id&&offer.availableFrom<=now)||null; }
// Exact published months only. Missing art/months remain pending; never silently
// re-grant an older reward or promise an indefinitely populated calendar.
export const MONTHLY_COSMETIC_DROPS = Object.freeze([
  {id:'keepsake-2026-11',monthKey:'2026-11',itemId:'sahra.frame',availableFrom:Date.UTC(2026,10,1),availableUntil:Date.UTC(2026,11,1)},
  {id:'keepsake-2026-12',monthKey:'2026-12',itemId:'artist.frame',availableFrom:Date.UTC(2026,11,1),availableUntil:Date.UTC(2027,0,1)},
  {id:'keepsake-2027-01',monthKey:'2027-01',itemId:'noir.frame',availableFrom:Date.UTC(2027,0,1),availableUntil:Date.UTC(2027,1,1)},
].map(Object.freeze));
const byId = new Map(PLUS_ITEMS.map(item => [item.id, item]));
export function getCosmetic(id, { kind, now = Date.now() } = {}) {
  const item = byId.get(id);
  return item && (!kind || item.kind === kind) && item.availableFrom <= now ? item : null;
}
export function availableCollections(now = Date.now()) { return PLUS_COLLECTIONS.filter(c => c.availableFrom <= now); }
export function availableItems(now = Date.now()) { return PLUS_ITEMS.filter(item => item.availableFrom <= now); }
export function availableSubscriptionItems(now = Date.now()) { return availableItems(now).filter(item => subscriptionIncludesKind(item.kind)); }
export const EMPTY_COSMETICS = Object.freeze({ frameId: null, avatarId: null, coverId: null, nameColorId: null, roomThemeId: null, entranceId:null, profileSkinId:null, councilSkinId:null, badge: false });
