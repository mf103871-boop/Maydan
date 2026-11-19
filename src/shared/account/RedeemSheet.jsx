import { tr } from '../i18n/core.js';
// رمز الهدية: نموذج يُستعمل داخل الجدار (بدل الخطط) وداخل ورقة من بطاقة الحساب.
import React, { useEffect, useId, useRef, useState } from 'react';
import { Sheet, Button } from '../ui/components.jsx';
import { useAccount } from './context.js';
import { PLUS_NAME } from './config.js';
import { accountErrorText } from './errors.js';
import { resolveAccountServer } from './api.js';
import gift from '../brand/assets/redeem-gift-v1.webp';

export const REDEEM_PROMPT = 'لديك رمز هدية؟';

export function RedeemForm(props) {
  const account = useAccount();
  const owner = account.user?.id || (account.signedIn ? 'pending' : 'guest');
  return <RedeemFormOwner key={`${resolveAccountServer()}:${owner}`} {...props} />;
}

function RedeemFormOwner({ onDone, onCancel }) {
  const account = useAccount();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const noteId = useId();
  const errorId = useId();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const submit = async (event) => {
    if (event) event.preventDefault();
    const value = code.trim();
    if (!value || busy || !account.signedIn) return;
    setBusy(true);
    setError('');
    const result = await account.redeem(value);
    if (!alive.current) return;
    setBusy(false);
    if (result === true) { setCode(''); if (onDone) onDone(); }
    else setError(accountErrorText(typeof result === 'string' ? result : 'REDEEM_INVALID'));
  };
  const note = account.signedIn
    ? tr("أدخل الرمز الذي حصلت عليه لتفعيل {v0} على حسابك، فيعمل على كل أجهزتك.", {v0: tr(PLUS_NAME)})
    : tr("سجّل الدخول أولًا لتفعيل رمز الهدية على حسابك واستخدامه على كل أجهزتك.", {});
  return (
    <form className="account-redeem" onSubmit={submit} aria-label={tr("تفعيل رمز الهدية")}>
      <p className="card-muted" id={noteId}>{note}</p>
      <input className="input" dir="ltr" inputMode="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={64}
        value={code} onChange={(event) => { setCode(event.target.value); setError(''); }}
        placeholder="• • • • • • •" aria-label={tr("رمز الهدية")} aria-describedby={error ? `${noteId} ${errorId}` : noteId}
        aria-invalid={error ? true : undefined} autoFocus={account.signedIn} />
      {error && <p className="online-notice error redeem-error" id={errorId} role="alert">{error}</p>}
      <Button type="submit" className="redeem-submit" variant="primary" size="lg" full loading={busy} disabled={!code.trim() || !account.signedIn}>{tr("تفعيل")}</Button>
      {onCancel && <Button variant="ghost" full onClick={onCancel}>{tr("رجوع")}</Button>}
    </form>
  );
}

export function RedeemSheet({ open, onClose }) {
  if (!open) return null;
  return (
    <Sheet data-design-screen="account.redeem" open={open} onClose={onClose} title={tr("رمز الهدية")}>
      <img className="redeem-gift-art" src={gift} alt="" width="256" height="256" decoding="async" />
      <RedeemForm onDone={onClose} />
    </Sheet>
  );
}
