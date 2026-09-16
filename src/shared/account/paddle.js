// Paddle.js على الويب فقط: يُحمّل كسولًا من CDN مرة واحدة، ولا يُحمّل أبدًا داخل
// غلاف iOS (قواعد آبل: الشراء داخل التطبيق عبر StoreKit وحده).
import { ClientError } from '../../online/client.js';
import { isNativeShell } from './native.js';

export const PADDLE_SRC = 'https://cdn.paddle.com/paddle/v2/paddle.js';
export const PERIOD_TEXT = { month: 'شهريًا', year: 'سنويًا' };

let scriptPromise = null;
let initializedToken = '';
let activeCheckout = null;

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

export async function loadPaddle({ clientToken, environment } = {}) {
  if (isNativeShell()) throw new ClientError('NOT_ELIGIBLE');
  if (!clientToken) throw new ClientError('NETWORK');
  const Paddle = await loadScript();
  if (initializedToken !== clientToken) {
    try {
      if (environment && Paddle.Environment && typeof Paddle.Environment.set === 'function') Paddle.Environment.set(environment);
      Paddle.Initialize({ token: clientToken, eventCallback: paddleEventCallback });
      initializedToken = clientToken;
    } catch (error) {
      throw new ClientError('NETWORK');
    }
  }
  return Paddle;
}

// يفتح نافذة الدفع لمعاملة أنشأها الخادم؛ يُحلّ عند checkout.completed
// ويُرفض بـ PURCHASE_CANCELLED عند الإغلاق بلا اكتمال.
export function openCheckout({ transactionId, clientToken, environment, timeout = 15 * 60_000 } = {}) {
  return (async () => {
    if (!transactionId) throw new ClientError('INVALID');
    const Paddle = await loadPaddle({ clientToken: clientToken || initializedToken, environment });
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
export async function previewPrices(priceIds, { clientToken, environment } = {}) {
  const ids = priceIds || {};
  const wanted = Object.entries(ids).filter(([, value]) => typeof value === 'string' && value);
  if (!wanted.length) return null;
  try {
    const Paddle = clientToken ? await loadPaddle({ clientToken, environment }) : (typeof window !== 'undefined' ? window.Paddle : null);
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
  if (activeCheckout) clearTimeout(activeCheckout.timer);
  activeCheckout = null;
}
