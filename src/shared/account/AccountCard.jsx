// بطاقة الحساب في الإعدادات: الحالة، الاشتراك، وكل ما تشترطه المتاجر
// (إدارة الاشتراك، استعادة المشتريات، الخروج، وحذف الحساب).
import React, { useEffect, useState } from 'react';
import { Button, Card, ConfirmModal } from '../ui/components.jsx';
import { IconUsers, IconStar, IconRotate, IconTrash, IconBack } from '../ui/icons.jsx';
import { useAccount } from './context.js';
import { PLUS_NAME } from './config.js';
import { isPremium } from './entitlements.js';
import { accountErrorText } from './errors.js';
import { SignInSheet } from './SignInSheet.jsx';
import { RedeemSheet, REDEEM_PROMPT } from './RedeemSheet.jsx';
import { REDEEM_ON_IOS } from './config.js';
import { navigate } from '../../platform/router.js';

const SOURCE_TEXT = { apple: 'عبر App Store', paddle: 'عبر الويب', promo: 'برمز هدية' };

export function formatUntil(value) {
  const stamp = Number(value);
  if (!Number.isFinite(stamp) || stamp <= 0) return '';
  try { return new Date(stamp).toLocaleDateString('ar-EG-u-nu-arab', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (error) { return new Date(stamp).toISOString().slice(0, 10); }
}

export function subscriptionLine(me, premium, promo = null, now = Date.now()) {
  if (!premium) return 'غير مشترك';
  const info = (me && me.premium) || {};
  // اشتراك الخادم يُذكر فقط إن كان ساريًا؛ منتهٍ + رمز على الجهاز = «برمز هدية».
  const serverActive = isPremium(me, now);
  const source = serverActive ? info.source : (promo ? 'promo' : null);
  // رمز الهدية دائم عمليًا: لا يُعرض له تاريخ انتهاء.
  const until = source === 'promo' ? '' : formatUntil(info.until);
  const sourceText = SOURCE_TEXT[source] || '';
  return `${PLUS_NAME} فعّال${until ? ` حتى ${until}` : ''}${sourceText ? ` · ${sourceText}` : ''}`;
}

export function AccountCard() {
  const account = useAccount();
  const { signedIn, refresh } = account;
  useEffect(() => { if (signedIn) refresh(); }, [signedIn, refresh]);
  const [signIn, setSignIn] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [redeem, setRedeem] = useState(false);
  const user = account.user;
  const ios = account.platform === 'ios';
  const canRedeem = !account.premium && (!ios || REDEEM_ON_IOS);
  const managed = account.premium && isPremium(account.me) && account.me.premium.source !== 'promo';
  const redeemButton = canRedeem ? <Button variant="ghost" onClick={() => setRedeem(true)}>{REDEEM_PROMPT}</Button> : null;

  return (
    <Card className="stack account-card" aria-label="الحساب">
      <div className="row"><IconUsers style={{ color: 'var(--accent)' }} /><span className="card-title">الحساب</span></div>
      {!user ? (
        <>
          <p className="card-muted">الحساب: غير مسجّل</p>
          {account.promo && <p className="account-plan is-plus">{subscriptionLine(account.me, account.premium, account.promo)} · على هذا الجهاز</p>}
          <p className="card-muted">سجّل الدخول ليعمل اشتراك {PLUS_NAME} على كل أجهزتك.</p>
          {account.offline
            ? <p className="online-notice" role="status">{accountErrorText('OFFLINE')}</p>
            : <Button variant="primary" onClick={() => setSignIn(true)}>تسجيل الدخول</Button>}
          {redeemButton}
        </>
      ) : (
        <>
          <div className="account-identity">
            <b>{user.name || 'لاعب ميدان'}</b>
            {user.email && <small className="muted">{user.email}</small>}
          </div>
          <Button variant="secondary" icon={<IconUsers />} onClick={() => navigate('/profile')}>بروفايلي وإنجازاتي</Button>
          <p className={`account-plan ${account.premium ? 'is-plus' : ''}`}>{subscriptionLine(account.me, account.premium, account.promo)}</p>
          {!account.premium && (
            <Button variant="primary" icon={<IconStar />} onClick={() => account.openPaywall({ reason: 'settings' })}>اشترك في {PLUS_NAME}</Button>
          )}
          {redeemButton}
          {managed && (
            <Button variant="secondary" onClick={() => account.manageSubscription()}>إدارة الاشتراك</Button>
          )}
          {ios && (
            <Button variant="secondary" icon={<IconRotate />} loading={account.busy === 'restore'} onClick={() => account.restore()}>استعادة المشتريات</Button>
          )}
          <Button variant="ghost" icon={<IconBack />} loading={account.busy === 'signout'} onClick={() => account.signOut()}>تسجيل الخروج</Button>
          <Button variant="danger" icon={<IconTrash />} onClick={() => setConfirmDelete(true)}>حذف الحساب</Button>
        </>
      )}
      {account.error && <p className="online-notice error" role="alert">{accountErrorText(account.error)}</p>}
      <SignInSheet open={signIn} onClose={() => setSignIn(false)} />
      <RedeemSheet open={redeem} onClose={() => setRedeem(false)} />
      {confirmDelete && (
        <ConfirmModal title="حذف الحساب؟" danger
          message="سيُحذف حسابك وسجل اشتراكك من خوادمنا نهائيًا ولا يمكن التراجع. إن كان اشتراكك عبر App Store فألغِه من إعدادات جهازك أيضًا."
          confirmLabel="نعم، احذف الحساب" cancelLabel="إلغاء"
          onConfirm={async () => { setConfirmDelete(false); await account.deleteAccount(); }}
          onCancel={() => setConfirmDelete(false)} />
      )}
    </Card>
  );
}
