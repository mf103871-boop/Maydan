import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { moderationError, reviewAudioPath } from './client.js';

// A report attachment is never a public media URL. Every play rechecks moderator access.
export function ReviewAudio({ path }) {
  const account = useAccount();
  const owner = account.ready && account.signedIn ? account.user?.id : null;
  const validPath = reviewAudioPath(path);
  const audio = useRef(null); const resource = useRef(null); const epoch = useRef(0);
  const identity = useRef(null); identity.current = { owner, path: validPath };
  const [phase, setPhase] = useState('idle'); const [error, setError] = useState('');
  const release = useCallback(() => {
    ++epoch.current;
    const element = resource.current?.element || audio.current;
    if (element) { element.pause(); element.removeAttribute('src'); element.load(); }
    if (resource.current) { URL.revokeObjectURL(resource.current.url); resource.current = null; }
  }, []);
  const stop = useCallback(() => { release(); setPhase('idle'); }, [release]);
  useLayoutEffect(() => {
    release(); setPhase('idle'); setError('');
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); release(); };
  }, [owner, validPath, account.requestAuthenticated, release, stop]);
  const play = async () => {
    if (!owner || !validPath || document.hidden) return;
    release(); const ticket = epoch.current; setPhase('loading'); setError('');
    const current = () => ticket === epoch.current && identity.current.owner === owner && identity.current.path === validPath && !document.hidden;
    try {
      const response = await account.requestAuthenticated(validPath, { raw: true });
      const blob = await response.blob();
      if (!current()) return;
      if (!/^audio\/(?:webm|ogg|mp4|mpeg|wav|x-wav)(?:;|$)/i.test(blob.type) || !blob.size || blob.size > 3 * 1024 * 1024) throw new Error('Invalid audio evidence');
      resource.current = { url: URL.createObjectURL(blob), element: audio.current }; audio.current.src = resource.current.url;
      await audio.current.play();
      if (current()) setPhase('playing');
    } catch (failure) {
      if (!current()) return;
      release(); setPhase('idle'); setError(failure?.code ? moderationError(failure) : 'تعذّر تشغيل الدليل الصوتي. أعد المحاولة.');
    }
  };
  if (!owner || !validPath) return null;
  return <div className="review-audio"><audio ref={audio} preload="none" onEnded={stop} />
    <button type="button" className="btn btn-secondary" onClick={phase === 'idle' ? play : stop}>{phase === 'playing' ? 'إيقاف الدليل الصوتي' : phase === 'loading' ? 'إلغاء تحميل الدليل الصوتي' : 'تشغيل الدليل الصوتي'}</button>
    <p className="moderation-note">تسجيل خاص بالمراجعة. يتوقف عند مغادرة الصفحة أو تبديل الحساب.</p>
    {phase === 'loading' && <p role="status">جارٍ التحقق من الصلاحية وتحميل التسجيل…</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
