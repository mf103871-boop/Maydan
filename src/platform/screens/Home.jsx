// تبويب الألعاب: قائمة الألعاب واختيار النمط، مع بقاء الحساب والسياسات متاحة.
import React, { useRef, useState, useEffect } from 'react';
import { Screen, Sheet, ripple } from '../../shared/ui/components.jsx';
import { IconUsers, IconBack } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { useAccount } from '../../shared/account/context.js';
import { LammaIcon } from '../../social/LammaMedia.jsx';
import { useSocialUI } from '../../social/SocialUIProvider.jsx';
import { ProfileAvatar } from '../../profiles/ProfileAvatar.jsx';
import { PUBLIC_SITE_ORIGIN, LEGAL_ROUTES } from '../../shared/account/config.js';
import { navigate, getDirection } from '../router.js';
import { GAMES } from '../registry.js';
import { reportSimulatorHomeReady } from '../native-launch-ready.js';
import { MenuGameIcon } from '../MenuGameIcon.jsx';
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
  const support = getGameModeSupport(game.id);
  return (
    <button type="button" data-design-id={`game-card.${game.id}`} className={`game-card home-game-row ${game.soon ? 'is-soon' : ''}`} style={{ '--game-accent': game.accent, '--delay': `${index * 25}ms` }}
      onPointerDown={ripple} onClick={() => onOpen(game)} aria-label={`${game.name}: ${game.tagline}`} aria-haspopup="dialog" disabled={!!game.soon}>
      <MenuGameIcon id={game.id} />
      <span className="home-game-copy"><span className="name">{game.name}</span><span className="home-game-capability">{support?.online && support.local ? 'أونلاين ومع العائلة' : support?.online ? 'أونلاين' : 'مع العائلة'}</span></span>
      <IconBack className="home-game-arrow" aria-hidden="true" />
    </button>
  );
}

export function GameModeSheet({ game, onClose, onSelect }) {
  if (!game) return null;
  const support = getGameModeSupport(game.id);
  return <Sheet open title={game.name} onClose={onClose} data-design-screen="home.game-mode">
    <MenuGameIcon id={game.id} className="game-mode-art" />
    <p className="game-mode-intro">كيف تودون اللعب؟</p>
    <div className="game-mode-options" aria-label="اختر نمط اللعب">
      <button type="button" className="game-mode-choice is-online" data-design-id="online-mode" disabled={!support?.online} onClick={() => onSelect('online')}>
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20m-10-10c-6 4-6 16 0 20 6-4 6-16 0-20Z"/></svg><strong>أونلاين</strong>
      </button>
      <button type="button" className="game-mode-choice is-local" data-design-id="local-mode" disabled={!support?.local} onClick={() => onSelect('local')}>
        <IconUsers /><strong>مع العائلة</strong>
      </button>
    </div>
    <ul className="game-mode-explain">
      {support?.online && <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M10 5h4m-3 14h2"/></svg>{support.unit === 'teams' ? 'لكل فريق جهاز' : 'لكل لاعب جهاز'}</li>}
      {support?.local && <li><IconUsers />جهاز واحد للمجموعة</li>}
      {(!support?.online || !support?.local) && <li>{support?.online ? 'هذه اللعبة متاحة أونلاين فقط.' : 'هذه اللعبة متاحة مع العائلة فقط.'}</li>}
    </ul>
  </Sheet>;
}

export function Home() {
  const { sound, haptics, version } = usePlatform();
  const account = useAccount();
  const socialUI = useSocialUI();
  const [selectedGame, setSelectedGame] = useState(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const normalize = value => value.replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').trim();
  const games = GAMES.filter(game => normalize(game.name).includes(normalize(query)));
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
        <button type="button" data-design-id="requests-open" className="home-head-action" aria-label="طلبات الأصدقاء والدعوات" onClick={() => socialUI ? socialUI.show({ type: 'list', tab: 'requests' }) : navigate('/friends')}><LammaIcon name="bell" /></button>
        <button type="button" data-design-id="profile" className="home-profile" aria-label="بروفايلي" title="بروفايلي" onClick={() => navigate('/profile')}><span data-design-id="brand">ميدان <bdi lang="en">MAYDAN</bdi></span></button>
        <button type="button" data-design-id="home-search-open" className="home-head-action" aria-label={searching ? 'إغلاق بحث الألعاب' : 'البحث عن لعبة'} aria-expanded={searching} aria-controls={searching ? 'home-game-search' : undefined} onClick={() => { setSearching(!searching); if (searching) setQuery(''); }}><LammaIcon name={searching ? 'close' : 'search'} /></button>
      </header>

      {searching && <div className="home-search"><label htmlFor="home-game-search" className="sr-only">اسم اللعبة</label><input data-design-id="search-input" id="home-game-search" value={query} placeholder="اسم اللعبة" onChange={event => setQuery(event.target.value)} /><LammaIcon name="search" /></div>}
      <section data-design-id="games" className="home-games" aria-labelledby="home-games-title">
        <h1 data-design-id="title" id="home-games-title" className="sr-only">اختار لعبتك</h1>
        <div className="games-grid home-game-list">{games.map((g, i) => <GameCard key={g.id} game={g} index={i} onOpen={open} />)}</div>
        {!games.length && <p className="home-no-games" role="status">لا توجد لعبة بهذا الاسم.</p>}
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
