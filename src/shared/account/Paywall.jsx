import { tr } from '../i18n/core.js';
// جدار «ميدان بلس»: ورقة سفلية واحدة لكل أسباب القفل. لا خدع: السبب أولًا، ثم
// ما يفتحه الاشتراك، ثم الخطط المتاحة بأسعار المتجر، ثم الشروط بوضوح.
import React, { useEffect, useRef, useState } from 'react';
import { Sheet, Button } from '../ui/components.jsx';
import { ClayStage, TrophyArtwork } from '../brand/art.jsx';
import { useAccount } from './context.js';
import { accountErrorText } from './errors.js';
import { catalogSupportText } from './catalog-diagnostics.js';
import { PLUS_NAME, LEGAL_ROUTES, SUPPORT_EMAIL, PUBLIC_SITE_ORIGIN } from './config.js';
import { SignInButtons, SIGN_IN_NOTE } from './SignInSheet.jsx';
import { RedeemForm, REDEEM_PROMPT } from './RedeemSheet.jsx';
import { REDEEM_ON_IOS } from './config.js';
import { isPremium } from './entitlements.js';
import { resolveAccountServer } from './api.js';
import { useAcceptedFeedback } from '../fx/accepted-feedback.js';
import { entryPolicyEnabled } from './gameplay-policy.mjs';
export const PAYWALL_BULLETS = ['شكل متكامل لبروفايلك مع بقاء صورتك الشخصية', 'إطارات مميزة لصورتك، تختارها وتستخدمها بشكل مستقل'];
export const PAYWALL_LEGAL = 'يتجدد الاشتراك تلقائيًا ما لم يُلغَ قبل نهاية الفترة بـ٢٤ ساعة';
export const PRICE_UNKNOWN = 'يُعرض السعر عند الشراء';

export function paywallReason(reason, game, gameplayPolicy) {
  if (entryPolicyEnabled(gameplayPolicy)) return tr("بلس يتيح بدء المباريات دون تذاكر إعلانات، مع أشكال البروفايل والإطارات. أول مباراة لكل لعبة مجانية؛ بعدها تذكرة إعلان لمباراة كاملة أو بلس. جميع الحزم مشمولة، وضيوف الغرف مجانًا مع المضيف، دون أفضلية في اللعب.");
  if (gameplayPolicy) return tr("بلس يتيح بدء المباريات دون تذاكر إعلانات، مع أشكال البروفايل والإطارات. تبقى أول مباراة لكل لعبة والحزم الأساسية والانضمام إلى الغرف مجانية؛ لا أفضلية في اللعب.");
  return tr("كل الألعاب والحزم والغرف مجانية. بلس يضيف لمستك الخاصة، دون أفضلية في اللعب.");
}

const PLANS = [
  { key: 'monthly', label: 'شهري', fallbackPeriod: 'شهريًا' },
  { key: 'yearly', label: 'سنوي', fallbackPeriod: 'سنويًا' },
];

export function Paywall({ open = true, reason = 'settings', game = null, pack = null, onClose }) {
  const account = useAccount();
  const accepted = useAcceptedFeedback(`${resolveAccountServer()}:${account.user?.id || 'guest'}:${open}`);
  const purchaseFeedback = async (action, ...args) => {
    const feedback = accepted.begin();
    try {
      const result = await action?.(...args);
      if (account.user?.id && result?.user?.id === account.user.id && isPremium(result)) feedback.confirm();
    } catch (error) { feedback.error(error); }
  };
  const [plan, setPlan] = useState('monthly');
  const [redeeming, setRedeeming] = useState(false);
  const redeemTrigger = useRef(null);
  const cancelRedeem = () => {
    setRedeeming(false);
    // التركيز يعود إلى الزر الذي فتح النموذج بدل الضياع في body داخل الورقة.
    setTimeout(() => { if (redeemTrigger.current) redeemTrigger.current.focus(); }, 0);
  };
  const loadProducts = account.loadProducts;
  useEffect(() => { if (open && loadProducts) loadProducts(); }, [open, loadProducts]);
  // كل فتح يبدأ بالخطط لا بنموذج الرمز: المكوّن يبقى مركّبًا بين فتحتين.
  useEffect(() => { if (open) setRedeeming(false); }, [open]);
  useEffect(() => {
    if (account.platform !== 'ios' || account.productsStatus !== 'ready') return;
    setPlan((current) => account.products?.[current]?.price?.trim() ? current :
      PLANS.find((item) => account.products?.[item.key]?.price?.trim())?.key || current);
  }, [account.platform, account.products, account.productsStatus]);
  if (!open) return null;

  const reasonText = paywallReason(reason, game, account.gameplayPolicy);
  const products = account.products || null;
  const native = account.platform === 'ios';
  const productsLoading = native && (account.productsStatus === 'idle' || account.productsStatus === 'loading');
  const productsUnavailable = native && account.productsStatus === 'unavailable';
  const plans = PLANS.filter((item) => {
    if (account.platform === 'android') return false;
    if (native) return (account.productsStatus === 'ready' || productsLoading) && !!products?.[item.key]?.price?.trim();
    // Do not advertise an annual plan until its price is actually available.
    if (item.key === 'yearly' && !products?.yearly?.price) return false;
    if (!account.billing) return item.key === 'monthly';
    return !!account.billing.paddle?.prices?.[item.key];
  });
  const selectedPlan = plans.some((item) => item.key === plan) ? plan : plans[0]?.key;
  const partialCatalog = native && account.productsStatus === 'ready' && plans.length < PLANS.length;
  const needsSignIn = account.platform !== 'ios' && !account.signedIn;
  const busy = account.busy;
  // قواعد App Store تمنع فتح المحتوى بمفاتيح داخل التطبيق: الرابط للويب فقط.
  const canRedeem = account.platform !== 'android' && (account.platform !== 'ios' || REDEEM_ON_IOS);

  return (
    <Sheet open={open} onClose={onClose} title={null}>
      <section data-design-screen="account.paywall" className="paywall" aria-label={tr("اشتراك {v0}", {v0: tr(PLUS_NAME)})} data-reason={reason} data-pack={pack || undefined}>
        <ClayStage className="paywall-hero clay-idle" aria-hidden="true"><TrophyArtwork /></ClayStage>
        <h2 className="paywall-title">{tr("خلّي لك بصمة مع ")}{tr(PLUS_NAME)}</h2>
        {account.platform !== 'ios' && account.billing?.paddle?.environment === 'sandbox' && (
          <p className="online-notice" role="status">{tr("الدفع في وضع الاختبار؛ لا تُخصم مبالغ حقيقية. الاشتراك الناتج تجريبي.")}</p>
        )}
        {reasonText && <p className="paywall-reason">{reasonText}</p>}
        {account.platform === 'android' && <p role="status">{tr("شراء بلس عبر Google Play غير متاح في هذه النسخة التجريبية.")}</p>}
        {redeeming ? (
          <RedeemForm onDone={onClose} onCancel={cancelRedeem} />
        ) : (
          <>
        <p className="paywall-reason">{tr("المزايا متاحة أثناء الاستحقاق فقط؛ نحفظ اختياراتك إذا انتهى الاشتراك.")}</p>
        <ul className="paywall-bullets">
          {PAYWALL_BULLETS.map((text, i) => <li key={text} style={{ '--n': i }}>{tr(text)}</li>)}
        </ul>
        <div data-design-id="products" className="paywall-plans" role="radiogroup" aria-label={tr("اختر مدة الاشتراك")}>
          {plans.map((item) => {
            const product = products && products[item.key];
            const selected = selectedPlan === item.key;
            return (
              <button key={item.key} data-design-id="plan-option" type="button" role="radio" aria-checked={selected} data-plan={item.key}
                className={`paywall-plan ${selected ? 'is-selected' : ''}`} onClick={() => setPlan(item.key)}>
                <span className="paywall-plan-name">{tr(item.label)}</span>
                <span className="paywall-plan-price">{product && product.price ? product.price : tr(PRICE_UNKNOWN)}</span>
                <span className="paywall-plan-period">{tr(item.fallbackPeriod)}</span>
              </button>
            );
          })}
        </div>
        {productsLoading && <p className="online-notice" role="status">{tr("جارٍ تحميل أسعار App Store…")}</p>}
        {productsUnavailable && (
          <>
            <p className="online-notice error" role="status">{accountErrorText(account.productsError || 'APPLE_PRODUCTS_UNAVAILABLE')}</p>
            <Button variant="secondary" full onClick={() => account.retryProducts && account.retryProducts()}>{tr("إعادة تحميل الأسعار")}</Button>
            {account.productsDiagnostics && <details className="paywall-support">
              <summary>{tr("تفاصيل المشكلة للدعم")}</summary>
              <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textAlign: 'left', fontSize: '0.8rem' }}>{catalogSupportText(account.productsDiagnostics)}</pre>
              {account.probeStore && <Button variant="secondary" full loading={account.storeProbeStatus === 'loading'} onClick={() => account.probeStore()}>{tr("فحص المتجر للدعم")}</Button>}
              {account.storeProbeDiagnostics && <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textAlign: 'left', fontSize: '0.8rem' }}>{catalogSupportText(account.storeProbeDiagnostics)}</pre>}
            </details>}
          </>
        )}
        {partialCatalog && <Button variant="secondary" full onClick={() => account.retryProducts && account.retryProducts()}>{tr("إعادة تحميل الأسعار")}</Button>}
        {!native && !plans.length && <p className="online-notice" role="status">{tr("الاشتراك غير متاح حاليًا؛ حاول لاحقًا.")}</p>}
        {needsSignIn ? (
          <div className="paywall-auth">
            <p className="paywall-note">{tr(SIGN_IN_NOTE)}</p>
            <SignInButtons />
          </div>
        ) : (
          <>
            {account.platform === 'ios' && !account.signedIn && <p className="paywall-note">{tr(SIGN_IN_NOTE)}</p>}
            <Button data-sound="none" variant="primary" size="lg" full disabled={!!account.activationPending || !selectedPlan || productsLoading} loading={busy === 'purchase' || busy === 'signin'} data-design-id="purchase" onClick={() => purchaseFeedback(account.purchase, selectedPlan)}>{tr("اشترك")}</Button>
            {account.activationPending && <Button variant="secondary" full onClick={() => account.refresh()}>{tr("تحديث حالة الاشتراك")}</Button>}
          </>
        )}
        {account.platform === 'ios' && (
          <Button data-sound="none" variant="ghost" full loading={busy === 'restore'} data-design-id="restore" data-design-required="true" onClick={() => purchaseFeedback(account.restore)}>{tr("استعادة المشتريات")}</Button>
        )}
        {native && account.restoreDiagnostics && <details className="paywall-support">
          <summary>{tr("تفاصيل الاستعادة للدعم")}</summary>
          <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textAlign: 'left', fontSize: '0.8rem' }}>{catalogSupportText(account.restoreDiagnostics)}</pre>
        </details>}
        {canRedeem && (
          <button type="button" ref={redeemTrigger} className="btn btn-ghost btn-full paywall-redeem" onClick={() => setRedeeming(true)}>{tr(REDEEM_PROMPT)}</button>
        )}
        {account.error && !needsSignIn && !(productsUnavailable && account.error === 'APPLE_PRODUCTS_UNAVAILABLE') && <p className="online-notice error" role="alert">{accountErrorText(account.error)}</p>}
        {account.error === 'CHECKOUT_REVIEW' && !needsSignIn && SUPPORT_EMAIL && (
          <a className="btn btn-ghost btn-full" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(tr("مراجعة محاولة دفع ميدان"))}`}>{tr("التواصل مع الدعم")}</a>
        )}
        <p data-design-id="legal" data-design-required="true" className="paywall-legal">
          {tr(PAYWALL_LEGAL)}
          <span className="paywall-legal-links">
            {account.platform !== 'ios' && <><a data-design-id="legal-pricing" data-legal="pricing" href="pricing/" onClick={onClose}>{tr("التسعير")}</a><span aria-hidden="true"> · </span></>}
            <a data-design-id="legal-terms" data-design-required="true" data-legal="terms" href={LEGAL_ROUTES.terms} onClick={onClose}>{tr("شروط الاستخدام")}</a>
            <span aria-hidden="true"> · </span>
            <a data-design-id="legal-privacy" data-design-required="true" data-legal="privacy" href={LEGAL_ROUTES.privacy} onClick={onClose}>{tr("سياسة الخصوصية")}</a>
            <span aria-hidden="true"> · </span>
            <a data-design-id="legal-refunds" data-design-required="true" data-legal="refunds" href={account.platform === 'ios' ? `${PUBLIC_SITE_ORIGIN}/refunds/` : 'refunds/'} onClick={onClose}>{tr("سياسة الاسترداد")}</a>
          </span>
        </p>
          </>
        )}
      </section>
    </Sheet>
  );
}
