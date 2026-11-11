import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Card } from '../ui/components.jsx';
import { useLamma } from '../../social/LammaProvider.jsx';
import { useAccount } from './context.js';
import { callNative, isNativeShell, onNativeEvent } from './native.js';
import { request, resolveAccountServer } from './api.js';
import { SignInSheet } from './SignInSheet.jsx';
import { hasRewardedDraft, LOCAL_REWARDED_OFFER, presentRewarded, rewardedConfig, rewardedStatus, rewardedEntryStatus, rewardedSurfaceSafe, rewardEvent } from './rewarded.js';
import { configuredBuildOrigin, MAFIA_PREVIEW_API_ORIGIN, PRODUCTION_API_ORIGIN } from '../lib/environment.js';
import { gameplayOfferById, gameplayEntryOfferById } from './gameplay-policy.mjs';
import { callAndroidRewarded, isAndroidRewardedShell } from './android-rewarded.js';
import entryStyles from './rewarded-entry.css';
import ticketArtwork from '../../../assets/game-entry/manifest.json' with { type: 'json' };

const rewardNative = (type, payload, options) => isAndroidRewardedShell()
  ? callAndroidRewarded(type, payload, options) : callNative(type, payload, options);

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
const entryFeedback = {
  pending: 'جارٍ تأكيد التذكرة من الخادم… تحقّق منها قبل طلب إعلان آخر. لا تُستهلك عند اختيار نمط اللعب.',
  skipped: 'أُغلق الإعلان قبل اكتماله، ولم تُمنح تذكرة. يمكنك المحاولة لاحقًا أو استخدام بلس.',
  unavailable: 'لا يوجد إعلان متاح الآن. جرّب لاحقًا أو استخدم بلس أو ارجع إلى الألعاب؛ لم تُستهلك تذكرة.',
  noAds: 'الإعلانات غير متاحة الآن. جرّب لاحقًا أو استخدم بلس؛ لم تُستهلك تذكرة.',
  blocked: 'تعذّر عرض الإعلان أثناء الاتصال أو الانتقال. أغلق الشاشة الأخرى ثم حاول مجددًا.',
  'privacy-required': 'راجع خيارات الخصوصية قبل طلب إعلان.',
  busy: 'هناك محاولة قيد التحقق. تحقّق من التذكرة قبل طلب إعلان آخر.',
  error: 'تعذّر التحقّق. راجع اتصالك وتحقّق من التذكرة قبل طلب إعلان جديد.',
};
const readyAccess = new Set(['plus', 'trial', 'ticket']);
const unshownStates = new Set(['unavailable', 'blocked', 'privacy-required', 'busy']);

export function RewardedPrivacySettings() {
  const [required, setRequired] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    let active = true;
    const update = status => { if (active) setRequired(status?.privacyOptionsRequired === true); };
    void rewardNative('rewardedStatus').then(update).catch(() => {});
    const stop = onNativeEvent('rewardedStatusChanged', update);
    return () => { active = false; stop(); };
  }, []);
  if (!required) return null;
  async function open() {
    setNote('');
    try {
      const result = await rewardNative('rewardedPrivacyOptions');
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

export function RewardedOffer({ offer, surface = 'selection', onReady, onFree, onBusy, onAccess, canPresent, requiredMode }) {
  const account = useAccount();
  return <Offer key={account.user?.id || 'guest'} {...{ account, offer, surface, onReady, onFree, onBusy, onAccess, canPresent, requiredMode }} />;
}

function Offer({ account, offer, surface, onReady, onFree, onBusy, onAccess, canPresent, requiredMode }) {
  const entry = gameplayEntryOfferById(offer);
  const gameplay = entry || gameplayOfferById(offer);
  const local = gameplay ? gameplay.mode === 'local' : offer === LOCAL_REWARDED_OFFER;
  const android = isAndroidRewardedShell();
  const native = isNativeShell() || android;
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
  const statusRead = useRef(0);
  const abort = useRef(null);
  const current = useRef(null);
  current.current = { owner, account, canPresent, unsafe: Boolean(lamma?.activeCall || lamma?.incomingCall || lamma?.callConnecting) };

  const refresh = useCallback(async () => {
    if (!owner || current.current.owner !== owner) return null;
    const read = ++statusRead.current;
    let next;
    try { next = entry ? await rewardedEntryStatus(current.current.account, entry.game) : await rewardedStatus(current.current.account, offer); }
    catch (error) {
      if (!lifetime.current || current.current.owner !== owner || read !== statusRead.current) return null;
      throw error;
    }
    if (!lifetime.current || current.current.owner !== owner || read !== statusRead.current) return null;
    const access = entry && requiredMode ? next.modeAccess?.[requiredMode] || 'required' : next.access;
    setStatus(next);
    onAccess?.(access, next);
    if (readyAccess.has(access)) setNote('');
    else if (next.attempt === 'pending') setNote('pending');
    return { ...next, access };
  }, [offer, owner, onAccess, entry, requiredMode]);
  useLayoutEffect(() => {
    const reads = statusRead;
    lifetime.current = true;
    return () => { lifetime.current = false; reads.current++; abort.current?.abort(); onBusy?.(false); };
  }, [onBusy]);
  useEffect(() => {
    rewardEvent(offer, 'offer');
    if (owner) refresh().catch(() => { if (lifetime.current) setNote('error'); });
  }, [offer, owner, refresh]);
  useEffect(() => {
    if (!native) return undefined;
    const read = () => rewardNative('rewardedStatus').then(value => {
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
        if (next && next.attempt !== 'pending' && !readyAccess.has(next.access) && !cancelled) {
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
    abort.current = new AbortController();
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
      const attempt = await issuingAccount.requestAuthenticated('/api/rewarded/attempt', { method: 'POST', body: { offer }, gameplayCapability: 2 });
      let result = { state: 'blocked', presented: false };
      if (safe() && (element = marker.current)) {
        element.dataset.maydanRewardedActive = '';
        element.dataset.attempt = attempt.customData;
        element.dataset.surface = surface;
        result = await presentRewarded(attempt, { isCurrent: stillHere, signal: abort.current.signal });
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
      abort.current = null;
      if (lifetime.current) { setBusy(false); onBusy?.(false); }
    }
  }
  async function refreshManually() {
    try { setNote(''); if (native) setNativeStatus(await rewardNative('rewardedStatus')); await refresh(); }
    catch { if (lifetime.current) setNote('error'); }
  }
  const saved = !gameplay && local && hasRewardedDraft(owner);
  const effectiveAccess = entry && requiredMode ? status?.modeAccess?.[requiredMode] || 'required' : status?.access;
  const messages = entry ? entryFeedback : feedback;
  const accessText = entry && effectiveAccess === 'required' ? 'تحتاج تذكرة لبدء مباراة جديدة في هذه اللعبة.' : ACCESS[effectiveAccess];
  const mayWatch = status?.group === 'B' && status.adsAvailable && effectiveAccess === 'required' &&
    status.attempt !== 'pending' && (!native || nativeStatus?.available !== false);
  const unavailable = effectiveAccess === 'required' && status?.group === 'B' && (!status.adsAvailable || nativeStatus?.available === false);
  return <Card className={entry ? 'stack rewarded-entry-card' : 'stack'} style={entry ? undefined : { padding: 16 }} data-maydan-ticket-ui={entry ? 'ticket-clay-v1' : undefined} data-entry-access={effectiveAccess || 'checking'} role="region" aria-label={gameplay ? `بدء مباراة ${gameplay.label}` : 'تحدّي اللمّة التجريبي'}>
    {entry && <style>{entryStyles}</style>}
    {entry ? <header className="rewarded-entry-header">
      <span className="rewarded-entry-kicker">تذكرة ميدان <span aria-hidden="true">✦</span> مباراة كاملة</span>
      <div className="rewarded-entry-art" aria-hidden="true"><img src={ticketArtwork.url} width="300" height="200" alt="" decoding="async" /></div>
      <span className="rewarded-entry-game">{gameplay.label}</span>
      <h2>{effectiveAccess === 'trial' ? 'أول مباراة علينا!' : readyAccess.has(effectiveAccess) ? 'جاهز للّمة؟' : 'تذكرتك إلى اللمّة'}</h2>
      <p>{effectiveAccess === 'trial' ? 'جرّب مباراة كاملة مجانًا، ثم اختر إعلانًا أو بلس للمباريات التالية.' : readyAccess.has(effectiveAccess) ? 'أهليتك مؤكدة. اختر طريقة اللعب واستمتع بمباراتك.' : 'شاهد إعلانًا لتذكرة مباراة، أو ادخل مباشرة مع بلس.'}</p>
      <div className="rewarded-entry-benefits" aria-label="مزايا التذكرة"><span>مباراة كاملة</span><span>بلا فواصل إعلانية</span>{entry.modes.includes('online') && <span>ضيوفك مجانًا</span>}</div>
    </header> : <header><small>{gameplay ? 'مباراة كاملة · إعلان اختياري أو بلس' : configuredBuildOrigin() === PRODUCTION_API_ORIGIN ? 'تحدّي اللمّة' : 'معاينة اختبار · تحدّي اللمّة'}</small><h2 className="card-title">{gameplay ? gameplay.label : local ? 'بديهة · ست حزم مختارة' : 'مين فينا · غرفة تجريبية خاصة'}</h2></header>}
    <p className={entry ? 'card-muted rewarded-entry-explanation' : 'card-muted'}>{entry ? `التذكرة محفوظة حتى تبدأ المباراة.${entry.modes.includes('online') ? ' ضيوف غرفتك يدخلون معك مجانًا.' : ' لا إعلانات بين الأسئلة أو الجولات.'}` : local ? `مباراة ${gameplay?.label || 'بديهة'} كاملة على جهاز واحد.` : 'المضيف فقط يحتاج أهلية البدء. الضيوف يدخلون بالدعوة مجانًا.'}</p>
    {entry && requiredMode && <p className="card-muted">تذكرتك السابقة مخصّصة لنمط آخر. لبدء {requiredMode === 'online' ? 'مباراة أونلاين' : 'مباراة مع العائلة'} اختر تذكرة جديدة أو بلس؛ تذكرتك السابقة محفوظة.</p>}
    <p className={entry ? 'rewarded-entry-status' : undefined} data-state={busy ? 'loading' : note || (unavailable ? 'unavailable' : effectiveAccess || 'checking')} role="status" aria-live="polite">{busy ? 'جارٍ تجهيز الإعلان…' : messages[note] || (unavailable ? messages.noAds : status ? accessText : owner ? 'جارٍ التحقق من الأهلية…' : 'سجّل الدخول لحفظ التجربة أو التذكرة على حسابك.')}</p>
    {!owner && <Button size="lg" onClick={() => setSignIn(true)}>تسجيل الدخول للتجربة</Button>}
    {owner && onReady && (entry ? readyAccess.has(effectiveAccess) : gameplay || !local || saved || readyAccess.has(status?.access)) && <Button size="lg" variant="accent" disabled={busy} onClick={onReady}>{entry ? 'اختر طريقة اللعب' : gameplay ? 'تحقّق وابدأ المباراة' : saved ? 'استأنف مباراة بديهة التجريبية' : local ? 'إلى إعداد المباراة التجريبية' : 'إلى إعداد الغرفة التجريبية'}</Button>}
    <div ref={marker}>{mayWatch && <Button size="lg" full variant="accent" disabled={busy} onClick={watch}>شاهد إعلان والعب مباراة كاملة</Button>}</div>
    {!account.premium && <Button size="lg" disabled={busy} onClick={() => account.openPaywall({ reason: 'cosmetics' })}>العب فورًا مع بلس</Button>}
    {owner && !readyAccess.has(effectiveAccess) && <Button size="lg" variant="ghost" disabled={busy} onClick={refreshManually}>تحقّق من تذكرتي</Button>}
    {nativeStatus?.privacyOptionsRequired && <Button size="lg" disabled={busy} onClick={() => { void rewardNative('rewardedPrivacyOptions').catch(() => setNote('privacy-required')); }}>خيارات خصوصية الإعلانات</Button>}
    {native && !android && <Button size="lg" variant="ghost" disabled={busy} onClick={() => { void callNative('rewardedReport').then(result => { if (result?.state !== 'shown') setNote('unavailable'); }).catch(() => setNote('unavailable')); }}>الإبلاغ عن آخر إعلان</Button>}
    <Button size="lg" variant="ghost" disabled={busy} onClick={onFree}>{entry ? 'ارجع إلى الألعاب' : 'ارجع للمحتوى المجاني'}</Button>
    <SignInSheet open={signIn} onClose={() => setSignIn(false)} note={entry ? 'الحساب يحفظ التجربة والتذاكر. لا تُستهلك إلا عند بدء المباراة، والانضمام إلى غرف الآخرين مجاني.' : gameplay ? 'الحساب يحفظ أهلية المباراة والتذاكر. الانضمام إلى غرف الآخرين والحزم الأساسية في بديهة مجانيان.' : 'الحساب مطلوب للتجربة وتذكرة الإعلان. اللعب العادي متاح مجانًا.'} />
  </Card>;
}
