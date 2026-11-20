import { getUiLocale, tr } from '../../shared/i18n/core.js';
import { loadGameContent } from '../../data/game-content.js';
import { collectCredits } from '../../shared/media/resolve.js';
import { BrandMark } from '../../shared/brand/art.jsx';
import React from 'react';
import { Screen, TopBar, IconButton, Card, Button } from '../../shared/ui/components.jsx';
import { IconBack, IconMusic } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { back, getDirection, getPreviousPath, navigate, useRoute } from '../router.js';
import { GAMES } from '../registry.js';
import { MenuGameIcon } from '../MenuGameIcon.jsx';
import { LEGAL_ROUTES, PUBLIC_SITE_ORIGIN } from '../../shared/account/config.js';
import { isNativeShell } from '../../shared/account/native.js';
import { AudioCredits } from './AudioCredits.jsx';
import { JPEG_ENCODER_LICENSE } from '../../profiles/vendor/jpeg-license.js';
import styles from './help-rebuild.css';

// Imported media keeps its attribution; generated illustrations are disclosed
// separately without inventing a photography license or an external source.
function Credits() {
  const locale = getUiLocale();
  const items = React.useMemo(() => GAMES.flatMap(game => (game.credits || []).map(credit => ({ ...credit, game: game.name }))), [locale]);
  const [open, setOpen] = React.useState(false);
  const [english, setEnglish] = React.useState(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!open || locale !== 'en' || english) return;
    let current = true;
    setLoadFailed(false);
    loadGameContent('badeeha', 'en').then(categories => {
      if (current) setEnglish(new Map(collectCredits(categories).map(credit => [credit.url, credit])));
    }).catch(() => { if (current) setLoadFailed(true); });
    return () => { current = false; };
  }, [open, locale, english, attempt]);
  const loading = open && locale === 'en' && !english && !loadFailed;
  const visibleItems = locale === 'en' && english
    ? items.map(item => ({ ...item, ...english.get(item.url) }))
    : items;
  const byLicense = items.reduce((acc, c) => { const label = c.generated ? tr("مولّد بالذكاء الاصطناعي") : c.license || tr("غير محدد"); acc[label] = (acc[label] || 0) + 1; return acc; }, {});
  return (
    <section className="stack help-sources" tabIndex={0} aria-label={tr("المصادر والتراخيص")}>
      <AudioCredits />
      <details className="help-disclosure"><summary data-design-id="license-link">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m4 17 5-5 3 3 3-5 5 7"/></svg>
        {tr("تراخيص تجهيز الصور")}</summary><pre dir="ltr">{JPEG_ENCODER_LICENSE}</pre></details>
      {items.length === 0 ? (
        <p className="card-muted">{tr("تظهر هنا بيانات إنشاء وسائط الأسئلة، ومصادر الملفات الخارجية وتراخيصها.")}</p>
      ) : (
        <Card className="stack media-credits">
          <p className="card-muted">{items.length}{tr(" ملفًا مع بيانات الإنشاء والإسناد: ")}{Object.entries(byLicense).map(([l, n]) => `${l} (${n})`).join(' · ')}.</p>
          <button data-design-id="show-all" type="button" className="btn btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? tr("إخفاء القائمة") : tr("عرض القائمة الكاملة")}</button>
          {loading && <p role="status">{tr("جارٍ التحميل")}</p>}
          {open && locale === 'en' && loadFailed && !english && <p role="status">{tr("تعذّر تحميل الملف")} <button type="button" className="btn btn-ghost" onClick={() => setAttempt(value => value + 1)}>{tr("أعد المحاولة")}</button></p>}
          {open && !loading && (
            <ul className="credits-list">
              {visibleItems.map((c) => (
                <li key={c.url}>
                  <b>{c.title || c.url.split('/').pop()}</b>
                  <span className="muted"> — {c.author || tr("مؤلف غير مذكور")} · </span>
                  {c.generated ? <span>{c.disclosure}</span> : c.licenseUrl ? <a data-design-id="license-link" href={c.licenseUrl} target="_blank" rel="noreferrer noopener">{c.license}</a> : <span>{c.license}</span>}
                  {c.sourceUrl && <> · <a data-design-id="source-link" href={c.sourceUrl} target="_blank" rel="noreferrer noopener">{tr("المصدر")}</a></>}
                  <span className="muted"> · {c.game} / {c.categoryName}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </section>
  );
}

export function About() {
  const { version } = usePlatform();
  const route = useRoute();
  const native = isNativeShell();
  const returnToHelp = () => getPreviousPath() ? back() : navigate('/settings?section=help', { replace: true });
  if (route.params.view === 'credits') return (
    <Screen data-design-screen="about" dir={getDirection()} className="stack help-page credits-page" aria-label={tr("المصادر والتراخيص")}>
      <style>{styles}</style>
      <TopBar data-design-id="topbar" title={tr("المصادر والتراخيص")} start={<IconButton data-design-id="back" label={tr("رجوع")} onClick={returnToHelp}><IconBack /></IconButton>} />
      <Credits />
      <Button variant="accent" size="lg" full onClick={returnToHelp}>{tr("إغلاق")}</Button>
    </Screen>
  );
  return (
    <Screen data-design-screen="about" dir={getDirection()} className="stack help-page" aria-label={tr("عن المنصة")}>
      <style>{styles}</style>
      <TopBar data-design-id="topbar" title={tr("عن ميدان")} start={<IconButton data-design-id="back" label={tr("رجوع")} onClick={back}><IconBack /></IconButton>} />
      <div className="about-brand">
        <BrandMark />
        <div><strong className="brand-name">{tr("ميدان")}</strong><span className="brand-sub">{tr("ألعاب جمعتنا")}</span></div>
      </div>
      <p className="about-intro">{tr("ألعاب للأصدقاء والعائلة على جهاز واحد، أو في غرف متصلة عبر الإنترنت.")}</p>
      <ul className="about-list">
        {GAMES.map((g, n) => <li key={g.id} className="row" style={{ '--delay': `${n * 45}ms` }}>
          <MenuGameIcon id={g.id} /><div><b>{g.name}</b><span>{g.tagline}</span></div>
        </li>)}
      </ul>
      <Card className="stack">
        <span className="card-title">{tr("بيانات الغرف")}</span>
        <p className="card-muted">{tr("ألعاب عربية للأصدقاء والعائلة على جهاز واحد، وغرف بديهة ومافيا وارسمها وفبركة ومين فينا ليلعب كل واحد من هاتفه. ألعاب الجهاز الواحد تعمل دون إنترنت بعد تنزيل المحتوى؛ والغرف تحتاج اتصالًا على كل هاتف.")}</p>
        <p className="card-muted">{tr("عند دخول غرفة، تُرسل معلومات المشاركة والإجراءات إلى خادم ميدان لتنسيق اللعبة. تختلف المعلومات الظاهرة بحسب اللعبة والمرحلة وصلاحية اللاعب. يُحفظ مفتاح العودة على جهازك، فلا تشارك بيانات المتصفح مع غيرك. تفاصيل حفظ البيانات وحذفها في سياسة الخصوصية.")}</p>
      </Card>
      <Card className="stack">
        <span className="card-title">{tr("جمعتكم تبدأ هنا")}</span>
        <p className="card-muted">{tr("اختر اللعب مع العائلة على جهاز واحد، أو افتح غرف لعبة تدعم الأونلاين وشارك رمز غرفتك مع أصحابك. تحديات معلومات ورسم واستنتاج وضحك، في مكان واحد.")}</p>
      </Card>
      <Button data-design-id="credits-open" variant="ghost" size="lg" full icon={<IconMusic />} onClick={() => navigate('/about?view=credits')}>{tr("المصادر والتراخيص")}</Button>
      <p className="muted center legal-links" style={{ fontSize: 13 }}>
        {!native && <><a data-design-id="pricing-link" href="pricing/">{tr("التسعير")}</a> · </>}
        <a data-design-id="refunds-link" href={native ? `${PUBLIC_SITE_ORIGIN}/refunds/` : 'refunds/'}>{tr("سياسة الاسترداد")}</a> · <a data-design-id="terms-link" href={LEGAL_ROUTES.terms}>{tr("شروط الاستخدام")}</a> · <a data-design-id="privacy-link" href={LEGAL_ROUTES.privacy}>{tr("سياسة الخصوصية")}</a>
      </p>
      <p className="muted center" style={{ fontSize: 13 }}>{tr("الإصدار ")}{version}{tr(" · صُنعت بحب للجلسات العائلية")}</p>
    </Screen>
  );
}
