// الرئيسية: الشعار، الإعدادات، دفتر اللاعبين، وشبكة بطاقات الألعاب.
import React, { useRef, useState, useEffect } from 'react';
import { Screen, IconButton, ripple } from '../../shared/ui/components.jsx';
import { IconSettings, IconUsers, IconClock, IconInfo } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { useAccount } from '../../shared/account/context.js';
import { useSocial } from '../../social/SocialProvider.jsx';
import { useSocialUI } from '../../social/SocialUIProvider.jsx';
import { useLamma } from '../../social/LammaProvider.jsx';
import { PersonAvatar } from '../../social/SocialScreen.jsx';
import { LammaIcon } from '../../social/LammaMedia.jsx';
import { useProfiles } from '../../profiles/ProfileProvider.jsx';
import { ProfileAvatar } from '../../profiles/ProfileAvatar.jsx';
import { PUBLIC_SITE_ORIGIN, LEGAL_ROUTES } from '../../shared/account/config.js';
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

export function HomeGroups({ account, groups = [], calls = [], onOpen }) {
  // LammaProvider supplies an identity-checked snapshot; guests never render cached groups.
  if (!account?.ready || !account.signedIn) return null;
  const active = new Set(calls.filter(call => call.scope === 'group' && call.status === 'active').map(call => call.conversationId));
  const recent = [...groups].sort((a, b) => Number(active.has(b.id)) - Number(active.has(a.id)) || Number(!!b.unreadCount) - Number(!!a.unreadCount) || Number(b.lastMessage?.createdAt || b.updatedAt || b.createdAt || 0) - Number(a.lastMessage?.createdAt || a.updatedAt || a.createdAt || 0)).slice(0, 3);
  if (!recent.length) return null;
  return <div className="lamma-home-groups" aria-label="لمّاتك الأخيرة">{recent.map(group => <button type="button" key={group.id} className={'lamma-home-group' + (active.has(group.id) ? ' has-live-call' : '')} onClick={() => onOpen(group.id)} aria-label={'افتح لمّة ' + group.name + (active.has(group.id) ? '، مكالمة جارية' : '')}><ProfileAvatar user={{ avatarPreset: group.avatarPreset, theme: 'teal' }} size={32} /><span><strong>{group.name}</strong><small>{active.has(group.id) ? <><LammaIcon name="phone" size={12} />مكالمة جارية</> : group.unreadCount > 0 ? `${group.unreadCount} رسالة جديدة` : 'افتح السوالف'}</small></span></button>)}</div>;
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
  const social = useSocial() || { friends: [], incoming: [], unreadCount: 0 };
  const socialUI = useSocialUI();
  const lamma = useLamma();
  const profiles = useProfiles();
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
          <button type="button" aria-label="بروفايلي" title="بروفايلي" onClick={() => navigate('/profile')} style={{ border: 0, padding: 0, background: 'transparent', borderRadius: 14, cursor: 'pointer' }}><ProfileAvatar user={profiles?.mine || account.user} /></button>
        </div>
      </header>

      <button type="button" className="card online-home-card" onClick={() => navigate('/online')} onPointerDown={ripple}>
        <ClayStage className="clay-static"><GameArtwork game="meenfina" /></ClayStage>
        <span><strong>اللّمّة من كل جوال</strong><small>غرف «مين فينا؟» و«فبركة» · دخول برمز وتصويت سري</small></span>
        <span className="online-new">تجريبي</span>
      </button>

      <section className="lamma-home-card" aria-label="الأصدقاء والمحادثات">
        <div className="lamma-home-heading"><div><strong>الميدان يحلى بأصحابك</strong><small>{account.signedIn ? `${social.friends.filter(f => f.online).length} متصل الآن · السالفة تبدأ من هنا` : 'سوالف، صوت، ولعبة تجمعكم'}</small></div><button type="button" onClick={() => socialUI ? socialUI.show() : navigate('/friends')}>افتح اللّمة{social.unreadCount + social.incoming.length > 0 && <b className="lamma-unread">{social.unreadCount + social.incoming.length}</b>}</button></div>
        <div className="lamma-home-friends">{social.friends.slice().sort((a, b) => Number(!!b.online) - Number(!!a.online)).slice(0, 7).map(friend => <button type="button" className="lamma-home-friend" key={friend.id} onClick={() => socialUI ? socialUI.openChat(friend.id) : navigate('/friends/' + friend.id)} aria-label={'محادثة مع ' + friend.name}><PersonAvatar user={friend} presence /><span>{friend.name}</span></button>)}<button type="button" className="lamma-home-friend" onClick={() => socialUI ? socialUI.show() : navigate('/friends')}><span className="lamma-home-add"><LammaIcon name="plus" size={22} /></span><span>أصحابك</span></button></div>
        <HomeGroups account={account} groups={lamma?.groups} calls={lamma?.calls} onOpen={id => socialUI?.openGroup(id)} />
      </section>

      <button type="button" className="card roster-card" onClick={() => navigate('/players')} aria-label="دفتر اللاعبين" onPointerDown={ripple}>
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
      <nav className="muted center legal-links" aria-label="الأسعار والسياسات" style={{ fontSize: 13 }}>
        {account.platform !== 'ios' && <><a href="pricing/">التسعير</a> · </>}
        <a href={account.platform === 'ios' ? `${PUBLIC_SITE_ORIGIN}/refunds/` : 'refunds/'}>سياسة الاسترداد</a> · <a href={LEGAL_ROUTES.terms}>شروط الاستخدام</a> · <a href={LEGAL_ROUTES.privacy}>سياسة الخصوصية</a>
      </nav>
    </Screen>
  );
}
