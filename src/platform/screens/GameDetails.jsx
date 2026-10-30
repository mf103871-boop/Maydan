// تفاصيل لعبة: «كيف تلعب» بخطوات متحركة، عدد اللاعبين والمدة، وزر العب.
import React from 'react';
import { Screen, TopBar, IconButton, Button, Card } from '../../shared/ui/components.jsx';
import { IconBack, IconUsers, IconClock, IconPlay } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { navigate, back, getDirection, getRoute } from '../router.js';
import { getGame } from '../registry.js';
import { resolveGameMode, gameInstructionsNextPath } from '../game-mode-navigation.js';
import homeStyles from './home-rebuild.css';

// معرّف غير معروف في الرابط: الملاحة أثناء التصيير تضيع لأن مستمعي الموجّه لم
// يشتركوا بعد، فتبقى الصفحة بيضاء إلى الأبد. نعرض رسالة وزر عودة بدلًا منها.
export function MissingGame({ id }) {
  return (
    <Screen data-design-screen="game-details" dir={getDirection()} className="stack" aria-label="لعبة غير موجودة">
      <TopBar data-design-id="topbar" title="لعبة غير موجودة" start={<IconButton data-design-id="back" label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <Card className="stack">
        <span className="card-title">لا توجد لعبة بهذا المعرّف</span>
        <p className="card-muted">الرابط يشير إلى «<bdi>{id}</bdi>» ولا توجد لعبة بهذا الاسم في ميدان.</p>
        <Button data-design-id="home" variant="accent" size="lg" full onClick={() => navigate('/', { replace: true })}>العودة إلى الرئيسية</Button>
      </Card>
    </Screen>
  );
}

export function GameDetails({ id, mode: requestedMode }) {
  const game = getGame(id);
  const { sound, haptics } = usePlatform();
  if (!game) return <MissingGame id={id} />;
  const Icon = game.icon;
  const mode = resolveGameMode(id, requestedMode ?? getRoute().params.mode);
  const modeLabel = game.id === 'ersomha' ? 'تعاون لشخصين · منافسة من ثلاثة' : game.players.mode === 'teams' ? 'فرق' : game.players.mode === 'both' ? 'فردي أو فرق' : 'فردي';
  const factDelay = (i) => ({ '--delay': `${250 + i * 50}ms` });
  const note = game.id === 'badeeha' ? 'كل الفئات مجانية — العبوا قد ما بدكم' : 'اللعب واستضافة الغرف والانضمام مجانًا';
  const skip = () => {
    const target = gameInstructionsNextPath(game.id, requestedMode ?? getRoute().params.mode);
    if (!target) return;
    sound.play('whoosh'); haptics.vibrate('medium'); navigate(target);
  };
  return (
    <Screen data-design-screen="game-details" dir={getDirection()} className="stack game-instructions-screen" style={{ '--game-accent': game.accent }} aria-label={game.name}>
      <style>{homeStyles}</style>
      <TopBar data-design-id="topbar" title={game.name} eyebrow="لعبة" start={<IconButton data-design-id="back" label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <p className="selected-game-mode" role={mode ? undefined : 'status'}>{mode === 'online' ? 'أونلاين' : mode === 'local' ? 'مع العائلة · على جوال واحد' : 'هذا النمط غير متاح لهذه اللعبة حاليًا'}</p>
      <div data-design-id="hero" className="details-hero">
        {/* الحامل: الرسم يهبط ثم يطفو (clay-idle)؛ الحركة على .clay-lift لا على الرسم */}
        <div data-design-id="game-icon" className="icon clay-stage clay-idle" aria-hidden="true"><span className="clay-lift">{Icon ? <Icon /> : '🎮'}</span></div>
        <h1 data-design-id="game-name">{game.name}</h1>
        <p data-design-id="game-description"><b style={{ color: 'var(--text)' }}>{game.tagline}</b><br />{game.description}</p>
        <div data-design-id="facts" className="facts">
          <span className="fact" style={factDelay(0)}><IconUsers /> {game.players.min}–{game.players.max} · {modeLabel}</span>
          <span className="fact" style={factDelay(1)}><IconClock /> {game.duration}</span>
          {game.tags.map((t, i) => <span key={t} className="fact" style={factDelay(2 + i)}>#{t}</span>)}
        </div>
        {note && <p className="card-muted details-plus-note">{note}</p>}
      </div>
      <div>
        <div className="section-title" style={{ marginBottom: 10 }}>كيف تلعب؟</div>
        <ol data-design-id="steps" className="steps">{game.howToPlay.map((s, i) => <li key={i} className="step" style={{ '--delay': `${120 + i * 90}ms` }}>{s}</li>)}</ol>
      </div>
      <div data-design-id="actions" className="setup-sticky stack">
        <Button data-design-id="skip-instructions" variant="accent" size="lg" full icon={<IconPlay />} disabled={!mode} onClick={skip}>تخطي التعليمات</Button>
      </div>
    </Screen>
  );
}
