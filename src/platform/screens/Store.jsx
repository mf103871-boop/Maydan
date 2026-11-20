import { tr } from '../../shared/i18n/core.js';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Screen, TopBar, Button, Modal, IconButton } from '../../shared/ui/components.jsx';
import { IconBack } from '../../shared/ui/icons.jsx';
import { back, getDirection, navigate, useRoute } from '../router.js';
import { useAccount } from '../../shared/account/context.js';
import { request as publicRequest, resolveAccountServer } from '../../shared/account/api.js';
import { useProfiles } from '../../profiles/ProfileProvider.jsx';
import { PLUS_CATALOG_VERSION, availableItems, availableSubscriptionItems, getCosmetic, EMPTY_COSMETICS, subscriptionIncludesKind } from '../../plus/catalog.js';
import { usePlusResource, plusError } from '../../plus/usePlusAccount.js';
import { PlusStyles } from '../../plus/PlusStyles.jsx';
import { ProductArtwork, ProductPreview } from '../../plus/ProductPreview.jsx';
import { COSMETIC_SLOTS, cosmeticSelection, permanentItemIds } from '../../plus/store-model.js';
import css from '../../plus/store-v2.css?sheet';
import studioCss from '../../plus/store-studio.css?sheet';
import { PresentationStyles } from '../../shared/ui/PresentationStyles.jsx';
import { useAcceptedFeedback } from '../../shared/fx/accepted-feedback.js';
import { ProfileAvatar } from '../../profiles/ProfileAvatar.jsx';
import { getFrameArt } from '../../shared/brand/playful-identity.js';
import plusArt from '../../shared/brand/assets/playful-cosmetics/plus.webp';
import { ticketPolicyEnabled } from '../../shared/account/gameplay-policy.mjs';

const TABS = [['collections', 'تخصيص'], ['membership', 'ميدان بلس']];
const storeTab = value => ['library','membership'].includes(value) ? value : 'collections';
export function Store() {
  const account = useAccount();
  return <StoreAccount key={`${resolveAccountServer()}:${account.user?.id || 'guest'}`}/>;
}
function StoreAccount() {
  const route = useRoute(), cosmetics = usePlusResource('/api/me/cosmetics'), inventory = usePlusResource('/api/me/cosmetics/inventory');
  const { account, owner } = cosmetics, profiles = useProfiles();
  const accepted = useAcceptedFeedback(owner);
  const [tab, setTab] = useState(storeTab(route.params?.tab));
  const [catalogTime, setCatalogTime] = useState(Date.now()), [offline, setOffline] = useState(false);
  const [previewId, setPreviewId] = useState(null), [busy, setBusy] = useState(''), [notice, setNotice] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const busyRef = useRef(false);
  const railRef = useRef(null);
  useEffect(() => { setTab(storeTab(route.params?.tab)); }, [route.params?.tab]);
  useEffect(() => {
    let current = true;
    publicRequest('/api/cosmetics/catalog').then(result => { if (current) { if (result.version === PLUS_CATALOG_VERSION && Number.isFinite(result.serverTime)) setCatalogTime(result.serverTime); else setOffline(true); } }).catch(() => { if (current) setOffline(true); });
    return () => { current = false; };
  }, []);
  const data = inventory.data || cosmetics.data, now = data?.serverTime || catalogTime;
  const items = availableSubscriptionItems(now), preferred = { ...EMPTY_COSMETICS, ...data?.preferred }, effective = { ...EMPTY_COSMETICS, ...data?.effective };
  const plus = data?.plusActive ?? account.premium, owned = permanentItemIds(inventory.data, data?.grants || []);
  const loading = !!owner && (cosmetics.loading || inventory.loading), unavailable = loading || !cosmetics.data || !!cosmetics.error;
  const profile = profiles?.mine?.id && profiles.mine.id === account.user?.id ? profiles.mine : account.user || { name: tr("لاعب ميدان"), avatarPreset: 'spark' };
  const previewUser = { ...profile, cosmetics: effective };
  const canUse = item => plus && subscriptionIncludesKind(item.kind) || !item.membershipOnly && owned.has(item.id);
  const equipped = item => effective[COSMETIC_SLOTS[item.kind]] === item.id;
  const shown = tab === 'library' ? items.filter(item => canUse(item)) : items;
  const basePreview = selectedId === 'base';
  const selected = basePreview ? null : shown.find(item => item.id === selectedId) || shown.find(equipped) || shown[0];
  const previewItemId = selected?.id;
  useLayoutEffect(() => {
    const rail = railRef.current;
    const choice = rail?.querySelector('[aria-pressed="true"]');
    if (!choice) return;
    const { left, right } = rail.getBoundingClientRect();
    const item = choice.getBoundingClientRect();
    // The equipped item can be past the first three cards on a returning
    // visit. Bring it into the rail without moving the page or its focus.
    if (item.left < left) rail.scrollBy(item.left - left - 4, 0);
    else if (item.right > right) rail.scrollBy(item.right - right + 4, 0);
  }, [previewItemId, basePreview, tab]);
  const legacy = availableItems(now).filter(item => owned.has(item.id) && !subscriptionIncludesKind(item.kind));
  const target = items.find(item => item.id === previewId);
  const previewItems = target?.kind === 'profileSkin' ? [target, getCosmetic('plus.signature.frame', { now })].filter(Boolean) : target ? [target] : [];
  const reportError = error => { if (error?.code === 'STALE_ACCOUNT') return; setNotice({ error: true, text: plusError(error) }); if (error?.code === 'CONFLICT') { cosmetics.reload(); inventory.reload(); } };
  const save = async (patch, id) => {
    if (!owner) { navigate('/settings?section=account'); return; }
    if (busyRef.current || unavailable) return;
    const feedback = accepted.begin();
    busyRef.current = true; setBusy(id); setNotice(null);
    try {
      const result = await cosmetics.request('/api/me/cosmetics', { method: 'PATCH', body: { selection: patch, revision: cosmetics.data.revision } });
      if (!feedback.current()) return;
      if (Number.isInteger(result?.revision) && result.revision > cosmetics.data.revision && Object.entries(patch).every(([key,value]) => result.preferred?.[key] === value)) feedback.confirm();
      if (!await cosmetics.reload()) return;
      await inventory.reload(); await Promise.allSettled([profiles?.loadProfile?.(), account.refresh()]);
      if (feedback.current()) setNotice({ text: tr("حُفظ مظهر بروفايلك. صورتك وبقية اختياراتك محفوظة كما هي.") });
    } catch (error) { if (feedback.current()) { feedback.error(error); reportError(error); } }
    finally { busyRef.current = false; if (feedback.current()) setBusy(''); }
  };
  const equip = item => {
    if (!owner) { navigate('/settings?section=account'); return; }
    if (!canUse(item)) { account.openPaywall({ reason: 'cosmetics' }); return; }
    save(cosmeticSelection([item]), item.id);
  };
  const usePair = () => { if (!previewItems.every(canUse)) { account.openPaywall({ reason: 'cosmetics' }); return; } save(cosmeticSelection(previewItems), 'pair'); };
  const switchTab = value => { setTab(value); setPreviewId(null); setNotice(null); navigate(`/store?tab=${value}`); };
  const select = id => { setSelectedId(id); setNotice(null); };
  const selectionOwned = selected && owned.has(selected.id);
  const selectionEquipped = selected ? equipped(selected) : basePreview && !effective.frameId;
  const feedback = notice && <p role={notice.error ? 'alert' : 'status'} className={'store-v2-notice' + (notice.error ? ' error' : '')}>{notice.text}</p>;
  return <Screen data-design-screen="store" dir={getDirection()} className="stack store-screen studio-store" aria-label={tr("متجر ميدان بلس")}>
    <PlusStyles/><PresentationStyles sheet={css}/><PresentationStyles sheet={studioCss}/><TopBar data-design-id="topbar" title={tr("المتجر")} start={<IconButton data-design-id="back" label={tr("رجوع")} onClick={back}><IconBack /></IconButton>} />
    <nav data-design-id="store-navigation" className="studio-store-tabs" role="tablist" aria-label={tr("المتجر")}>{TABS.map(([id,label]) => <button data-design-id={'store-tab-'+id} key={id} type="button" role="tab" aria-selected={tab === id || (tab === 'library' && id === 'collections')} onClick={() => switchTab(id)}>{tr(label)}</button>)}</nav>
    {tab === 'membership' ? <>
      <section data-design-id="store-membership" className="store-membership studio-membership-hero"><img src={plusArt} width="640" height="427" alt="" decoding="async"/><div><strong>{tr("ما هو ميدان بلس؟")}</strong><small>{ticketPolicyEnabled(account.gameplayPolicy) ? tr("ابدأ المباريات دون تذاكر إعلانات، وخصّص بروفايلك وإطار صورتك.") : tr("اشتراك اختياري يضيف مظهرًا لبروفايلك وإطارًا لصورتك.")}</small></div></section>
      <ul className="store-membership-perks"><li><b>{tr("مظهر كامل لبروفايلك")}</b><small>{tr("ألوان وخامات متناسقة لبروفايلك وبطاقاته.")}</small></li><li><b>{tr("إطار ذهبي حول صورتك")}</b><small>{tr("تظل صورتك الشخصية كما اخترتها.")}</small></li><li><b>{ticketPolicyEnabled(account.gameplayPolicy) ? tr("مباريات دون تذاكر إعلانات") : tr("اللعب مجاني للجميع")}</b><small>{ticketPolicyEnabled(account.gameplayPolicy) ? tr("بلس يغطي بدء مبارياتك؛ ضيوف غرفتك يدخلون مجانًا.") : tr("الألعاب والغرف والمحادثات متاحة دون اشتراك.")}</small></li></ul>
      <Button data-design-id="plus-details" variant="accent" full onClick={() => account.openPaywall({ reason: 'cosmetics' })}>{plus ? tr("إدارة بلس") : tr("عرض خيارات الاشتراك")}</Button>
    </> : <>
    <div className="studio-store-filter" role="group" aria-label={tr("تصفح المظهر والإطارات")}>
      <button type="button" data-design-id="collection-preview" aria-pressed={tab !== 'library'} onClick={() => switchTab('collections')}>{tr("كل العناصر")}</button>
      <button type="button" data-design-id="store-tab-library" aria-pressed={tab === 'library'} onClick={() => switchTab('library')}>{tr("مقتنياتي")}</button>
    </div>
    {offline && <p role="status" className="store-product-note">{tr("نعرض المظهر المحفوظ؛ يلزم الاتصال لحفظ اختيارك.")}</p>}
    {loading && <p role="status">{tr("جارٍ تحميل مقتنياتك…")}</p>}
    {(cosmetics.error || inventory.error) && <div role="alert"><p>{plusError(cosmetics.error || inventory.error)}</p><Button data-design-id="plus-retry" onClick={() => { cosmetics.reload(); inventory.reload(); }}>{tr("إعادة التحميل")}</Button></div>}
    {(selected || basePreview) && <section className="studio-store-preview" aria-label={tr("معاينة بروفايلك")}>
      <span className="studio-store-eyebrow">{selected?.kind === 'profileSkin' ? tr("معاينة المظهر") : tr("معاينة الإطار")}</span>
      <div key={selected?.id || 'base'} data-design-id="artwork" className="studio-store-art" data-preview-item={selected?.id || 'base'}>
        {selected ? <ProductArtwork item={selected} user={previewUser} size={148}/> : <ProfileAvatar user={{...previewUser,cosmetics:{...effective,frameId:null}}} size={148}/>}
      </div>
      <h2 className="studio-store-name">{selected ? tr(selected.label) : tr("بدون إطار")}</h2>
      <div className="studio-store-rights" aria-live="polite">
        <span key={`${selected?.id || 'base'}:${Boolean(selectionOwned)}:${Boolean(selectionEquipped)}`} className={'studio-store-status' + (selectionOwned ? ' owned' : '') + (selectionEquipped ? ' equipped' : '')}>
          {selectionEquipped ? tr("مجهّز الآن") : selectionOwned ? tr("مملوك دائمًا") : selected ? tr("مع بلس") : tr("التصميم الأساسي")}
        </span>
        {selected && !selectionOwned && <small>{tr("أثناء عضوية بلس")}</small>}
        {selected && selectionOwned && selectionEquipped && <small>{tr("مملوك دائمًا")}</small>}
      </div>
      <Button data-sound="none" data-design-id="item-use" variant="primary" full loading={!!busy && (busy === selected?.id || busy === 'remove-frame')}
        disabled={!!busy || (!!owner && unavailable) || (selected ? equipped(selected) : !preferred.frameId)}
        onClick={() => selected ? equip(selected) : save({frameId:null}, 'remove-frame')}>
        {selected ? selectionEquipped ? tr("مجهّز") : canUse(selected) ? tr("تجهيز") : tr("عرض بلس") : !preferred.frameId ? tr("مجهّز") : effective.frameId ? tr("إزالة الإطار") : tr("إزالة الإطار المحفوظ")}
      </Button>
      <p className="studio-store-preview-note">{basePreview && preferred.frameId && !effective.frameId ? tr("يوجد إطار محفوظ يعود عند توفر استحقاقه. يمكنك إزالته.") : selectionEquipped ? tr("صورتك وبقية اختياراتك محفوظة كما هي.") : selected && !canUse(selected) ? tr("يمكنك معاينة هذا المظهر دون تغيير اختياراتك.") : selected ? tr("المعاينة لا تغيّر مظهرك حتى تختار تجهيز.") : tr("المعاينة لا تغيّر مظهرك حتى تؤكد الاختيار.")}</p>
      <div ref={railRef} data-design-id="collections" className="studio-store-items" aria-label={tr("تصفح المظهر والإطارات")}>
        <button type="button" data-design-id="item-preview" className="studio-store-choice studio-store-base" aria-label={tr("معاينة بدون إطار")} aria-pressed={basePreview} onClick={() => select('base')}>
          <ProfileAvatar user={{...previewUser,cosmetics:{...effective,frameId:null}}} size={52}/><span>{tr("بدون إطار")}</span>
        </button>
        {shown.map(item => <article data-design-id="store-product" data-item-id={item.id} className="studio-store-item" key={item.id}>
          <button type="button" data-design-id="item-preview" className={'studio-store-choice' + (equipped(item) ? ' is-equipped' : '')} aria-label={tr(item.label)} aria-pressed={selected?.id === item.id} onClick={() => select(item.id)}>
            {getFrameArt(item.id) ? <img className="studio-store-frame-option" src={getFrameArt(item.id)} width={60} height={60} alt="" loading="lazy" decoding="async"/> : <ProductArtwork item={item} user={previewUser} size={52}/>}<span>{tr(item.label)}</span>
            {(equipped(item) || owned.has(item.id)) && <small className={owned.has(item.id) ? 'owned' : ''}>{equipped(item) ? tr("مجهّز") : tr("مملوك")}</small>}
          </button>
        </article>)}
      </div>
      <div className="studio-store-links">
        {owner && (selected?.kind === 'frame' && selectionEquipped ? <Button data-design-id="frame-remove" data-sound="none" variant="ghost" disabled={!!busy || unavailable} onClick={() => save({frameId:null}, 'remove-frame')}>{tr("إزالة الإطار")}</Button> : <Button data-design-id="profile" variant="ghost" onClick={() => navigate('/profile')}>{tr("عرض البروفايل")}</Button>)}
        {selected && <Button data-design-id="item-preview" variant="ghost" onClick={() => setPreviewId(selected.id)}>{tr("مقارنة المظهر")}</Button>}
      </div>
      {feedback}
    </section>}
    {!shown.length && !basePreview && <div className="store-empty"><p>{tr("إطاراتك ومظهر بروفايلك المملوك تظهر هنا.")}</p></div>}
    {owner && <section className="store-membership-options"><h2>{tr("مظهري الأساسي")}</h2><p>{tr("إزالة تخصيص البروفايل والإطار لا تمس الصورة الشخصية أو مقتنياتك السابقة.")}</p><Button data-sound="none" data-design-id="store-reset" variant="ghost" disabled={!!busy || unavailable || (!preferred.frameId && !preferred.profileSkinId)} onClick={() => save({ profileSkinId: null, frameId: null }, 'reset')}>{tr("التصميم الأساسي بدون إطار")}</Button></section>}
    {tab === 'library' && legacy.length > 0 && <details data-design-id="earned-cosmetics" className="store-membership-options"><summary data-design-id="store-legacy-toggle">{tr("مقتنيات سابقة محفوظة")}</summary><p>{tr("هذه تراخيصك السابقة؛ لم تُحذف عند تبسيط ميدان بلس.")}</p><ul>{legacy.map(item => <li key={item.id}>{tr(item.label)}{tr(" · ملك دائم محفوظ")}</li>)}</ul></details>}
    {!selected && !basePreview && feedback}
    </>}
    {target && <Modal data-design-screen="store.preview" title={tr(target.label)} className="store-v2-dialog" onClose={() => setPreviewId(null)}><PlusStyles/><PresentationStyles sheet={css}/><div data-design-id="store-detail-actions" className="store-detail"><ProductPreview user={previewUser} items={previewItems}/>{previewItems.map(item => <div className="plus-preview-category" key={item.id}><span>{item.kind === 'profileSkin' ? tr("شكل البروفايل") : tr("إطار الصورة")}<small>{owned.has(item.id) ? tr(" · ملك دائم") : tr(" · أثناء عضوية بلس")}</small></span><Button data-sound="none" data-design-id="item-use" disabled={!!busy || (!!owner && unavailable) || equipped(item)} onClick={() => equip(item)}>{equipped(item) ? tr("مستخدم الآن") : canUse(item) ? tr("استخدام") : tr("مع بلس")}</Button></div>)}{target.kind === 'profileSkin' && <Button data-sound="none" data-design-id="collection-use" variant="primary" disabled={!!busy || (!!owner && unavailable)} onClick={usePair}>{previewItems.every(canUse) ? tr("استخدام البروفايل والإطار معًا") : tr("تفاصيل ميدان بلس")}</Button>}{feedback}</div></Modal>}
  </Screen>;
}
