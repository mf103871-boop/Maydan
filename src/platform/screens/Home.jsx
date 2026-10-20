// تبويب الألعاب: الألعاب أولًا، مع حضور الأصدقاء وأدوات اللّمّة.
import React, { useRef, useState, useEffect } from 'react';
import { Screen, ripple } from '../../shared/ui/components.jsx';
import { IconUsers, IconClock, IconBack } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { useAccount } from '../../shared/account/context.js';
import { useSocial } from '../../social/SocialProvider.jsx';
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
  if (game.id === 'badeeha') return '١٠ فئات مجانية';
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
  return <div data-design-id="groups" className="lamma-home-groups" aria-label="لمّاتك الأخيرة">{recent.map(group => <button type="button" key={group.id} data-design-id="group-card" className={'lamma-home-group' + (active.has(group.id) ? ' has-live-call' : '')} onClick={() => onOpen(group.id)} aria-label={'افتح لمّة ' + group.name + (active.has(group.id) ? '، مكالمة جارية' : '')}><ProfileAvatar user={{ avatarPreset: group.avatarPreset, theme: 'teal' }} size={32} /><span><strong>{group.name}</strong><small>{active.has(group.id) ? <><LammaIcon name="phone" size={12} />مكالمة جارية</> : group.unreadCount > 0 ? `${group.unreadCount} رسالة جديدة` : 'افتح السوالف'}</small></span></button>)}</div>;
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
    <button ref={ref} type="button" data-design-id={`game-card.${game.id}`} className={`game-card ${game.soon ? 'is-soon' : ''} ${launching ? 'is-launch' : ''}`} style={{ '--game-accent': game.accent, '--delay': `${index * 55}ms` }}
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
  const onlineFriends = social.friends.filter(friend => friend.online);
  const presenceFriends = [...social.friends].sort((a, b) => Number(!!b.online) - Number(!!a.online)).slice(0, 3);
  const activeGroups = new Set((lamma?.calls || []).filter(call => call.scope === 'group' && call.status === 'active').map(call => call.conversationId)).size;
  return (
    <Screen data-design-screen="home" dir={getDirection()} className="stack home-screen" aria-label="الألعاب">
      <header data-design-id="header" className="home-head">
        <div data-design-id="brand" className="brand">
          <BrandMark />
          <div><Wordmark /><div className="brand-sub">ألعاب جمعتنا</div></div>
        </div>
        <button type="button" data-design-id="profile" className="home-profile" aria-label="بروفايلي" title="بروفايلي" onClick={() => navigate('/profile')}><ProfileAvatar user={profiles?.mine || account.user} /></button>
      </header>

      <button type="button" data-design-id="presence" className="home-presence" onClick={() => navigate('/friends')} onPointerDown={ripple} aria-label="افتح الأصدقاء والمحادثات">
        <span className="home-presence-faces" aria-hidden="true">{presenceFriends.length ? presenceFriends.map(friend => <PersonAvatar key={friend.id} user={friend} presence />) : <span className="home-presence-symbol"><IconUsers /></span>}</span>
        <span className="home-presence-copy"><strong>{onlineFriends.length ? `${onlineFriends.length} من أصحابك متصل الآن` : 'اللّمة تبدأ بأصحابك'}</strong><small>{!account.signedIn ? 'سجّل دخولك وابدأ السوالف' : activeGroups ? `${activeGroups} من شِلَلك في مكالمة الآن` : 'سوالف، صوت، ودعوة للعب'}</small></span>
        <IconBack className="home-presence-arrow" />
      </button>

      <section data-design-id="games" className="home-games" aria-labelledby="home-games-title">
        <div className="home-section-heading"><div><h1 data-design-id="title" id="home-games-title">اختار لعبتك</h1><p>كل جمعة لها ميدان</p></div><span className="badge">{gamesLabel(GAMES.length)}</span></div>
        <div className="games-grid">{cards.map((g, i) => <GameCard key={g.id} game={g} index={i} launching={launchId === g.id} badge={plusBadge(account, g)} onOpen={open} />)}</div>
      </section>

      <section data-design-id="tools" className="home-tools" aria-label="الغرف واللاعبون">
      <button type="button" data-design-id="rooms" className="card online-home-card" onClick={() => navigate('/online')} onPointerDown={ripple}>
        <ClayStage className="clay-static"><GameArtwork game="meenfina" /></ClayStage>
        <span><strong>اللّمّة من كل جوال</strong><small>ارسمها وفبركة من شخصين · مين فينا من ثلاثة · برمز أو بدعوة</small></span>
        <IconBack className="home-tool-arrow" />
      </button>
      <button type="button" data-design-id="roster" className="card roster-card" onClick={() => navigate('/players')} aria-label="دفتر اللاعبين" onPointerDown={ripple}>
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
      </section>
      <p data-design-id="footer" className="home-footer">ألعاب الجهاز الواحد تعمل دون إنترنت · الغرف تحتاج اتصالًا <span>الإصدار {version}</span></p>
      <nav className="muted center legal-links" aria-label="الأسعار والسياسات" style={{ fontSize: 13 }}>
        {account.platform !== 'ios' && <><a data-design-id="pricing-link" href="pricing/">التسعير</a> · </>}
        <a data-design-id="refunds-link" href={account.platform === 'ios' ? `${PUBLIC_SITE_ORIGIN}/refunds/` : 'refunds/'}>سياسة الاسترداد</a> · <a data-design-id="terms-link" href={LEGAL_ROUTES.terms}>شروط الاستخدام</a> · <a data-design-id="privacy-link" href={LEGAL_ROUTES.privacy}>سياسة الخصوصية</a>
      </nav>
    </Screen>
  );
}
