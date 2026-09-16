// جدار «ميدان بلس»: ورقة سفلية واحدة لكل أسباب القفل. لا خدع: السبب أولًا، ثم
// ما يفتحه الاشتراك، ثم الخطتان بأسعار المتجر، ثم الشروط بوضوح.
import React, { useEffect, useState } from 'react';
import { Sheet, Button } from '../ui/components.jsx';
import { ClayStage, TrophyArtwork } from '../brand/art.jsx';
import { useAccount } from './context.js';
import { accountErrorText } from './errors.js';
import { PLUS_NAME } from './config.js';
import { SignInButtons, SIGN_IN_NOTE } from './SignInSheet.jsx';
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
  { key: 'yearly', label: 'سنوي', fallbackPeriod: 'سنويًا', best: true },
];

export function Paywall({ open = true, reason = 'settings', game = null, pack = null, onClose }) {
  const account = useAccount();
  const [plan, setPlan] = useState('yearly');
  const loadProducts = account.loadProducts;
  useEffect(() => { if (open && loadProducts) loadProducts(); }, [open, loadProducts]);
  if (!open) return null;

  const reasonText = paywallReason(reason, game);
  const products = account.products || null;
  const needsSignIn = account.platform !== 'ios' && !account.signedIn;
  const busy = account.busy;

  return (
    <Sheet open={open} onClose={onClose} title={null}>
      <section className="paywall" aria-label={`اشتراك ${PLUS_NAME}`} data-reason={reason} data-pack={pack || undefined}>
        <ClayStage className="paywall-hero clay-idle" aria-hidden="true"><TrophyArtwork /></ClayStage>
        <h2 className="paywall-title">افتح كل ميدان مع {PLUS_NAME}</h2>
        {reasonText && <p className="paywall-reason">{reasonText}</p>}
        <ul className="paywall-bullets">
          {PAYWALL_BULLETS.map((text, i) => <li key={text} style={{ '--n': i }}>{text}</li>)}
        </ul>
        <div className="paywall-plans" role="radiogroup" aria-label="اختر مدة الاشتراك">
          {PLANS.map((item) => {
            const product = products && products[item.key];
            const selected = plan === item.key;
            return (
              <button key={item.key} type="button" role="radio" aria-checked={selected} data-plan={item.key}
                className={`paywall-plan ${selected ? 'is-selected' : ''}`} onClick={() => setPlan(item.key)}>
                <span className="paywall-plan-name">{item.label}{item.best && <span className="badge badge-accent">الأوفر</span>}</span>
                <span className="paywall-plan-price">{product && product.price ? product.price : PRICE_UNKNOWN}</span>
                <span className="paywall-plan-period">{(product && product.period) || item.fallbackPeriod}</span>
              </button>
            );
          })}
        </div>
        {needsSignIn ? (
          <div className="paywall-auth">
            <p className="paywall-note">{SIGN_IN_NOTE}</p>
            <SignInButtons />
          </div>
        ) : (
          <>
            {account.platform === 'ios' && !account.signedIn && <p className="paywall-note">{SIGN_IN_NOTE}</p>}
            <Button variant="primary" size="lg" full loading={busy === 'purchase' || busy === 'signin'} onClick={() => account.purchase && account.purchase(plan)}>اشترك</Button>
          </>
        )}
        {account.platform === 'ios' && (
          <Button variant="ghost" full loading={busy === 'restore'} onClick={() => account.restore && account.restore()}>استعادة المشتريات</Button>
        )}
        {account.error && !needsSignIn && <p className="online-notice error" role="alert">{accountErrorText(account.error)}</p>}
        <p className="paywall-legal">
          {PAYWALL_LEGAL}
          <span className="paywall-legal-links">
            {/* المرحلة 3 تستبدل الوجهة بصفحات حقيقية؛ data-legal يثبّت نقطة الوصل. */}
            <a data-legal="terms" href="#/about">شروط الاستخدام</a>
            <span aria-hidden="true"> · </span>
            <a data-legal="privacy" href="#/about">سياسة الخصوصية</a>
          </span>
        </p>
      </section>
    </Sheet>
  );
}
