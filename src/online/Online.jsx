import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import config from '../../online.config.json';
import { Screen, TopBar, Button, Card, ConfirmModal, Podium, Scoreboard } from '../shared/ui/components.jsx';
import { Avatar, AvatarPicker, GameArtwork, ClayStage } from '../shared/brand/art.jsx';
import { burstConfetti, vignette } from '../shared/fx/index.js';
import { navigate, setExitGuard } from '../platform/router.js';
import { usePlatform } from '../platform/context.js';
import { useAccount } from '../shared/account/context.js';
import { socialInterruption } from '../social/interruption.js';
import { useLamma } from '../social/LammaProvider.jsx';
import { socialJoinFallbackKey } from '../social/game-launch.js';
import { AVATARS, ROUND_OPTIONS, ONLINE_GAMES, ROOM_CAPABILITIES, ROOM_REACTIONS, reactionsAllowed, minimumOnlinePlayers, EXPIRY_WARNING, normalizeCode, validCode, resolveServerUrl, errorText, arabicNumber } from './shared.js';
import { RoomClient, newCredentials, post, readSaved, save, clearSession, deviceId } from './client.js';
import { reloadWithLatestVersion } from './update.js';
import { isNativeShell } from '../shared/account/native.js';
import { normalizeContentOptions } from '../games/fabraka/content.js';
import { FabrakaSettings, FabrakaRules, FabrakaMatch, FABRAKA_MODES, fabrakaTopics } from './Fabraka.jsx';
import { ErsomhaSettings, ErsomhaRules, ErsomhaLobbySettings, ErsomhaMatch } from './Ersomha.jsx';
import { ErsomhaIcon } from '../games/ersomha/icon.jsx';
import { normalizeErsomhaOptions, enoughErsomhaCategories } from '../games/ersomha/options.js';

const SERVER = resolveServerUrl(typeof __MAYDAN_ROOMS_URL__ !== 'undefined' && __MAYDAN_ROOMS_URL__ || config.serverUrl, typeof location === 'undefined' ? '' : location.origin);
const arabic = arabicNumber;
const inviteUrl = (code) => { const url = new URL(location.href); url.search = ''; url.hash = `/room/${code}`; return url.toString(); };
function ErrorNotice({ code }) { return code ? <p className="online-notice error" role="alert">{errorText(code)}</p> : null; }

export function Entry({ initialCode = '', initialGame = 'meenfina', onJoined }) {
  const account = useAccount();
  const fallback = initialCode && account.user?.id ? readSaved(SERVER, socialJoinFallbackKey(account.user.id, initialCode)) : null;
  const [mode, setMode] = useState(initialCode ? 'join' : 'create');
  const [game, setGame] = useState(ONLINE_GAMES[initialGame] ? initialGame : 'meenfina');
  const [fabrakaSettings, setFabrakaSettings] = useState(() => normalizeContentOptions(readSaved(SERVER, 'fabrakaSettings')));
  const [ersomhaSettings, setErsomhaSettings] = useState(() => normalizeErsomhaOptions(readSaved(SERVER, 'ersomhaSettings')));
  const [name, setName] = useState(() => fallback?.name || readSaved(SERVER, 'profile')?.name || Array.from(account.user?.name?.normalize('NFKC').trim().replace(/\s+/g, ' ') || '').slice(0, 20).join(''));
  const [avatar, setAvatar] = useState(() => fallback?.avatar ?? readSaved(SERVER, 'profile')?.avatar ?? 0);
  const [code, setCode] = useState(initialCode);
  const [rounds, setRounds] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(fallback?.error || '');
  const credentialsRef = useRef(fallback?.session || null);
  const lastRoom = readSaved(SERVER, 'lastRoom');
  // The server rejects these settings with QUESTIONS; keep the button honest instead.
  const topicsReady = mode !== 'create' || (game === 'fabraka' ? fabrakaTopics(fabrakaSettings).enough : game === 'ersomha' ? enoughErsomhaCategories(ersomhaSettings) : true);
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    setError('');
    if (!name.trim()) { setError('NAME'); return; }
    if (mode === 'create' && game === 'ersomha' && !account.user?.id) { setError('AUTH_REQUIRED'); return; }
    const normalized = normalizeCode(code);
    if (mode === 'join' && !validCode(normalized)) { setError('INVALID'); return; }
    // Waiting for friends never consumes the trial. It is marked only after
    // the authoritative server confirms the first actual match start.
    if (mode === 'create' && account.gameAccess(game) === 'locked') { account.openPaywall({ reason: 'room', game }); return; }
    setBusy(true);
    try {
      const pendingKey = mode === 'create' ? (game === 'meenfina' ? 'pendingCreate' : `pendingCreate:${game}`) : `pendingJoin:${normalized}`;
      let session = mode === 'join' ? readSaved(SERVER, normalized) : null;
      session ||= credentialsRef.current || readSaved(SERVER, pendingKey) || newCredentials();
      credentialsRef.current = session;
      save(SERVER, pendingKey, session); // Persist before HTTP so a retry can reclaim the same seat.
      const result = await post(SERVER, mode === 'create' ? '/api/rooms' : `/api/rooms/${normalized}/join`, { ...session, name: name.trim(), avatar, rounds, capabilities: ROOM_CAPABILITIES,
        // معرّف الجهاز يحتسب الغرفة المجانية لغير المسجّل على الخادم؛ الدخول برمز لا يحتاجه.
        ...(mode === 'create' ? { game, deviceId: deviceId(), ...(game === 'fabraka' ? { settings: fabrakaSettings } : game === 'ersomha' ? { settings: ersomhaSettings } : {}) } : {}) }, { headers: account.authHeaders() });
      const stored = save(SERVER, result.code, session);
      if (account.user?.id) {
        save(SERVER, `roomOwner:${result.code}`, account.user.id);
        save(SERVER, socialJoinFallbackKey(account.user.id, result.code), null);
      }
      save(SERVER, 'persistence', stored);
      save(SERVER, 'profile', { name: name.trim(), avatar }); save(SERVER, 'lastRoom', result.code); save(SERVER, pendingKey, null);
      onJoined(result.code, session, stored);
    } catch (e) {
      // الخادم يردّ PLUS_REQUIRED لمسجّل غير مشترك استهلك تجربته: الجدار أوضح من تنبيه أحمر.
      if (e.code === 'PLUS_REQUIRED') account.openPaywall({ reason: 'room', game });
      else setError(e.code || 'NETWORK');
    }
    finally { setBusy(false); }
  }
  return <>
    <Card data-design-id="hero" className="online-intro">
      {/* الحامل مفتاحه اللعبة: يعيد الهبوط عند التبديل ثم يطفو؛ النص مفتاحه الوضع فيدخل كصف */}
      <ClayStage key={game} className="clay-idle" aria-hidden="true">{game === 'ersomha' ? <ErsomhaIcon /> : <GameArtwork game={game} />}</ClayStage>
      <div key={mode} className="online-intro-copy">
        <span className="online-label">{mode === 'create' ? ONLINE_GAMES[game].name : 'غرف ميدان'} · تجربة جماعية</span>
        <h1>اللّمّة وحدة، وكل واحد بجواله</h1>
        <p>{mode === 'join' ? 'رمز واحد يجمعكم في نفس اللعبة' : game === 'ersomha' ? '٢–٨ لاعبين · رسم حي · تخمين معًا' : game === 'fabraka' ? '٢–٨ لاعبين · كتابة متزامنة · تصويت سري' : '٣–١٢ لاعبًا · تصويت سري · نفس السؤال للجميع'}</p>
      </div>
    </Card>
    {!SERVER && <p className="online-notice" role="status">الغرف غير متاحة بعد. تقدر تلعب ألعاب ميدان على جهاز واحد من الرئيسية.</p>}
    {lastRoom && !initialCode && readSaved(SERVER, lastRoom) && <Button full onClick={() => onJoined(lastRoom, readSaved(SERVER, lastRoom), readSaved(SERVER, 'persistence') !== false)}>العودة إلى غرفتي <bdi>{lastRoom}</bdi></Button>}
    <Card>
      <div data-design-id="entry-mode" className="online-tabs" role="group" aria-label="طريقة الدخول">
        <Button data-design-id="entry-create" variant={mode === 'create' ? 'primary' : 'ghost'} aria-pressed={mode === 'create'} onClick={() => { setMode('create'); setError(''); credentialsRef.current = null; }}>إنشاء غرفة</Button>
        <Button data-design-id="entry-join" variant={mode === 'join' ? 'primary' : 'ghost'} aria-pressed={mode === 'join'} onClick={() => { setMode('join'); setError(''); credentialsRef.current = null; }}>دخول برمز</Button>
      </div>
      <form data-design-id="entry" className="stack" onSubmit={submit}>
        {mode === 'create' && <div data-design-id="game-picker" className="online-game-picker" role="group" aria-label="لعبة الغرفة">{Object.entries(ONLINE_GAMES).map(([id, info]) => <button data-design-id={`game-choice.${id}`} key={id} type="button" disabled={busy} aria-pressed={game === id} className={game === id ? 'selected' : ''} onClick={() => { setGame(id); setError(''); credentialsRef.current = null; }}><ClayStage className="clay-static" aria-hidden="true">{id === 'ersomha' ? <ErsomhaIcon /> : <GameArtwork game={id} />}</ClayStage><b>{info.name}</b><small>{arabic(info.min)}–{arabic(info.max)} لاعبين</small></button>)}</div>}
        <label className="online-field">اسمك في الغرفة<input data-design-id="name-input" autoComplete="nickname" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="اكتب اسمك" required /></label>
        <div data-design-id="avatar-picker"><span className="online-field-label">اختر شخصيتك</span><AvatarPicker value={AVATARS[avatar]} onChange={(emoji) => setAvatar(AVATARS.indexOf(emoji))} /></div>
        {mode === 'join' ? <label className="online-field">رمز الغرفة<input data-design-id="room-code" className="online-code-input" dir="ltr" inputMode="numeric" autoComplete="off" maxLength={8} value={code} onChange={(e) => { setCode(normalizeCode(e.target.value)); credentialsRef.current = null; }} placeholder="123456" required /></label>
          : game === 'fabraka' ? <FabrakaSettings value={fabrakaSettings} disabled={busy} onChange={(next) => { setFabrakaSettings(next); save(SERVER, 'fabrakaSettings', next); }} />
          : game === 'ersomha' ? <ErsomhaSettings value={ersomhaSettings} disabled={busy} onChange={(next) => { setErsomhaSettings(next); save(SERVER, 'ersomhaSettings', next); }} />
          : <label className="online-field">عدد الجولات<select data-design-id="round-count" value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>{ROUND_OPTIONS.map((n) => <option key={n} value={n}>{arabic(n)} جولات</option>)}</select></label>}
        {mode === 'create' && game === 'fabraka' && <FabrakaRules />}
        {mode === 'create' && game === 'ersomha' && <><ErsomhaRules />{!account.user?.id && <p className="online-notice" role="status">ارسمها تحتاج حسابًا ليُحفظ تاريخ الأفكار عبر أجهزتك. <Button size="sm" onClick={() => navigate('/settings')}>تسجيل الدخول</Button></p>}</>}
        <ErrorNotice code={error} />
        <Button data-design-id="start" data-design-required="true" type="submit" variant="primary" size="lg" full disabled={!SERVER || busy || !topicsReady} loading={busy}>{mode === 'create' ? 'أنشئ الغرفة' : 'ادخل الغرفة'}</Button>
      </form>
    </Card>
    <p className="online-footnote">تحتاج الغرف اتصالًا بالإنترنت على كل هاتف. تنتهي الغرفة بعد ساعتين.</p>
  </>;
}
export function Invite({ code }) {
  const { toast } = usePlatform();
  const [qr, setQr] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [qrReady, setQrReady] = useState(false);   // الصورة ظاهرة دائمًا؛ الصنف يضيف انبثاقًا بعد التحميل فقط
  const url = inviteUrl(code);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 200, margin: 3, errorCorrectionLevel: 'M', color: { dark: '#35224A', light: '#FFFFFF' } })
      .then((src) => { if (!cancelled) setQr(src); }).catch(() => {});
    return () => { cancelled = true; };
  }, [url]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); toast('تم نسخ رابط الدعوة'); }
    catch { setShowLink(true); }
  }
  return <Card data-design-id="invite" className="online-invite">
    <div><span className="online-label">رمز الغرفة</span><strong data-design-id="invite-code" className="online-room-code" dir="ltr">{code}</strong><p>أرسل الرابط أو خلي أصحابك يمسحوا الرمز.</p><Button data-design-id="invite-share" onClick={() => window.dispatchEvent(new CustomEvent('maydan-invite-friends', { detail: { roomCode: code } }))}>ادعُ أصدقاء ميدان</Button><Button data-design-id="invite-copy" onClick={copy}>نسخ رابط الدعوة</Button></div>
    {qr && <img data-design-id="invite-qr" width="136" height="136" src={qr} className={qrReady ? 'is-ready' : ''} onLoad={() => setQrReady(true)} alt={`رمز QR للدخول إلى الغرفة ${code}`} />}
    {showLink && <label className="online-field online-invite-link">رابط الدعوة<input readOnly value={url} dir="ltr" onFocus={(e) => e.target.select()} /></label>}
  </Card>;
}
// Exported for the rooms regression tests, which render the waiting room from a snapshot.
export function Lobby({ state, me, isHost, disabled, act }) {
  const players = state.members.filter((m) => !m.left);
  const minimum = minimumOnlinePlayers(state.game, state.settings);
  const canStart = players.length >= minimum && players.every((m) => m.connected && m.ready);
  // إزالة لاعب متصل قرار يستحق تأكيدًا؛ المقعد المنقطع يُزال مباشرة. الإزالة تمنع العودة إلى هذه الغرفة.
  const [kickTarget, setKickTarget] = useState(null);
  return <section data-design-screen="online.lobby" className="stack">
    <Invite code={state.code} />
    <Card className="stack">
      <div data-design-id="header" className="row-between"><h2>غرفة الانتظار</h2><span>{arabic(players.length)} / {arabic(ONLINE_GAMES[state.game || 'meenfina'].max)}</span></div>
      <ul data-design-id="players" className="online-players">{players.map((p, i) => <li data-design-id="member" key={p.id} style={{ '--i': i }}>
        <span className="online-seat" style={{ background: p.color }} aria-hidden="true" /><Avatar index={p.avatar} /><div className="grow"><b>{p.name}{p.id === me?.id ? ' (أنت)' : ''}</b><small>{p.id === state.hostId ? 'المضيف · ' : ''}{!p.connected ? 'انقطع الاتصال' : p.ready ? 'جاهز' : 'يستعد'}</small></div>
        <span className={`online-presence ${p.connected && p.ready ? 'ready' : ''}`} aria-hidden="true" />
        {isHost && p.id !== me?.id && <Button size="sm" variant={p.connected ? 'ghost' : 'secondary'} disabled={disabled} data-design-id="member-remove" onClick={() => (p.connected ? setKickTarget(p) : act('kick', { targetId: p.id }))}>إزالة</Button>}
      </li>)}</ul>
      <Button data-design-id="ready" full disabled={disabled} variant={me?.ready ? 'secondary' : 'primary'} onClick={() => act('ready', { ready: !me?.ready })}>{me?.ready ? 'أنا جاهز ✓ — إلغاء الجاهزية' : 'أنا جاهز'}</Button>
      {isHost ? <Button full variant="primary" size="lg" className={canStart ? 'is-armed' : ''} disabled={disabled || !canStart} data-design-id="start" data-design-required="true" onClick={() => act('start')}>ابدأ اللعب</Button> : <p className="online-footnote">المضيف يبدأ الجولة عندما يجهز الجميع.</p>}
      {!canStart && isHost && <p className="online-footnote">{minimum === 2 ? 'نحتاج لاعبين على الأقل، متصلين وجاهزين جميعًا.' : 'نحتاج ٣ لاعبين على الأقل، متصلين وجاهزين جميعًا.'} تقدر تزيل مقعدًا منقطعًا من الانتظار.</p>}
      {state.game === 'fabraka' && minimum === 2 && players.length === 2 && <p className="online-footnote" role="status">تحدّي لشخصين: فبركة صاحبك تمتزج بخيارات اللعبة، والحقيقة تبقى سرّية حتى الكشف.</p>}
      {state.game === 'ersomha' && <p className="online-footnote" role="status">{players.length === 2 ? 'ثنائي متعاون: تتبادلان الرسم ضد الوقت، ونتيجتكما مشتركة.' : 'من ٣ لاعبين: منافسة فردية وأدوار رسم متوازنة للجميع.'} يثبت نمط المباراة عند البداية.</p>}
    </Card>
    {state.game === 'fabraka' ? <Card className="stack"><h2>فبركة · {FABRAKA_MODES[state.settings.mode]}</h2><p>{arabic(state.rounds)} جولات · {state.settings.writeSeconds ? `${arabic(state.settings.writeSeconds)} ثانية للكتابة` : 'كتابة براحتنا'} · {state.settings.discussionSeconds ? `${arabic(state.settings.discussionSeconds)} ثانية للنقاش` : 'بدون نقاش'} · ٣٠ ثانية للتصويت.</p><FabrakaRules /></Card>
      : state.game === 'ersomha' ? <ErsomhaLobbySettings state={state} isHost={isHost} disabled={disabled} act={act} />
      : <p className="online-footnote">{arabic(state.rounds)} جولات · ٣٠ ثانية لكل تصويت · الأعلى أصواتًا يكسب نقطة، والتعادل يحتسب للجميع.</p>}
    {kickTarget && <ConfirmModal title={`تزيل ${kickTarget.name}؟`} message="يخرج من الغرفة ولا يستطيع العودة إليها بهذا الرمز." confirmLabel="إزالة" cancelLabel="إبقاؤه" onConfirm={() => { const target = kickTarget; setKickTarget(null); act('kick', { targetId: target.id }); }} onCancel={() => setKickTarget(null)} />}
  </section>;
}
// «دقيقة واحدة»، «دقيقتان»، «٣–١٠ دقائق»، ثم «١١ دقيقة».
function minutesLabel(n) {
  if (n <= 1) return 'دقيقة واحدة';
  if (n === 2) return 'دقيقتين';
  return `${arabic(n)} ${n <= 10 ? 'دقائق' : 'دقيقة'}`;
}
export function Match({ state, disabled, isHost, act, clockOffset, spectating = false }) {
  const platform = usePlatform();
  const [now, setNow] = useState(Date.now());
  const [choice, setChoice] = useState(undefined);
  const winnerRef = useRef(null);
  useEffect(() => { setChoice(undefined); }, [state.matchId, state.round]);
  useEffect(() => {
    if (state.phase !== 'vote' || state._designPreview) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.phase, state.round, state._designPreview]);
  const seconds = Math.max(0, Math.ceil((state.deadlineAt - (now + clockOffset)) / 1000));
  const players = state.members.filter((m) => state.participants.includes(m.id));
  const sorted = [...players].sort((a, b) => b.score - a.score);
  // آخر ثلاث ثوانٍ من التصويت: تظليل أحمر نابض (يُطفأ عند تغيّر الطور أو الخروج).
  useEffect(() => {
    vignette(state.phase === 'vote' && seconds > 0 && seconds <= 3);
    return () => vignette(false);
  }, [state.phase, seconds]);
  // النتيجة: قصاصات عند صف الفائز الأول، وصوت «صح» إن كان اختياري هو الفائز (مرئي/صوتي فقط).
  useEffect(() => {
    if (state.phase !== 'result') return;
    const r = winnerRef.current?.getBoundingClientRect();
    if (r) burstConfetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 36 });
    if (state.myVote?.targetId != null && state.winners.includes(state.myVote.targetId)) platform?.sound?.play('correct');
  }, [state.phase, state.round, state._designPreview]);
  if (state.phase === 'over') return <section data-design-screen="online.meenfina.over" className="stack">
    {state.reason === 'players_left' && <p className="online-notice">انتهت اللعبة لأن عدد اللاعبين أصبح أقل من ٣. هذه نقاط الجولات المكتملة.</p>}
    <Podium data-design-id="podium" entries={sorted} />
    <Card className="stack">{sorted.map((p) => <div className="row-between" key={p.id}><b>{p.name}</b><span>{p.title}</span></div>)}</Card>
    {isHost ? <Button data-design-id="restart" full size="lg" variant="primary" disabled={disabled} onClick={() => act('restart')}>العودة للانتظار ولعب مرة ثانية</Button> : <p className="online-footnote">بانتظار المضيف لبدء لعبة جديدة.</p>}
  </section>;
  return <section data-design-screen={`online.meenfina.${state.phase}`} className="stack">
    <div className="row-between"><b>الجولة {arabic(state.round)} من {arabic(state.rounds)}</b>{state.phase === 'vote' && <span data-design-id="timer" className={`online-timer ${seconds <= 5 ? 'urgent' : ''}`} aria-label={`متبقي ${seconds} ثانية`}><b key={seconds <= 5 ? seconds : 'n'}><bdi>{arabic(seconds)}</bdi></b> ث</span>}</div>
    <Card data-design-id="question" className="online-question" key={state.round}><ClayStage aria-hidden="true"><GameArtwork game="meenfina" /></ClayStage><h1>{state.question?.text}</h1></Card>
    {state.phase === 'vote' ? <Card data-design-id="vote-panel" className="stack">
      {spectating ? <div className="online-voted" role="status"><strong>تتفرج على هذه الجولة</strong><p>اللاعبون يصوّتون الآن، وتشارك معهم من المباراة القادمة.</p></div> : state.myVote.submitted ? <div className="online-voted" role="status"><strong>وصل تصويتك ✓</strong><p>اختيارك: {state.myVote.targetId === null ? 'لا أحد' : players.find((p) => p.id === state.myVote.targetId)?.name}. بانتظار الباقي…</p></div> : <>
        <p className="online-footnote">اختَر الشخص الأقرب للعبارة. تقدر تختار نفسك. بعد التأكيد لا يمكن تغيير التصويت.</p>
        <div data-design-id="options-list" className="online-vote-grid" role="group" aria-label="اختر لاعبًا">{players.map((p, i) => <button data-design-id="option" className={`online-vote-choice ${choice === p.id ? 'selected' : ''}`} type="button" key={p.id} style={{ '--i': i }} disabled={disabled || seconds === 0} aria-pressed={choice === p.id} onClick={() => setChoice(p.id)}><ClayStage className="clay-static" aria-hidden="true"><Avatar index={p.avatar} /></ClayStage><b>{p.name}</b>{p.left && <small>غادر الجولة</small>}</button>)}</div>
        <Button data-design-id="abstain" aria-pressed={choice === null} variant={choice === null ? 'secondary' : 'ghost'} disabled={disabled || seconds === 0} onClick={() => setChoice(null)}>لا أحد</Button>
        <Button data-design-id="submit" full variant="primary" size="lg" disabled={disabled || choice === undefined || seconds === 0} onClick={() => act('vote', { targetId: choice })}>تأكيد التصويت</Button>
      </>}
      <p className="online-footnote" role="status">وصل {arabic(state.submittedCount)} تصويت · {seconds === 0 ? 'بانتظار نتيجة الخادم…' : 'اختيارات اللاعبين تبقى سرّية'}</p>
    </Card> : <Card className="stack">
      <h2>{state.winners.length ? state.winners.map((id) => players.find((p) => p.id === id)?.name).join(' و') : 'ولا أحد هالمرة!'}</h2>
      <p>{state.winners.length > 1 ? 'تعادل! نقطة لكل واحد منهم.' : state.winners.length ? 'أكثر واحد أخذ أصوات… ونقطة جديدة!' : 'لم يحصل أحد على أصوات.'}</p>
      <ul data-design-id="players" className="online-players">{players.map((p, i) => <li key={p.id} ref={state.winners[0] === p.id ? winnerRef : null} className={state.winners.includes(p.id) ? 'is-winner' : ''} style={{ '--i': i }}><Avatar index={p.avatar} /><b className="grow">{p.name}</b><span>{arabic(state.counts[p.id] || 0)} أصوات</span>{state.winners.includes(p.id) && <b className="online-point">+١</b>}</li>)}</ul>
      {isHost ? <Button data-design-id="continue" full variant="primary" size="lg" disabled={disabled} onClick={() => act('next')}>{state.round === state.rounds ? 'عرض النتيجة النهائية' : 'الجولة التالية'}</Button> : <p className="online-footnote">بانتظار المضيف للمتابعة.</p>}
    </Card>}
    <Card className="stack"><h2>النقاط</h2><Scoreboard data-design-id="scoreboard" entries={sorted} /></Card>
  </section>;
}
// The same chrome is rendered by real connected rooms and isolated design fixtures.
// Connection state and actions remain owned by ConnectedRoom; this view cannot
// create a socket, reserve a seat, or send a room command by itself.
export function RoomChrome({ state, code, status, error, expiring = false, msLeft = Infinity, dropped = [], disabled = false, onExit, onKick, onReconnect, children }) {
  return <div data-design-screen="online.chrome" className="stack online-room-chrome">
    <TopBar data-design-id="topbar" title={state ? ONLINE_GAMES[state.game || 'meenfina']?.name || 'غرف ميدان' : 'غرف ميدان'} eyebrow={`غرفة ${code}`} end={<span data-design-id="room-actions" className="online-room-actions">{state?.game === 'ersomha' && <span className="online-social-slot" data-social-game-launcher />}<Button data-design-id="exit" data-design-required="true" size="sm" onClick={onExit}>خروج</Button></span>} />
    <p data-design-id="connection" data-design-required="true" className={`online-connection ${status === 'connected' ? 'connected' : ''}`} role="status">{status === 'connected' ? 'متصل · كل واحد بجواله' : status === 'ended' ? 'انتهى الاتصال بالغرفة' : status === 'outdated' ? 'نسخة اللعبة أقدم من الغرفة' : status === 'replaced' ? 'الجلسة مفتوحة في تبويب آخر' : 'جاري الاتصال بالغرفة…'}</p>
    <ErrorNotice code={error} />
    {state?.hostMissingSince && <p className="online-notice is-host-missing">انقطع اتصال المضيف. تنتقل الإدارة للاعب متصل بعد ٢٠ ثانية إذا لم يعد.</p>}
    {expiring && <p className="online-notice" role="status">تنتهي الغرفة بعد {minutesLabel(Math.max(1, Math.ceil(msLeft / 60_000)))}. أكملوا الجولة الحالية أو أنشئوا غرفة جديدة بعدها.</p>}
    {dropped.length > 0 && <Card data-design-id="dropped" className="stack online-dropped"><p className="online-footnote">مقاعد منقطعة: لا تنتظرها الجولة بعد ١٥ ثانية، وتقدر تزيلها من المباراة.</p>{dropped.map((m) => <Button data-design-id="member-remove" key={m.id} size="sm" variant="ghost" disabled={disabled} onClick={() => onKick?.(m.id)}>إزالة {m.name}</Button>)}</Card>}
    {['replaced', 'reconnecting', 'disconnected'].includes(status) && <Button data-design-id="reconnect" data-design-required="true" onClick={onReconnect}>إعادة الاتصال</Button>}
    {children}
  </div>;
}

// تفاعلات سريعة: طقم رموز ثابت، وكل تفاعل يطفو باسم صاحبه ثم يختفي. لا نص حر ولا حفظ؛
// الخادم يحدّ كل مقعد بدفعة صغيرة، والزر يهدأ لحظة إن بلغها اللاعب.
export function RoomReactions({ client, state, me, status }) {
  const [floating, setFloating] = useState([]);
  const [resting, setResting] = useState(false);
  const membersRef = useRef([]); membersRef.current = state?.members || [];
  const meId = me?.id;
  useEffect(() => {
    if (!client) return undefined;
    const timers = new Set();
    const unsubscribe = client.subscribeReactions((event) => {
      const sender = membersRef.current.find((m) => m.id === event.seatId && !m.left);
      if (!sender || !ROOM_REACTIONS.includes(event.emoji)) return;
      const item = { key: event.id || `${event.seatId}-${event.at}`, emoji: event.emoji, name: event.seatId === meId ? 'أنت' : sender.name, lane: Math.floor(Math.random() * 5) };
      setFloating((list) => [...list.filter((x) => x.key !== item.key).slice(-7), item]);
      const timer = setTimeout(() => { timers.delete(timer); setFloating((list) => list.filter((x) => x.key !== item.key)); }, 2600);
      timers.add(timer);
    });
    return () => { unsubscribe(); timers.forEach(clearTimeout); };
  }, [client, meId]);
  const restTimer = useRef(0);
  useEffect(() => () => clearTimeout(restTimer.current), []);
  if (!state || !me || !client) return null;
  const allowed = reactionsAllowed(state, me.id);
  const send = async (emoji) => {
    try { await client.react(emoji); }
    catch (error) {
      if (error?.code !== 'RATE_LIMIT') return;
      setResting(true); clearTimeout(restTimer.current); restTimer.current = setTimeout(() => setResting(false), 1500);
    }
  };
  return <>
    <div className="room-reactions" role="group" aria-label={allowed ? 'تفاعل سريع' : 'التفاعل متوقف خلال دورك في الرسم'}>
      {ROOM_REACTIONS.map((emoji) => <button key={emoji} type="button" className="room-reaction" disabled={status !== 'connected' || !allowed || resting} aria-label={`أرسل ${emoji}`} onClick={() => send(emoji)}>{emoji}</button>)}
    </div>
    <div className="room-reaction-layer" aria-live="polite">
      {floating.map((item) => <span key={item.key} className={`room-reaction-float lane-${item.lane}`}><b>{item.emoji}</b><small>{item.name}</small></span>)}
    </div>
  </>;
}

function ConnectedRoom({ code, session, stored, onLeft }) {
  const { toast, sound, haptics, confetti } = usePlatform();
  const account = useAccount();
  const lamma = useLamma();
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(stored ? '' : 'STORAGE');
  const [busy, setBusy] = useState(false);
  const [exitTarget, setExitTarget] = useState(null);
  const [updating, setUpdating] = useState(false);
  const clientRef = useRef(null);
  const busyRef = useRef(false);
  const trialMarked = useRef(false);
  const reportRef = useRef(null);
  const accountRef = useRef(account); accountRef.current = account;
  const ownerRef = useRef(readSaved(SERVER, `roomOwner:${code}`) || account.user?.id || null);
  const ownershipMismatch = state?.game === 'ersomha' && (!ownerRef.current || ownerRef.current !== account.user?.id);
  useLayoutEffect(() => {
    if (!ownershipMismatch || account.ready === false) return;
    clientRef.current?.stop(); clearSession(SERVER, code); setState(null); setExitGuard(null); onLeft(); navigate('/online/ersomha', { replace: true });
  }, [ownershipMismatch, account.ready, code, onLeft]);
  useEffect(() => { trialMarked.current = false; }, [code, session.id]);
  useEffect(() => {
    if (!state || trialMarked.current || !state.trialStarted || state.trialOwnerId !== session.id) return;
    trialMarked.current = true;
    account.markTrial(state.game || 'meenfina');
  }, [state, session.id, account]);
  useEffect(() => {
    const client = new RoomClient({ server: SERVER, code, session, getAccountAuthorization: () => accountRef.current.authHeaders()?.Authorization, onState: setState, onStatus: setStatus, onError: setError });
    clientRef.current = client; client.start();
    const wake = () => { if (!document.hidden) client.wake(); };
    document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake);
    setExitGuard((target) => { setExitTarget(target); return true; });
    return () => { client.stop(); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); setExitGuard(null); };
  }, [code, session]);
  useEffect(() => { if (status === 'connected') setError((old) => old === 'STORAGE' ? old : ''); }, [status]);
  const phase = state?.phase;
  useLayoutEffect(() => {
    if (ownershipMismatch || state?.game !== 'ersomha' || state.drawerId !== session.id || !['select', 'draw'].includes(phase)) return;
    return socialInterruption.private(`ersomha:${code}:${state.matchId}:${state.round}`);
  }, [code, state?.game, state?.drawerId, state?.matchId, state?.round, phase, session.id, ownershipMismatch]);
  useEffect(() => {
    socialInterruption.setContext({ local: false, online: true, turnDeadline: state?.deadlineAt ? state.deadlineAt - (clientRef.current?.clockOffset || 0) : null });
    return () => socialInterruption.setContext({ online: false, turnDeadline: null });
  }, [state?.deadlineAt]);
  useEffect(() => {
    if (phase === 'result') { sound.play('pop'); haptics.vibrate('success'); }
    else if (phase === 'over') { sound.play('fanfare'); haptics.vibrate('win'); confetti?.fire(); }   // احتفال النهاية (مرئي/صوتي فقط)
  }, [phase]);
  async function act(type, fields) {
    if (busyRef.current || ownershipMismatch) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await clientRef.current.command(type, { ...fields, matchId: state.matchId, round: state.round }); return true; }
    catch (e) { if (e.code === 'PLUS_REQUIRED') account.openPaywall({ reason: 'room', game: state.game || 'meenfina' }); else setError(e.code); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function leave() {
    const target = exitTarget || '/online';
    setBusy(true);
    try { await post(SERVER, `/api/rooms/${code}/leave`, session); clearSession(SERVER, code); }
    catch (e) {
      if (['AUTH', 'NOT_FOUND', 'EXPIRED', 'REMOVED'].includes(e.code)) clearSession(SERVER, code);
      else toast('خرجت من الشاشة. مقعدك محفوظ لتقدر ترجع عند الاتصال.');
    }
    clientRef.current.stop(); setExitGuard(null); onLeft(); navigate(target, { replace: true });
  }
  async function reportDrawing(reason) {
    if (!account.user?.id || !account.requestAuthenticated) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
    const key = `${account.user.id}:${code}:${state.matchId}:${state.round}`;
    if (reportRef.current?.key !== key) reportRef.current = { key, clientId: crypto.randomUUID() };
    return account.requestAuthenticated('/api/games/ersomha/reports', { method: 'POST', body: { roomCode: code, matchId: state.matchId, round: state.round, reason, clientId: reportRef.current.clientId } });
  }
  const me = state?.members.find((m) => m.id === session.id);
  const isHost = state?.hostId === session.id;
  // دخل بعد بداية المباراة: يتفرج من خارج participants ويلعب من المباراة التالية.
  const spectating = Boolean(state && me && state.phase !== 'lobby' && !state.participants.includes(me.id));
  const watchers = state && state.phase !== 'lobby' ? state.members.filter((m) => !m.left && !state.participants.includes(m.id)) : [];
  const disabled = busy || status !== 'connected';
  // تنبيه قبل انتهاء عمر الغرفة (يُمدَّد مع كل مباراة حتى ست ساعات) بدل قطع الجولة بلا سابق إنذار.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const msLeft = state ? state.expiresAt - (clock + (clientRef.current?.clockOffset || 0)) : Infinity;
  const expiring = Boolean(state) && msLeft < EXPIRY_WARNING && !['over', 'closed'].includes(state.phase);
  // مقاعد انقطعت أثناء المباراة: الجولة لا تنتظرها بعد مهلتها، ويستطيع المضيف إزالتها.
  const dropped = state && isHost && state.phase !== 'lobby' ? state.members.filter((m) => state.participants.includes(m.id) && !m.left && !m.connected) : [];
  if (ownershipMismatch) return <Card role="status">نحمي أفكار حسابك… سجّل الدخول إلى حساب اللاعب للعودة.</Card>;
  // نسخة الغرف على الخادم أحدث من هذه الصفحة: المقعد يبقى محفوظًا، والويب يحدّث ويعود إليه
  // تلقائيًا؛ تطبيق iPhone يحمل صفحته داخله فيحتاج تحديثًا من المتجر.
  const native = isNativeShell();
  const leaveKeepingSeat = () => { setExitGuard(null); onLeft(); navigate('/online', { replace: true }); };
  const outdated = status === 'outdated' ? <Card className="stack">
    {!native && <Button data-design-id="reconnect" data-design-required="true" variant="accent" full loading={updating} disabled={updating}
      onClick={() => { setUpdating(true); setExitGuard(null); reloadWithLatestVersion(); }}>حدّث وتابع في الغرفة</Button>}
    <Button full variant="ghost" disabled={updating} onClick={leaveKeepingSeat}>العودة إلى الغرف</Button>
  </Card> : null;
  return <RoomChrome state={state} code={code} status={status} error={error === 'ROOM_OUTDATED' && native ? 'ROOM_OUTDATED_APP' : error} expiring={expiring} msLeft={msLeft} dropped={dropped} disabled={disabled}
    onExit={() => setExitTarget(state?.game && state.game !== 'meenfina' ? `/online/${state.game}` : '/online')}
    onKick={targetId => act('kick', { targetId })}
    onReconnect={() => { clientRef.current.stop(); clientRef.current.start(); }}>
    {outdated || (status === 'ended' ? <Button full onClick={() => { clearSession(SERVER, code); setExitGuard(null); onLeft(); navigate('/online', { replace: true }); }}>العودة إلى الغرف</Button>
      : state && <>{spectating && <p className="online-notice" role="status">انضممت بعد بداية المباراة: تتفرج الآن، وتلعب معهم من المباراة القادمة.</p>}{state.phase === 'lobby' ? <Lobby state={state} me={me} isHost={isHost} disabled={disabled} act={act} /> : state.game === 'fabraka'
        ? <FabrakaMatch state={state} me={me} disabled={disabled} isHost={isHost} act={act} clockOffset={clientRef.current?.clockOffset || 0} spectating={spectating} />
        : state.game === 'ersomha' ? <ErsomhaMatch state={state} me={me} disabled={disabled} isHost={isHost} act={act} client={clientRef.current} status={status} clockOffset={clientRef.current?.clockOffset || 0} drawerReady={!lamma?.activeCall || (lamma.activeCall._ownerId === account.user?.id && lamma.media?.userId === account.user?.id && lamma.media?.muted === true)} onReport={['draw', 'result'].includes(state.phase) ? reportDrawing : undefined} />
        : <Match state={state} disabled={disabled} isHost={isHost} act={act} clockOffset={clientRef.current?.clockOffset || 0} spectating={spectating} />}</>)}
    {watchers.length > 0 && !outdated && status !== 'ended' && <Card className="stack online-watchers"><p className="online-footnote">يتفرجون الآن ويلعبون من المباراة القادمة: {watchers.map((m) => m.name).join('، ')}</p>
      {isHost && watchers.filter((m) => m.id !== me?.id).map((m) => <Button key={m.id} size="sm" variant="ghost" disabled={disabled} onClick={() => act('kick', { targetId: m.id })}>إزالة {m.name}</Button>)}</Card>}
    {!outdated && status !== 'ended' && <RoomReactions client={clientRef.current} state={state} me={me} status={status} />}
    {exitTarget && <ConfirmModal title="تطلع من الغرفة؟" message="مغادرتك تنهي مقعدك الحالي. إذا كنت المضيف تنتقل الإدارة للاعب متصل." confirmLabel="الخروج" cancelLabel="خلّيني ألعب" onConfirm={leave} onCancel={() => setExitTarget(null)} />}
  </RoomChrome>;
}
export function Online({ code = '', game = 'meenfina' }) {
  const [session, setSession] = useState(() => code ? readSaved(SERVER, code) : null);
  const [stored, setStored] = useState(() => readSaved(SERVER, 'persistence') !== false);
  function joined(nextCode, nextSession, isStored) {
    if (nextCode !== code) navigate(`/room/${nextCode}`);
    else { setStored(isStored); setSession(nextSession); }
  }
  return <Screen data-design-screen={session && code ? undefined : 'online.entry'} className="stack online-screen" aria-label="غرف ميدان">
    {session && code ? <ConnectedRoom code={code} session={session} stored={stored} onLeft={() => setSession(null)} /> : <><TopBar data-design-id="topbar" title="غرف ميدان" end={<Button data-design-id="home" size="sm" onClick={() => navigate('/')}>الرئيسية</Button>} /><Entry initialCode={code} initialGame={game} onJoined={joined} /></>}
  </Screen>;
}
