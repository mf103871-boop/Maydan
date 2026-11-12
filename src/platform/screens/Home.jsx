import { tr } from '../../shared/i18n/core.js';
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
import { gameEntryPath, needsGameEntry } from '../game-entry.mjs';
import homeStyles from './home-rebuild.css';
import { useI18n } from '../../shared/i18n/react.jsx';
import { gameName } from '../../shared/i18n/core.js';
import { useSocial } from '../../social/SocialProvider.jsx';

// جمع «لعبة» بحسب العدد: لعبة واحدة، لعبتان، 3–10 ألعاب، 11+ لعبة
export function gamesLabel(n) {
  if (n === 1) return tr("لعبة واحدة");
  if (n === 2) return tr("لعبتان");
  if (n >= 3 && n <= 10) return tr("{v0} ألعاب", {v0: n});
  return tr("{v0} لعبة", {v0: n});
}

// Gameplay does not advertise or depend on Plus membership.
export function plusBadge() { return tr("مجانية بالكامل"); }

export function HomeGroups({ account, groups = [], calls = [], onOpen }) {
  // LammaProvider supplies an identity-checked snapshot; guests never render cached groups.
  if (!account?.ready || !account.signedIn) return null;
  const active = new Set(calls.filter(call => call.scope === 'group' && call.status === 'active').map(call => call.conversationId));
  const recent = [...groups].sort((a, b) => Number(active.has(b.id)) - Number(active.has(a.id)) || Number(!!b.unreadCount) - Number(!!a.unreadCount) || Number(b.lastMessage?.createdAt || b.updatedAt || b.createdAt || 0) - Number(a.lastMessage?.createdAt || a.updatedAt || a.createdAt || 0)).slice(0, 3);
  if (!recent.length) return null;
  return <div data-design-id="groups" className="lamma-home-groups" aria-label={tr("لمّاتك الأخيرة")}>{recent.map(group => <button type="button" key={group.id} data-design-id="group-card" className={'lamma-home-group' + (active.has(group.id) ? ' has-live-call' : '')} onClick={() => onOpen(group.id)} aria-label={tr("افتح لمّة ") + group.name + (active.has(group.id) ? tr("، مكالمة جارية") : '')}><ProfileAvatar user={{ avatarPreset: group.avatarPreset, theme: 'teal' }} size={32} /><span><strong>{group.name}</strong><small>{active.has(group.id) ? <><LammaIcon name="phone" size={12} />{tr("مكالمة جارية")}</> : group.unreadCount > 0 ? tr("{v0} رسالة جديدة", {v0: group.unreadCount}) : tr("افتح السوالف")}</small></span></button>)}</div>;
}

function GameCard({ game, index, onOpen, opensDialog = true }) {
  const { t, locale } = useI18n();
  const support = getGameModeSupport(game.id);
  return (
    <button type="button" data-game={game.id} data-design-id={`game-card.${game.id}`} className={`game-card home-game-row ${game.soon ? 'is-soon' : ''}`} style={{ '--game-accent': game.accent, '--delay': `${index * 25}ms` }}
      onPointerDown={ripple} onClick={() => onOpen(game)} aria-label={gameName(game, locale)} aria-haspopup={opensDialog ? 'dialog' : undefined} disabled={!!game.soon}>
      <MenuGameIcon id={game.id} />
      <span className="home-game-copy"><span className="name">{gameName(game, locale)}</span><span className="home-game-capability">{t(support?.online && support.local ? 'أونلاين ومع العائلة' : support?.online ? 'أونلاين' : 'مع العائلة')}</span></span>
      <IconBack className="home-game-arrow" aria-hidden="true" />
    </button>
  );
}

export function GameModeSheet({ game, onClose, onSelect, disabled = false }) {
  const { t, locale } = useI18n();
  if (!game) return null;
  const support = getGameModeSupport(game.id);
  return <Sheet open title={gameName(game, locale)} onClose={onClose} data-design-screen="home.game-mode">
    <MenuGameIcon id={game.id} className="game-mode-art" />
    <p className="game-mode-intro">{tr("كيف تودون اللعب؟")}</p>
    <div className="game-mode-options" aria-label={tr("اختر نمط اللعب")}>
      <button type="button" className="game-mode-choice is-online" data-design-id="online-mode" disabled={disabled || !support?.online} onClick={() => onSelect('online')}>
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20m-10-10c-6 4-6 16 0 20 6-4 6-16 0-20Z"/></svg><strong>{tr("أونلاين")}</strong>
      </button>
      <button type="button" className="game-mode-choice is-local" data-design-id="local-mode" disabled={disabled || !support?.local} onClick={() => onSelect('local')}>
        <IconUsers /><strong>{tr("مع العائلة")}</strong>
      </button>
    </div>
    <ul className="game-mode-explain">
      {support?.online && <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M10 5h4m-3 14h2"/></svg>{support.unit === 'teams' ? tr("لكل فريق جهاز") : tr("لكل لاعب جهاز")}</li>}
      {support?.local && <li><IconUsers />{tr("جهاز واحد للمجموعة")}</li>}
      {(!support?.online || !support?.local) && <li>{support?.online ? tr("هذه اللعبة متاحة أونلاين فقط.") : tr("هذه اللعبة متاحة مع العائلة فقط.")}</li>}
    </ul>
  </Sheet>;
}

export function Home() {
  const { t, locale } = useI18n();
  const { sound, haptics, version } = usePlatform();
  const account = useAccount();
  const social = useSocial();
  const socialUI = useSocialUI();
  const [selectedGame, setSelectedGame] = useState(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const normalize = value => value.replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').trim();
  const order = ['ersomha', 'mafia', 'badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina'];
  const games = [...GAMES].sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id)).filter(game => normalize(gameName(game, locale)).toLowerCase().includes(normalize(query).toLowerCase()) || normalize(game.name).includes(normalize(query)));
  const onlineFriends = account.ready && account.signedIn ? (social?.friends || []).filter(friend => friend.online).slice(0, 5) : [];
  const opening = useRef(false);
  const entryRequired = selectedGame && needsGameEntry(account, selectedGame.id);
  useEffect(() => {
    if (!entryRequired) return;
    setSelectedGame(null); navigate(gameEntryPath(selectedGame.id));
  }, [entryRequired, selectedGame]);
  useEffect(() => reportSimulatorHomeReady({ accountReady: account.ready, gameCount: GAMES.length }), [account.ready]);
  const open = (game) => {
    opening.current = false;
    sound.play('pop'); haptics.vibrate('selection');
    if (needsGameEntry(account, game.id)) { navigate(gameEntryPath(game.id)); return; }
    setSelectedGame(game);
  };
  const select = (mode) => {
    if (selectedGame && needsGameEntry(account, selectedGame.id)) {
      setSelectedGame(null); navigate(gameEntryPath(selectedGame.id)); return;
    }
    const target = gameModePath(selectedGame?.id, mode);
    if (!target || opening.current) return;
    opening.current = true;
    sound.play('whoosh'); haptics.vibrate('selection');
    setSelectedGame(null);
    navigate(target);
  };
  return (
    <Screen data-design-screen="home" dir={getDirection()} className="stack home-screen" aria-label={tr("الألعاب")}>
      <style>{homeStyles}</style>
      <header data-design-id="header" className="home-head">
        <div data-design-id="brand" className="studio-wordmark"><strong>{t('ميدان')}</strong><span lang="en">MAYDAN</span></div>
        <div className="home-head-tools">
          <button type="button" data-design-id="home-search-open" className="home-head-action" aria-label={t(searching ? 'إغلاق بحث الألعاب' : 'البحث عن لعبة')} aria-expanded={searching} aria-controls={searching ? 'home-game-search' : undefined} onClick={() => { setSearching(!searching); if (searching) setQuery(''); }}><LammaIcon name={searching ? 'close' : 'search'} /></button>
          <button type="button" data-design-id="requests-open" className="home-head-action" aria-label={t('طلبات الأصدقاء والدعوات')} onClick={() => socialUI ? socialUI.show({ type: 'list', tab: 'requests' }) : navigate('/friends')}><LammaIcon name="bell" /></button>
          <button type="button" data-design-id="profile" className="home-profile" aria-label={t('بروفايلي')} onClick={() => navigate('/profile')}><ProfileAvatar user={account.user || { avatarPreset:'fox',theme:'teal' }} size={48} /></button>
        </div>
      </header>
      <div className="studio-home-intro"><h1 data-design-id="title">{t('جاهز تلعب؟')}</h1><p>{t('تحدّي جديد، جمعة أحلى')}</p></div>
      {onlineFriends.length > 0 && <section className="studio-home-friends" aria-label={t('أصحابك متصلون')}><h2>{t('أصحابك متصلون')}</h2><div>{onlineFriends.map(friend => <button key={friend.id} data-design-id="online-friend" type="button" aria-label={friend.name} onClick={() => navigate(`/friends/${friend.id}`)}><ProfileAvatar user={friend} size={44} /><span className="studio-online-dot" /><span>{friend.name}</span></button>)}</div></section>}

      {searching && <div className="home-search"><label htmlFor="home-game-search" className="sr-only">{tr("اسم اللعبة")}</label><input data-design-id="search-input" id="home-game-search" value={query} placeholder={tr("اسم اللعبة")} onChange={event => setQuery(event.target.value)} /><LammaIcon name="search" /></div>}
      <section data-design-id="games" className="home-games" aria-labelledby="home-games-title">
        <h2 id="home-games-title" className="studio-games-heading">{t('اختار لعبتك')}</h2>
        <div className="games-grid home-game-list">{games.map((g, i) => <GameCard key={g.id} game={g} index={i} onOpen={open} opensDialog={!needsGameEntry(account, g.id)} />)}</div>
        {!games.length && <p className="home-no-games" role="status">{tr("لا توجد لعبة بهذا الاسم.")}</p>}
      </section>
      <p data-design-id="footer" className="home-footer">{account.gameplayPolicy && account.signedIn ? tr("بدء مباراة جديدة يحتاج اتصالًا للتحقّق · يمكن استئناف المباراة المحلية المحفوظة دون اتصال") : tr("ألعاب الجهاز الواحد تعمل دون إنترنت · الغرف تحتاج اتصالًا")} <span>{tr("الإصدار ")}{version}</span></p>
      <nav className="muted center legal-links" aria-label={tr("الأسعار والسياسات")} style={{ fontSize: 13 }}>
        {account.platform === 'web' && <><a data-design-id="pricing-link" href="pricing/">{tr("التسعير")}</a> · </>}
        <a data-design-id="refunds-link" href={account.platform === 'ios' ? `${PUBLIC_SITE_ORIGIN}/refunds/` : 'refunds/'}>{tr("سياسة الاسترداد")}</a> · <a data-design-id="terms-link" href={LEGAL_ROUTES.terms}>{tr("شروط الاستخدام")}</a> · <a data-design-id="privacy-link" href={LEGAL_ROUTES.privacy}>{tr("سياسة الخصوصية")}</a>
      </nav>
      <GameModeSheet game={entryRequired ? null : selectedGame} onClose={() => setSelectedGame(null)} onSelect={select} />
    </Screen>
  );
}
