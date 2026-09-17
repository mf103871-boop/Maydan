// جدار «ميدان بلس»: ورقة سفلية واحدة لكل أسباب القفل. لا خدع: السبب أولًا، ثم
// ما يفتحه الاشتراك، ثم الخطط المتاحة بأسعار المتجر، ثم الشروط بوضوح.
import React, { useEffect, useRef, useState } from 'react';
import { Sheet, Button } from '../ui/components.jsx';
import { ClayStage, TrophyArtwork } from '../brand/art.jsx';
import { useAccount } from './context.js';
import { accountErrorText } from './errors.js';
import { PLUS_NAME, LEGAL_ROUTES, SUPPORT_EMAIL, PUBLIC_SITE_ORIGIN } from './config.js';
import { SignInButtons, SIGN_IN_NOTE } from './SignInSheet.jsx';
import { RedeemForm, REDEEM_PROMPT } from './RedeemSheet.jsx';
import { REDEEM_ON_IOS } from './config.js';
import beepMeta from '../../games/beep/meta.js';
import mamnooMeta from '../../games/mamnoo/meta.js';
import jabeenMeta from '../../games/jabeen/meta.js';
import fabrakaMeta from '../../games/fabraka/meta.js';
import meenfinaMeta from '../../games/meenfina/meta.js';

const GAME_NAMES = {
  [beepMeta.id]: beepMeta.name,
  [mamnooMeta.id]: mamnooMeta.name,
  [jabeenMeta.id]: jabeenMeta.name,
  [fabrakaMeta.id]: fabrakaMeta.name,
  [meenfinaMeta.id]: meenfinaMeta.name,
};

export const PAYWALL_BULLETS = ['كل فئات بَديهة', 'مباريات بلا حدود', 'غرف جماعية بلا حدود', 'اشتراك واحد على كل أجهزتك'];
export const PAYWALL_LEGAL = 'يتجدد الاشتراك تلقائيًا ما لم يُلغَ قبل نهاية الفترة بـ٢٤ ساعة';
export const PRICE_UNKNOWN = 'يُعرض السعر عند الشراء';

export function paywallReason(reason, game) {
  if (reason === 'pack') return 'هذه الفئة ضمن ميدان بلس';
  if (reason === 'trial') return `لعبت مباراتك المجانية في ${GAME_NAMES[game] || 'هذه اللعبة'}. اشترك لتلعب بلا حدود.`;
  if (reason === 'room') return 'بعد الغرفة المجانية يحتاج إنشاء الغرف إلى ميدان بلس. الدخول برمز مجاني دائمًا.';
  if (reason === 'resume') return 'هذه المباراة المحفوظة تحتوي فئات ضمن ميدان بلس.';
  return '';
}

const PLANS = [
  { key: 'monthly', label: 'شهري', fallbackPeriod: 'شهريًا' },
  { key: 'yearly', label: 'سنوي', fallbackPeriod: 'سنويًا' },
];

export function Paywall({ open = true, reason = 'settings', game = null, pack = null, onClose }) {
  const account = useAccount();
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
  if (!open) return null;

  const reasonText = paywallReason(reason, game);
  const products = account.products || null;
  const plans = PLANS.filter((item) => {
    // Do not advertise an annual plan until its price is actually available.
    if (item.key === 'yearly' && !products?.yearly?.price) return false;
    if (account.platform === 'ios') return !products || !!products[item.key];
    if (!account.billing) return item.key === 'monthly';
    return !!account.billing.paddle?.prices?.[item.key];
  });
  const selectedPlan = plans.some((item) => item.key === plan) ? plan : plans[0]?.key;
  const needsSignIn = account.platform !== 'ios' && !account.signedIn;
  const busy = account.busy;
  // قواعد App Store تمنع فتح المحتوى بمفاتيح داخل التطبيق: الرابط للويب فقط.
  const canRedeem = account.platform !== 'ios' || REDEEM_ON_IOS;

  return (
    <Sheet open={open} onClose={onClose} title={null}>
      <section className="paywall" aria-label={`اشتراك ${PLUS_NAME}`} data-reason={reason} data-pack={pack || undefined}>
        <ClayStage className="paywall-hero clay-idle" aria-hidden="true"><TrophyArtwork /></ClayStage>
        <h2 className="paywall-title">افتح كل ميدان مع {PLUS_NAME}</h2>
        {account.platform !== 'ios' && account.billing?.paddle?.environment === 'sandbox' && (
          <p className="online-notice" role="status">الدفع في وضع الاختبار؛ لا تُخصم مبالغ حقيقية. الاشتراك الناتج تجريبي.</p>
        )}
        {reasonText && <p className="paywall-reason">{reasonText}</p>}
        {redeeming ? (
          <RedeemForm onDone={onClose} onCancel={cancelRedeem} />
        ) : (
          <>
        <ul className="paywall-bullets">
          {PAYWALL_BULLETS.map((text, i) => <li key={text} style={{ '--n': i }}>{text}</li>)}
        </ul>
        <div className="paywall-plans" role="radiogroup" aria-label="اختر مدة الاشتراك">
          {plans.map((item) => {
            const product = products && products[item.key];
            const selected = selectedPlan === item.key;
            return (
              <button key={item.key} type="button" role="radio" aria-checked={selected} data-plan={item.key}
                className={`paywall-plan ${selected ? 'is-selected' : ''}`} onClick={() => setPlan(item.key)}>
                <span className="paywall-plan-name">{item.label}</span>
                <span className="paywall-plan-price">{product && product.price ? product.price : PRICE_UNKNOWN}</span>
                <span className="paywall-plan-period">{(product && product.period) || item.fallbackPeriod}</span>
              </button>
            );
          })}
        </div>
        {!plans.length && <p className="online-notice" role="status">الاشتراك غير متاح حاليًا؛ حاول لاحقًا.</p>}
        {needsSignIn ? (
          <div className="paywall-auth">
            <p className="paywall-note">{SIGN_IN_NOTE}</p>
            <SignInButtons />
          </div>
        ) : (
          <>
            {account.platform === 'ios' && !account.signedIn && <p className="paywall-note">{SIGN_IN_NOTE}</p>}
            <Button variant="primary" size="lg" full disabled={!!account.activationPending || !selectedPlan} loading={busy === 'purchase' || busy === 'signin'} onClick={() => account.purchase && account.purchase(selectedPlan)}>اشترك</Button>
            {account.activationPending && <Button variant="secondary" full onClick={() => account.refresh()}>تحديث حالة الاشتراك</Button>}
          </>
        )}
        {account.platform === 'ios' && (
          <Button variant="ghost" full loading={busy === 'restore'} onClick={() => account.restore && account.restore()}>استعادة المشتريات</Button>
        )}
        {canRedeem && (
          <button type="button" ref={redeemTrigger} className="btn btn-ghost btn-full paywall-redeem" onClick={() => setRedeeming(true)}>{REDEEM_PROMPT}</button>
        )}
        {account.error && !needsSignIn && <p className="online-notice error" role="alert">{accountErrorText(account.error)}</p>}
        {account.error === 'CHECKOUT_REVIEW' && !needsSignIn && SUPPORT_EMAIL && (
          <a className="btn btn-ghost btn-full" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('مراجعة محاولة دفع ميدان')}`}>التواصل مع الدعم</a>
        )}
        <p className="paywall-legal">
          {PAYWALL_LEGAL}
          <span className="paywall-legal-links">
            {account.platform !== 'ios' && <><a data-legal="pricing" href="/pricing/" onClick={onClose}>التسعير</a><span aria-hidden="true"> · </span></>}
            <a data-legal="terms" href={LEGAL_ROUTES.terms} onClick={onClose}>شروط الاستخدام</a>
            <span aria-hidden="true"> · </span>
            <a data-legal="privacy" href={LEGAL_ROUTES.privacy} onClick={onClose}>سياسة الخصوصية</a>
            <span aria-hidden="true"> · </span>
            <a data-legal="refunds" href={account.platform === 'ios' ? `${PUBLIC_SITE_ORIGIN}/refunds/` : '/refunds/'} onClick={onClose}>سياسة الاسترداد</a>
          </span>
        </p>
          </>
        )}
      </section>
    </Sheet>
  );
}
