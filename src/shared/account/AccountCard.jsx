// بطاقة الحساب في الإعدادات: الحالة، الاشتراك، وكل ما تشترطه المتاجر
// (إدارة الاشتراك، استعادة المشتريات، الخروج، وحذف الحساب).
import React, { useState } from 'react';
import { Button, Card, ConfirmModal } from '../ui/components.jsx';
import { IconUsers, IconStar, IconRotate, IconTrash, IconBack } from '../ui/icons.jsx';
import { useAccount } from './context.js';
import { PLUS_NAME } from './config.js';
import { accountErrorText } from './errors.js';
import { SignInSheet } from './SignInSheet.jsx';

const SOURCE_TEXT = { apple: 'عبر App Store', paddle: 'عبر الويب' };

export function formatUntil(value) {
  const stamp = Number(value);
  if (!Number.isFinite(stamp) || stamp <= 0) return '';
  try { return new Date(stamp).toLocaleDateString('ar-EG-u-nu-arab', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (error) { return new Date(stamp).toISOString().slice(0, 10); }
}

export function subscriptionLine(me, premium) {
  if (!premium) return 'غير مشترك';
  const info = (me && me.premium) || {};
  const until = formatUntil(info.until);
  const source = SOURCE_TEXT[info.source] || '';
  return `${PLUS_NAME} فعّال${until ? ` حتى ${until}` : ''}${source ? ` · ${source}` : ''}`;
}

export function AccountCard() {
  const account = useAccount();
  const [signIn, setSignIn] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const user = account.user;
  const ios = account.platform === 'ios';

  return (
    <Card className="stack account-card" aria-label="الحساب">
      <div className="row"><IconUsers style={{ color: 'var(--accent)' }} /><span className="card-title">الحساب</span></div>
      {!user ? (
        <>
          <p className="card-muted">الحساب: غير مسجّل</p>
          <p className="card-muted">سجّل الدخول ليعمل اشتراك {PLUS_NAME} على كل أجهزتك.</p>
          {account.offline
            ? <p className="online-notice" role="status">{accountErrorText('OFFLINE')}</p>
            : <Button variant="primary" onClick={() => setSignIn(true)}>تسجيل الدخول</Button>}
        </>
      ) : (
        <>
          <div className="account-identity">
            <b>{user.name || 'لاعب ميدان'}</b>
            {user.email && <small className="muted">{user.email}</small>}
          </div>
          <p className={`account-plan ${account.premium ? 'is-plus' : ''}`}>{subscriptionLine(account.me, account.premium)}</p>
          {!account.premium && (
            <Button variant="primary" icon={<IconStar />} onClick={() => account.openPaywall({ reason: 'settings' })}>اشترك في {PLUS_NAME}</Button>
          )}
          {account.premium && (
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
