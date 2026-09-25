// مزوّد الحساب: مصدر واحد لحالة الاشتراك والتجارب والجدار في الواجهة كلها.
// الخادم هو مصدر الحقيقة؛ ما هنا نسخة مخزّنة تُحدَّث عند الإقلاع وعند العودة
// للتطبيق وبعد كل دخول أو شراء. بلا خادم مضبوط تعمل الطبقة «دون اتصال»:
// لا اشتراك ولا دخول، والتجارب تُسجَّل محليًا فقط.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountContext } from './context.js';
import { PLUS_NAME, PRODUCTS, TRIAL_GAMES } from './config.js';
import { isPremium, lockedPack as lockedPackOf, trialAvailable as trialAvailableOf, gameAccess as gameAccessOf, mergeTrials, shouldRefresh } from './entitlements.js';
import { accountErrorText } from './errors.js';
import { accountStore, ACCOUNT_PREFIX, KEYS } from './store.js';
import {
  ClientError, accountOffline, authStartUrl, appleNative, createPaddleCheckout, deleteAccountRequest,
  exchangeCode, getBillingConfig, getMe, getPaddlePortal, mergeTrialsRequest, postAppleTransaction, postTrial, redeemRequest, signout, request,
} from './api.js';
import { deliverAppleTransaction, waitForEntitlement } from './purchases.js';
import { callNative, isNativeShell, onNativeEvent } from './native.js';
import { clearPaddleCustomer, loadPaddle, openCheckout, previewPrices, setPaddleCustomer } from './paddle.js';
import { usePlatform } from '../../platform/context.js';
import { navigate, useRoute } from '../../platform/router.js';

const EMPTY = Object.freeze({});
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
  const toast = (platformValue && platformValue.toast) || (() => {});
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
  const [ready, setReady] = useState(() => !(accountStore.readSession() && !cached.data));
  const [products, setProducts] = useState(null);
  const [billing, setBilling] = useState(null);
  const [paddleIdentity, setPaddleIdentity] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activationPending, setActivationPending] = useState(false);
  const [error, setError] = useState(null);
  const [paywall, setPaywall] = useState({ open: false, reason: 'settings', game: null, pack: null });

  const sessionRef = useRef(session);
  const authEpochRef = useRef(0);
  const meRef = useRef(me);
  meRef.current = me;
  const fetchedRef = useRef(cached.fetchedAt);
  const consumedRef = useRef(new Set());
  const authWaiterRef = useRef(null);
  const productsRef = useRef(false);

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
    clearPaddleCustomer();
    setPaddleIdentity(null);
    accountStore.clearAuth();
    sessionRef.current = null;
    meRef.current = null;
    fetchedRef.current = 0;
    setSession(null);
    setMe(null);
    setFetchedAt(0);
  }, []);

  // خيارات كل نداء: الرمز الحالي + التقاط تدوير الجلسة المنزلق.
  const options = useCallback(() => {
    const token = sessionRef.current;
    const epoch = authEpochRef.current;
    return { token: token || undefined, onSession: (next) => {
      if (epoch === authEpochRef.current && token && token === sessionRef.current) applySession(next);
    } };
  }, [applySession]);

  const handleError = useCallback((err) => {
    const code = codeOf(err);
    if (isAuthError(code)) clearLocalAuth();
    setError(code);
    return code;
  }, [clearLocalAuth]);

  // Reuse session rotation, guarding late authentication failures across accounts.
  const requestAuthenticated = useCallback(async (path, settings = {}) => {
    const epoch = authEpochRef.current;
    try { return await request(path, { ...settings, ...options() }); }
    catch (error) {
      if (epoch === authEpochRef.current && isAuthError(codeOf(error))) handleError(error);
      throw error;
    }
  }, [options, handleError]);

  // ── التحديث ─────────────────────────────────────────────────────────────
  const flushPending = useCallback(async () => {
    const stored = accountStore.readTrials();
    if (!stored.pending.length || !sessionRef.current || accountOffline()) return;
    try {
      const result = await mergeTrialsRequest(stored.pending, options());
      setLocalTrials(accountStore.clearPending(stored.pending));
      applyTrials(result && result.trials);
    } catch (err) {
      if (isAuthError(codeOf(err))) clearLocalAuth();
    }
  }, [options, applyTrials, clearLocalAuth]);

  const refresh = useCallback(async () => {
    if (!sessionRef.current || accountOffline()) return null;
    const epoch = authEpochRef.current;
    try {
      const next = await getMe(options());
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
  }, [options, applyMe, flushPending, clearLocalAuth]);

  // بعد أي دخول ناجح: خزّن الجلسة، ادمج علامات هذا الجهاز، ثم رحّب باللاعب.
  const afterSignIn = useCallback(async (result) => {
    if (!result || !result.session || !result.session.token) throw new ClientError('PROVIDER');
    authEpochRef.current++;
    clearPaddleCustomer();
    setPaddleIdentity(null);
    meRef.current = null;
    setMe(null);
    applySession(result.session.token);
    if (result.me) applyMe(result.me);
    const stored = accountStore.readTrials();
    const games = [...new Set([...Object.keys(stored.marks), ...stored.pending])].filter((g) => TRIAL_GAMES.includes(g));
    if (games.length) {
      try {
        const merged = await mergeTrialsRequest(games, options());
        setLocalTrials(accountStore.clearPending(games));
        applyTrials(merged && merged.trials);
      } catch (err) { /* تبقى محليًا وتُدمج لاحقًا */ }
    }
    const name = (result.me && result.me.user && result.me.user.name) || '';
    toast(name ? `أهلًا ${name}` : 'أهلًا بك');
    return result.me || null;
  }, [applySession, applyMe, applyTrials, options, toast]);

  const consumeCode = useCallback(async (code, client) => {
    const epoch = authEpochRef.current;
    const result = await exchangeCode(code, client);
    if (epoch !== authEpochRef.current) throw new ClientError('PURCHASE_CANCELLED');
    return afterSignIn(result);
  }, [afterSignIn]);

  // ── المنتجات والأسعار (كسول: عند فتح الجدار أو بطاقة الإعدادات) ─────────
  const loadProducts = useCallback(async () => {
    if (productsRef.current) return;
    productsRef.current = true;
    try {
      if (native) {
        const list = listOf(await callNative('products'), 'products');
        const byId = {};
        for (const item of list) if (item && item.id) byId[item.id] = item;
        const monthly = byId[PRODUCTS.monthly];
        const yearly = byId[PRODUCTS.yearly];
        if (monthly || yearly) {
          setProducts({
            monthly: monthly ? { id: PRODUCTS.monthly, price: String(monthly.price || ''), period: String(monthly.period || 'شهريًا') } : null,
            yearly: yearly ? { id: PRODUCTS.yearly, price: String(yearly.price || ''), period: String(yearly.period || 'سنويًا') } : null,
          });
        }
        if (!monthly && !yearly) productsRef.current = false;
        return;
      }
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
  }, [native, options]);

  // ── الإجراءات العامة ────────────────────────────────────────────────────
  const openPaywall = useCallback((detail = {}) => {
    setError(null);
    setPaywall({ open: true, reason: detail.reason || 'settings', game: detail.game || null, pack: detail.pack || null });
    loadProducts();
    if (sessionRef.current) refresh();
  }, [loadProducts, refresh]);
  const closePaywall = useCallback(() => setPaywall((prev) => ({ ...prev, open: false })), []);

  const markTrial = useCallback((game) => {
    if (!TRIAL_GAMES.includes(game)) return;
    setLocalTrials(accountStore.addMark(game));
    // مرآة الغلاف (UserDefaults): تصمد أمام مسح بيانات WebKit.
    if (native) callNative('markTrial', { game }, { timeout: 5_000 }).catch(() => {});
    if (!sessionRef.current || accountOffline()) return;
    postTrial(game, options())
      .then((result) => applyTrials(result && result.trials))
      .catch((err) => {
        if (isAuthError(codeOf(err))) clearLocalAuth();
        setLocalTrials(accountStore.addPending(game));
      });
  }, [native, options, applyTrials, clearLocalAuth]);

  // الغلاف يبثّ authReturn بالرمز، أو بخطأ (إلغاء المستخدم مثلًا) فيُرفض الانتظار فورًا.
  const waitForAuthReturn = useCallback((timeout = 5 * 60_000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { authWaiterRef.current = null; reject(new ClientError('NETWORK')); }, timeout);
    authWaiterRef.current = (code, error) => {
      clearTimeout(timer);
      authWaiterRef.current = null;
      if (error) reject(new ClientError(error)); else resolve(code);
    };
  }), []);

  const signIn = useCallback(async (provider = 'apple') => {
    setError(null);
    if (accountOffline()) { setError('OFFLINE'); return null; }
    setBusy('signin');
    try {
      if (!native) {
        // الويب: الخادم يتولّى المزوّد ثم يعيدنا إلى #/auth?code=. قبل المغادرة
        // نتأكد أن الحسابات مفعّلة على الخادم كي لا نهبط على صفحة 404.
        const url = authStartUrl(provider, { client: 'web' });
        if (!url) throw new ClientError('OFFLINE');
        try {
          const config = await getBillingConfig(options());
          setBilling(config || null);
          if (config?.providers?.[provider] === false) throw new ClientError('PROVIDER');
        }
        catch (err) {
          if (isDisabled(codeOf(err))) { setOffline(true); throw new ClientError('OFFLINE'); }
          throw err; // لا نغادر الصفحة إن فشل فحص الخادم، حتى بعد تحميل إعدادات سابقة.
        }
        if (typeof location !== 'undefined') location.assign(url);
        return null;
      }
      if (provider === 'apple') {
        const payload = await callNative('signInApple', {}, { timeout: NATIVE_SHEET_TIMEOUT });
        const result = await appleNative(payload || {}, { onSession: applySession });
        return await afterSignIn(result);
      }
      const url = authStartUrl(provider, { client: 'ios', returnUrl: 'maydan://auth' });
      if (!url) throw new ClientError('OFFLINE');
      const waiting = waitForAuthReturn();
      await callNative('openAuth', { url });
      const code = await waiting;
      return await consumeCode(code, 'ios');
    } catch (err) {
      const code = handleError(err);
      if (code !== 'PURCHASE_CANCELLED') toast(accountErrorText(code));
      return null;
    } finally {
      setBusy(false);
    }
  }, [native, options, applySession, afterSignIn, consumeCode, waitForAuthReturn, handleError, toast]);

  const signOut = useCallback(async () => {
    setBusy('signout');
    const requestOptions = options();
    clearLocalAuth(); // Clear Retain before waiting on an unavailable logout endpoint.
    try { if (requestOptions.token && !accountOffline()) await signout(requestOptions); }
    catch (err) { /* الخروج محلي في كل الأحوال */ }
    finally {
      setBusy(false);
      setError(null);
      toast('سجّلت الخروج');
    }
  }, [options, clearLocalAuth, toast]);

  const purchase = useCallback(async (plan = 'monthly') => {
    setError(null);
    if (activationPending) { setError('ACTIVATION_PENDING'); return null; }
    if (accountOffline()) { setError('OFFLINE'); return null; }
    // داخل التطبيق: الاشتراك يُربط بحساب ليعمل على كل الأجهزة، فالدخول بحساب Apple
    // (ورقة واحدة) يسبق ورقة المتجر حين لا جلسة.
    if (native && !sessionRef.current) {
      const signed = await signIn('apple');
      if (!signed || !sessionRef.current) return null;
    }
    setBusy('purchase');
    const epoch = authEpochRef.current;
    try {
      if (!sessionRef.current) throw new ClientError('AUTH_REQUIRED');
      // An old sandbox entitlement may still be cached after a live cutover.
      // Require a fresh server answer before checking duplicates or opening a
      // payment sheet; a network failure leaves the cached history untouched.
      const current = await getMe(options());
      if (epoch !== authEpochRef.current) throw new ClientError('PURCHASE_CANCELLED');
      applyMe(current, epoch);
      if (isPremium(current) && current.premium.source !== 'promo') throw new ClientError('ALREADY_SUBSCRIBED');
      if (native) {
        // Do not open a payment sheet until this server can verify its result.
        // Existing transactions still restore/replay independently of this gate.
        const config = await getBillingConfig(options());
        if (epoch !== authEpochRef.current) throw new ClientError('PURCHASE_CANCELLED');
        setBilling(config || null);
        if (config?.apple?.purchasesConfigured !== true) throw new ClientError('APPLE_PURCHASES_UNAVAILABLE');
        // appAccountToken = معرّف المستخدم: الخادم يرفض ربط المعاملة بحساب آخر.
        const userId = (meRef.current && meRef.current.user && meRef.current.user.id) || null;
        if (!sessionRef.current || !userId) throw new ClientError('AUTH_REQUIRED');
        const result = await callNative('purchase', { productId: PRODUCTS[plan] || PRODUCTS.monthly, plan, userId }, { timeout: NATIVE_SHEET_TIMEOUT });
        const jws = (result && (result.jws || result.transaction)) || null;
        if (!jws) throw new ClientError('PURCHASE_PENDING');
        const next = await deliverAppleTransaction(jws, {
          submit: (value) => postAppleTransaction(value, options()), apply: applyMe,
          acknowledge: (value) => callNative('finishTransaction', { jws: value }, { timeout: 5_000 }),
        });
        if (!isPremium(next)) throw new ClientError('ACTIVATION_PENDING');
        toast('فُعِّل ميدان بلس');
        closePaywall();
        return next;
      }
      if (!sessionRef.current) throw new ClientError('AUTH_REQUIRED');
      const config = await getBillingConfig(options());
      if (epoch !== authEpochRef.current) throw new ClientError('PURCHASE_CANCELLED');
      setBilling(config || null);
      if (config?.paddle?.checkoutEnabled === false) throw new ClientError('CHECKOUT_DISABLED');
      const checkout = await createPaddleCheckout(plan, options());
      if (epoch !== authEpochRef.current) throw new ClientError('PURCHASE_CANCELLED');
      await openCheckout({ transactionId: checkout.transactionId, clientToken: checkout.clientToken, environment: checkout.environment, checkoutEnabled: config?.paddle?.checkoutEnabled });
      if (epoch !== authEpochRef.current) throw new ClientError('PURCHASE_CANCELLED');
      setActivationPending(true);
      const next = await waitForEntitlement(refresh);
      setActivationPending(false);
      toast(checkout.environment === 'sandbox' ? 'فُعّل اشتراك الاختبار — لم يُخصم مبلغ حقيقي' : 'فُعِّل ميدان بلس');
      closePaywall();
      return next;
    } catch (err) {
      const code = handleError(err);
      if (code !== 'PURCHASE_CANCELLED') toast(accountErrorText(code));
      return null;
    } finally {
      setBusy(false);
    }
  }, [native, options, applyMe, refresh, handleError, closePaywall, toast, signIn, activationPending]);

  const restore = useCallback(async () => {
    setError(null);
    if (!native) { setError('NOT_ELIGIBLE'); return null; }
    if (!sessionRef.current) { setError('AUTH_REQUIRED'); toast(accountErrorText('AUTH_REQUIRED')); return null; }
    setBusy('restore');
    try {
      const jwsList = listOf(await callNative('restore', {}, { timeout: NATIVE_SHEET_TIMEOUT }), 'transactions').filter((value) => typeof value === 'string' && value);
      if (!jwsList.length) throw new ClientError('RESTORE_EMPTY');
      let next = null;
      for (const jws of jwsList) next = await deliverAppleTransaction(jws, {
        submit: (value) => postAppleTransaction(value, options()), apply: applyMe,
        acknowledge: (value) => callNative('finishTransaction', { jws: value }, { timeout: 5_000 }),
      });
      if (next) applyMe(next);
      toast(isPremium(next) ? 'استُعيد اشتراكك' : accountErrorText('RESTORE_EMPTY'));
      return next;
    } catch (err) {
      const code = handleError(err);
      toast(accountErrorText(code));
      return null;
    } finally {
      setBusy(false);
    }
  }, [native, options, applyMe, handleError, toast]);

  const manageSubscription = useCallback(async () => {
    setError(null);
    try {
      if (meRef.current?.premium?.source === 'apple') {
        if (native) await callNative('manageSubscriptions');
        else if (typeof location !== 'undefined') location.assign('https://apps.apple.com/account/subscriptions');
        return;
      }
      if (native) throw new ClientError('MANAGE_ON_WEB');
      const result = await getPaddlePortal(options());
      if (result && result.url && typeof location !== 'undefined') location.assign(result.url);
    } catch (err) {
      const code = handleError(err);
      toast(accountErrorText(code));
    }
  }, [native, options, handleError, toast]);

  // رمز الهدية: الخادم يتحقق بعد تسجيل الدخول، ولا نحفظ الرمز محليًا.
  const redeem = useCallback(async (code) => {
    if (!sessionRef.current) return 'AUTH_REQUIRED';
    if (accountOffline()) return 'OFFLINE';
    const epoch = authEpochRef.current;
    try {
      const next = await redeemRequest(code, options());
      if (epoch !== authEpochRef.current) return 'PURCHASE_CANCELLED';
      if (next) applyMe(next, epoch);
    } catch (err) {
      const failure = codeOf(err);
      if (isAuthError(failure)) clearLocalAuth();
      return failure === 'NOT_FOUND' ? 'REDEEM_INVALID' : failure;
    }
    closePaywall();
    toast(`فُعِّل ${PLUS_NAME}`);
    return true;
  }, [options, applyMe, clearLocalAuth, closePaywall, toast]);

  const deleteAccount = useCallback(async () => {
    setBusy('delete');
    try {
      if (accountOffline()) throw new ClientError('OFFLINE');
      if (!sessionRef.current) throw new ClientError('AUTH_REQUIRED');
      await deleteAccountRequest(options());
      clearLocalAuth();
      toast('حُذف حسابك');
      return true;
    } catch (err) {
      const code = handleError(err);
      toast(accountErrorText(code));
      return false;
    } finally {
      setBusy(false);
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
      if (sessionRef.current && !accountOffline()) await refresh();
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, [refresh]);

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
    consumeCode(code, 'ios').catch((err) => { const c = handleError(err); toast(accountErrorText(c)); });
  }), [consumeCode, handleError, toast]);

  // معاملة من المتجر خارج الشراء المباشر (تجديد، شراء معلّق اكتمل): الخادم يتحقق ويحدّث الاستحقاق.
  useEffect(() => onNativeEvent('transaction', (payload) => {
    const jws = payload && typeof payload === 'object' ? payload.jws : null;
    if (typeof jws !== 'string' || !jws || !sessionRef.current || accountOffline()) return;
    deliverAppleTransaction(jws, {
      submit: (value) => postAppleTransaction(value, options()), apply: applyMe,
      acknowledge: (value) => callNative('finishTransaction', { jws: value }, { timeout: 5_000 }),
    })
      .catch((err) => { if (isAuthError(codeOf(err))) clearLocalAuth(); });
  }), [options, applyMe, clearLocalAuth]);

  // Replay after sign-in/start and on returning online; StoreKit holds transactions until acknowledgment.
  useEffect(() => {
    if (!native || !session) return undefined;
    let running = false;
    const replay = async () => {
      if (running || accountOffline()) return;
      running = true;
      try {
        const transactions = listOf(await callNative('pendingTransactions'), 'transactions');
        for (const jws of transactions) {
          if (typeof jws !== 'string') continue;
          try { await deliverAppleTransaction(jws, {
            submit: (value) => postAppleTransaction(value, options()), apply: applyMe,
            acknowledge: (value) => callNative('finishTransaction', { jws: value }, { timeout: 5_000 }),
          }); } catch { /* A transaction for another account must not block the remaining purchases. */ }
        }
      } catch { /* Retry on next launch/online/foreground. */ }
      finally { running = false; }
    };
    replay();
    const visible = () => { if (document.visibilityState === 'visible') replay(); };
    window.addEventListener('online', replay);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('online', replay); document.removeEventListener('visibilitychange', visible); };
  }, [native, session, options, applyMe]);

  // عودة الويب: #/auth?code=… رمز لمرة واحدة عمره 60 ثانية.
  const authCode = route && route.name === 'auth' ? (route.params && route.params.code) || '' : '';
  useEffect(() => {
    if (!authCode || consumedRef.current.has(authCode)) return;
    consumedRef.current.add(authCode);
    let alive = true;
    (async () => {
      setBusy('signin');
      try { await consumeCode(authCode, native ? 'ios' : 'web'); }
      catch (err) { const code = handleError(err); toast(accountErrorText(code)); }
      finally {
        if (alive) setBusy(false);
        navigate('/', { replace: true });
      }
    })();
    return () => { alive = false; };
  }, [authCode, native, consumeCode, handleError, toast]);

  // ── القيمة ──────────────────────────────────────────────────────────────
  const premium = isPremium(me);
  const trials = useMemo(() => mergeTrials(localTrials.marks, (me && me.trials) || EMPTY), [localTrials, me]);
  const user = (me && me.user) || null;

  const value = useMemo(() => ({
    ready, user, me, premium, promo, trials, platform, products,
    offline, signedIn: !!session, busy, error, paywall, billing, activationPending,
    redeem,
    signIn, signOut, refresh, requestAuthenticated,
    markTrial,
    trialAvailable: (game) => trialAvailableOf(me, localTrials.marks, game, premium),
    lockedPack: (id) => lockedPackOf(id, premium),
    gameAccess: (game) => (premium ? 'premium' : gameAccessOf(me, localTrials.marks, game)),
    openPaywall, closePaywall, restore, deleteAccount,
    purchase, manageSubscription, loadProducts,
    clearError: () => setError(null),
    authHeaders: () => (sessionRef.current ? { Authorization: `Bearer ${sessionRef.current}` } : {}),
  }), [ready, user, me, premium, promo, trials, platform, products, offline, session, busy, error, paywall, billing, activationPending,
    signIn, signOut, refresh, requestAuthenticated, markTrial, localTrials, openPaywall, closePaywall, restore, deleteAccount, purchase, manageSubscription, loadProducts, redeem]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
