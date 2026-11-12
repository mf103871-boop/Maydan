import { tr, getUiLocale } from '../i18n/core.js';
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
import { REDEEM_ON_IOS, SUPPORT_EMAIL } from './config.js';
import { navigate } from '../../platform/router.js';
import { resolveAccountServer } from './api.js';
import { useAcceptedFeedback } from '../fx/accepted-feedback.js';

const SOURCE_TEXT = { apple: 'عبر App Store', paddle: 'عبر الويب', promo: 'برمز هدية' };

export function formatUntil(value) {
  const stamp = Number(value);
  if (!Number.isFinite(stamp) || stamp <= 0) return '';
  try { return new Date(stamp).toLocaleDateString(getUiLocale() === 'en' ? 'en' : 'ar-EG-u-nu-arab', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (error) { return new Date(stamp).toISOString().slice(0, 10); }
}

export function subscriptionLine(me, premium, promo = null, now = Date.now()) {
  if (!premium) return tr("غير مشترك");
  const info = (me && me.premium) || {};
  // اشتراك الخادم يُذكر فقط إن كان ساريًا؛ منتهٍ + رمز على الجهاز = «برمز هدية».
  const serverActive = isPremium(me, now);
  const source = serverActive ? info.source : (promo ? 'promo' : null);
  // رمز الهدية دائم عمليًا: لا يُعرض له تاريخ انتهاء.
  const until = source === 'promo' ? '' : formatUntil(info.until);
  const sourceText = tr(SOURCE_TEXT[source] || '');
  return tr("{v0} فعّال{v1}{v2}", {v0: tr(PLUS_NAME), v1: until ? tr(" حتى {date}", {date:until}) : '', v2: sourceText ? ` · ${sourceText}` : ''});
}

export function AccountCard() {
  const account = useAccount();
  // A deletion confirmation belongs to the account that opened it. Remount
  // before paint when its owner changes, rather than rebinding it to user B.
  const owner = account.user?.id || (account.signedIn ? 'pending' : 'guest');
  return <AccountCardOwner key={`${resolveAccountServer()}:${owner}`} />;
}

function AccountCardOwner() {
  const account = useAccount();
  const accepted = useAcceptedFeedback(`${resolveAccountServer()}:${account.user?.id || 'guest'}`);
  const restore = async () => {
    const feedback = accepted.begin();
    try {
      const result = await account.restore();
      if (account.user?.id && result?.user?.id === account.user.id && isPremium(result)) feedback.confirm();
    } catch (error) { feedback.error(error); }
  };
  const { signedIn, refresh } = account;
  useEffect(() => { if (signedIn) refresh(); }, [signedIn, refresh]);
  const [signIn, setSignIn] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [redeem, setRedeem] = useState(false);
  const user = account.user;
  const suspension = account.me?.moderation?.suspended ? account.me.moderation : null;
  const ios = account.platform === 'ios';
  const canRedeem = !account.premium && (!ios || REDEEM_ON_IOS);
  const managed = account.premium && isPremium(account.me) && account.me.premium.source !== 'promo';
  const redeemButton = canRedeem ? <Button variant="ghost" onClick={() => setRedeem(true)}>{tr(REDEEM_PROMPT)}</Button> : null;

  return (
    <Card data-design-screen="account.card" className={`stack account-card${user ? '' : ' is-guest'}`} aria-label={tr("الحساب")}>
      <div className="row"><IconUsers style={{ color: 'var(--accent)' }} /><span className="card-title">{tr("الحساب")}</span></div>
      {!user ? (
        <>
          <h3 className="account-guest-title">{tr("احفظ ملفك وأصدقاءك")}</h3>
          {account.promo && <p className="account-plan is-plus">{subscriptionLine(account.me, account.premium, account.promo)}{tr(" · على هذا الجهاز")}</p>}
          <p className="card-muted">{tr("سجّل الدخول لتحفظ بروفايلك وأصدقاءك وإنجازاتك على أجهزتك.")}</p>
          {account.offline
            ? <p className="online-notice" role="status">{accountErrorText('OFFLINE')}</p>
            : <Button variant="primary" data-design-id="account-signin" data-design-required="true" onClick={() => setSignIn(true)}>{tr("تسجيل الدخول")}</Button>}
          <Button data-design-id="continue" variant="ghost" onClick={() => navigate('/')}>{tr("متابعة كضيف")}</Button>
          {redeemButton}
        </>
      ) : (
        <>
          <div className="account-identity">
            <b>{user.name || tr("لاعب ميدان")}</b>
            {user.email && <small className="muted">{user.email}</small>}
          </div>
          {suspension ? <div className="online-notice error account-suspension" role="status"><b>{tr("حسابك معلّق")}</b><p>{tr("الملف والتواصل والغرف غير متاحة أثناء التعليق. يمكنك إدارة اشتراكك واستعادة المشتريات أو حذف الحساب.")}</p>{suspension.reason && <p dir="auto">{tr("السبب: ")}{suspension.reason}</p>}<a href={`mailto:${SUPPORT_EMAIL}`}>{tr("التواصل مع الدعم بخصوص التعليق")}</a></div> : <Button variant="secondary" icon={<IconUsers />} data-design-id="profile" onClick={() => navigate('/profile')}>{tr("بروفايلي وإنجازاتي")}</Button>}
          <p className={`account-plan ${account.premium ? 'is-plus' : ''}`}>{subscriptionLine(account.me, account.premium, account.promo)}</p>
          {!account.premium && !suspension && (
            <Button variant="primary" icon={<IconStar />} data-design-id="purchase" onClick={() => account.openPaywall({ reason: 'settings' })}>{tr("اشترك في ")}{tr(PLUS_NAME)}</Button>
          )}
          {!suspension && redeemButton}
          {managed && (
            <Button variant="secondary" data-design-id="subscription" data-design-required="true" onClick={() => account.manageSubscription()}>{tr("إدارة الاشتراك")}</Button>
          )}
          {ios && (
            <Button data-sound="none" variant="secondary" icon={<IconRotate />} loading={account.busy === 'restore'} data-design-id="restore" data-design-required="true" onClick={restore}>{tr("استعادة المشتريات")}</Button>
          )}
          <Button variant="ghost" icon={<IconBack />} loading={account.busy === 'signout'} data-design-id="account-signout" data-design-required="true" onClick={() => account.signOut()}>{tr("تسجيل الخروج")}</Button>
          <Button variant="danger" icon={<IconTrash />} data-design-id="account-delete" data-design-required="true" onClick={() => setConfirmDelete(true)}>{tr("حذف الحساب")}</Button>
        </>
      )}
      {account.error && <p className="online-notice error" role="alert">{accountErrorText(account.error)}</p>}
      <SignInSheet open={signIn} onClose={() => setSignIn(false)} />
      <RedeemSheet open={redeem} onClose={() => setRedeem(false)} />
      {confirmDelete && (
        <ConfirmModal title={tr("حذف الحساب؟")} danger
          message={tr("سيُحذف حسابك وسجل اشتراكك من خوادمنا نهائيًا ولا يمكن التراجع. إن كان اشتراكك عبر App Store فألغِه من إعدادات جهازك أيضًا.")}
          confirmLabel={tr("نعم، احذف الحساب")} cancelLabel={tr("إلغاء")}
          onConfirm={async () => { setConfirmDelete(false); await account.deleteAccount(user?.id); }}
          onCancel={() => setConfirmDelete(false)} />
      )}
    </Card>
  );
}
