import React, { useId, useRef, useState } from 'react';
import { termsIdentity, termsLocale } from './terms.js';
import termsStyles from './terms.css';

const copy = {
  ar: { title: 'قبل أن نلعب', intro: 'اختيار واضح، وحقوق محفوظة. اطّلع على شروط ميدان ثم قرّر إن كنت توافق.',
    points: ['اللعب باحترام، وحماية خصوصية اللاعبين.', 'قواعد المشتريات والتذاكر واضحة قبل التأكيد.', 'الخصوصية والأذونات لها خيارات مستقلة.'],
    terms: 'قراءة شروط الاستخدام', privacy: 'قراءة سياسة الخصوصية', check: 'أوافق على شروط استخدام ميدان لهذه النسخة.',
    accept: 'أوافق وأتابع', pending: 'جارٍ حفظ الموافقة…', back: 'لا أوافق، أرجع', hint: 'يمكنك الرجوع دون موافقة. تبقى قراءة السياسات والدعم وأدوات حماية الحساب وحذفه متاحة.', version: 'نسخة الشروط', failed: 'تعذّر حفظ الموافقة. حاول مرة أخرى.' },
  en: { title: 'Before we play', intro: 'A clear choice, with your rights protected. Read Maydan’s terms, then decide whether to agree.',
    points: ['Play respectfully and protect player privacy.', 'Purchase and ticket rules are clear before confirmation.', 'Privacy and permissions have separate choices.'],
    terms: 'Read terms of use', privacy: 'Read privacy policy', check: 'I agree to this version of the Maydan terms of use.',
    accept: 'Agree and continue', pending: 'Saving your choice…', back: 'Do not agree, go back', hint: 'You can go back without agreeing. Policies, support, account protection and deletion remain available.', version: 'Terms version', failed: 'Your choice could not be saved. Please try again.' }
};
function ConsentForm({ locale, pending = false, error = '', onAccept, onBack, onReadTerms, onReadPrivacy }) {
  const text = copy[locale], id = useId(), [checked, setChecked] = useState(false), [submitting, setSubmitting] = useState(false), [submitError, setSubmitError] = useState(''), inFlight = useRef(false);
  const identity = termsIdentity(locale), busy = pending || submitting;
  const submit = async event => {
    event.preventDefault();
    if (!checked || busy || inFlight.current || typeof onAccept !== 'function') return;
    inFlight.current = true; setSubmitting(true); setSubmitError('');
    try { await onAccept({ ...identity, accepted: true }); }
    catch { setSubmitError(text.failed); }
    finally { inFlight.current = false; setSubmitting(false); }
  };
  return <section className="terms-consent" lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-labelledby={`${id}-title`} data-design-screen="legal.consent">
    <style>{termsStyles}</style>
    <div className="terms-emblem" aria-hidden="true">✓</div>
    <h1 id={`${id}-title`}>{text.title}</h1><p className="terms-intro">{text.intro}</p>
    <ul>{text.points.map(point => <li key={point}>{point}</li>)}</ul>
    <div className="terms-read-actions">
      <button type="button" className="terms-link" onClick={onReadTerms}>{text.terms}</button>
      <button type="button" className="terms-link" onClick={onReadPrivacy}>{text.privacy}</button>
    </div>
    <form onSubmit={submit} aria-busy={busy}>
      <label className="terms-check" htmlFor={`${id}-check`}>
        <input id={`${id}-check`} type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} aria-describedby={`${id}-version`} />
        <span>{text.check}</span>
      </label>
      <p id={`${id}-version`} className="terms-meta">{text.version}: <bdi>{identity.termsVersion}</bdi></p>
      {error || submitError ? <p className="terms-error" role="alert">{error || submitError}</p> : null}
      <div className="terms-choice-actions">
        <button type="submit" className="terms-primary" disabled={!checked || busy || typeof onAccept !== 'function'}>{busy ? text.pending : text.accept}</button>
        <button type="button" className="terms-secondary" onClick={onBack} disabled={busy}>{text.back}</button>
      </div>
    </form>
    <p className="terms-hint">{text.hint}</p>
  </section>;
}
export function TermsConsent(props) {
  const locale = termsLocale(props.locale || 'ar'), identity = termsIdentity(locale);
  // A changed document/language is a new choice, never a retained checked box.
  return <ConsentForm {...props} locale={locale} key={`${locale}:${identity.termsVersion}:${identity.documentHash}`} />;
}
export default TermsConsent;
