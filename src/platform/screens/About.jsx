import { BrandMark, GameArtwork } from '../../shared/brand/art.jsx';
import React from 'react';
import { Screen, TopBar, IconButton, Card } from '../../shared/ui/components.jsx';
import { IconBack } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { back, getDirection } from '../router.js';
import { GAMES } from '../registry.js';
import { LEGAL_ROUTES, PUBLIC_SITE_ORIGIN } from '../../shared/account/config.js';
import { isNativeShell } from '../../shared/account/native.js';

// Imported media keeps its attribution; generated illustrations are disclosed
// separately without inventing a photography license or an external source.
function Credits() {
  const items = GAMES.flatMap((g) => (g.credits || []).map((c) => ({ ...c, game: g.name })));
  const [open, setOpen] = React.useState(false);
  const byLicense = items.reduce((acc, c) => { const label = c.generated ? 'مولّد بالذكاء الاصطناعي' : c.license || 'غير محدد'; acc[label] = (acc[label] || 0) + 1; return acc; }, {});
  return (
    <Card className="stack" aria-label="المصادر والتراخيص">
      <span className="card-title">المصادر والتراخيص</span>
      <p className="card-muted">المؤثرات الصوتية: <a href="https://dustyroom.com/free-casual-game-sounds/" target="_blank" rel="noreferrer noopener">Dustyroom</a> و<a href="https://ci.itch.io/400-sounds-pack" target="_blank" rel="noreferrer noopener">Chequered Ink</a>، مع ضبط مستويات الصوت لميدان.</p>
      {items.length === 0 ? (
        <p className="card-muted">تظهر هنا بيانات إنشاء وسائط الأسئلة، ومصادر الملفات الخارجية وتراخيصها.</p>
      ) : (
        <>
          <p className="card-muted">{items.length} ملفًا مع بيانات الإنشاء والإسناد: {Object.entries(byLicense).map(([l, n]) => `${l} (${n})`).join(' · ')}.</p>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'إخفاء القائمة' : 'عرض القائمة الكاملة'}</button>
          {open && (
            <ul className="credits-list">
              {items.map((c) => (
                <li key={c.url}>
                  <b>{c.title || c.url.split('/').pop()}</b>
                  <span className="muted"> — {c.author || 'مؤلف غير مذكور'} · </span>
                  {c.generated ? <span>{c.disclosure}</span> : c.licenseUrl ? <a href={c.licenseUrl} target="_blank" rel="noreferrer noopener">{c.license}</a> : <span>{c.license}</span>}
                  {c.sourceUrl && <> · <a href={c.sourceUrl} target="_blank" rel="noreferrer noopener">المصدر</a></>}
                  <span className="muted"> · {c.game} / {c.categoryName}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

export function About() {
  const { version } = usePlatform();
  const native = isNativeShell();
  return (
    <Screen dir={getDirection()} className="stack" aria-label="عن المنصة">
      <TopBar title="عن ميدان" start={<IconButton label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <Card className="stack">
        <div className="brand">
          <BrandMark />
          <div><div className="brand-name">ميدان</div><div className="brand-sub">ألعاب جمعتنا</div></div>
        </div>
        <p className="card-muted" style={{ fontSize: 15 }}>ألعاب عربية للأصدقاء والعائلة على جهاز واحد، وغرف «مين فينا؟» ليلعب كل واحد من هاتفه. ألعاب الجهاز الواحد تعمل دون إنترنت بعد تنزيل المحتوى؛ والغرف تحتاج اتصالًا على كل هاتف.</p>
        <div className="about-list">
          {/* رسمة كل لعبة (28px، بلا حامل) بدل النقطة الملوّنة؛ الصفوف تدخل بتدرّج 45ms */}
          {GAMES.map((g, n) => <div key={g.id} className="row" style={{ '--c': g.accent, '--delay': `${n * 45}ms` }}><GameArtwork game={g.id} /><b>{g.name}</b><span className="muted" style={{ fontSize: 13 }}>{g.tagline}</span></div>)}
        </div>
      </Card>
      <Card className="stack">
        <span className="card-title">بيانات الغرف</span>
        <p className="card-muted">عند دخول غرفة، تُرسل أسماء اللاعبين وشخصياتهم وتصويتاتهم إلى خادم ميدان لتنسيق اللعبة. يرى اللاعبون مجموع الأصوات فقط، وتبقى الاختيارات الفردية مخفية عن الآخرين. تنتهي الغرفة بعد ساعتين وتُحذف بياناتها النشطة. يُحفظ مفتاح العودة على جهازك، فلا تشارك بيانات المتصفح مع غيرك.</p>
      </Card>
      <Card className="stack">
        <span className="card-title">جمعتكم تبدأ هنا</span>
        <p className="card-muted">اختر لعبة لجهاز واحد، أو أنشئ غرفة «مين فينا؟» وشارك رمزها مع أصحابك. تحديات معلومات وسرعة وتمثيل وضحك، في مكان واحد.</p>
      </Card>
      <Credits />
      <p className="muted center legal-links" style={{ fontSize: 13 }}>
        {!native && <><a href="/pricing/">التسعير</a> · </>}
        <a href={native ? `${PUBLIC_SITE_ORIGIN}/refunds/` : '/refunds/'}>سياسة الاسترداد</a> · <a href={LEGAL_ROUTES.terms}>شروط الاستخدام</a> · <a href={LEGAL_ROUTES.privacy}>سياسة الخصوصية</a>
      </p>
      <p className="muted center" style={{ fontSize: 13 }}>الإصدار {version} · صُنعت بحب للجلسات العائلية</p>
    </Screen>
  );
}
