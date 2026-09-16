// مزوّد الحساب: مصدر واحد لحالة الاشتراك والتجارب والجدار في الواجهة كلها.
// الخادم هو مصدر الحقيقة؛ ما هنا نسخة مخزّنة تُحدَّث عند الإقلاع وعند العودة
// للتطبيق وبعد كل دخول أو شراء. بلا خادم مضبوط تعمل الطبقة «دون اتصال»:
// لا اشتراك ولا دخول، والتجارب تُسجَّل محليًا فقط.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountContext } from './context.js';
import { PRODUCTS, TRIAL_GAMES } from './config.js';
import { isPremium, lockedPack as lockedPackOf, trialAvailable as trialAvailableOf, gameAccess as gameAccessOf, mergeTrials, shouldRefresh } from './entitlements.js';
import { accountErrorText } from './errors.js';
import { accountStore } from './store.js';
import {
  ClientError, accountOffline, authStartUrl, appleNative, createPaddleCheckout, deleteAccountRequest,
  exchangeCode, getBillingConfig, getMe, getPaddlePortal, mergeTrialsRequest, postAppleTransaction, postTrial, signout,
} from './api.js';
import { callNative, isNativeShell, onNativeEvent } from './native.js';
import { openCheckout, previewPrices } from './paddle.js';
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
  const [ready, setReady] = useState(() => !(accountStore.readSession() && !cached.data));
  const [products, setProducts] = useState(null);
  const [billing, setBilling] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [paywall, setPaywall] = useState({ open: false, reason: 'settings', game: null, pack: null });

  const sessionRef = useRef(session);
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

  const applyMe = useCallback((next) => {
    const stamp = Date.now();
    accountStore.writeMe(next, stamp);
    fetchedRef.current = stamp;
    setMe(next || null);
    setFetchedAt(stamp);
  }, []);

  const applyTrials = useCallback((serverTrials) => {
    if (!serverTrials) return;
    setMe((prev) => {
      const next = { ...(prev || {}), trials: serverTrials };
      accountStore.writeMe(next, fetchedRef.current || Date.now());
      return next;
    });
  }, []);

  const clearLocalAuth = useCallback(() => {
    accountStore.clearAuth();
    sessionRef.current = null;
    fetchedRef.current = 0;
    setSession(null);
    setMe(null);
    setFetchedAt(0);
  }, []);

  // خيارات كل نداء: الرمز الحالي + التقاط تدوير الجلسة المنزلق.
  const options = useCallback(() => ({ token: sessionRef.current || undefined, onSession: applySession }), [applySession]);

  const handleError = useCallback((err) => {
    const code = codeOf(err);
    if (isAuthError(code)) clearLocalAuth();
    setError(code);
    return code;
  }, [clearLocalAuth]);

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
    try {
      const next = await getMe(options());
      applyMe(next);
      flushPending();
      return next;
    } catch (err) {
      const code = codeOf(err);
      if (isAuthError(code)) clearLocalAuth();
      if (isDisabled(code)) setOffline(true);
      return null;
    }
  }, [options, applyMe, flushPending, clearLocalAuth]);

  // بعد أي دخول ناجح: خزّن الجلسة، ادمج علامات هذا الجهاز، ثم رحّب باللاعب.
  const afterSignIn = useCallback(async (result) => {
    if (!result || !result.session || !result.session.token) throw new ClientError('PROVIDER');
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
    const result = await exchangeCode(code, client, { onSession: applySession });
    return afterSignIn(result);
  }, [applySession, afterSignIn]);

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
        return;
      }
      if (accountOffline()) return;
      const config = await getBillingConfig(options());
      setBilling(config || null);
      const paddle = config && config.paddle;
      if (!paddle || !paddle.clientToken) return;
      const prices = await previewPrices(paddle.prices, { clientToken: paddle.clientToken, environment: paddle.environment });
      if (!prices) return;
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
  }, [loadProducts]);
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
        if (!billing) {
          try { setBilling((await getBillingConfig(options())) || null); }
          catch (err) { if (isDisabled(codeOf(err))) { setOffline(true); throw new ClientError('OFFLINE'); } }
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
  }, [native, billing, options, applySession, afterSignIn, consumeCode, waitForAuthReturn, handleError, toast]);

  const signOut = useCallback(async () => {
    setBusy('signout');
    try { if (sessionRef.current && !accountOffline()) await signout(options()); }
    catch (err) { /* الخروج محلي في كل الأحوال */ }
    finally {
      clearLocalAuth();
      setBusy(false);
      setError(null);
      toast('سجّلت الخروج');
    }
  }, [options, clearLocalAuth, toast]);

  const purchase = useCallback(async (plan = 'monthly') => {
    setError(null);
    if (accountOffline()) { setError('OFFLINE'); return null; }
    // داخل التطبيق: الاشتراك يُربط بحساب ليعمل على كل الأجهزة، فالدخول بحساب Apple
    // (ورقة واحدة) يسبق ورقة المتجر حين لا جلسة.
    if (native && !sessionRef.current) {
      const signed = await signIn('apple');
      if (!signed || !sessionRef.current) return null;
    }
    setBusy('purchase');
    try {
      if (native) {
        // appAccountToken = معرّف المستخدم: الخادم يرفض ربط المعاملة بحساب آخر.
        const userId = (meRef.current && meRef.current.user && meRef.current.user.id) || null;
        if (!sessionRef.current || !userId) throw new ClientError('AUTH_REQUIRED');
        const result = await callNative('purchase', { productId: PRODUCTS[plan] || PRODUCTS.monthly, plan, userId }, { timeout: NATIVE_SHEET_TIMEOUT });
        const jws = (result && (result.jws || result.transaction)) || null;
        if (!jws) throw new ClientError('PURCHASE_PENDING');
        const next = await postAppleTransaction(jws, options());
        applyMe(next);
        toast('فُعِّل ميدان بلس');
        closePaywall();
        return next;
      }
      if (!sessionRef.current) throw new ClientError('AUTH_REQUIRED');
      const checkout = await createPaddleCheckout(plan, options());
      await openCheckout({ transactionId: checkout.transactionId, clientToken: checkout.clientToken, environment: checkout.environment });
      const next = await refresh();
      toast('فُعِّل ميدان بلس');
      closePaywall();
      return next;
    } catch (err) {
      const code = handleError(err);
      if (code !== 'PURCHASE_CANCELLED') toast(accountErrorText(code));
      return null;
    } finally {
      setBusy(false);
    }
  }, [native, options, applyMe, refresh, handleError, closePaywall, toast, signIn]);

  const restore = useCallback(async () => {
    setError(null);
    if (!native) { setError('NOT_ELIGIBLE'); return null; }
    if (!sessionRef.current) { setError('AUTH_REQUIRED'); toast(accountErrorText('AUTH_REQUIRED')); return null; }
    setBusy('restore');
    try {
      const jwsList = listOf(await callNative('restore', {}, { timeout: NATIVE_SHEET_TIMEOUT }), 'transactions').filter((value) => typeof value === 'string' && value);
      if (!jwsList.length) throw new ClientError('RESTORE_EMPTY');
      let next = null;
      for (const jws of jwsList) next = await postAppleTransaction(jws, options());
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
      if (native) { await callNative('manageSubscriptions'); return; }
      const result = await getPaddlePortal(options());
      if (result && result.url && typeof location !== 'undefined') location.assign(result.url);
    } catch (err) {
      const code = handleError(err);
      toast(accountErrorText(code));
    }
  }, [native, options, handleError, toast]);

  const deleteAccount = useCallback(async () => {
    setBusy('delete');
    try {
      if (sessionRef.current && !accountOffline()) await deleteAccountRequest(options());
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
  // إقلاع: تحديث في الخلفية إن تقادمت النسخة المخزّنة.
  useEffect(() => {
    let alive = true;
    setOffline(accountOffline());
    (async () => {
      if (sessionRef.current && !accountOffline() && shouldRefresh(fetchedRef.current)) await refresh();
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
    const onVisible = () => { if (document.visibilityState === 'visible' && shouldRefresh(fetchedRef.current)) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

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
    postAppleTransaction(jws, options())
      .then((next) => { if (next) applyMe(next); })
      .catch((err) => { if (isAuthError(codeOf(err))) clearLocalAuth(); });
  }), [options, applyMe, clearLocalAuth]);

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
    ready, user, me, premium, trials, platform, products,
    offline, signedIn: !!session, busy, error, paywall, billing,
    signIn, signOut, refresh,
    markTrial,
    trialAvailable: (game) => trialAvailableOf(me, localTrials.marks, game, premium),
    lockedPack: (id) => lockedPackOf(id, premium),
    gameAccess: (game) => (premium ? 'premium' : gameAccessOf(me, localTrials.marks, game)),
    openPaywall, closePaywall, restore, deleteAccount,
    purchase, manageSubscription, loadProducts,
    clearError: () => setError(null),
    authHeaders: () => (sessionRef.current ? { Authorization: `Bearer ${sessionRef.current}` } : {}),
  }), [ready, user, me, premium, trials, platform, products, offline, session, busy, error, paywall, billing,
    signIn, signOut, refresh, markTrial, localTrials, openPaywall, closePaywall, restore, deleteAccount, purchase, manageSubscription, loadProducts]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
