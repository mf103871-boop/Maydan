// الرئيسية: الشعار، الإعدادات، دفتر اللاعبين، وشبكة بطاقات الألعاب.
import React, { useRef, useState, useEffect } from 'react';
import { Screen, IconButton, ripple } from '../../shared/ui/components.jsx';
import { IconSettings, IconUsers, IconClock, IconInfo } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { useAccount } from '../../shared/account/context.js';
import { navigate, getDirection } from '../router.js';
import { GAMES } from '../registry.js';
import { Avatar, BrandMark, Wordmark, GameArtwork, ClayStage } from '../../shared/brand/art.jsx';
import { prefersReducedMotion, wait } from '../../shared/fx/index.js';

// جمع «لعبة» بحسب العدد: لعبة واحدة، لعبتان، 3–10 ألعاب، 11+ لعبة
export function gamesLabel(n) {
  if (n === 1) return 'لعبة واحدة';
  if (n === 2) return 'لعبتان';
  if (n >= 3 && n <= 10) return `${n} ألعاب`;
  return `${n} لعبة`;
}

// شارة «ميدان بلس» على البطاقة: بَديهة تعلن حزمها المجانية، وبقية الألعاب مباراتها المجانية.
// المشترك لا يرى شارة، والبطاقات تبقى مفعّلة في كل الحالات (القفل يظهر داخل اللعبة لا هنا).
export function plusBadge(account, game) {
  if (account.premium) return '';
  if (game.setup === 'self') return '١٠ فئات مجانية';
  const access = account.gameAccess(game.id);
  if (access === 'premium') return '';
  return access === 'locked' ? 'بلس' : 'مباراة مجانية';
}

function GameCard({ game, index, launching, badge, onOpen }) {
  const ref = useRef(null);
  const frame = useRef(0);
  const pointer = useRef(null);
  // ميل ثلاثي الأبعاد خفيف بحسب موضع الإصبع، مخنوق بإطار الرسم: البطاقة تدور والرسم
  // يتحرك عكس الإصبع عبر --tx/--ty (بارالاكس ثنائي الأبعاد في كل المتصفحات).
  const tilt = (e) => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const node = ref.current;
      const p = pointer.current;
      if (!node || !p) return;
      const r = node.getBoundingClientRect();
      const x = ((p.x - r.left) / r.width - 0.5) * 2;
      const y = ((p.y - r.top) / r.height - 0.5) * 2;
      node.style.transform = `perspective(700px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg) translateY(2px)`;
      node.style.setProperty('--tx', x.toFixed(3));
      node.style.setProperty('--ty', y.toFixed(3));
    });
  };
  const untilt = () => {
    cancelAnimationFrame(frame.current); frame.current = 0; pointer.current = null;
    const el = ref.current;
    if (!el) return;
    el.style.transform = ''; el.style.removeProperty('--tx'); el.style.removeProperty('--ty');
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const Icon = game.icon;
  return (
    <button ref={ref} type="button" className={`game-card ${game.soon ? 'is-soon' : ''} ${launching ? 'is-launch' : ''}`} style={{ '--game-accent': game.accent, '--delay': `${index * 55}ms` }}
      onPointerDown={(e) => { tilt(e); ripple(e); }} onPointerMove={tilt} onPointerUp={untilt} onPointerLeave={untilt} onPointerCancel={untilt}
      onClick={() => onOpen(game)} aria-label={`${game.name}: ${game.tagline}`} disabled={!!game.soon}>
      {badge && <span className="badge badge-accent card-badge">{badge}</span>}
      <span className="icon clay-stage clay-static" aria-hidden="true"><span className="clay-lift">{Icon ? <Icon /> : '🎮'}</span></span>
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
  const account = useAccount();
  // فتح لعبة: البطاقة تنطلق (is-launch) ثم الملاحة بعد 140ms (صفر تحت تقليل الحركة)؛ النقر المزدوج محروس بمرجع.
  const launching = useRef(false);
  const launchTimer = useRef(0);
  useEffect(() => () => clearTimeout(launchTimer.current), []);
  const [launchId, setLaunchId] = useState(null);
  const open = (game) => {
    if (launching.current) return;
    launching.current = true;
    setLaunchId(game.id);
    sound.play('pop'); haptics.vibrate('selection');
    launchTimer.current = setTimeout(() => { navigate(`/game/${game.id}`); launching.current = false; }, wait(140));
  };
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

      <button type="button" className="card online-home-card" onClick={() => { sound.play('click'); navigate('/online'); }} onPointerDown={ripple}>
        <ClayStage className="clay-static"><GameArtwork game="meenfina" /></ClayStage>
        <span><strong>اللّمّة من كل جوال</strong><small>غرف «مين فينا؟» و«فبركة» · دخول برمز وتصويت سري</small></span>
        <span className="online-new">تجريبي</span>
      </button>

      <button type="button" className="card roster-card" onClick={() => { sound.play('click'); navigate('/players'); }} aria-label="دفتر اللاعبين" onPointerDown={ripple}>
        <span className="grow" style={{ textAlign: 'start' }}>
          <span className="card-title" style={{ display: 'block' }}>دفتر اللاعبين</span>
          <span key={roster.length} className="card-muted">{roster.length ? `${roster.length} لاعبين جاهزون لكل الألعاب` : 'أضف أسماء أصدقائك مرة واحدة'}</span>
        </span>
        <span className="roster-faces" aria-hidden="true">
          {roster.length
            ? roster.slice(0, 4).map((p) => <ClayStage key={p.id} className="clay-static no-contact"><Avatar player={p} /></ClayStage>)
            : [0, 1, 2, 3].map((index) => <ClayStage key={index} className="clay-static no-contact"><Avatar index={index} /></ClayStage>)}
        </span>
      </button>

      <div>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="section-title">الألعاب</span>
          <span className="badge"><IconClock style={{ width: 14, height: 14 }} /> {gamesLabel(GAMES.length)}</span>
        </div>
        <div className="games-grid">
          {cards.map((g, i) => <GameCard key={g.id} game={g} index={i} launching={launchId === g.id} badge={plusBadge(account, g)} onOpen={open} />)}
        </div>
      </div>
      <p className="home-footer">ألعاب الجهاز الواحد تعمل دون إنترنت · الغرف تحتاج اتصالًا <span>الإصدار {version}</span></p>
    </Screen>
  );
}
