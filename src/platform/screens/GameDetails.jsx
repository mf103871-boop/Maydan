// تفاصيل لعبة: «كيف تلعب» بخطوات متحركة، عدد اللاعبين والمدة، وزر العب.
import React from 'react';
import { Screen, TopBar, IconButton, Button } from '../../shared/ui/components.jsx';
import { IconBack, IconUsers, IconClock, IconPlay } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { navigate, back, getDirection } from '../router.js';
import { getGame } from '../registry.js';

export function GameDetails({ id }) {
  const game = getGame(id);
  const { sound, haptics } = usePlatform();
  if (!game) { navigate('/', { replace: true }); return null; }
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
      <div className="setup-sticky">
        <Button variant="accent" size="lg" full icon={<IconPlay />} onClick={() => { sound.play('whoosh'); haptics.vibrate('medium'); navigate(`/play/${game.id}`); }}>العب</Button>
      </div>
    </Screen>
  );
}
