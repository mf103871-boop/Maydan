// تسجيل الدخول: أزرار المزوّدين في ورقة سفلية، وتُعاد في الجدار وفي الإعدادات.
// الدخول يخدم غرضًا واحدًا: أن يعمل الاشتراك على كل أجهزة اللاعب.
import React from 'react';
import { Sheet, Button } from '../ui/components.jsx';
import { useAccount } from './context.js';
import { accountErrorText } from './errors.js';

export const SIGN_IN_NOTE = 'الاشتراك يُربط بحسابك ليعمل على كل أجهزتك';

function AppleMark() {
  return (
    <svg className="account-mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M16.3 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.8-3.5.8s-1.8-.8-3-.8c-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.6 2.3 2.8 2.2 1.1 0 1.6-.7 2.9-.7s1.7.7 2.9.7 2-1.1 2.7-2.1c.9-1.2 1.2-2.4 1.2-2.5 0 0-2.3-.9-2.3-3.6zM14.1 5.9c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.6 1.4-.6.7-1.1 1.7-.9 2.8 1 0 2-.5 2.6-1.3z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg className="account-mark" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}

// الأزرار وحدها: تُستعمل داخل الجدار أيضًا حيث لا ورقة ثانية.
export function SignInButtons({ onDone }) {
  const account = useAccount();
  const providers = (account.billing && account.billing.providers) || null;
  const busy = account.busy === 'signin';
  const run = async (provider) => { await account.signIn(provider); if (onDone) onDone(); };
  if (account.offline) return <p className="online-notice" role="status">{accountErrorText('OFFLINE')}</p>;
  return (
    <div className="account-providers">
      {(!providers || providers.apple !== false) && (
        <Button variant="primary" size="lg" full loading={busy} icon={<AppleMark />} data-provider="apple" onClick={() => run('apple')}>المتابعة بحساب Apple</Button>
      )}
      {(!providers || providers.google !== false) && (
        <Button variant="secondary" size="lg" full disabled={busy} icon={<GoogleMark />} data-provider="google" onClick={() => run('google')}>المتابعة بحساب Google</Button>
      )}
      {account.error && <p className="online-notice error" role="alert">{accountErrorText(account.error)}</p>}
    </div>
  );
}

export function SignInSheet({ open, onClose, title = 'تسجيل الدخول', note = SIGN_IN_NOTE }) {
  if (!open) return null;
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="account-signin">
        <p className="card-muted">{note}</p>
        <SignInButtons onDone={onClose} />
        <p className="account-fineprint">لا نطلب كلمة مرور. يكفي حساب Apple أو Google لتتبع اشتراكك.</p>
      </div>
    </Sheet>
  );
}
