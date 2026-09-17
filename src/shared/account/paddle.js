// Paddle.js على الويب فقط: يُحمّل كسولًا من CDN مرة واحدة، ولا يُحمّل أبدًا داخل
// غلاف iOS (قواعد آبل: الشراء داخل التطبيق عبر StoreKit وحده).
import { ClientError } from '../../online/client.js';
import { isNativeShell } from './native.js';

export const PADDLE_SRC = 'https://cdn.paddle.com/paddle/v2/paddle.js';
export const PERIOD_TEXT = { month: 'شهريًا', year: 'سنويًا' };

let scriptPromise = null;
let initializedToken = '';
let initializedEnvironment = '';
let configuredPaddle = null;
let configurationChanged = false;
let customerIdentity = null;
let customerRevision = 0;
let appliedCustomerId = '';
let activeCheckout = null;

const validCustomerId = (id) => typeof id === 'string' && /^ctm_[a-z0-9]{26}$/.test(id);
export function retainCustomer(identity, environment) {
  return environment === 'production' && identity?.environment === 'production' && validCustomerId(identity.customerId)
    ? { id: identity.customerId } : {};
}

function applyCustomer(Paddle, force = false) {
  const pwCustomer = configurationChanged ? {} : retainCustomer(customerIdentity, initializedEnvironment);
  if (force || appliedCustomerId !== (pwCustomer.id || '')) {
    Paddle.Update({ pwCustomer });
    appliedCustomerId = pwCustomer.id || '';
  }
}

// Called only with a fresh authenticated /api/me response, never cached profile data.
export function setPaddleCustomer(identity) {
  const next = identity && ['sandbox', 'production'].includes(identity.environment) && validCustomerId(identity.customerId)
    ? { environment: identity.environment, customerId: identity.customerId } : null;
  if (next?.environment !== customerIdentity?.environment || next?.customerId !== customerIdentity?.customerId) customerRevision++;
  customerIdentity = next;
  if (configuredPaddle) {
    try { applyCustomer(configuredPaddle); } catch { clearPaddleCustomer(); }
  }
}

export function clearPaddleCustomer() {
  customerRevision++; // Also invalidates a pending checkout before a customer exists.
  customerIdentity = null;
  if (configuredPaddle) {
    try { applyCustomer(configuredPaddle, true); } catch { configurationChanged = true; }
  }
  if (activeCheckout) {
    const pending = activeCheckout;
    activeCheckout = null;
    clearTimeout(pending.timer);
    pending.reject(new ClientError('PURCHASE_CANCELLED'));
    try { configuredPaddle?.Checkout?.close(); } catch { /* already closed */ }
  }
}

// الأحداث تصل عبر eventCallback واحد، فيُترجم إلى وعد عملية الشراء الجارية.
export function paddleEventCallback(event) {
  const name = event && event.name;
  if (!name || !activeCheckout) return;
  if (name === 'checkout.completed') {
    const current = activeCheckout;
    activeCheckout = null;
    clearTimeout(current.timer);
    current.resolve((event && event.data) || null);
  } else if (name === 'checkout.closed') {
    // إغلاق بلا اكتمال = إلغاء من اللاعب.
    const current = activeCheckout;
    activeCheckout = null;
    clearTimeout(current.timer);
    current.reject(new ClientError('PURCHASE_CANCELLED'));
  }
}

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.Paddle) { resolve(window.Paddle); return; }
    if (typeof document === 'undefined') { reject(new ClientError('NETWORK')); return; }
    const existing = document.querySelector(`script[src="${PADDLE_SRC}"]`);
    const el = existing || document.createElement('script');
    const done = () => (typeof window !== 'undefined' && window.Paddle ? resolve(window.Paddle) : reject(new ClientError('NETWORK')));
    el.addEventListener('load', done);
    el.addEventListener('error', () => reject(new ClientError('NETWORK')));
    if (!existing) {
      el.src = PADDLE_SRC;
      el.async = true;
      document.head.appendChild(el);
    }
  }).catch((error) => { scriptPromise = null; throw error; });
  return scriptPromise;
}

export async function loadPaddle({ clientToken, environment, checkoutEnabled } = {}) {
  if (isNativeShell()) throw new ClientError('NOT_ELIGIBLE');
  // Paddle.js auto-opens receipt transactions during Initialize, even when the
  // caller intended only Retain or price previews on another app route.
  if (checkoutEnabled === false && typeof location !== 'undefined'
      && new URLSearchParams(location.search || '').has('_ptxn')) throw new ClientError('CHECKOUT_DISABLED');
  const selectedEnvironment = environment || 'production';
  if (!['sandbox', 'production'].includes(selectedEnvironment)
      || typeof clientToken !== 'string'
      || !clientToken.startsWith(selectedEnvironment === 'sandbox' ? 'test_' : 'live_')) {
    if (configuredPaddle) configurationChanged = true;
    clearPaddleCustomer();
    throw new ClientError('NETWORK');
  }
  const Paddle = await loadScript();
  if (configurationChanged || (initializedToken && (initializedToken !== clientToken || initializedEnvironment !== selectedEnvironment))
      || (!initializedToken && Paddle.Initialized)) {
    configurationChanged = true;
    configuredPaddle = Paddle;
    clearPaddleCustomer();
    // Initialize is once per document; Update cannot change its token or environment.
    throw new ClientError('BILLING_CONFIG_CHANGED');
  }
  if (!initializedToken) {
    try {
      if (selectedEnvironment === 'sandbox') Paddle.Environment.set('sandbox');
      const pwCustomer = retainCustomer(customerIdentity, selectedEnvironment);
      Paddle.Initialize({ token: clientToken, pwCustomer, eventCallback: paddleEventCallback });
      initializedToken = clientToken;
      initializedEnvironment = selectedEnvironment;
      configuredPaddle = Paddle;
      appliedCustomerId = pwCustomer.id || '';
    } catch (error) {
      throw new ClientError('NETWORK');
    }
  } else {
    try { applyCustomer(Paddle); } catch { clearPaddleCustomer(); throw new ClientError('NETWORK'); }
  }
  return Paddle;
}

// يفتح نافذة الدفع لمعاملة أنشأها الخادم؛ يُحلّ عند checkout.completed
// ويُرفض بـ PURCHASE_CANCELLED عند الإغلاق بلا اكتمال.
export function openCheckout({ transactionId, clientToken, environment, checkoutEnabled, timeout = 15 * 60_000 } = {}) {
  return (async () => {
    if (!transactionId) throw new ClientError('INVALID');
    if (checkoutEnabled === false) throw new ClientError('CHECKOUT_DISABLED');
    const revision = customerRevision;
    const Paddle = await loadPaddle({ clientToken: clientToken || initializedToken, environment: environment || initializedEnvironment || undefined });
    if (revision !== customerRevision) throw new ClientError('PURCHASE_CANCELLED');
    if (activeCheckout) { activeCheckout.reject(new ClientError('PURCHASE_CANCELLED')); clearTimeout(activeCheckout.timer); activeCheckout = null; }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { activeCheckout = null; reject(new ClientError('NETWORK')); }, timeout);
      activeCheckout = { resolve, reject, timer };
      try {
        Paddle.Checkout.open({ transactionId });
      } catch (error) {
        clearTimeout(timer);
        activeCheckout = null;
        reject(new ClientError('NETWORK'));
      }
    });
  })();
}

function readLineItem(item) {
  const price = (item && item.formattedTotals && (item.formattedTotals.total || item.formattedTotals.subtotal)) || '';
  const interval = item && item.price && item.price.billingCycle && item.price.billingCycle.interval;
  return { price: String(price || ''), period: PERIOD_TEXT[interval] || '' };
}

// previewPrices({ monthly, yearly }) → { monthly:{price,period}, yearly:{…} } أو null عند أي فشل.
export async function previewPrices(priceIds, { clientToken, environment, checkoutEnabled } = {}) {
  const ids = priceIds || {};
  const wanted = Object.entries(ids).filter(([, value]) => typeof value === 'string' && value);
  if (!wanted.length) return null;
  try {
    const Paddle = clientToken ? await loadPaddle({ clientToken, environment, checkoutEnabled }) : (typeof window !== 'undefined' ? window.Paddle : null);
    if (!Paddle || typeof Paddle.PricePreview !== 'function') return null;
    const response = await Paddle.PricePreview({ items: wanted.map(([, priceId]) => ({ priceId, quantity: 1 })) });
    const lines = (response && response.data && response.data.details && response.data.details.lineItems) || [];
    const out = {};
    for (const [plan, priceId] of wanted) {
      const item = lines.find((line) => line && line.price && line.price.id === priceId);
      if (item) out[plan] = readLineItem(item);
    }
    return Object.keys(out).length ? out : null;
  } catch (error) {
    return null;
  }
}

// للاختبارات: نسيان السكربت والمعاملة الجارية.
export function resetPaddleForTests() {
  scriptPromise = null;
  initializedToken = '';
  initializedEnvironment = '';
  configuredPaddle = null;
  configurationChanged = false;
  customerIdentity = null;
  customerRevision = 0;
  appliedCustomerId = '';
  if (activeCheckout) clearTimeout(activeCheckout.timer);
  activeCheckout = null;
}
