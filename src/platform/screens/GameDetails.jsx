// تفاصيل لعبة: «كيف تلعب» بخطوات متحركة، عدد اللاعبين والمدة، وزر العب.
import React from 'react';
import { Screen, TopBar, IconButton, Button, Card } from '../../shared/ui/components.jsx';
import { IconBack, IconUsers, IconClock, IconPlay } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { useAccount } from '../../shared/account/context.js';
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
  const account = useAccount();
  if (!game) return <MissingGame id={id} />;
  const Icon = game.icon;
  const modeLabel = game.players.mode === 'teams' ? 'فرق' : game.players.mode === 'both' ? 'فردي أو فرق' : 'فردي';
  const online = ['meenfina', 'fabraka'].includes(game.id);
  const factDelay = (i) => ({ '--delay': `${250 + i * 50}ms` });
  // القفل: بَديهة تُلعب دائمًا (القفل في حزمها) وبقية الألعاب مباراة واحدة مجانية ثم «ميدان بلس».
  const packs = game.setup === 'self';
  const locked = !packs && account.gameAccess(game.id) === 'locked';
  const note = account.premium ? '' : packs ? '١٠ فئات مجانية، والباقي ضمن ميدان بلس'
    : locked ? 'لعبت مباراتك المجانية — اشترك للمتابعة' : 'مباراة واحدة مجانية، ثم ميدان بلس';
  const play = () => {
    if (locked) { sound.play('click'); account.openPaywall({ reason: 'trial', game: game.id }); return; }
    sound.play('whoosh'); haptics.vibrate('medium'); navigate(`/play/${game.id}`);
  };
  return (
    <Screen dir={getDirection()} className="stack" style={{ '--game-accent': game.accent }} aria-label={game.name}>
      <TopBar title={game.name} eyebrow="لعبة" start={<IconButton label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <div className="details-hero">
        {/* الحامل: الرسم يهبط ثم يطفو (clay-idle)؛ الحركة على .clay-lift لا على الرسم */}
        <div className="icon clay-stage clay-idle" aria-hidden="true"><span className="clay-lift">{Icon ? <Icon /> : '🎮'}</span></div>
        <h1>{game.name}</h1>
        <p><b style={{ color: 'var(--text)' }}>{game.tagline}</b><br />{game.description}</p>
        <div className="facts">
          <span className="fact" style={factDelay(0)}><IconUsers /> {game.players.min}–{game.players.max} · {modeLabel}</span>
          <span className="fact" style={factDelay(1)}><IconClock /> {game.duration}</span>
          {game.tags.map((t, i) => <span key={t} className="fact" style={factDelay(2 + i)}>#{t}</span>)}
        </div>
        {note && <p className="card-muted details-plus-note">{note}</p>}
      </div>
      <div>
        <div className="section-title" style={{ marginBottom: 10 }}>كيف تلعب؟</div>
        <ol className="steps">{game.howToPlay.map((s, i) => <li key={i} className="step" style={{ '--delay': `${120 + i * 90}ms` }}>{s}</li>)}</ol>
      </div>
      <div className="setup-sticky stack">
        {/* الزر الرئيسي «مسلّح» (is-armed): تنفّس ×3 ووهج ×2 من brand.css */}
        {online && <Button variant="accent" size="lg" full className="is-armed" onClick={() => navigate(`/online/${game.id}`)}>العب من كل جوال · غرف جماعية</Button>}
        <Button variant={online ? 'secondary' : 'accent'} size="lg" full className={online ? '' : 'is-armed'} icon={<IconPlay />} onClick={play}>{online ? 'العب على جهاز واحد' : 'العب'}</Button>
      </div>
    </Screen>
  );
}
