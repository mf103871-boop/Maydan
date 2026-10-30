// تبويب الألعاب: قائمة الألعاب واختيار النمط، مع بقاء الحساب والسياسات متاحة.
import React, { useRef, useState, useEffect } from 'react';
import { Screen, Sheet, ripple } from '../../shared/ui/components.jsx';
import { IconUsers, IconClock, IconBack } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { useAccount } from '../../shared/account/context.js';
import { LammaIcon } from '../../social/LammaMedia.jsx';
import { useProfiles } from '../../profiles/ProfileProvider.jsx';
import { ProfileAvatar } from '../../profiles/ProfileAvatar.jsx';
import { PUBLIC_SITE_ORIGIN, LEGAL_ROUTES } from '../../shared/account/config.js';
import { navigate, getDirection } from '../router.js';
import { GAMES } from '../registry.js';
import { reportSimulatorHomeReady } from '../native-launch-ready.js';
import { BrandMark, Wordmark } from '../../shared/brand/art.jsx';
import { getGameModeSupport } from '../../shared/game-mode-support.mjs';
import { gameModePath } from '../game-mode-navigation.js';
import homeStyles from './home-rebuild.css';

// جمع «لعبة» بحسب العدد: لعبة واحدة، لعبتان، 3–10 ألعاب، 11+ لعبة
export function gamesLabel(n) {
  if (n === 1) return 'لعبة واحدة';
  if (n === 2) return 'لعبتان';
  if (n >= 3 && n <= 10) return `${n} ألعاب`;
  return `${n} لعبة`;
}

// Gameplay does not advertise or depend on Plus membership.
export function plusBadge() { return 'مجانية بالكامل'; }

export function HomeGroups({ account, groups = [], calls = [], onOpen }) {
  // LammaProvider supplies an identity-checked snapshot; guests never render cached groups.
  if (!account?.ready || !account.signedIn) return null;
  const active = new Set(calls.filter(call => call.scope === 'group' && call.status === 'active').map(call => call.conversationId));
  const recent = [...groups].sort((a, b) => Number(active.has(b.id)) - Number(active.has(a.id)) || Number(!!b.unreadCount) - Number(!!a.unreadCount) || Number(b.lastMessage?.createdAt || b.updatedAt || b.createdAt || 0) - Number(a.lastMessage?.createdAt || a.updatedAt || a.createdAt || 0)).slice(0, 3);
  if (!recent.length) return null;
  return <div data-design-id="groups" className="lamma-home-groups" aria-label="لمّاتك الأخيرة">{recent.map(group => <button type="button" key={group.id} data-design-id="group-card" className={'lamma-home-group' + (active.has(group.id) ? ' has-live-call' : '')} onClick={() => onOpen(group.id)} aria-label={'افتح لمّة ' + group.name + (active.has(group.id) ? '، مكالمة جارية' : '')}><ProfileAvatar user={{ avatarPreset: group.avatarPreset, theme: 'teal' }} size={32} /><span><strong>{group.name}</strong><small>{active.has(group.id) ? <><LammaIcon name="phone" size={12} />مكالمة جارية</> : group.unreadCount > 0 ? `${group.unreadCount} رسالة جديدة` : 'افتح السوالف'}</small></span></button>)}</div>;
}

function GameCard({ game, index, onOpen }) {
  const Icon = game.icon;
  const support = getGameModeSupport(game.id);
  return (
    <button type="button" data-design-id={`game-card.${game.id}`} className={`game-card home-game-row ${game.soon ? 'is-soon' : ''}`} style={{ '--game-accent': game.accent, '--delay': `${index * 25}ms` }}
      onPointerDown={ripple} onClick={() => onOpen(game)} aria-label={`${game.name}: ${game.tagline}`} aria-haspopup="dialog" disabled={!!game.soon}>
      <span className="icon clay-stage clay-static" aria-hidden="true"><span className="clay-lift">{Icon ? <Icon /> : '🎮'}</span></span>
      <span className="home-game-copy"><span className="name">{game.name}</span><span className="tagline">{game.tagline}</span><span className="meta">
        <span><IconUsers /> <bdi>{game.players.min}–{game.players.max}</bdi></span>
        <span><IconClock /> <bdi>{game.duration}</bdi></span>
        <span>{support?.online && support.local ? 'أونلاين · مع العائلة' : support?.online ? 'أونلاين' : 'مع العائلة'}</span>
      </span></span>
      <IconBack className="home-game-arrow" aria-hidden="true" />
    </button>
  );
}

export function GameModeSheet({ game, onClose, onSelect }) {
  if (!game) return null;
  const support = getGameModeSupport(game.id);
  return <Sheet open title={game.name} onClose={onClose} data-design-screen="home.game-mode">
    <div className="game-mode-options" aria-label="اختر نمط اللعب">
      <button type="button" className="game-mode-choice" data-design-id="online-mode" disabled={!support?.online} onClick={() => onSelect('online')}>
        <span className="game-mode-symbol" aria-hidden="true">↗</span><span><strong>أونلاين</strong><small>{support?.online ? support.unit === 'teams' ? 'جوال لكل فريق' : 'كل لاعب من جواله' : 'غير متاح لهذه اللعبة حاليًا'}</small></span><IconBack aria-hidden="true" />
      </button>
      <button type="button" className="game-mode-choice" data-design-id="local-mode" disabled={!support?.local} onClick={() => onSelect('local')}>
        <span className="game-mode-symbol" aria-hidden="true"><IconUsers /></span><span><strong>مع العائلة</strong><small>{support?.local ? 'على جوال واحد' : 'متاحة أونلاين فقط'}</small></span><IconBack aria-hidden="true" />
      </button>
    </div>
  </Sheet>;
}

export function Home() {
  const { sound, haptics, version } = usePlatform();
  const account = useAccount();
  const profiles = useProfiles();
  const [selectedGame, setSelectedGame] = useState(null);
  const opening = useRef(false);
  useEffect(() => reportSimulatorHomeReady({ accountReady: account.ready, gameCount: GAMES.length }), [account.ready]);
  const open = (game) => {
    opening.current = false;
    sound.play('pop'); haptics.vibrate('selection');
    setSelectedGame(game);
  };
  const select = (mode) => {
    const target = gameModePath(selectedGame?.id, mode);
    if (!target || opening.current) return;
    opening.current = true;
    sound.play('whoosh'); haptics.vibrate('selection');
    setSelectedGame(null);
    navigate(target);
  };
  return (
    <Screen data-design-screen="home" dir={getDirection()} className="stack home-screen" aria-label="الألعاب">
      <style>{homeStyles}</style>
      <header data-design-id="header" className="home-head">
        <img className="home-header-art" src="art/home/home-header-v1.webp" width="1536" height="512" alt="" aria-hidden="true" decoding="async" />
        <div data-design-id="brand" className="brand">
          <BrandMark />
          <div><Wordmark /><div className="brand-sub">ألعاب جمعتنا</div></div>
        </div>
        <button type="button" data-design-id="profile" className="home-profile" aria-label="بروفايلي" title="بروفايلي" onClick={() => navigate('/profile')}><ProfileAvatar user={profiles?.mine || account.user} size={64} /></button>
      </header>

      <section data-design-id="games" className="home-games" aria-labelledby="home-games-title">
        <div className="home-section-heading"><h1 data-design-id="title" id="home-games-title">اختار لعبتك</h1><span className="badge">{gamesLabel(GAMES.length)}</span></div>
        <div className="games-grid home-game-list">{GAMES.map((g, i) => <GameCard key={g.id} game={g} index={i} onOpen={open} />)}</div>
      </section>
      <p data-design-id="footer" className="home-footer">ألعاب الجهاز الواحد تعمل دون إنترنت · الغرف تحتاج اتصالًا <span>الإصدار {version}</span></p>
      <nav className="muted center legal-links" aria-label="الأسعار والسياسات" style={{ fontSize: 13 }}>
        {account.platform !== 'ios' && <><a data-design-id="pricing-link" href="pricing/">التسعير</a> · </>}
        <a data-design-id="refunds-link" href={account.platform === 'ios' ? `${PUBLIC_SITE_ORIGIN}/refunds/` : 'refunds/'}>سياسة الاسترداد</a> · <a data-design-id="terms-link" href={LEGAL_ROUTES.terms}>شروط الاستخدام</a> · <a data-design-id="privacy-link" href={LEGAL_ROUTES.privacy}>سياسة الخصوصية</a>
      </nav>
      <GameModeSheet game={selectedGame} onClose={() => setSelectedGame(null)} onSelect={select} />
    </Screen>
  );
}
