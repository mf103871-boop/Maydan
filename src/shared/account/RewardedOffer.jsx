import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Card } from '../ui/components.jsx';
import { useLamma } from '../../social/LammaProvider.jsx';
import { useAccount } from './context.js';
import { callNative, isNativeShell, onNativeEvent } from './native.js';
import { request, resolveAccountServer } from './api.js';
import { SignInSheet } from './SignInSheet.jsx';
import { hasRewardedDraft, LOCAL_REWARDED_OFFER, presentRewarded, rewardedConfig, rewardedStatus, rewardedSurfaceSafe, rewardEvent } from './rewarded.js';
import { configuredBuildOrigin, MAFIA_PREVIEW_API_ORIGIN, PRODUCTION_API_ORIGIN } from '../lib/environment.js';

const ACCESS = {
  plus: 'بلس مفعّل. المباراة جاهزة.',
  trial: 'لك مباراة تجريبية كاملة مجانية.',
  ticket: 'تذكرتك مؤكدة وجاهزة لمباراة واحدة.',
  required: 'انتهت التجربة المجانية لهذا التحدّي.',
  busy: 'هناك بداية مباراة قيد التحقق. ارجع إلى المباراة نفسها أو تحقّق مجددًا.',
};
const feedback = {
  pending: 'جارٍ تأكيد التذكرة من الخادم… يمكنك التحقّق مجددًا دون مشاهدة إعلان آخر.',
  skipped: 'أُغلق الإعلان قبل اكتماله. لا توجد تذكرة جديدة.',
  unavailable: 'لا يوجد إعلان متاح الآن. يمكنك متابعة اللعب المجاني.',
  noAds: 'الإعلانات غير متاحة لهذه التجربة. يمكنك متابعة اللعب المجاني.',
  blocked: 'تعذّر العرض في هذه اللحظة. ارجع إلى شاشة الاختيار وحاول عند انتهاء الاتصال أو الانتقال.',
  'privacy-required': 'راجع خيارات الخصوصية قبل طلب إعلان.',
  busy: 'هناك محاولة قيد التحقق. تحقّق من التذكرة قبل الطلب مرة أخرى.',
  error: 'تعذّر الاتصال. تحقّق من التذكرة قبل بدء محاولة أخرى.',
};
const readyAccess = new Set(['plus', 'trial', 'ticket']);
const unshownStates = new Set(['unavailable', 'blocked', 'privacy-required', 'busy']);

export function RewardedPrivacySettings() {
  const [required, setRequired] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    let active = true;
    const update = status => { if (active) setRequired(status?.privacyOptionsRequired === true); };
    void callNative('rewardedStatus').then(update).catch(() => {});
    const stop = onNativeEvent('rewardedStatusChanged', update);
    return () => { active = false; stop(); };
  }, []);
  if (!required) return null;
  async function open() {
    setNote('');
    try {
      const result = await callNative('rewardedPrivacyOptions');
      if (result?.state === 'shown') return;
    } catch { /* The user can retry after the competing native surface closes. */ }
    setNote('تعذّر فتح خيارات خصوصية الإعلانات الآن. حاول مرة أخرى.');
  }
  return <><Button onClick={open}>خيارات خصوصية الإعلانات</Button>{note && <p role="status">{note}</p>}</>;
}

export function RewardedEntry(props) {
  const { signedIn, user, requestAuthenticated } = useAccount();
  const hostedPreview = configuredBuildOrigin() === MAFIA_PREVIEW_API_ORIGIN;
  const owner = signedIn ? user?.id : null;
  const scope = hostedPreview ? owner : 'public';
  const [visibleScope, setVisibleScope] = useState(null);
  useEffect(() => {
    if (!scope) return undefined;
    let mounted = true;
    const readConfig = hostedPreview ? requestAuthenticated('/api/rewarded/config') : rewardedConfig();
    readConfig.then(config => {
      if (mounted && config.offers?.some(offer => offer.id === props.offer)) setVisibleScope(scope);
    }).catch(() => { if (mounted) setVisibleScope(null); });
    return () => { mounted = false; };
  }, [props.offer, scope, hostedPreview, requestAuthenticated]);
  return scope && visibleScope === scope ? <RewardedOffer {...props} /> : null;
}

export function RewardedOffer({ offer, surface = 'selection', onReady, onFree, onBusy, onAccess, canPresent }) {
  const account = useAccount();
  return <Offer key={account.user?.id || 'guest'} {...{ account, offer, surface, onReady, onFree, onBusy, onAccess, canPresent }} />;
}

function Offer({ account, offer, surface, onReady, onFree, onBusy, onAccess, canPresent }) {
  const local = offer === LOCAL_REWARDED_OFFER;
  const native = isNativeShell();
  const lamma = useLamma();
  const owner = account.signedIn ? account.user?.id : null;
  const [status, setStatus] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const [nativeStatus, setNativeStatus] = useState(null);
  const marker = useRef(null);
  const lifetime = useRef(false);
  const action = useRef(false);
  const current = useRef(null);
  current.current = { owner, account, canPresent, unsafe: Boolean(lamma?.activeCall || lamma?.incomingCall || lamma?.callConnecting) };

  const refresh = useCallback(async () => {
    if (!owner || current.current.owner !== owner) return null;
    const next = await rewardedStatus(current.current.account, offer);
    if (!lifetime.current || current.current.owner !== owner) return null;
    setStatus(next);
    onAccess?.(next.access);
    if (readyAccess.has(next.access)) setNote('');
    else if (next.attempt === 'pending') setNote('pending');
    return next;
  }, [offer, owner, onAccess]);
  useLayoutEffect(() => {
    lifetime.current = true;
    return () => { lifetime.current = false; onBusy?.(false); };
  }, [onBusy]);
  useEffect(() => {
    rewardEvent(offer, 'offer');
    if (owner) refresh().catch(() => { if (lifetime.current) setNote('error'); });
  }, [offer, owner, refresh]);
  useEffect(() => {
    if (!native) return undefined;
    const read = () => callNative('rewardedStatus').then(value => {
      if (lifetime.current) setNativeStatus(value);
    }).catch(() => {});
    read();
    const stopStatus = onNativeEvent('rewardedStatusChanged', setNativeStatus);
    const stopImpression = onNativeEvent('rewardedImpression', () => { if (action.current) rewardEvent(offer, 'impression'); });
    return () => { stopStatus(); stopImpression(); };
  }, [native, offer]);
  useEffect(() => {
    if (note !== 'pending' || !owner) return undefined;
    let count = 0, cancelled = false, timer;
    async function poll() {
      try {
        const next = await refresh();
        if (next?.attempt !== 'pending' && !readyAccess.has(next?.access) && !cancelled) {
          setNote('unavailable'); return;
        }
        if (readyAccess.has(next?.access)) return;
      } catch { /* Keep an uncertain reward recoverable with the same attempt. */ }
      if (!cancelled && ++count < 12) timer = setTimeout(poll, 1400);
    }
    timer = setTimeout(poll, 900);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [note, owner, refresh]);

  async function watch() {
    if (action.current || !owner || !lifetime.current) return;
    const stillHere = () => lifetime.current && current.current.owner === owner;
    const safe = () => stillHere() &&
      !current.current.unsafe && (current.current.canPresent?.() ?? true) && rewardedSurfaceSafe(surface);
    if (!safe()) { setNote('blocked'); return; }
    action.current = true;
    setBusy(true); onBusy?.(true); setNote('');
    rewardEvent(offer, 'accept');
    let element;
    try {
      const latest = await refresh();
      if (!latest || latest.access !== 'required' || latest.attempt === 'pending' || !latest.adsAvailable) return;
      if (!safe()) { setNote('blocked'); return; }
      // Cleanup may outlive this screen. Use the exact issuing credential and
      // host so a late cancellation can never adopt another account's session.
      const issuingAccount = current.current.account;
      const authorization = issuingAccount.authHeaders?.().Authorization || '';
      const token = /^Bearer (.+)$/.exec(authorization)?.[1];
      const server = resolveAccountServer();
      const attempt = await issuingAccount.requestAuthenticated('/api/rewarded/attempt', { method: 'POST', body: { offer } });
      let result = { state: 'blocked', presented: false };
      if (safe() && (element = marker.current)) {
        element.dataset.maydanRewardedActive = '';
        element.dataset.attempt = attempt.customData;
        element.dataset.surface = surface;
        result = await presentRewarded(attempt);
      }
      const definitelyUnshown = result.presented === false && unshownStates.has(result.state);
      if (token && server && (definitelyUnshown || (stillHere() && result.state === 'skipped'))) {
        await request(`/api/rewarded/attempt/${encodeURIComponent(attempt.attemptId)}/cancel`,
          { method: 'POST', token, server }).catch(() => {});
      }
      if (!stillHere()) return;
      if (result.state === 'unavailable') rewardEvent(offer, 'no-fill');
      setNote(result.state);
      await refresh();
    } catch {
      if (lifetime.current && current.current.owner === owner) {
        setNote('error');
        await refresh().catch(() => {});
      }
    } finally {
      if (element) {
        delete element.dataset.maydanRewardedActive;
        delete element.dataset.attempt;
        delete element.dataset.surface;
      }
      action.current = false;
      if (lifetime.current) { setBusy(false); onBusy?.(false); }
    }
  }
  async function refreshManually() {
    try { setNote(''); await refresh(); }
    catch { if (lifetime.current) setNote('error'); }
  }
  const saved = local && hasRewardedDraft(owner);
  const mayWatch = status?.group === 'B' && status.adsAvailable && status.access === 'required' &&
    status.attempt !== 'pending' && (!native || nativeStatus?.available !== false);
  const unavailable = status?.access === 'required' && status.group === 'B' && (!status.adsAvailable || nativeStatus?.available === false);
  return <Card className="stack" style={{ padding: 16 }} role="region" aria-label="تحدّي اللمّة التجريبي">
    <header><small>{configuredBuildOrigin() === PRODUCTION_API_ORIGIN ? 'تحدّي اللمّة' : 'معاينة اختبار · تحدّي اللمّة'}</small><h2 className="card-title">{local ? 'بديهة · ست حزم مختارة' : 'مين فينا · غرفة تجريبية خاصة'}</h2></header>
    <p className="card-muted">{local ? 'مباراة بديهة كاملة على جهاز واحد.' : 'المضيف فقط يحتاج أهلية البدء. الضيوف يدخلون بالدعوة مجانًا.'}</p>
    <p role="status" aria-live="polite">{busy ? 'جارٍ تجهيز الإعلان…' : feedback[note] || (unavailable ? feedback.noAds : status ? ACCESS[status.access] : owner ? 'جارٍ التحقق من الأهلية…' : 'سجّل الدخول لحفظ التجربة أو التذكرة على حسابك.')}</p>
    {!owner && <Button size="lg" onClick={() => setSignIn(true)}>تسجيل الدخول للتجربة</Button>}
    {owner && onReady && (!local || saved || readyAccess.has(status?.access)) && <Button size="lg" variant="accent" disabled={busy} onClick={onReady}>{saved ? 'استأنف مباراة بديهة التجريبية' : local ? 'إلى إعداد المباراة التجريبية' : 'إلى إعداد الغرفة التجريبية'}</Button>}
    <div ref={marker}>{mayWatch && <Button size="lg" full variant="accent" disabled={busy} onClick={watch}>شاهد إعلان والعب مباراة كاملة</Button>}</div>
    {owner && !readyAccess.has(status?.access) && <Button size="lg" variant="ghost" disabled={busy} onClick={refreshManually}>تحقّق من تذكرتي</Button>}
    {!account.premium && <Button size="lg" disabled={busy} onClick={() => account.openPaywall({ reason: 'cosmetics' })}>العب فورًا مع بلس</Button>}
    {nativeStatus?.privacyOptionsRequired && <Button size="lg" disabled={busy} onClick={() => { void callNative('rewardedPrivacyOptions').catch(() => setNote('privacy-required')); }}>خيارات خصوصية الإعلانات</Button>}
    {native && <Button size="lg" variant="ghost" disabled={busy} onClick={() => { void callNative('rewardedReport').then(result => { if (result?.state !== 'shown') setNote('unavailable'); }).catch(() => setNote('unavailable')); }}>الإبلاغ عن آخر إعلان</Button>}
    <Button size="lg" variant="ghost" disabled={busy} onClick={onFree}>ارجع للمحتوى المجاني</Button>
    <SignInSheet open={signIn} onClose={() => setSignIn(false)} note="الحساب مطلوب للتجربة وتذكرة الإعلان. اللعب العادي متاح مجانًا." />
  </Card>;
}
