import React, { useEffect, useState } from 'react';
import { Screen, TopBar, Button, Modal } from '../../shared/ui/components.jsx';
import { getDirection, navigate } from '../router.js';
import { useAccount } from '../../shared/account/context.js';
import { request as publicRequest, resolveAccountServer } from '../../shared/account/api.js';
import { useProfiles } from '../../profiles/ProfileProvider.jsx';
import { ProfileAvatar } from '../../profiles/ProfileAvatar.jsx';
import { PLUS_CATALOG_VERSION, availableCollections, availableItems, getCosmetic } from '../../plus/catalog.js';
import { usePlusResource, plusError } from '../../plus/usePlusAccount.js';
import { SubscriptionTransition } from '../../plus/SubscriptionTransition.jsx';
import css from '../../plus/plus.css';

const SLOTS = { frame: 'frameId', avatar: 'avatarId', cover: 'coverId', nameColor: 'nameColorId', roomTheme: 'roomThemeId' };
const LABELS = { frame: 'إطار الصورة', avatar: 'الصورة المتحركة', cover: 'غلاف البروفايل', nameColor: 'لون الاسم', roomTheme: 'ستايل المجلس' };
const EMPTY_SELECTION = Object.freeze({ frameId: null, avatarId: null, coverId: null, nameColorId: null, roomThemeId: null, badge: false });

export function Store() {
  const account = useAccount();
  return <StoreAccount key={`${resolveAccountServer()}:${account.user?.id || 'guest'}`} />;
}

function StoreAccount() {
  const resource = usePlusResource('/api/me/cosmetics');
  const { account, owner, data, loading, request, reload } = resource;
  const profiles = useProfiles();
  const [catalogTime, setCatalogTime] = useState(Date.now());
  const [catalogOffline, setCatalogOffline] = useState(false);
  const [previewId, setPreviewId] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [savedError, setSavedError] = useState(false);
  useEffect(() => {
    let current = true;
    publicRequest('/api/cosmetics/catalog').then(result => {
      if (!current) return;
      if (result.version === PLUS_CATALOG_VERSION && Number.isFinite(result.serverTime)) setCatalogTime(result.serverTime);
      else setCatalogOffline(true);
    }).catch(() => { if (current) setCatalogOffline(true); });
    return () => { current = false; };
  }, []);
  const collections = availableCollections(data?.serverTime || catalogTime);
  const items = availableItems(data?.serverTime || catalogTime);
  const selected = { ...EMPTY_SELECTION, ...data?.preferred };
  const effective = { ...EMPTY_SELECTION, ...data?.effective };
  const plus = data?.plusActive ?? account.premium;
  const currentProfile = profiles?.mine || account.user || { name: 'لاعب ميدان', avatarPreset: 'spark' };
  const preview = collections.find(collection => collection.id === previewId);
  const previewItems = preview ? items.filter(item => item.collectionId === preview.id) : [];
  const previewSelection = { ...effective, ...Object.fromEntries(previewItems.filter(item => SLOTS[item.kind]).map(item => [SLOTS[item.kind], item.id])), badge: true };
  const previewNameColor = getCosmetic(previewSelection.nameColorId, { kind: 'nameColor' });
  const save = async (patch, action = 'save') => {
    if (busy || !owner || !data || loading) return;
    setBusy(action); setNotice(''); setSavedError(false);
    try {
      await request('/api/me/cosmetics', { method: 'PATCH', body: { selection: patch, revision: data.revision } });
      if (!await reload()) return;
      await Promise.allSettled([profiles?.loadProfile(), account.refresh()]);
      setNotice('حُفظ مظهرك على حسابك. ستراه على أجهزتك أيضًا.');
    } catch (error) {
      if (error.code === 'STALE_ACCOUNT') return;
      setNotice(plusError(error)); setSavedError(true);
      if (error.code === 'PLUS_REQUIRED') account.openPaywall({ reason: 'cosmetics' });
      if (error.code === 'CONFLICT') await reload();
    } finally { setBusy(''); }
  };
  const equip = item => {
    if (!owner) { navigate('/settings'); return; }
    if (!plus) { account.openPaywall({ reason: 'cosmetics' }); return; }
    save({ [SLOTS[item.kind]]: item.id }, item.id);
  };
  const equipCollection = collection => {
    if (!owner) { navigate('/settings'); return; }
    if (!plus) { account.openPaywall({ reason: 'cosmetics' }); return; }
    save(Object.fromEntries(items.filter(item => item.collectionId === collection.id && SLOTS[item.kind]).map(item => [SLOTS[item.kind], item.id])), collection.id);
  };
  return <Screen data-design-screen="store" dir={getDirection()} className="stack store-screen plus-store" aria-label="متجر ميدان بلس">
    <style>{css}</style>
    <TopBar data-design-id="topbar" title="المتجر" eyebrow="اللعب للجميع… واللمسة إلك" />
    <section data-design-id="store-empty" className="plus-store-intro">
      <span className="plus-eyebrow">ميدان بلس · بصمتك في اللّمّة</span>
      <h1>خلّي حضورك يشبهك</h1>
      <p>أطقم أصلية لبروفايلك، مجلسك وتعبيراتك. جرّب شكلها هون قبل ما تختار.</p>
      <div className="plus-free-note">كل الألعاب والفئات والغرف والصوت مجانية. بلس للتخصيص؛ فرص الفوز للجميع متساوية.</div>
    </section>
    <SubscriptionTransition />
    {catalogOffline && <p role="status" className="plus-expired-note">نعرض الكتالوج المحفوظ حاليًا. يلزم الاتصال لحفظ اختيارك.</p>}
    {owner && loading && <p role="status">جارٍ تحميل اختياراتك…</p>}
    {resource.error && <div role="alert" className="online-notice error"><p>{plusError(resource.error)}</p><Button data-design-id="plus-retry" onClick={reload}>إعادة التحميل</Button></div>}
    {owner && data && !plus && Object.values(selected).some(Boolean) && <p className="plus-expired-note">اختيارات بلس محفوظة لك. مظهرك المجاني هو الظاهر حتى يعود الاستحقاق.</p>}
    <div data-design-id="collections" className="plus-collection-grid">{collections.map(collection => {
      const groupItems = items.filter(item => item.collectionId === collection.id);
      const cover = groupItems.find(item => item.kind === 'cover');
      const isEquipped = groupItems.some(item => SLOTS[item.kind] && effective[SLOTS[item.kind]] === item.id);
      return <article key={collection.id} data-design-id="collection" className="plus-collection" style={{ '--collection-bg': collection.palette?.bg, '--collection-accent': collection.palette?.accent }}>
        <img data-design-id="artwork" className="plus-collection-cover" src={collection.coverUrl || cover?.assetUrl} alt={`طقم ${collection.label}`} loading="lazy" decoding="async" />
        <div className="plus-collection-content"><div><span className="plus-pill">{isEquipped ? 'من مظهرك الحالي' : 'ضمن بلس'}</span></div><h2>{collection.label}</h2><p>{collection.description || 'لمسة أصلية من ميدان تكمل حضورك.'}</p>
          <div className="plus-collection-stickers" aria-label={`ملصقات ${collection.label}`}>{groupItems.filter(item => item.kind === 'sticker').slice(0, 3).map(item => <div className="plus-sticker-sample" key={item.id}><img src={item.assetUrl} alt="" loading="lazy" decoding="async" /><small>{item.label}</small></div>)}</div>
          <div className="plus-card-actions"><Button data-design-id="collection-preview" onClick={() => setPreviewId(collection.id)}>جرّب المظهر</Button><Button data-design-id="collection-use" variant="primary" disabled={!!busy || (!!owner && (loading || !!resource.error))} loading={busy === collection.id} onClick={() => equipCollection(collection)}>{!owner ? 'دخول واستخدام' : plus ? 'استخدم الطقم' : 'اكتشف بلس'}</Button></div>
        </div>
      </article>;
    })}</div>
    <section className="card stack"><h2 className="card-title">مكتبة تتجدد كل شهر</h2><p>إطار وغلاف وستة ملصقات جديدة شهريًا. كل المجموعات المتاحة ضمن اشتراكك؛ دون عملات أو صناديق عشوائية.</p><p className="plus-preview-note">استخدام عناصر بلس أثناء الاستحقاق فقط. نحفظ اختياراتك عند انتهائه، وتبقى رسائلك ومبارياتك كما هي.</p>{!plus && <Button data-design-id="plus-details" variant="primary" onClick={() => account.openPaywall({ reason: 'cosmetics' })}>مزايا وأسعار ميدان بلس</Button>}</section>
    {owner && data && <section className="card stack" aria-label="خيارات مظهري"><h2 className="card-title">مظهري</h2><label className="plus-store-check"><input type="checkbox" checked={selected.badge === true} disabled={!!busy || (!plus && !selected.badge)} onChange={event => save({ badge: event.target.checked }, 'badge')} />إظهار شارة بلس بجانب اسمي</label><Button variant="ghost" disabled={!!busy} onClick={() => save(EMPTY_SELECTION, 'clear')}>العودة لمظهري المجاني</Button><p className="plus-preview-note">صورك وأغلفتك وثيماتك المجانية تبقى محفوظة ويمكن تعديلها من البروفايل.</p></section>}
    {notice && <p role={savedError ? 'alert' : 'status'} className={'online-notice' + (savedError ? ' error' : '')}>{notice}</p>}
    {preview && <Modal title={preview.label} onClose={() => setPreviewId(null)} className="plus-preview-dialog"><div className="plus-preview" style={{ '--collection-bg': preview.palette?.bg, '--collection-accent': preview.palette?.accent, '--collection-text': preview.palette?.text }}>
      {notice && <p role={savedError ? 'alert' : 'status'}>{notice}</p>}
      <p className="plus-preview-note">معاينة فقط. مظهرك الحقيقي لا يتغيّر حتى تضغط «استخدام».</p>
      <div className="plus-preview-cover"><img src={preview.coverUrl || previewItems.find(item => item.kind === 'cover')?.assetUrl} alt="معاينة غلاف البروفايل" /></div>
      <div className="plus-preview-identity"><ProfileAvatar user={{ ...currentProfile, cosmetics: previewSelection }} size={76} /><div><strong style={{ color: previewNameColor?.color }}>{currentProfile.name || 'لاعب ميدان'}</strong><div><span className="plus-badge">✦ بلس</span></div></div></div>
      {previewItems.some(item => item.kind === 'roomTheme') && <div className="plus-room-preview"><strong>مجلس {preview.label}</strong><p>المضيف يختار الستايل، وكل الموجودين يستمتعون به.</p><div className="plus-room-preview-players"><span>أنت · جاهز</span><span>صديقك · جاهز</span></div></div>}
      {previewItems.filter(item => SLOTS[item.kind]).map(item => <div className="plus-preview-category" key={item.id}><span>{LABELS[item.kind]}</span><Button size="sm" disabled={!!busy || (!!owner && (loading || !!resource.error))} onClick={() => equip(item)}>{effective[SLOTS[item.kind]] === item.id ? 'مستخدم الآن' : plus ? 'استخدام' : 'مع بلس'}</Button></div>)}
      <div className="plus-collection-stickers" aria-label="ملصقات المجموعة">{previewItems.filter(item => item.kind === 'sticker').map(item => <div className="plus-sticker-sample" key={item.id}><img src={item.assetUrl} alt={item.label} /><small>{item.label}</small></div>)}</div>
      <Button variant="primary" full disabled={!!busy || (!!owner && (loading || !!resource.error))} onClick={() => equipCollection(preview)}>{plus ? 'استخدم الطقم كاملًا' : 'اكتشف ميدان بلس'}</Button>
    </div></Modal>}
  </Screen>;
}
