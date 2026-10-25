import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createVoiceRecorder, audioActivity } from './media.js';
import { validCode } from '../online/shared.js';
import { useAccount } from '../shared/account/context.js';
import { useLamma } from './LammaProvider.jsx';

const PATHS = {
  mic: 'M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  muted: 'M3 3l18 18M9 9v3a3 3 0 0 0 5 2M15 9V5a3 3 0 0 0-5-2M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8',
  phone: 'M8 3H4a1 1 0 0 0-1 1c0 10 7 17 17 17a1 1 0 0 0 1-1v-4l-5-2-2 3a12 12 0 0 1-7-7l3-2-2-5Z',
  end: 'M3 16v-5c5-5 13-5 18 0v5h-5l-1-4H9l-1 4H3Z',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17 3a4 4 0 0 1 0 8M18 15a4 4 0 0 1 4 4v2',
  chat: 'M21 11a9 9 0 0 1-9 9H4l-3 3V11a10 10 0 0 1 20 0ZM7 9h8M7 13h5',
  game: 'M7 8h10a4 4 0 0 1 4 3l1 6c0 3-3 4-5 1l-1-1H8l-1 1c-2 3-5 2-5-1l1-6a4 4 0 0 1 4-3ZM7 11v5M4.5 13.5h5M16 12h.01M19 15h.01',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M6 18L18 6', back: 'M9 5l7 7-7 7M16 12H4',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01', send: 'M21 3L3 10l7 4 4 7 7-18ZM10 14l11-11',
  stop: 'M6 6h12v12H6Z', play: 'm8 4 12 8-12 8V4Z', settings: 'M4 7h16M4 17h16M9 3v8M16 13v8',
  pause: 'M8 4v16M16 4v16',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
  shield: 'M12 2l8 3v7c0 5-8 10-8 10S4 17 4 12V5l8-3ZM8 12l3 3 5-6',
};
export function LammaIcon({ name, size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name] || PATHS.chat} /></svg>;
}
export function LammaButton({ label, icon, children, className = '', ...props }) {
  return <button type="button" data-design-id={props['data-design-id'] || ({ mic:'record', muted:'mute', phone:'call', end:'end-call', people:'members', chat:'friend-chat', game:'game-invite', bell:'preferences', plus:'add-friend', close:'close', back:'back', search:'search', more:'menu', send:'send', stop:'record-stop', play:'voice-play', pause:'voice-play', settings:'preferences', star:'favorite', shield:'report' })[icon]} className={'lamma-icon-button ' + className} aria-label={label} title={label} {...props}><LammaIcon name={icon} />{children}</button>;
}
export const mediaError = error => error?.message && /[\u0600-\u06ff]/.test(error.message) ? error.message : 'تعذّر تشغيل الصوت. تحقق من إذن الميكروفون وحاول مجددًا.';
export const durationLabel = value => `${Math.floor(Math.max(0, value || 0) / 60000)}:${String(Math.floor(Math.max(0, value || 0) / 1000) % 60).padStart(2, '0')}`;
export const invalidatesVoice = event => (event?.type === 'refresh' && !['read', 'presence'].includes(event.reason)) || (event?.type === 'group' && ['membership', 'removed', 'closed', 'deleted'].includes(event.reason)) || (event?.type === 'message' && event.reason === 'deleted');
const liveCallOwner = value => value === 'live-call' || String(value || '').startsWith('live-call-');

export function VoiceRecorder({ onSend, disabled, unavailableReason, onError }) {
  const lamma = useLamma();
  const callActive = !!(lamma?.activeCall || lamma?.media?.connected || lamma?.media?.connecting || lamma?.media?.ending);
  const callActiveRef = useRef(callActive); callActiveRef.current = callActive;
  const recorder = useRef(null);
  const alive = useRef(true);
  const stopping = useRef(false);
  const session = useRef(0);
  const previewPlayer = useRef(null);
  const previewOwner = useRef(`voice-preview-${globalThis.crypto.randomUUID()}`);
  const attachPreview = useCallback(element => { if (previewPlayer.current && previewPlayer.current !== element) { previewPlayer.current.pause(); audioActivity(previewOwner.current, false); } previewPlayer.current = element; }, []);
  const liveCalls = useRef(new Set());
  const [phase, setPhase] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState(null);
  const [preview, setPreview] = useState('');
  const pauseForCall = useCallback(() => {
    previewPlayer.current?.pause(); audioActivity(previewOwner.current, false); ++session.current; recorder.current?.cancel(); recorder.current = null;
    setPhase(value => ['recording', 'starting'].includes(value) ? 'idle' : value);
  }, []);
  useLayoutEffect(() => { if (callActive) pauseForCall(); }, [callActive, pauseForCall]);
  useEffect(() => {
    alive.current = true;
    const interrupt = event => {
      const detail = event.detail;
      if (!liveCallOwner(detail?.owner)) return;
      if (!detail.active) { liveCalls.current.delete(detail.owner); return; }
      liveCalls.current.add(detail.owner); pauseForCall();
    };
    const hidden = () => { if (document.hidden) pauseForCall(); };
    window.addEventListener('maydan-social-audio', interrupt); document.addEventListener('visibilitychange', hidden);
    const teardown = () => { alive.current = false; ++session.current; recorder.current?.cancel(); previewPlayer.current?.pause(); audioActivity(previewOwner.current, false); };
    return () => { teardown(); window.removeEventListener('maydan-social-audio', interrupt); document.removeEventListener('visibilitychange', hidden); };
  }, [pauseForCall]);
  useEffect(() => {
    if (!clip?.blob) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(clip.blob); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);
  const finish = async () => {
    if (!recorder.current || stopping.current) return;
    const ticket = session.current;
    stopping.current = true;
    try { const value = await recorder.current.stop(); if (alive.current && ticket === session.current) { setClip(value); setPhase('preview'); } }
    catch (error) { if (alive.current && ticket === session.current) { setPhase('idle'); onError(mediaError(error)); } }
    finally { stopping.current = false; }
  };
  const finishRef = useRef(finish); finishRef.current = finish;
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const start = Date.now();
    const timer = setInterval(() => {
      const value = Date.now() - start; setElapsed(value);
      if (value >= 120000) finishRef.current();
    }, 150);
    return () => clearInterval(timer);
  }, [phase]);
  const start = async () => {
    if (disabled || unavailableReason || callActiveRef.current || liveCalls.current.size || phase !== 'idle') return;
    const ticket = ++session.current;
    setPhase('starting');
    try {
      const next = createVoiceRecorder({ onInterrupted(error) {
        if (alive.current && ticket === session.current) { ++session.current; setPhase('idle'); setClip(null); setElapsed(0); onError(mediaError(error)); }
      } }); recorder.current = next; await next.start();
      if (!alive.current || ticket !== session.current || callActiveRef.current || liveCalls.current.size) { next.cancel(); return; }
      setElapsed(0); setPhase('recording');
    } catch (error) { if (alive.current && ticket === session.current) { setPhase('idle'); onError(mediaError(error)); } }
  };
  const discard = () => { ++session.current; previewPlayer.current?.pause(); audioActivity(previewOwner.current, false); recorder.current?.cancel(); recorder.current = null; setClip(null); setPhase('idle'); };
  const send = async () => {
    if (!clip || phase === 'sending') return;
    setPhase('sending');
    try { await onSend(clip); if (alive.current) discard(); }
    catch (error) { if (alive.current) { setPhase('preview'); onError(mediaError(error)); } }
  };
  const previewStopped = () => audioActivity(previewOwner.current, false);
  return <div data-design-screen="social.voice" className={'lamma-recorder is-' + phase}>
    {phase === 'idle' || phase === 'starting' ? <><button type="button" data-design-id="record" className="lamma-voice-start" disabled={disabled || callActive || !!unavailableReason || phase === 'starting'} onClick={start}><LammaIcon name="mic" size={18} />{phase === 'starting' ? 'فتح الميكروفون…' : 'رسالة صوتية'}<small>حتى دقيقتين</small></button>{unavailableReason && <small className="lamma-unavailable">{unavailableReason}</small>}</> : phase === 'recording' ? <><span className="lamma-recording-dot" /><span role="status">جارٍ التسجيل <bdi>{durationLabel(elapsed)}</bdi></span><LammaButton label="إنهاء التسجيل ومراجعته" icon="stop" onClick={finish} /><LammaButton data-design-id="record-cancel" label="إلغاء التسجيل" icon="close" onClick={discard} /></> : <><div data-design-id="record-preview" className="lamma-recorded-preview"><span>اسمعها قبل الإرسال · <bdi>{durationLabel(clip?.durationMs)}</bdi></span>{preview && <audio ref={attachPreview} onPlay={() => { if (callActiveRef.current || liveCalls.current.size || document.hidden) { previewPlayer.current?.pause(); previewStopped(); } else audioActivity(previewOwner.current, true); }} onPause={previewStopped} onEnded={previewStopped} onError={previewStopped} onEmptied={previewStopped} controls={!callActive} preload="metadata" src={preview} aria-label="معاينة الرسالة الصوتية" />}</div><LammaButton label={phase === 'sending' ? 'جارٍ إرسال الصوت' : 'إرسال الرسالة الصوتية'} icon="send" disabled={disabled || callActive || phase === 'sending'} onClick={send} /><LammaButton data-design-id="record-cancel" label="حذف التسجيل" icon="close" disabled={phase === 'sending'} onClick={discard} /></>}
  </div>;
}

export function VoiceMessage({ attachment, getVoiceUrl }) {
  const account = useAccount();
  const lamma = useLamma();
  const callActive = !!(lamma?.activeCall || lamma?.media?.connected || lamma?.media?.connecting || lamma?.media?.ending);
  const callActiveRef = useRef(callActive); callActiveRef.current = callActive;
  const userId = account.ready && account.signedIn ? account.user?.id : null;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const player = useRef(null);
  const alive = useRef(true);
  const epoch = useRef(0);
  const liveCalls = useRef(new Set());
  const identity = useRef(null); identity.current = { userId, attachmentId: attachment?.id };
  const owner = useRef(`voice-${globalThis.crypto.randomUUID()}`);
  const activity = active => audioActivity(owner.current, active);
  useLayoutEffect(() => {
    if (!callActive) return;
    ++epoch.current; player.current?.pause(); player.current?.removeAttribute('src'); player.current?.load(); activity(false); setLoading(false); setPlaying(false);
  }, [callActive]);
  useEffect(() => {
    alive.current = true;
    const element = player.current;
    const stop = (update = true) => { ++epoch.current; element?.pause(); element?.removeAttribute('src'); element?.load(); activity(false); if (update) { setLoading(false); setPlaying(false); } };
    stop(); setPosition(0); setError('');
    const hidden = () => { if (document.hidden) stop(); };
    const update = event => { if (invalidatesVoice(event.detail)) stop(); };
    const interrupt = event => { const detail = event.detail; if (!liveCallOwner(detail?.owner)) return; if (detail.active) { liveCalls.current.add(detail.owner); stop(); } else liveCalls.current.delete(detail.owner); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('maydan-social-event', update); window.addEventListener('maydan-social-audio', interrupt);
    return () => { alive.current = false; stop(false); activity(false); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('maydan-social-event', update); window.removeEventListener('maydan-social-audio', interrupt); };
  }, [userId, attachment?.id]);
  const toggle = async () => {
    if (!attachment?.id || loading) return;
    if (callActiveRef.current || liveCalls.current.size) { setError('أنهِ المكالمة قبل تشغيل الرسالة الصوتية.'); return; }
    if (playing) { player.current?.pause(); activity(false); setPlaying(false); return; }
    setLoading(true); setError('');
    const ticket = ++epoch.current;
    const current = () => alive.current && ticket === epoch.current && identity.current.userId === userId && identity.current.attachmentId === attachment.id && !document.hidden && !callActiveRef.current && !liveCalls.current.size;
    try {
      const next = await getVoiceUrl(attachment.id);
      if (current() && player.current) { player.current.src = next; player.current.currentTime = position; await player.current.play(); }
    }
    catch { if (current()) { activity(false); setPlaying(false); setError('تعذّر تحميل الصوت. حاول مجددًا.'); } }
    finally { if (current()) setLoading(false); }
  };
  return <div data-design-id="voice-message" className="lamma-voice-message"><div><LammaIcon name="mic" size={17} /><span>رسالة صوتية</span><bdi>{durationLabel(attachment?.durationMs)}</bdi></div><div className="lamma-voice-player"><button data-design-id="voice-play" type="button" onClick={toggle} disabled={loading || callActive || !attachment?.id} title={callActive ? 'أنهِ المكالمة قبل تشغيل الرسالة الصوتية' : undefined} aria-label={playing ? 'إيقاف الرسالة الصوتية مؤقتًا' : 'تشغيل الرسالة الصوتية'}><LammaIcon name={playing ? 'pause' : 'play'} size={17} /></button><progress max={attachment?.durationMs || 1} value={position * 1000} aria-label="تقدم الرسالة الصوتية" /><bdi>{loading ? '…' : durationLabel(position * 1000)}</bdi></div><audio ref={player} preload="none" onPlay={() => { if (callActiveRef.current || liveCalls.current.size || document.hidden) { player.current?.pause(); activity(false); return; } setPlaying(true); activity(true); }} onPause={() => { setPlaying(false); activity(false); }} onError={() => { setPlaying(false); activity(false); setError('تعذّر تشغيل الصوت. حاول مجددًا.'); }} onAbort={() => { if (player.current?.paused) { setPlaying(false); activity(false); } }} onEmptied={() => { if (player.current?.paused) { setPlaying(false); activity(false); } }} onEnded={() => { setPlaying(false); setPosition(0); activity(false); }} onTimeUpdate={() => setPosition(player.current?.currentTime || 0)} />{error && <small role="alert">{error}</small>}</div>;
}

export function GameInviteCard({ invite, onJoin }) {
  const [joining, setJoining] = useState(false);
  const code = String(invite?.roomCode || invite?.code || '');
  const expired = invite?.status === 'expired' || (invite?.expiresAt && invite.expiresAt < Date.now());
  const valid = validCode(code) && !!invite?.id && !expired;
  return <div data-design-id="game-invite-card" className="lamma-game-invite"><span className="lamma-game-icon"><LammaIcon name="game" size={27} /></span><strong>مكانك معنا في الميدان</strong><p>{invite?.game === 'ersomha' ? 'ارسمها' : invite?.game === 'fabraka' ? 'فبركة' : invite?.game === 'meenfina' ? 'مين فينا؟' : 'غرفة ميدان'} · <bdi>{code}</bdi></p><button data-design-id="game-invite-join" type="button" onClick={async () => { if (joining) return; setJoining(true); try { await onJoin(invite.id); } finally { setJoining(false); } }} disabled={!valid || joining}>{expired ? 'انتهت هذه الدعوة' : joining ? 'نفتح الغرفة…' : 'انضم للّمة'} <LammaIcon name="back" size={17} /></button></div>;
}
