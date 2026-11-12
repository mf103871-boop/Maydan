import React, { useId } from 'react';
import { getTermsDocument, termsLocale, TERMS_UPDATED, TERMS_VERSION, TERMS_SUPPORT_EMAIL } from './terms.js';
import termsStyles from './terms.css';

export function TermsDocument({ locale = 'ar' }) {
  const language = termsLocale(locale), document = getTermsDocument(language), id = useId();
  return <article className="terms-document" lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} aria-labelledby={`${id}-title`}>
    <style>{termsStyles}</style>
    <h1 id={`${id}-title`}>{document.title}</h1>
    <p className="terms-meta">{language === 'ar' ? 'آخر تحديث' : 'Updated'}: <time dateTime={TERMS_UPDATED} dir="ltr">{TERMS_UPDATED}</time> · {language === 'ar' ? 'النسخة' : 'Version'} <bdi>{TERMS_VERSION}</bdi></p>
    <p>{document.summary}</p>
    {document.sections.map(section => <section key={section.id} aria-labelledby={`${id}-${section.id}`}>
      <h2 id={`${id}-${section.id}`}>{section.title}</h2>
      {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    </section>)}
    <a className="terms-link" href={`mailto:${TERMS_SUPPORT_EMAIL}`}><bdi>{TERMS_SUPPORT_EMAIL}</bdi></a>
  </article>;
}
export default TermsDocument;
