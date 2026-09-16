import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import config from '../../online.config.json';
import { Screen, TopBar, Button, Card, ConfirmModal, Podium, Scoreboard } from '../shared/ui/components.jsx';
import { Avatar, AvatarPicker, GameArtwork, ClayStage } from '../shared/brand/art.jsx';
import { burstConfetti, vignette } from '../shared/fx/index.js';
import { navigate, setExitGuard } from '../platform/router.js';
import { usePlatform } from '../platform/context.js';
import { useAccount } from '../shared/account/context.js';
import { AVATARS, ROUND_OPTIONS, MIN_PLAYERS, ONLINE_GAMES, normalizeCode, validCode, resolveServerUrl, errorText, arabicNumber } from './shared.js';
import { RoomClient, newCredentials, post, readSaved, save, clearSession } from './client.js';
import { normalizeOptions } from '../games/fabraka/logic.js';
import { FabrakaSettings, FabrakaRules, FabrakaMatch, FABRAKA_MODES, fabrakaTopics } from './Fabraka.jsx';

const SERVER = resolveServerUrl(typeof __MAYDAN_ROOMS_URL__ !== 'undefined' && __MAYDAN_ROOMS_URL__ || config.serverUrl, typeof location === 'undefined' ? '' : location.origin);
const arabic = arabicNumber;
const inviteUrl = (code) => { const url = new URL(location.href); url.search = ''; url.hash = `/room/${code}`; return url.toString(); };
function ErrorNotice({ code }) { return code ? <p className="online-notice error" role="alert">{errorText(code)}</p> : null; }

function Entry({ initialCode = '', initialGame = 'meenfina', onJoined }) {
  const account = useAccount();
  const [mode, setMode] = useState(initialCode ? 'join' : 'create');
  const [game, setGame] = useState(ONLINE_GAMES[initialGame] ? initialGame : 'meenfina');
  const [fabrakaSettings, setFabrakaSettings] = useState(() => normalizeOptions(readSaved(SERVER, 'fabrakaSettings')));
  const [name, setName] = useState(() => readSaved(SERVER, 'profile')?.name || '');
  const [avatar, setAvatar] = useState(() => readSaved(SERVER, 'profile')?.avatar ?? 0);
  const [code, setCode] = useState(initialCode);
  const [rounds, setRounds] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const credentialsRef = useRef(null);
  const lastRoom = readSaved(SERVER, 'lastRoom');
  // The server rejects these settings with QUESTIONS; keep the button honest instead.
  const topicsReady = !(mode === 'create' && game === 'fabraka') || fabrakaTopics(fabrakaSettings).enough;
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    setError('');
    if (!name.trim()) { setError('NAME'); return; }
    const normalized = normalizeCode(code);
    if (mode === 'join' && !validCode(normalized)) { setError('INVALID'); return; }
    // إنشاء غرفة = مباراة لهذه اللعبة؛ الدخول برمز يبقى مجانيًا دائمًا.
    if (mode === 'create' && account.gameAccess(game) === 'locked') { account.openPaywall({ reason: 'room', game }); return; }
    setBusy(true);
    try {
      const pendingKey = mode === 'create' ? (game === 'meenfina' ? 'pendingCreate' : `pendingCreate:${game}`) : `pendingJoin:${normalized}`;
      let session = mode === 'join' ? readSaved(SERVER, normalized) : null;
      session ||= credentialsRef.current || readSaved(SERVER, pendingKey) || newCredentials();
      credentialsRef.current = session;
      save(SERVER, pendingKey, session); // Persist before HTTP so a retry can reclaim the same seat.
      const result = await post(SERVER, mode === 'create' ? '/api/rooms' : `/api/rooms/${normalized}/join`, { ...session, name: name.trim(), avatar, rounds,
        ...(mode === 'create' ? { game, ...(game === 'fabraka' ? { settings: fabrakaSettings } : {}) } : {}) }, { headers: account.authHeaders() });
      if (mode === 'create') account.markTrial(game);
      const stored = save(SERVER, result.code, session);
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
    <Card className="online-intro">
      {/* الحامل مفتاحه اللعبة: يعيد الهبوط عند التبديل ثم يطفو؛ النص مفتاحه الوضع فيدخل كصف */}
      <ClayStage key={game} className="clay-idle" aria-hidden="true"><GameArtwork game={game} /></ClayStage>
      <div key={mode} className="online-intro-copy">
        <span className="online-label">{mode === 'create' ? ONLINE_GAMES[game].name : 'غرف ميدان'} · تجربة جماعية</span>
        <h1>اللّمّة وحدة، وكل واحد بجواله</h1>
        <p>{mode === 'join' ? 'رمز واحد يجمعكم في نفس اللعبة' : game === 'fabraka' ? '٣–٨ لاعبين · كتابة متزامنة · تصويت سري' : '٣–١٢ لاعبًا · تصويت سري · نفس السؤال للجميع'}</p>
      </div>
    </Card>
    {!SERVER && <p className="online-notice" role="status">الغرف غير متاحة بعد. تقدر تلعب ألعاب ميدان على جهاز واحد من الرئيسية.</p>}
    {lastRoom && !initialCode && readSaved(SERVER, lastRoom) && <Button full onClick={() => onJoined(lastRoom, readSaved(SERVER, lastRoom), readSaved(SERVER, 'persistence') !== false)}>العودة إلى غرفتي <bdi>{lastRoom}</bdi></Button>}
    <Card>
      <div className="online-tabs" role="group" aria-label="طريقة الدخول">
        <Button variant={mode === 'create' ? 'primary' : 'ghost'} aria-pressed={mode === 'create'} onClick={() => { setMode('create'); setError(''); credentialsRef.current = null; }}>إنشاء غرفة</Button>
        <Button variant={mode === 'join' ? 'primary' : 'ghost'} aria-pressed={mode === 'join'} onClick={() => { setMode('join'); setError(''); credentialsRef.current = null; }}>دخول برمز</Button>
      </div>
      <form className="stack" onSubmit={submit}>
        {mode === 'create' && <div className="online-game-picker" role="group" aria-label="لعبة الغرفة">{Object.entries(ONLINE_GAMES).map(([id, info]) => <button key={id} type="button" disabled={busy} aria-pressed={game === id} className={game === id ? 'selected' : ''} onClick={() => { setGame(id); setError(''); credentialsRef.current = null; }}><ClayStage className="clay-static" aria-hidden="true"><GameArtwork game={id} /></ClayStage><b>{info.name}</b><small>{arabic(info.min)}–{arabic(info.max)} لاعبين</small></button>)}</div>}
        <label className="online-field">اسمك في الغرفة<input autoComplete="nickname" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="اكتب اسمك" required /></label>
        <div><span className="online-field-label">اختر شخصيتك</span><AvatarPicker value={AVATARS[avatar]} onChange={(emoji) => setAvatar(AVATARS.indexOf(emoji))} /></div>
        {mode === 'join' ? <label className="online-field">رمز الغرفة<input className="online-code-input" dir="ltr" inputMode="numeric" autoComplete="off" maxLength={8} value={code} onChange={(e) => { setCode(normalizeCode(e.target.value)); credentialsRef.current = null; }} placeholder="123456" required /></label>
          : game === 'fabraka' ? <FabrakaSettings value={fabrakaSettings} disabled={busy} onChange={(next) => { setFabrakaSettings(next); save(SERVER, 'fabrakaSettings', next); }} />
          : <label className="online-field">عدد الجولات<select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>{ROUND_OPTIONS.map((n) => <option key={n} value={n}>{arabic(n)} جولات</option>)}</select></label>}
        {mode === 'create' && game === 'fabraka' && <FabrakaRules />}
        <ErrorNotice code={error} />
        <Button type="submit" variant="primary" size="lg" full disabled={!SERVER || busy || !topicsReady} loading={busy}>{mode === 'create' ? 'أنشئ الغرفة' : 'ادخل الغرفة'}</Button>
      </form>
    </Card>
    <p className="online-footnote">تحتاج الغرف اتصالًا بالإنترنت على كل هاتف. تنتهي الغرفة بعد ساعتين.</p>
  </>;
}
function Invite({ code }) {
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
  return <Card className="online-invite">
    <div><span className="online-label">رمز الغرفة</span><strong className="online-room-code" dir="ltr">{code}</strong><p>أرسل الرابط أو خلي أصحابك يمسحوا الرمز.</p><Button onClick={copy}>نسخ رابط الدعوة</Button></div>
    {qr && <img width="136" height="136" src={qr} className={qrReady ? 'is-ready' : ''} onLoad={() => setQrReady(true)} alt={`رمز QR للدخول إلى الغرفة ${code}`} />}
    {showLink && <label className="online-field online-invite-link">رابط الدعوة<input readOnly value={url} dir="ltr" onFocus={(e) => e.target.select()} /></label>}
  </Card>;
}
// Exported for the rooms regression tests, which render the waiting room from a snapshot.
export function Lobby({ state, me, isHost, disabled, act }) {
  const players = state.members.filter((m) => !m.left);
  const canStart = players.length >= MIN_PLAYERS && players.every((m) => m.connected && m.ready);
  return <>
    <Invite code={state.code} />
    <Card className="stack">
      <div className="row-between"><h2>غرفة الانتظار</h2><span>{arabic(players.length)} / {arabic(ONLINE_GAMES[state.game || 'meenfina'].max)}</span></div>
      <ul className="online-players">{players.map((p, i) => <li key={p.id} style={{ '--i': i }}>
        <Avatar index={p.avatar} /><div className="grow"><b>{p.name}{p.id === me?.id ? ' (أنت)' : ''}</b><small>{p.id === state.hostId ? 'المضيف · ' : ''}{!p.connected ? 'انقطع الاتصال' : p.ready ? 'جاهز' : 'يستعد'}</small></div>
        <span className={`online-presence ${p.connected && p.ready ? 'ready' : ''}`} aria-hidden="true" />
        {isHost && !p.connected && p.id !== me.id && <Button size="sm" disabled={disabled} onClick={() => act('kick', { targetId: p.id })}>إزالة</Button>}
      </li>)}</ul>
      <Button full disabled={disabled} variant={me?.ready ? 'secondary' : 'primary'} onClick={() => act('ready', { ready: !me?.ready })}>{me?.ready ? 'أنا جاهز ✓ — إلغاء الجاهزية' : 'أنا جاهز'}</Button>
      {isHost ? <Button full variant="primary" size="lg" className={canStart ? 'is-armed' : ''} disabled={disabled || !canStart} onClick={() => act('start')}>ابدأ اللعب</Button> : <p className="online-footnote">المضيف يبدأ الجولة عندما يجهز الجميع.</p>}
      {!canStart && isHost && <p className="online-footnote">نحتاج ٣ لاعبين على الأقل، متصلين وجاهزين جميعًا. تقدر تزيل مقعدًا منقطعًا من الانتظار.</p>}
    </Card>
    {state.game === 'fabraka' ? <Card className="stack"><h2>فبركة · {FABRAKA_MODES[state.settings.mode]}</h2><p>{arabic(state.rounds)} جولات · {state.settings.writeSeconds ? `${arabic(state.settings.writeSeconds)} ثانية للكتابة` : 'كتابة براحتنا'} · {state.settings.discussionSeconds ? `${arabic(state.settings.discussionSeconds)} ثانية للنقاش` : 'بدون نقاش'} · ٣٠ ثانية للتصويت.</p><FabrakaRules /></Card>
      : <p className="online-footnote">{arabic(state.rounds)} جولات · ٣٠ ثانية لكل تصويت · الأعلى أصواتًا يكسب نقطة، والتعادل يحتسب للجميع.</p>}
  </>;
}
function Match({ state, disabled, isHost, act, clockOffset }) {
  const platform = usePlatform();
  const [now, setNow] = useState(Date.now());
  const [choice, setChoice] = useState(undefined);
  const winnerRef = useRef(null);
  useEffect(() => { setChoice(undefined); }, [state.matchId, state.round]);
  useEffect(() => {
    if (state.phase !== 'vote') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.phase, state.round]);
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
  }, [state.phase, state.round]);
  if (state.phase === 'over') return <>
    {state.reason === 'players_left' && <p className="online-notice">انتهت اللعبة لأن عدد اللاعبين أصبح أقل من ٣. هذه نقاط الجولات المكتملة.</p>}
    <Podium entries={sorted} />
    <Card className="stack">{sorted.map((p) => <div className="row-between" key={p.id}><b>{p.name}</b><span>{p.title}</span></div>)}</Card>
    {isHost ? <Button full size="lg" variant="primary" disabled={disabled} onClick={() => act('restart')}>العودة للانتظار ولعب مرة ثانية</Button> : <p className="online-footnote">بانتظار المضيف لبدء لعبة جديدة.</p>}
  </>;
  return <>
    <div className="row-between"><b>الجولة {arabic(state.round)} من {arabic(state.rounds)}</b>{state.phase === 'vote' && <span className={`online-timer ${seconds <= 5 ? 'urgent' : ''}`} aria-label={`متبقي ${seconds} ثانية`}><b key={seconds <= 5 ? seconds : 'n'}><bdi>{arabic(seconds)}</bdi></b> ث</span>}</div>
    <Card className="online-question" key={state.round}><ClayStage aria-hidden="true"><GameArtwork game="meenfina" /></ClayStage><h1>{state.question?.text}</h1></Card>
    {state.phase === 'vote' ? <Card className="stack">
      {state.myVote.submitted ? <div className="online-voted" role="status"><strong>وصل تصويتك ✓</strong><p>اختيارك: {state.myVote.targetId === null ? 'لا أحد' : players.find((p) => p.id === state.myVote.targetId)?.name}. بانتظار الباقي…</p></div> : <>
        <p className="online-footnote">اختَر الشخص الأقرب للعبارة. تقدر تختار نفسك. بعد التأكيد لا يمكن تغيير التصويت.</p>
        <div className="online-vote-grid" role="group" aria-label="اختر لاعبًا">{players.map((p, i) => <button className={`online-vote-choice ${choice === p.id ? 'selected' : ''}`} type="button" key={p.id} style={{ '--i': i }} disabled={disabled || seconds === 0} aria-pressed={choice === p.id} onClick={() => setChoice(p.id)}><ClayStage className="clay-static" aria-hidden="true"><Avatar index={p.avatar} /></ClayStage><b>{p.name}</b>{p.left && <small>غادر الجولة</small>}</button>)}</div>
        <Button aria-pressed={choice === null} variant={choice === null ? 'secondary' : 'ghost'} disabled={disabled || seconds === 0} onClick={() => setChoice(null)}>لا أحد</Button>
        <Button full variant="primary" size="lg" disabled={disabled || choice === undefined || seconds === 0} onClick={() => act('vote', { targetId: choice })}>تأكيد التصويت</Button>
      </>}
      <p className="online-footnote" role="status">وصل {arabic(state.submittedCount)} تصويت · {seconds === 0 ? 'بانتظار نتيجة الخادم…' : 'اختيارات اللاعبين تبقى سرّية'}</p>
    </Card> : <Card className="stack">
      <h2>{state.winners.length ? state.winners.map((id) => players.find((p) => p.id === id)?.name).join(' و') : 'ولا أحد هالمرة!'}</h2>
      <p>{state.winners.length > 1 ? 'تعادل! نقطة لكل واحد منهم.' : state.winners.length ? 'أكثر واحد أخذ أصوات… ونقطة جديدة!' : 'لم يحصل أحد على أصوات.'}</p>
      <ul className="online-players">{players.map((p, i) => <li key={p.id} ref={state.winners[0] === p.id ? winnerRef : null} className={state.winners.includes(p.id) ? 'is-winner' : ''} style={{ '--i': i }}><Avatar index={p.avatar} /><b className="grow">{p.name}</b><span>{arabic(state.counts[p.id] || 0)} أصوات</span>{state.winners.includes(p.id) && <b className="online-point">+١</b>}</li>)}</ul>
      {isHost ? <Button full variant="primary" size="lg" disabled={disabled} onClick={() => act('next')}>{state.round === state.rounds ? 'عرض النتيجة النهائية' : 'الجولة التالية'}</Button> : <p className="online-footnote">بانتظار المضيف للمتابعة.</p>}
    </Card>}
    <Card className="stack"><h2>النقاط</h2><Scoreboard entries={sorted} /></Card>
  </>;
}
function ConnectedRoom({ code, session, stored, onLeft }) {
  const { toast, sound, haptics, confetti } = usePlatform();
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(stored ? '' : 'STORAGE');
  const [busy, setBusy] = useState(false);
  const [exitTarget, setExitTarget] = useState(null);
  const clientRef = useRef(null);
  const busyRef = useRef(false);
  useEffect(() => {
    const client = new RoomClient({ server: SERVER, code, session, onState: setState, onStatus: setStatus, onError: setError });
    clientRef.current = client; client.start();
    const wake = () => { if (!document.hidden) client.wake(); };
    document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake);
    setExitGuard((target) => { setExitTarget(target); return true; });
    return () => { client.stop(); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); setExitGuard(null); };
  }, [code, session]);
  useEffect(() => { if (status === 'connected') setError((old) => old === 'STORAGE' ? old : ''); }, [status]);
  const phase = state?.phase;
  useEffect(() => {
    if (phase === 'result') { sound.play('pop'); haptics.vibrate('success'); }
    else if (phase === 'over') { sound.play('fanfare'); haptics.vibrate('win'); confetti?.fire(); }   // احتفال النهاية (مرئي/صوتي فقط)
  }, [phase]);
  async function act(type, fields) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await clientRef.current.command(type, { ...fields, matchId: state.matchId, round: state.round }); return true; }
    catch (e) { setError(e.code); return false; }
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
  const me = state?.members.find((m) => m.id === session.id);
  const isHost = state?.hostId === session.id;
  const disabled = busy || status !== 'connected';
  return <>
    <TopBar title={state ? ONLINE_GAMES[state.game || 'meenfina'].name : 'غرف ميدان'} eyebrow={`غرفة ${code}`} end={<Button size="sm" onClick={() => setExitTarget(state?.game === 'fabraka' ? '/online/fabraka' : '/online')}>خروج</Button>} />
    <p className={`online-connection ${status === 'connected' ? 'connected' : ''}`} role="status">{status === 'connected' ? 'متصل · كل واحد بجواله' : status === 'ended' ? 'انتهى الاتصال بالغرفة' : status === 'replaced' ? 'الجلسة مفتوحة في تبويب آخر' : 'جاري الاتصال بالغرفة…'}</p>
    <ErrorNotice code={error} />
    {state?.hostMissingSince && <p className="online-notice is-host-missing">انقطع اتصال المضيف. تنتقل الإدارة للاعب متصل بعد ٢٠ ثانية إذا لم يعد.</p>}
    {['replaced', 'reconnecting', 'disconnected'].includes(status) && <Button onClick={() => { clientRef.current.stop(); clientRef.current.start(); }}>إعادة الاتصال</Button>}
    {status === 'ended' ? <Button full onClick={() => { clearSession(SERVER, code); setExitGuard(null); onLeft(); navigate('/online', { replace: true }); }}>العودة إلى الغرف</Button>
      : state && (state.phase === 'lobby' ? <Lobby state={state} me={me} isHost={isHost} disabled={disabled} act={act} /> : state.game === 'fabraka'
        ? <FabrakaMatch state={state} me={me} disabled={disabled} isHost={isHost} act={act} clockOffset={clientRef.current?.clockOffset || 0} />
        : <Match state={state} disabled={disabled} isHost={isHost} act={act} clockOffset={clientRef.current?.clockOffset || 0} />)}
    {exitTarget && <ConfirmModal title="تطلع من الغرفة؟" message="مغادرتك تنهي مقعدك الحالي. إذا كنت المضيف تنتقل الإدارة للاعب متصل." confirmLabel="الخروج" cancelLabel="خلّيني ألعب" onConfirm={leave} onCancel={() => setExitTarget(null)} />}
  </>;
}
export function Online({ code = '', game = 'meenfina' }) {
  const [session, setSession] = useState(() => code ? readSaved(SERVER, code) : null);
  const [stored, setStored] = useState(() => readSaved(SERVER, 'persistence') !== false);
  function joined(nextCode, nextSession, isStored) {
    if (nextCode !== code) navigate(`/room/${nextCode}`);
    else { setStored(isStored); setSession(nextSession); }
  }
  return <Screen className="stack online-screen" aria-label="غرف ميدان">
    {session && code ? <ConnectedRoom code={code} session={session} stored={stored} onLeft={() => setSession(null)} /> : <><TopBar title="غرف ميدان" end={<Button size="sm" onClick={() => navigate('/')}>الرئيسية</Button>} /><Entry initialCode={code} initialGame={game} onJoined={joined} /></>}
  </Screen>;
}
