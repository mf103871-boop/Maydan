// الرئيسية: الشعار، الإعدادات، دفتر اللاعبين، وشبكة بطاقات الألعاب.
import React, { useRef } from 'react';
import { Screen, IconButton, ripple } from '../../shared/ui/components.jsx';
import { IconSettings, IconUsers, IconClock, IconInfo } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { navigate, getDirection } from '../router.js';
import { GAMES } from '../registry.js';
import { Avatar, BrandMark, Wordmark, GameArtwork } from '../../shared/brand/art.jsx';

// جمع «لعبة» بحسب العدد: لعبة واحدة، لعبتان، 3–10 ألعاب، 11+ لعبة
export function gamesLabel(n) {
  if (n === 1) return 'لعبة واحدة';
  if (n === 2) return 'لعبتان';
  if (n >= 3 && n <= 10) return `${n} ألعاب`;
  return `${n} لعبة`;
}

function GameCard({ game, index, onOpen }) {
  const ref = useRef(null);
  // ميل ثلاثي الأبعاد خفيف بحسب موضع الإصبع
  const tilt = (e) => {
    const el = ref.current;
    if (!el || document.documentElement.dataset.reducedMotion === 'true') return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    el.style.transform = `perspective(700px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg) scale(.985)`;
  };
  const untilt = () => { if (ref.current) ref.current.style.transform = ''; };
  const Icon = game.icon;
  return (
    <button ref={ref} type="button" className={`game-card ${game.soon ? 'is-soon' : ''}`} style={{ '--game-accent': game.accent, '--delay': `${index * 60}ms` }}
      onPointerDown={(e) => { tilt(e); ripple(e); }} onPointerMove={tilt} onPointerUp={untilt} onPointerLeave={untilt} onPointerCancel={untilt}
      onClick={() => onOpen(game)} aria-label={`${game.name}: ${game.tagline}`} disabled={!!game.soon}>
      <span className="icon" aria-hidden="true">{Icon ? <Icon /> : '🎮'}</span>
      <span className="name">{game.name}</span>
      <span className="tagline">{game.tagline}</span>
      <span className="meta">
        <span><IconUsers /> <bdi>{game.players.min}–{game.players.max}</bdi></span>
        <span><IconClock /> <bdi>{game.duration}</bdi></span>
      </span>
    </button>
  );
}

export function Home() {
  const { roster, sound, haptics, version } = usePlatform();
  const open = (game) => { sound.play('pop'); haptics.vibrate('selection'); navigate(`/game/${game.id}`); };
  const cards = GAMES;
  return (
    <Screen dir={getDirection()} className="stack home-screen" aria-label="الرئيسية">
      <header className="home-head">
        <div className="brand">
          <BrandMark />
          <div><Wordmark /><div className="brand-sub">ألعاب جمعتنا</div></div>
        </div>
        <div className="row">
          <IconButton label="عن المنصة" onClick={() => navigate('/about')}><IconInfo /></IconButton>
          <IconButton label="الإعدادات" onClick={() => navigate('/settings')}><IconSettings /></IconButton>
        </div>
      </header>

      <button type="button" className="card online-home-card" onClick={() => navigate('/online')}>
        <GameArtwork game="meenfina" />
        <span><strong>اللّمّة من كل جوال</strong><small>غرف «مين فينا؟» · دخول برمز وتصويت سري</small></span>
        <span className="online-new">تجريبي</span>
      </button>

      <button type="button" className="card roster-card" onClick={() => { sound.play('click'); navigate('/players'); }} aria-label="دفتر اللاعبين" onPointerDown={ripple} style={{ position: 'relative', overflow: 'hidden' }}>
        <span className="grow" style={{ textAlign: 'start' }}>
          <span className="card-title" style={{ display: 'block' }}>دفتر اللاعبين</span>
          <span className="card-muted">{roster.length ? `${roster.length} لاعبين جاهزون لكل الألعاب` : 'أضف أسماء أصدقائك مرة واحدة'}</span>
        </span>
        <span className="roster-faces" aria-hidden="true">{roster.length ? roster.slice(0, 4).map((p) => <Avatar key={p.id} player={p} />) : [0, 1, 2, 3].map((index) => <Avatar key={index} index={index} />)}</span>
      </button>

      <div>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="section-title">الألعاب</span>
          <span className="badge"><IconClock style={{ width: 14, height: 14 }} /> {gamesLabel(GAMES.length)}</span>
        </div>
        <div className="games-grid">
          {cards.map((g, i) => <GameCard key={g.id} game={g} index={i} onOpen={open} />)}
        </div>
      </div>
      <p className="home-footer">ألعاب الجهاز الواحد تعمل دون إنترنت · الغرف تحتاج اتصالًا <span>الإصدار {version}</span></p>
    </Screen>
  );
}
