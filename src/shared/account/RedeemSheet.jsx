// رمز الهدية: نموذج يُستعمل داخل الجدار (بدل الخطط) وداخل ورقة من بطاقة الحساب.
import React, { useState } from 'react';
import { Sheet, Button } from '../ui/components.jsx';
import { useAccount } from './context.js';
import { PLUS_NAME } from './config.js';
import { accountErrorText } from './errors.js';

export const REDEEM_PROMPT = 'لديك رمز هدية؟';

export function RedeemForm({ onDone, onCancel }) {
  const account = useAccount();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    if (event) event.preventDefault();
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    const result = await account.redeem(value);
    setBusy(false);
    if (result === true) { setCode(''); if (onDone) onDone(); }
    else setError(accountErrorText(typeof result === 'string' ? result : 'REDEEM_INVALID'));
  };
  const note = account.signedIn
    ? `أدخل الرمز الذي حصلت عليه لتفعيل ${PLUS_NAME} على حسابك، فيعمل على كل أجهزتك.`
    : `أدخل الرمز الذي حصلت عليه لتفعيل ${PLUS_NAME} على هذا الجهاز. إن سجّلت الدخول يُربط بحسابك ليعمل على كل أجهزتك.`;
  return (
    <form className="account-redeem" onSubmit={submit} aria-label="تفعيل رمز الهدية">
      <p className="card-muted">{note}</p>
      <input className="input" dir="ltr" inputMode="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={64}
        value={code} onChange={(event) => { setCode(event.target.value); setError(''); }} placeholder="• • • • • • •" aria-label="رمز الهدية" autoFocus />
      {error && <p className="online-notice error" role="alert">{error}</p>}
      <Button variant="primary" size="lg" full loading={busy} disabled={!code.trim()} onClick={submit}>تفعيل</Button>
      {onCancel && <Button variant="ghost" full onClick={onCancel}>رجوع</Button>}
    </form>
  );
}

export function RedeemSheet({ open, onClose }) {
  if (!open) return null;
  return (
    <Sheet open={open} onClose={onClose} title="رمز الهدية">
      <RedeemForm onDone={onClose} />
    </Sheet>
  );
}
