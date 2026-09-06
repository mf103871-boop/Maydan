import React from 'react';
import { Screen, TopBar, IconButton, Card } from '../../shared/ui/components.jsx';
import { IconBack } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { back, getDirection } from '../router.js';
import { GAMES } from '../registry.js';

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
      <p className="muted center" style={{ fontSize: 13 }}>الإصدار {version} · صُنعت بحب للجلسات العائلية</p>
    </Screen>
  );
}
