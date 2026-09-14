// تفاصيل لعبة: «كيف تلعب» بخطوات متحركة، عدد اللاعبين والمدة، وزر العب.
import React from 'react';
import { Screen, TopBar, IconButton, Button, Card } from '../../shared/ui/components.jsx';
import { IconBack, IconUsers, IconClock, IconPlay } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { navigate, back, getDirection } from '../router.js';
import { getGame } from '../registry.js';

// معرّف غير معروف في الرابط: الملاحة أثناء التصيير تضيع لأن مستمعي الموجّه لم
// يشتركوا بعد، فتبقى الصفحة بيضاء إلى الأبد. نعرض رسالة وزر عودة بدلًا منها.
export function MissingGame({ id }) {
  return (
    <Screen dir={getDirection()} className="stack" aria-label="لعبة غير موجودة">
      <TopBar title="لعبة غير موجودة" start={<IconButton label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <Card className="stack">
        <span className="card-title">لا توجد لعبة بهذا المعرّف</span>
        <p className="card-muted">الرابط يشير إلى «<bdi>{id}</bdi>» ولا توجد لعبة بهذا الاسم في ميدان.</p>
        <Button variant="accent" size="lg" full onClick={() => navigate('/', { replace: true })}>العودة إلى الرئيسية</Button>
      </Card>
    </Screen>
  );
}

export function GameDetails({ id }) {
  const game = getGame(id);
  const { sound, haptics } = usePlatform();
  if (!game) return <MissingGame id={id} />;
  const Icon = game.icon;
  const modeLabel = game.players.mode === 'teams' ? 'فرق' : game.players.mode === 'both' ? 'فردي أو فرق' : 'فردي';
  return (
    <Screen dir={getDirection()} className="stack" style={{ '--game-accent': game.accent }} aria-label={game.name}>
      <TopBar title={game.name} eyebrow="لعبة" start={<IconButton label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <div className="details-hero">
        <div className="icon" aria-hidden="true">{Icon ? <Icon /> : '🎮'}</div>
        <h1>{game.name}</h1>
        <p><b style={{ color: 'var(--text)' }}>{game.tagline}</b><br />{game.description}</p>
        <div className="facts">
          <span className="fact"><IconUsers /> {game.players.min}–{game.players.max} · {modeLabel}</span>
          <span className="fact"><IconClock /> {game.duration}</span>
          {game.tags.map((t) => <span key={t} className="fact">#{t}</span>)}
        </div>
      </div>
      <div>
        <div className="section-title" style={{ marginBottom: 10 }}>كيف تلعب؟</div>
        <ol className="steps">{game.howToPlay.map((s, i) => <li key={i} className="step" style={{ '--delay': `${120 + i * 90}ms` }}>{s}</li>)}</ol>
      </div>
      <div className="setup-sticky stack">
        {['meenfina', 'fabraka'].includes(game.id) && <Button variant="accent" size="lg" full onClick={() => navigate(`/online/${game.id}`)}>العب من كل جوال · غرف جماعية</Button>}
        <Button variant={['meenfina', 'fabraka'].includes(game.id) ? 'secondary' : 'accent'} size="lg" full icon={<IconPlay />} onClick={() => { sound.play('whoosh'); haptics.vibrate('medium'); navigate(`/play/${game.id}`); }}>{['meenfina', 'fabraka'].includes(game.id) ? 'العب على جهاز واحد' : 'العب'}</Button>
      </div>
    </Screen>
  );
}
