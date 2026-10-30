import { isMafiaPreview } from '../lib/environment.js';
// مزوّد الحساب: مصدر واحد لحالة الاشتراك والتجارب والجدار في الواجهة كلها.
// الخادم هو مصدر الحقيقة؛ ما هنا نسخة مخزّنة تُحدَّث عند الإقلاع وعند العودة
// للتطبيق وبعد كل دخول أو شراء. بلا خادم مضبوط تعمل الطبقة «دون اتصال»:
// لا اشتراك ولا دخول، والتجارب تُسجَّل محليًا فقط.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountContext } from './context.js';
import { PLUS_NAME, PRODUCTS, TRIAL_GAMES, signInProviders } from './config.js';
import { isPremium, lockedPack as lockedPackOf, trialAvailable as trialAvailableOf, gameAccess as gameAccessOf, mergeTrials, shouldRefresh } from './entitlements.js';
import { accountErrorText } from './errors.js';
import { accountStore, ACCOUNT_PREFIX, KEYS } from './store.js';
import {
  ClientError, accountOffline, authStartUrl, appleNative, createPaddleCheckout, deleteAccountRequest,
  exchangeCode, getBillingConfig, getMe, getPaddlePortal, mergeTrialsRequest, postAppleTransaction, postTrial, redeemRequest, signout, request, resolveAccountServer,
} from './api.js';
import { deliverAppleTransaction, waitForEntitlement } from './purchases.js';
import { callNative, isNativeShell, onNativeEvent } from './native.js';
import { catalogDiagnostics } from './catalog-diagnostics.js';
import { clearPaddleCustomer, loadPaddle, openCheckout, previewPrices, setPaddleCustomer } from './paddle.js';
import { usePlatform } from '../../platform/context.js';
import { getRoute, navigate, useRoute } from '../../platform/router.js';
import { rememberProfileReturn, consumeProfileReturn } from './return-path.js';
import { beginAuthAttempt, currentAuthAttempt, clearAuthAttempt } from './attempt.js';
import { clearDeletedTutorialAccount } from '../../games/mafia/tutorial/progress.js';
import { clearDeletedMafiaLabs } from '../../games/mafia/tutorial/labs/progress.js';

const EMPTY = Object.freeze({});
// بديل ثابت حين لا يوفّر المزوّد تنبيهات: دالة جديدة في كل رسم كانت تعيد بناء كل
// استدعاء وأثر يعتمد على toast في كل رسم.
const NO_TOAST = () => {};
// أوراق النظام (Apple، المتجر) قد تنتظر المستخدم طويلًا: مهلة أطول من مهلة الجسر الافتراضية.
const NATIVE_SHEET_TIMEOUT = 10 * 60_000;
const codeOf = (error) => (error && error.code) || 'NETWORK';
const isAuthError = (code) => code === 'AUTH_EXPIRED' || code === 'AUTH_REQUIRED';
// خادم بلا قاعدة D1 يردّ 404 على مسارات الحسابات كلها: نعامله كغياب الخادم.
const isDisabled = (code) => code === 'NOT_FOUND';

// نتيجة الغلاف قد تصل كمصفوفة أو ككائن يلفّها: كلاهما مقبول.
function listOf(result, key) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result[key])) return result[key];
  return [];
}

export function AccountProvider({ children }) {
  const platformValue = usePlatform();
  const toast = (platformValue && platformValue.toast) || NO_TOAST;
  const route = useRoute();

  const native = useMemo(() => isNativeShell(), []);
  const platform = native ? 'ios' : 'web';
  const [offline, setOffline] = useState(() => accountOffline());

  const [session, setSession] = useState(() => accountStore.readSession());
  const cached = useMemo(() => accountStore.readMe(), []);
  const [me, setMe] = useState(cached.data);
  const [fetchedAt, setFetchedAt] = useState(cached.fetchedAt);
  const [localTrials, setLocalTrials] = useState(() => accountStore.readTrials());
  // منح الهدايا تأتي ضمن me من الخادم، ولا تمنح بيانات الجهاز صلاحيات مستقلة.
  const promo = null; // Legacy device-only gifts no longer grant access; server grants remain valid.
  const [ready, setReady] = useState(() => !native && !(accountStore.readSession() && !cached.data));
  const [products, setProducts] = useState(null);
  const [productsStatus, setProductsStatus] = useState('idle');
  const [productsError, setProductsError] = useState(null);
  const [productsDiagnostics, setProductsDiagnostics] = useState(null);
  const [storeProbeStatus, setStoreProbeStatus] = useState('idle');
  const [storeProbeDiagnostics, setStoreProbeDiagnostics] = useState(null);
  const [restoreDiagnostics, setRestoreDiagnostics] = useState(null);
  const [billing, setBilling] = useState(null);
  const [signInProvidersStatus, setSignInProvidersStatus] = useState('idle');
  const [signInProvidersError, setSignInProvidersError] = useState(null);
  const providerConfigRef = useRef({ pending: null, config: null, fetchedAt: 0, error: null });
  const [paddleIdentity, setPaddleIdentity] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activationPending, setActivationPending] = useState(false);
  const [error, setError] = useState(null);
  const [paywall, setPaywall] = useState({ open: false, reason: 'settings', game: null, pack: null });

  const sessionRef = useRef(session);
  const authEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const busyOwnerRef = useRef(null);
  const meRef = useRef(me);
  meRef.current = me;
  const fetchedRef = useRef(cached.fetchedAt);
  const consumedRef = useRef(new Set());
  const authWaiterRef = useRef(null);
  const productsRef = useRef(false);
  const productsRequestRef = useRef(null);
  const storeProbeRequestRef = useRef(null);
  const storeProbeEpochRef = useRef(0);
  const nativeCatalogRef = useRef({ status: 'idle', products: null });
  const purchaseInFlightRef = useRef(false);

  // ── أدوات داخلية ────────────────────────────────────────────────────────
  const applySession = useCallback((token) => {
    sessionRef.current = token || null;
    accountStore.writeSession(token || null);
    setSession(token || null);
  }, []);

  const applyMe = useCallback((next, epoch = authEpochRef.current) => {
    if (epoch !== authEpochRef.current || !sessionRef.current) return;
    const stamp = Date.now();
    accountStore.writeMe(next, stamp);
    fetchedRef.current = stamp;
    meRef.current = next || null;
    setMe(next || null);
    setFetchedAt(stamp);
    if (!native) {
      const identity = next?.user?.id ? next.paddle || null : null;
      setPaddleCustomer(identity);
      setPaddleIdentity(identity);
    }
  }, [native]);

  const applyTrials = useCallback((serverTrials) => {
    if (!serverTrials) return;
    setMe((prev) => {
      const next = { ...(prev || {}), trials: serverTrials };
      accountStore.writeMe(next, fetchedRef.current || Date.now());
      return next;
    });
  }, []);

  const clearLocalAuth = useCallback(() => {
    authEpochRef.current++;
    busyOwnerRef.current = null;
    setBusy(false); setActivationPending(false); setError(null);
    authWaiterRef.current?.(null, 'PURCHASE_CANCELLED');
    clearAuthAttempt();
    clearPaddleCustomer();
    setPaddleIdentity(null);
    accountStore.clearAuth();
    sessionRef.current = null;
    meRef.current = null;
    fetchedRef.current = 0;
    setSession(null);
    setMe(null);
    setFetchedAt(0);
    if (isNativeShell()) return callNative('socialLogout', {}, { timeout: 5000 }).catch(() => {});
  }, []);

  // خيارات كل نداء: الرمز الحالي + التقاط تدوير الجلسة المنزلق.
  const options = useCallback(() => {
    const token = sessionRef.current;
    const epoch = authEpochRef.current;
    return { token: token || undefined, onSession: (next) => {
      if (epoch === authEpochRef.current && token && token === sessionRef.current) applySession(next);
    } };
  }, [applySession]);

  // An async operation belongs to an identity generation, not whichever token
  // happens to be current when its native sheet/network response returns.
  const captureAuth = useCallback(() => ({ epoch: authEpochRef.current, server: resolveAccountServer(), userId: meRef.current?.user?.id || null }), []);
  const ownsAuth = useCallback(owner => !!owner && mountedRef.current && owner.epoch === authEpochRef.current && owner.server === resolveAccountServer() && (!owner.userId || owner.userId === meRef.current?.user?.id), []);
  const requireAuthOwner = useCallback(owner => { if (!ownsAuth(owner)) throw new ClientError('PURCHASE_CANCELLED'); }, [ownsAuth]);
  const ownedOptions = useCallback(owner => { requireAuthOwner(owner); return { ...options(), server: owner.server }; }, [options, requireAuthOwner]);
  const startBusy = useCallback(value => { const owner = Symbol(value); busyOwnerRef.current = owner; setBusy(value); return owner; }, []);
  const finishBusy = useCallback(owner => { if (mountedRef.current && busyOwnerRef.current === owner) { busyOwnerRef.current = null; setBusy(false); } }, []);
  useEffect(() => {
    const lifetime = { mounted: mountedRef, epoch: authEpochRef, busy: busyOwnerRef, waiter: authWaiterRef };
    lifetime.mounted.current = true;
    return () => { lifetime.mounted.current = false; lifetime.epoch.current++; lifetime.busy.current = null; lifetime.waiter.current?.(null, 'PURCHASE_CANCELLED'); };
  }, []);

  const deliverOwnedTransaction = useCallback((jws, owner, active = () => true) => {
    const requireCurrent = () => { requireAuthOwner(owner); if (!active()) throw new ClientError('PURCHASE_CANCELLED'); };
    return deliverAppleTransaction(jws, {
      submit: value => { requireCurrent(); const sent = ownedOptions(owner); return postAppleTransaction(value, sent); },
      apply: next => { requireCurrent(); applyMe(next, owner.epoch); },
      acknowledge: value => { requireCurrent(); return callNative('finishTransaction', { jws: value }, { timeout: 5_000 }); },
    }).then(next => { requireCurrent(); return next; });
  }, [requireAuthOwner, ownedOptions, applyMe]);

  const handleError = useCallback((err) => {
    const code = codeOf(err);
    if (isAuthError(code)) clearLocalAuth();
    setError(code);
    return code;
  }, [clearLocalAuth]);

  const ensureNativeSocialSession = useCallback(async () => {
    if (!native) return null;
    const epoch = authEpochRef.current, sent = sessionRef.current, userId = meRef.current?.user?.id;
    if (!sent || !userId) throw new ClientError('AUTH_REQUIRED');
    const result = await callNative('socialSession', { userId, token: sent }, { timeout: 5000 });
    if (epoch !== authEpochRef.current || meRef.current?.user?.id !== userId) throw new ClientError('AUTH_REQUIRED');
    if (sessionRef.current === sent && result?.token && result.token !== sent) applySession(result.token);
    return result;
  }, [native, applySession]);

  // Reuse session rotation, guarding late authentication failures across accounts.
  const requestAuthenticated = useCallback(async (path, settings = {}) => {
    const owner = captureAuth();
    const epoch = authEpochRef.current;
    const sent = sessionRef.current;
    const send = async () => { const result = await request(path, { ...settings, ...ownedOptions(owner) }); if (!ownsAuth(owner)) throw new ClientError('STALE_ACCOUNT'); return result; };
    try { return await send(); }
    catch (error) {
      // A native call can renew its credential while WebKit is suspended. An
      // auth rejection performs no mutation, so retry it once with that canonical
      // credential before treating the account as signed out.
      if (native && sent && epoch === authEpochRef.current && isAuthError(codeOf(error))) {
        let retrying = false;
        try {
          const stored = await callNative('socialStoredSession', {}, { timeout: 5000 });
          if (epoch === authEpochRef.current && sessionRef.current && stored?.userId === meRef.current?.user?.id && stored.token) {
            if (sessionRef.current === sent && stored.token !== sent) applySession(stored.token);
            if (sessionRef.current !== sent) { retrying = true; return await send(); }
          }
        } catch (retryError) {
          if (retrying && !isAuthError(codeOf(retryError))) throw retryError;
        }
      }
      if (epoch === authEpochRef.current && isAuthError(codeOf(error))) handleError(error);
      throw error;
    }
  }, [captureAuth, ownedOptions, ownsAuth, handleError, native, applySession]);

  // ── التحديث ─────────────────────────────────────────────────────────────
  const flushPending = useCallback(async () => {
    const stored = accountStore.readTrials();
    if (!stored.pending.length || !sessionRef.current || accountOffline()) return;
    const owner = captureAuth();
    try {
      const result = await mergeTrialsRequest(stored.pending, ownedOptions(owner));
      if (!ownsAuth(owner)) return;
      setLocalTrials(accountStore.clearPending(stored.pending));
      applyTrials(result && result.trials);
    } catch (err) {
      if (ownsAuth(owner) && isAuthError(codeOf(err))) clearLocalAuth();
    }
  }, [captureAuth, ownedOptions, ownsAuth, applyTrials, clearLocalAuth]);

  const refresh = useCallback(async () => {
    if (!sessionRef.current || accountOffline()) return null;
    const epoch = authEpochRef.current;
    try {
      const next = await requestAuthenticated('/api/me');
      if (epoch !== authEpochRef.current) return null;
      applyMe(next, epoch);
      if (isPremium(next) && next?.premium?.active && next.premium.source === 'paddle') setActivationPending(false);
      flushPending();
      return next;
    } catch (err) {
      if (epoch !== authEpochRef.current) return null;
      const code = codeOf(err);
      if (isAuthError(code)) clearLocalAuth();
      if (isDisabled(code)) setOffline(true);
      return null;
    }
  }, [requestAuthenticated, applyMe, flushPending, clearLocalAuth]);

  // بعد أي دخول ناجح: خزّن الجلسة، ادمج علامات هذا الجهاز، ثم رحّب باللاعب.
  const afterSignIn = useCallback(async (result, owner = captureAuth()) => {
    requireAuthOwner(owner);
    if (!result || !result.session || !result.session.token) throw new ClientError('PROVIDER');
    authEpochRef.current++;
    busyOwnerRef.current = null;
    setBusy(false); setActivationPending(false); setError(null);
    clearPaddleCustomer();
    setPaddleIdentity(null);
    meRef.current = null;
    setMe(null);
    applySession(result.session.token);
    if (result.me) applyMe(result.me);
    Object.assign(owner, captureAuth());
    setReady(true);
    const stored = accountStore.readTrials();
    const games = [...new Set([...Object.keys(stored.marks), ...stored.pending])].filter((g) => TRIAL_GAMES.includes(g));
    if (games.length) {
      try {
        const merged = await mergeTrialsRequest(games, ownedOptions(owner));
        if (!ownsAuth(owner)) return null;
        setLocalTrials(accountStore.clearPending(games));
        applyTrials(merged && merged.trials);
      } catch (err) { /* تبقى محليًا وتُدمج لاحقًا */ }
    }
    if (!ownsAuth(owner)) return null;
    const name = (result.me && result.me.user && result.me.user.name) || '';
    toast(name ? `أهلًا ${name}` : 'أهلًا بك');
    return result.me || null;
  }, [captureAuth, requireAuthOwner, ownedOptions, ownsAuth, applySession, applyMe, applyTrials, toast]);

  const consumeCode = useCallback(async (code, client, owner = captureAuth()) => {
    // The attempt secret this browser generated before leaving; the server accepts the
    // code only together with it. It is cleared whether or not the exchange succeeds.
    const attempt = currentAuthAttempt();
    let result;
    try { result = await exchangeCode(code, client, undefined, attempt); }
    finally { if (currentAuthAttempt() === attempt) clearAuthAttempt(); }
    requireAuthOwner(owner);
    return afterSignIn(result, owner);
  }, [captureAuth, requireAuthOwner, afterSignIn]);

  // ── المنتجات والأسعار (كسول: عند فتح الجدار أو بطاقة الإعدادات) ─────────
  const applyNativeCatalog = useCallback((status, next, code = null, diagnostics = null) => {
    nativeCatalogRef.current = { status, products: next };
    setProducts(next);
    setProductsStatus(status);
    setProductsError(code);
    setProductsDiagnostics(diagnostics);
    if (status === 'ready') {
      storeProbeEpochRef.current++;
      setStoreProbeStatus('idle');
      setStoreProbeDiagnostics(null);
      setRestoreDiagnostics(null);
      setError((current) => current === 'APPLE_PRODUCTS_UNAVAILABLE' ? null : current);
    }
  }, []);

  // Public provider capabilities are independent of StoreKit. A sign-in sheet
  // must not infer web/native OAuth availability from the product catalog.
  const loadSignInProviders = useCallback(async ({ retry = false } = {}) => {
    const current = providerConfigRef.current;
    if (current.pending) return current.pending;
    if (!retry && current.config && Date.now() - current.fetchedAt < 60_000) return current.config;
    const previousFailure = current.error;
    if (previousFailure) setError((previous) => previous === previousFailure ? null : previous);
    setSignInProvidersStatus('loading'); setSignInProvidersError(null);
    const pending = (async () => {
      try {
        const config = await getBillingConfig();
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new ClientError('NETWORK');
        current.config = config; current.fetchedAt = Date.now(); current.error = null;
        setBilling(config); setSignInProvidersStatus('ready');
        return config;
      } catch (error) {
        current.error = codeOf(error); current.fetchedAt = 0;
        setSignInProvidersError(current.error); setSignInProvidersStatus('error');
        return null;
      }
    })();
    current.pending = pending;
    try { return await pending; }
    finally { if (current.pending === pending) current.pending = null; }
  }, []);

  const loadProducts = useCallback(async ({ retry = false } = {}) => {
    if (native) {
      if (productsRequestRef.current) return productsRequestRef.current;
      const catalog = nativeCatalogRef.current;
      if (catalog.status === 'ready' && !retry) return catalog.products;
      // A failed catalog waits for an explicit retry, avoiding a Paywall effect loop.
      if (catalog.status === 'unavailable' && !retry) return null;
      applyNativeCatalog('loading', catalog.products);
      const pending = (async () => {
        // Independent, synchronous native reply distinguishes a stalled StoreKit query
        // from a bridge that cannot return any reply. Never gates the product request.
        const statusRequest = callNative('storeStatus', {}, { timeout: 5_000 }).catch(() => null);
        try {
          const result = await callNative('products');
          const list = listOf(result, 'products');
          const byId = {};
          for (const item of list) if (item && item.id) byId[item.id] = item;
          const priced = (key, period) => {
            const item = byId[PRODUCTS[key]];
            const price = typeof item?.price === 'string' ? item.price.trim() : '';
            return price ? { id: PRODUCTS[key], price, period: String(item.period || period) } : null;
          };
          const next = { monthly: priced('monthly', 'شهريًا'), yearly: priced('yearly', 'سنويًا') };
          if (!next.monthly && !next.yearly) {
            const diagnostics = catalogDiagnostics(result?.diagnostics, list.length ? 'unexpected-products' : 'empty');
            if (diagnostics.outcome === 'success') diagnostics.outcome = 'unexpected-products';
            applyNativeCatalog('unavailable', null, 'APPLE_PRODUCTS_UNAVAILABLE', diagnostics);
            return null;
          }
          applyNativeCatalog('ready', next);
          return next;
        } catch (err) {
          const status = await statusRequest;
          let outcome = err?.nativeFailure === 'bridge-timeout' || err?.nativeFailure === 'bridge-unavailable' ? err.nativeFailure : 'native-error';
          if (outcome === 'bridge-timeout' && status && typeof status === 'object') outcome = 'storekit-timeout';
          applyNativeCatalog('unavailable', null, 'APPLE_PRODUCTS_UNAVAILABLE', catalogDiagnostics({ ...status, outcome }));
          return null;
        }
      })();
      productsRequestRef.current = pending;
      try { return await pending; }
      finally { if (productsRequestRef.current === pending) productsRequestRef.current = null; }
    }
    if (productsRef.current) return;
    productsRef.current = true;
    try {
      if (accountOffline()) return;
      const config = await getBillingConfig(options());
      setBilling(config || null);
      const paddle = config && config.paddle;
      if (!paddle || !paddle.clientToken) return;
      const prices = await previewPrices(paddle.prices, paddle);
      if (!prices) { productsRef.current = false; return; }
      setProducts({
        monthly: prices.monthly ? { id: PRODUCTS.monthly, ...prices.monthly } : null,
        yearly: prices.yearly ? { id: PRODUCTS.yearly, ...prices.yearly } : null,
      });
    } catch (err) {
      productsRef.current = false; // محاولة أخرى ممكنة لاحقًا
      if (isDisabled(codeOf(err))) setOffline(true);
    }
  }, [native, options, applyNativeCatalog]);

  const retryProducts = useCallback(() => {
    setError((current) => current === 'APPLE_PRODUCTS_UNAVAILABLE' ? null : current);
    return loadProducts({ retry: true });
  }, [loadProducts]);

  // A support-only, read-only comparison. It never supplies prices or grants access.
  const probeStore = useCallback(async () => {
    if (!native || nativeCatalogRef.current.status !== 'unavailable') return null;
    if (storeProbeRequestRef.current) return storeProbeRequestRef.current;
    const epoch = ++storeProbeEpochRef.current;
    setStoreProbeStatus('loading');
    setStoreProbeDiagnostics(null);
    const pending = (async () => {
      const statusRequest = callNative('storeStatus', {}, { timeout: 5_000 }).catch(() => null);
      let details;
      try {
        const result = await callNative('storeProbe', {}, { timeout: 20_000 });
        details = catalogDiagnostics({ ...result?.diagnostics, api: 'storekit1' });
      } catch (err) {
        const status = await statusRequest;
        let outcome = err?.nativeFailure || 'native-error';
        if (outcome === 'bridge-timeout' && status && typeof status === 'object') outcome = 'storekit-timeout';
        details = catalogDiagnostics({ ...status, api: 'storekit1', outcome });
      }
      if (epoch === storeProbeEpochRef.current) {
        setStoreProbeDiagnostics(details);
        setStoreProbeStatus('ready');
      }
      return details;
    })();
    storeProbeRequestRef.current = pending;
    try { return await pending; }
    finally { if (storeProbeRequestRef.current === pending) storeProbeRequestRef.current = null; }
  }, [native]);

  // ── الإجراءات العامة ────────────────────────────────────────────────────
  const openPaywall = useCallback((detail = {}) => {
    setError(null);
    setPaywall({ open: true, reason: detail.reason || 'settings', game: detail.game || null, pack: detail.pack || null });
    loadProducts();
    if (sessionRef.current) refresh();
  }, [loadProducts, refresh]);
  const closePaywall = useCallback(() => setPaywall((prev) => ({ ...prev, open: false })), []);

  // Keep the old game integration callable without consuming any new trials.
  const markTrial = useCallback(() => {}, []);

  // الغلاف يبثّ authReturn بالرمز، أو بخطأ (إلغاء المستخدم مثلًا) فيُرفض الانتظار فورًا.
  const waitForAuthReturn = useCallback((timeout = 5 * 60_000) => new Promise((resolve, reject) => {
    authWaiterRef.current?.(null, 'PURCHASE_CANCELLED');
    const timer = setTimeout(() => { if (authWaiterRef.current === waiter) authWaiterRef.current = null; reject(new ClientError('NETWORK')); }, timeout);
    const waiter = (code, error) => {
      clearTimeout(timer);
      if (authWaiterRef.current === waiter) authWaiterRef.current = null;
      if (error) reject(new ClientError(error)); else resolve(code);
    };
    authWaiterRef.current = waiter;
  }), []);

  const signIn = useCallback(async (provider = 'apple') => {
    const owner = captureAuth();
    setError(null);
    if (accountOffline()) { setError('OFFLINE'); return null; }
    const activity = startBusy('signin');
    try {
      if (!native) {
        // الويب: الخادم يتولّى المزوّد ثم يعيدنا إلى #/auth?code=. قبل المغادرة
        // نتأكد أن الحسابات مفعّلة على الخادم كي لا نهبط على صفحة 404.
        const url = authStartUrl(provider, { client: 'web', attempt: beginAuthAttempt() });
        if (!url) throw new ClientError('OFFLINE');
        try {
          const config = await loadSignInProviders({ retry: true });
          requireAuthOwner(owner);
          if (!config) throw new ClientError(providerConfigRef.current.error || 'NETWORK');
          if (signInProviders(config, 'web')?.[provider] === false) throw new ClientError('PROVIDER');
        }
        catch (err) {
          if (isDisabled(codeOf(err))) { setOffline(true); throw new ClientError('OFFLINE'); }
          throw err; // لا نغادر الصفحة إن فشل فحص الخادم، حتى بعد تحميل إعدادات سابقة.
        }
        if (typeof location !== 'undefined') {
          requireAuthOwner(owner);
          try { rememberProfileReturn(sessionStorage, location.hash); } catch { /* Storage may be unavailable. */ }
          location.assign(url);
        }
        return null;
      }
      const nativeConfig = await loadSignInProviders({ retry: true });
      requireAuthOwner(owner);
      if (!nativeConfig) throw new ClientError(providerConfigRef.current.error || 'NETWORK');
      if (signInProviders(nativeConfig, 'ios')?.[provider] === false) throw new ClientError('PROVIDER');
      if (provider === 'apple') {
        const payload = await callNative('signInApple', {}, { timeout: NATIVE_SHEET_TIMEOUT });
        requireAuthOwner(owner);
        // A login response creates a new principal, unlike same-account session
        // rotation. Adopt its token and identity together in afterSignIn only.
        const result = await appleNative(payload || {});
        requireAuthOwner(owner);
        return await afterSignIn(result, owner);
      }
      const url = authStartUrl(provider, { client: 'ios', returnUrl: 'maydan://auth', attempt: beginAuthAttempt() });
      if (!url) throw new ClientError('OFFLINE');
      const waiting = waitForAuthReturn();
      // Attach a rejection handler before openAuth: an opening failure or an
      // account switch can cancel this waiter before it is awaited below.
      waiting.catch(() => {});
      const waiter = authWaiterRef.current;
      try {
        await callNative('openAuth', { url }); requireAuthOwner(owner);
        const code = await waiting; requireAuthOwner(owner);
        return await consumeCode(code, 'ios', owner);
      } finally { if (authWaiterRef.current === waiter) waiter(null, 'PURCHASE_CANCELLED'); }
    } catch (err) {
      if (!ownsAuth(owner)) return null;
      const code = handleError(err);
      if (code !== 'PURCHASE_CANCELLED') toast(accountErrorText(code));
      return null;
    } finally {
      finishBusy(activity);
    }
  }, [captureAuth, ownsAuth, requireAuthOwner, startBusy, finishBusy, native, loadSignInProviders, afterSignIn, consumeCode, waitForAuthReturn, handleError, toast]);

  const signOut = useCallback(async () => {
    const requestOptions = options();
    const nativeLogout = clearLocalAuth(); // Hide private state immediately; unregister native devices before revoking its session.
    const owner = captureAuth(), activity = startBusy('signout');
    try { await nativeLogout; if (requestOptions.token && !accountOffline()) await signout(requestOptions); }
    catch (err) { /* الخروج محلي في كل الأحوال */ }
    finally {
      if (ownsAuth(owner)) { setError(null); toast('سجّلت الخروج'); }
      finishBusy(activity);
    }
  }, [options, clearLocalAuth, captureAuth, ownsAuth, startBusy, finishBusy, toast]);

  const purchase = useCallback(async (plan = 'monthly') => {
    if (purchaseInFlightRef.current) return null;
    setError(null);
    if (activationPending) { setError('ACTIVATION_PENDING'); return null; }
    if (accountOffline()) { setError('OFFLINE'); return null; }
    if (native) {
      const catalog = nativeCatalogRef.current;
      const product = catalog.products?.[plan];
      // Catalog availability is independent of authentication. Do not open either
      // Apple sheet for a plan whose real StoreKit price has not loaded.
      if (catalog.status !== 'ready' || product?.id !== PRODUCTS[plan] || !product?.price?.trim()) {
        setError('APPLE_PRODUCTS_UNAVAILABLE');
        return null;
      }
    }
    purchaseInFlightRef.current = true;
    let owner = captureAuth(), activity = null;
    try {
      // داخل التطبيق: الاشتراك يُربط بحساب ليعمل على كل الأجهزة، فالدخول بحساب Apple
      // (ورقة واحدة) يسبق ورقة المتجر حين لا جلسة.
      if (native && !sessionRef.current) {
        const signed = await signIn('apple');
        if (!signed || !sessionRef.current) return null;
        owner = captureAuth();
      }
      requireAuthOwner(owner);
      activity = startBusy('purchase');
      const epoch = owner.epoch;
      if (!sessionRef.current) throw new ClientError('AUTH_REQUIRED');
      // An old sandbox entitlement may still be cached after a live cutover.
      // Require a fresh server answer before checking duplicates or opening a
      // payment sheet; a network failure leaves the cached history untouched.
      const current = await getMe(ownedOptions(owner));
      requireAuthOwner(owner);
      applyMe(current, epoch);
      if (isPremium(current) && current.premium.source !== 'promo') throw new ClientError('ALREADY_SUBSCRIBED');
      if (native) {
        // Do not open a payment sheet until this server can verify its result.
        // Existing transactions still restore/replay independently of this gate.
        const config = await getBillingConfig(ownedOptions(owner));
        requireAuthOwner(owner);
        setBilling(config || null);
        if (config?.apple?.purchasesConfigured !== true) throw new ClientError('APPLE_PURCHASES_UNAVAILABLE');
        // appAccountToken = معرّف المستخدم: الخادم يرفض ربط المعاملة بحساب آخر.
        const userId = (meRef.current && meRef.current.user && meRef.current.user.id) || null;
        if (!sessionRef.current || !userId) throw new ClientError('AUTH_REQUIRED');
        const catalog = nativeCatalogRef.current;
        const product = catalog.products?.[plan];
        if (catalog.status !== 'ready' || product?.id !== PRODUCTS[plan] || !product?.price?.trim()) throw new ClientError('APPLE_PRODUCTS_UNAVAILABLE');
        const result = await callNative('purchase', { productId: PRODUCTS[plan], plan, userId }, { timeout: NATIVE_SHEET_TIMEOUT });
        requireAuthOwner(owner);
        const jws = (result && (result.jws || result.transaction)) || null;
        if (!jws) throw new ClientError('PURCHASE_PENDING');
        const next = await deliverOwnedTransaction(jws, owner);
        requireAuthOwner(owner);
        if (!isPremium(next)) throw new ClientError('ACTIVATION_PENDING');
        toast('فُعِّل ميدان بلس');
        closePaywall();
        return next;
      }
      if (!sessionRef.current) throw new ClientError('AUTH_REQUIRED');
      const config = await getBillingConfig(ownedOptions(owner));
      requireAuthOwner(owner);
      setBilling(config || null);
      if (config?.paddle?.checkoutEnabled === false) throw new ClientError('CHECKOUT_DISABLED');
      const checkout = await createPaddleCheckout(plan, ownedOptions(owner));
      requireAuthOwner(owner);
      await openCheckout({ transactionId: checkout.transactionId, clientToken: checkout.clientToken, environment: checkout.environment, checkoutEnabled: config?.paddle?.checkoutEnabled });
      requireAuthOwner(owner);
      setActivationPending(true);
      const next = await waitForEntitlement(async () => { requireAuthOwner(owner); const next = await refresh(); requireAuthOwner(owner); return next; });
      requireAuthOwner(owner);
      setActivationPending(false);
      toast(checkout.environment === 'sandbox' ? 'فُعّل اشتراك الاختبار — لم يُخصم مبلغ حقيقي' : 'فُعِّل ميدان بلس');
      closePaywall();
      return next;
    } catch (err) {
      if (!ownsAuth(owner)) return null;
      const code = handleError(err);
      if (native && code === 'APPLE_PRODUCTS_UNAVAILABLE') applyNativeCatalog('unavailable', null, code);
      if (code !== 'PURCHASE_CANCELLED') toast(accountErrorText(code));
      return null;
    } finally {
      purchaseInFlightRef.current = false;
      finishBusy(activity);
    }
  }, [captureAuth, requireAuthOwner, ownsAuth, ownedOptions, startBusy, finishBusy, deliverOwnedTransaction, native, applyMe, refresh, handleError, closePaywall, toast, signIn, activationPending, applyNativeCatalog]);

  const restore = useCallback(async () => {
    setError(null);
    setRestoreDiagnostics(null);
    if (!native) { setError('NOT_ELIGIBLE'); return null; }
    if (!sessionRef.current) { setError('AUTH_REQUIRED'); toast(accountErrorText('AUTH_REQUIRED')); return null; }
    const owner = captureAuth(), activity = startBusy('restore');
    let stage = 'native-bridge';
    try {
      const jwsList = listOf(await callNative('restore', {}, { timeout: NATIVE_SHEET_TIMEOUT }), 'transactions').filter((value) => typeof value === 'string' && value);
      requireAuthOwner(owner);
      stage = 'native-entitlements';
      if (!jwsList.length) throw new ClientError('RESTORE_EMPTY');
      stage = 'server-verify';
      let next = null;
      for (const jws of jwsList) next = await deliverOwnedTransaction(jws, owner);
      requireAuthOwner(owner);
      if (next) applyMe(next, owner.epoch);
      toast(isPremium(next) ? 'استُعيد اشتراكك' : accountErrorText('RESTORE_EMPTY'));
      return next;
    } catch (err) {
      if (!ownsAuth(owner)) return null;
      const nativeDetails = err?.nativeDiagnostics;
      const outcome = nativeDetails?.outcome || err?.nativeFailure || (codeOf(err) === 'RESTORE_EMPTY' ? 'empty' : 'native-error');
      setRestoreDiagnostics(catalogDiagnostics({ ...nativeDetails, stage: nativeDetails?.stage || stage, outcome }));
      const code = handleError(nativeDetails?.stage === 'native-sync' && codeOf(err) === 'NETWORK' ? new ClientError('APPLE_STORE_CONNECTION') : err);
      toast(accountErrorText(code));
      return null;
    } finally {
      finishBusy(activity);
    }
  }, [captureAuth, requireAuthOwner, ownsAuth, startBusy, finishBusy, deliverOwnedTransaction, native, applyMe, handleError, toast]);

  const manageSubscription = useCallback(async () => {
    const owner = captureAuth();
    setError(null);
    try {
      if (meRef.current?.premium?.source === 'apple') {
        if (native) await callNative('manageSubscriptions');
        else if (typeof location !== 'undefined') location.assign('https://apps.apple.com/account/subscriptions');
        return;
      }
      if (native) throw new ClientError('MANAGE_ON_WEB');
      const result = await getPaddlePortal(ownedOptions(owner));
      requireAuthOwner(owner);
      if (result && result.url && typeof location !== 'undefined') location.assign(result.url);
    } catch (err) {
      if (!ownsAuth(owner)) return;
      const code = handleError(err);
      toast(accountErrorText(code));
    }
  }, [captureAuth, requireAuthOwner, ownsAuth, ownedOptions, native, handleError, toast]);

  // رمز الهدية: الخادم يتحقق بعد تسجيل الدخول، ولا نحفظ الرمز محليًا.
  const redeem = useCallback(async (code) => {
    if (!sessionRef.current) return 'AUTH_REQUIRED';
    if (accountOffline()) return 'OFFLINE';
    const owner = captureAuth();
    try {
      const next = await redeemRequest(code, ownedOptions(owner));
      if (!ownsAuth(owner)) return 'PURCHASE_CANCELLED';
      if (next) applyMe(next, owner.epoch);
    } catch (err) {
      if (!ownsAuth(owner)) return 'PURCHASE_CANCELLED';
      const failure = codeOf(err);
      if (isAuthError(failure)) clearLocalAuth();
      return failure === 'NOT_FOUND' ? 'REDEEM_INVALID' : failure;
    }
    closePaywall();
    toast(`فُعِّل ${PLUS_NAME}`);
    return true;
  }, [captureAuth, ownsAuth, ownedOptions, applyMe, clearLocalAuth, closePaywall, toast]);

  const deleteAccount = useCallback(async (expectedUserId) => {
    // The confirmation may have rendered before a storage/native account swap.
    // Never reinterpret that old confirmation as consent to delete the new user.
    if (expectedUserId != null && expectedUserId !== meRef.current?.user?.id) return false;
    const epoch = authEpochRef.current;
    const deletedOwner = { userId: meRef.current?.user?.id, server: resolveAccountServer() };
    let clearedOwner = false;
    setBusy('delete');
    try {
      if (accountOffline()) throw new ClientError('OFFLINE');
      if (!sessionRef.current) throw new ClientError('AUTH_REQUIRED');
      await deleteAccountRequest({ ...options(), server: deletedOwner.server });
      clearDeletedTutorialAccount(deletedOwner);
      clearDeletedMafiaLabs(deletedOwner);
      if (epoch === authEpochRef.current) {
        clearLocalAuth();
        clearedOwner = true;
        toast('حُذف حسابك');
      }
      return true;
    } catch (err) {
      if (epoch !== authEpochRef.current) return false;
      clearedOwner = isAuthError(codeOf(err));
      const code = handleError(err);
      toast(accountErrorText(code));
      return false;
    } finally {
      if (epoch === authEpochRef.current || clearedOwner) setBusy(false);
    }
  }, [options, clearLocalAuth, handleError, toast]);

  // ── التأثيرات ───────────────────────────────────────────────────────────
  // Retain uses fresh server identity, never the offline /api/me cache. It is
  // independent of the paywall so existing live subscribers can be identified.
  useEffect(() => {
    if (native || !session || paddleIdentity?.environment !== 'production' || !paddleIdentity.customerId) return undefined;
    let alive = true;
    const epoch = authEpochRef.current;
    (async () => {
      try {
        const config = await getBillingConfig(options());
        if (!alive || epoch !== authEpochRef.current) return;
        setBilling(config || null);
        if (config?.paddle?.clientToken) await loadPaddle(config.paddle);
      } catch { /* Retain is optional; checkout reports configuration failures. */ }
    })();
    return () => { alive = false; };
  }, [native, session, paddleIdentity, options]);

  useEffect(() => () => clearPaddleCustomer(), []);

  // A second tab may sign out or switch account while this tab is open. Do not
  // rewrite its storage event; invalidate this tab's identity and verify afresh.
  useEffect(() => {
    const changed = (event) => {
      if (event.key !== null && event.key !== `${ACCOUNT_PREFIX}${KEYS.session}`) return;
      const token = accountStore.readSession();
      if (token === sessionRef.current) return;
      authEpochRef.current++;
      busyOwnerRef.current = null;
      setBusy(false); setActivationPending(false); setError(null);
      authWaiterRef.current?.(null, 'PURCHASE_CANCELLED');
      clearAuthAttempt();
      clearPaddleCustomer();
      setPaddleIdentity(null);
      sessionRef.current = token;
      meRef.current = null;
      fetchedRef.current = 0;
      setSession(token);
      setMe(null);
      setFetchedAt(0);
      if (token) refresh();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [refresh]);

  // إقلاع: تحديث في الخلفية إن تقادمت النسخة المخزّنة.
  useEffect(() => {
    let alive = true;
    accountStore.clearPromo();
    setOffline(accountOffline());
    (async () => {
      // CallKit may rotate the account session while WebKit is suspended. Adopt
      // the secure native copy before sending the first request with an old token.
      const epoch = authEpochRef.current;
      if (native) {
        try {
          const stored = await callNative('socialStoredSession', {}, { timeout: 5000 });
          if (alive && epoch === authEpochRef.current && stored?.token && stored.userId &&
            (!meRef.current?.user?.id || meRef.current.user.id === stored.userId)) applySession(stored.token);
        } catch { /* Older shells do not implement social calls. */ }
      }
      if (!alive || epoch !== authEpochRef.current) return;
      if (sessionRef.current && !accountOffline()) await refresh();
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, [refresh, native, applySession]);

  useEffect(() => onNativeEvent('socialSessionRotated', payload => {
    if (payload?.userId === meRef.current?.user?.id && sessionRef.current &&
      payload.previousToken === sessionRef.current && typeof payload.token === 'string') applySession(payload.token);
  }), [applySession]);
  useEffect(() => {
    if (!native || !ready || !session || !me?.user?.id) return;
    ensureNativeSocialSession().catch(() => {});
  }, [native, ready, session, me?.user?.id, ensureNativeSocialSession]);

  // إقلاع الغلاف: علامات التجارب المحفوظة في UserDefaults تُدمج (اتحاد) مع علامات WebKit.
  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    callNative('getTrials', {}, { timeout: 5_000 }).then((result) => {
      const marks = result && typeof result === 'object' && result.marks && typeof result.marks === 'object' ? result.marks : {};
      const games = Object.keys(marks).filter((game) => marks[game] && TRIAL_GAMES.includes(game));
      if (!alive || !games.length) return;
      let next = accountStore.readTrials();
      for (const game of games) next = accountStore.addMark(game);
      setLocalTrials(next);
    }).catch(() => {});
    return () => { alive = false; };
  }, [native]);

  // العودة إلى التطبيق: الاشتراك قد يكون تغيّر على جهاز آخر.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.addEventListener) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (paywall.open || route?.name === 'settings' || shouldRefresh(fetchedRef.current))) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh, paywall.open, route?.name]);

  // عودة الغلاف من متصفح المصادقة (maydan://auth?code=…).
  useEffect(() => onNativeEvent('authReturn', (payload) => {
    const failure = payload && typeof payload === 'object' && payload.error ? String(payload.error) : null;
    if (failure) { if (authWaiterRef.current) authWaiterRef.current(null, failure); return; }
    const code = (payload && (payload.code || payload)) || null;
    if (typeof code !== 'string' || !code) return;
    if (authWaiterRef.current) { authWaiterRef.current(code); return; }
    if (consumedRef.current.has(code)) return;
    consumedRef.current.add(code);
    const owner = captureAuth();
    consumeCode(code, 'ios', owner).catch((err) => { if (!ownsAuth(owner)) return; const c = handleError(err); if (c !== 'PURCHASE_CANCELLED') toast(accountErrorText(c)); });
  }), [captureAuth, ownsAuth, consumeCode, handleError, toast]);

  // معاملة من المتجر خارج الشراء المباشر (تجديد، شراء معلّق اكتمل): الخادم يتحقق ويحدّث الاستحقاق.
  useEffect(() => onNativeEvent('transaction', (payload) => {
    const jws = payload && typeof payload === 'object' ? payload.jws : null;
    if (typeof jws !== 'string' || !jws || !sessionRef.current || accountOffline()) return;
    const owner = captureAuth();
    deliverOwnedTransaction(jws, owner)
      .catch((err) => { if (ownsAuth(owner) && isAuthError(codeOf(err))) clearLocalAuth(); });
  }), [captureAuth, ownsAuth, deliverOwnedTransaction, clearLocalAuth]);

  // Replay after sign-in/start and on returning online; StoreKit holds transactions until acknowledgment.
  useEffect(() => {
    if (!native || !session) return undefined;
    const owner = captureAuth();
    let running = false, active = true;
    const replay = async () => {
      if (!active || !ownsAuth(owner) || running || accountOffline()) return;
      running = true;
      try {
        const transactions = listOf(await callNative('pendingTransactions'), 'transactions');
        if (!active || !ownsAuth(owner)) return;
        for (const jws of transactions) {
          if (!active || !ownsAuth(owner)) return;
          if (typeof jws !== 'string') continue;
          try { await deliverOwnedTransaction(jws, owner, () => active); }
          catch { /* A transaction for another account must not block the remaining purchases. */ }
        }
      } catch { /* Retry on next launch/online/foreground. */ }
      finally { running = false; }
    };
    replay();
    const visible = () => { if (document.visibilityState === 'visible') replay(); };
    window.addEventListener('online', replay);
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.removeEventListener('online', replay); document.removeEventListener('visibilitychange', visible); };
  }, [native, session, captureAuth, ownsAuth, deliverOwnedTransaction]);

  // عودة الويب: #/auth?code=… رمز لمرة واحدة عمره 60 ثانية.
  const authCode = route && route.name === 'auth' ? (route.params && route.params.code) || '' : '';
  useEffect(() => {
    if (!authCode || consumedRef.current.has(authCode)) return;
    consumedRef.current.add(authCode);
    const owner = captureAuth(), activity = startBusy('signin');
    let alive = true;
    (async () => {
      try { await consumeCode(authCode, native ? 'ios' : 'web', owner); }
      catch (err) { if (alive && ownsAuth(owner)) { const code = handleError(err); if (code !== 'PURCHASE_CANCELLED') toast(accountErrorText(code)); } }
      finally {
        finishBusy(activity);
        const current = getRoute();
        if (alive && ownsAuth(owner) && current.name === 'auth' && current.params.code === authCode) {
          let target = '/';
          try { target = consumeProfileReturn(sessionStorage); } catch { /* Keep the default route. */ }
          navigate(target, { replace: true });
        }
      }
    })();
    return () => { alive = false; };
  }, [authCode, native, captureAuth, ownsAuth, startBusy, finishBusy, consumeCode, handleError, toast]);

  // ── القيمة ──────────────────────────────────────────────────────────────
  const premium = isPremium(me);
  const trials = useMemo(() => mergeTrials(localTrials.marks, (me && me.trials) || EMPTY), [localTrials, me]);
  const user = (me && me.user) || null;

  const value = useMemo(() => ({
    ready, user, me, premium, promo, trials, platform, products, productsStatus, productsError, productsDiagnostics,
    storeProbeStatus, storeProbeDiagnostics, restoreDiagnostics,
    offline, signedIn: !!session, busy, error, paywall, billing, activationPending,
    loadSignInProviders, signInProvidersStatus, signInProvidersError,
    redeem,
    signIn, signOut, refresh, requestAuthenticated, ensureNativeSocialSession,
    markTrial,
    trialAvailable: (game) => trialAvailableOf(me, localTrials.marks, game, premium),
    lockedPack: (id) => lockedPackOf(id, premium),
    gameAccess: (game) => gameAccessOf(me, localTrials.marks, game),
    openPaywall, closePaywall, restore, deleteAccount,
    purchase, manageSubscription, loadProducts, retryProducts, probeStore,
    clearError: () => setError(null),
    authHeaders: () => (sessionRef.current ? { Authorization: `Bearer ${sessionRef.current}` } : {}),
  }), [ready, user, me, premium, promo, trials, platform, products, productsStatus, productsError, productsDiagnostics, storeProbeStatus, storeProbeDiagnostics, restoreDiagnostics, offline, session, busy, error, paywall, billing, activationPending, loadSignInProviders, signInProvidersStatus, signInProvidersError,
    signIn, signOut, refresh, requestAuthenticated, ensureNativeSocialSession, markTrial, localTrials, openPaywall, closePaywall, restore, deleteAccount, purchase, manageSubscription, loadProducts, retryProducts, probeStore, redeem]);

  return <AccountContext.Provider value={value}>{isMafiaPreview() && !['room','play'].includes(route.name) && <aside data-design-fixed="isolated-test-environment" role="status" style={{margin:'8px 12px',padding:'10px 14px',border:'1px solid #8c6daa',borderRadius:14,background:'#eee2f7',color:'#402451',fontSize:13,lineHeight:1.7,textAlign:'center'}}><strong>بيئة اختبار مافيا</strong><br/>حسابات وتجارب منفصلة عن ميدان الأساسية. استخدم حساب التجربة.</aside>}{children}</AccountContext.Provider>;
}
