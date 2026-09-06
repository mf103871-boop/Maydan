import React from 'react';
import { Screen, TopBar, IconButton, Card } from '../../shared/ui/components.jsx';
import { IconBack } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { back, getDirection } from '../router.js';
import { GAMES } from '../registry.js';

// «المصادر والتراخيص»: كل صورة أو مقطع صوت في حزم الأسئلة مأخوذ من مصدر مفتوح
// (Wikimedia Commons وأمثاله) بترخيص يسمح بإعادة النشر، وبعض التراخيص (CC BY)
// تشترط ذكر صاحب العمل. هذه الشاشة تفي بذلك لكل ملف.
function Credits() {
  const items = GAMES.flatMap((g) => (g.credits || []).map((c) => ({ ...c, game: g.name })));
  const [open, setOpen] = React.useState(false);
  const byLicense = items.reduce((acc, c) => { acc[c.license || 'غير محدد'] = (acc[c.license || 'غير محدد'] || 0) + 1; return acc; }, {});
  return (
    <Card className="stack" aria-label="المصادر والتراخيص">
      <span className="card-title">المصادر والتراخيص</span>
      {items.length === 0 ? (
        <p className="card-muted">لا توجد وسائط خارجية بعد. حين تُضاف صور أو مقاطع صوت إلى حزم الأسئلة تظهر مصادرها وتراخيصها هنا.</p>
      ) : (
        <>
          <p className="card-muted">{items.length} ملفًا من مصادر مفتوحة: {Object.entries(byLicense).map(([l, n]) => `${l} (${n})`).join(' · ')}.</p>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'إخفاء القائمة' : 'عرض القائمة الكاملة'}</button>
          {open && (
            <ul className="credits-list">
              {items.map((c) => (
                <li key={c.url}>
                  <b>{c.title || c.url.split('/').pop()}</b>
                  <span className="muted"> — {c.author || 'مؤلف غير مذكور'} · </span>
                  {c.licenseUrl ? <a href={c.licenseUrl} target="_blank" rel="noreferrer noopener">{c.license}</a> : <span>{c.license}</span>}
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
  return (
    <Screen dir={getDirection()} className="stack" aria-label="عن المنصة">
      <TopBar title="عن منصة ميدان" start={<IconButton label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <Card className="stack">
        <p className="card-muted" style={{ fontSize: 15 }}>ألعاب جماعية تُلعب على جهاز واحد يتناقله الأصدقاء والعائلة. تعمل دون إنترنت ولا تُرسل أي بيانات إلى أي مكان؛ وحزم الأسئلة ذات الصور والأصوات تحتاج الشبكة أول مرة فقط، ثم تُحفظ في الجهاز.</p>
        <div className="about-list">
          {GAMES.map((g) => <div key={g.id} className="row" style={{ '--c': g.accent }}><span className="dot" aria-hidden="true" /><b>{g.name}</b><span className="muted" style={{ fontSize: 13 }}>{g.tagline}</span></div>)}
        </div>
      </Card>
      <Card className="stack">
        <span className="card-title">كيف تُضاف لعبة؟</span>
        <p className="card-muted">كل لعبة وحدة مستقلة في <code dir="ltr">src/games/&lt;id&gt;</code> تصدّر manifest فيه الاسم واللون و«كيف تلعب» والمكوّن. تسجيلها سطر واحد في السجل. التفاصيل في README.</p>
      </Card>
      <Credits />
      <p className="muted center" style={{ fontSize: 13 }}>الإصدار {version} · صُنعت بحب للجلسات العائلية</p>
    </Screen>
  );
}
