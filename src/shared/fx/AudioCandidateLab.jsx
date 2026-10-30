import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/components.jsx';
import { usePlatform } from '../../platform/context.js';
import { registerBackLayer } from '../../platform/router.js';
import { useAccount } from '../account/context.js';
import { useLamma } from '../../social/LammaProvider.jsx';
import { activeAudioOwners, audioActivity } from '../../social/media.js';
import { socialInterruption } from '../../social/interruption.js';
import { CANDIDATE_AUDITIONS } from './audio-candidate-catalog.js';
import { createCandidatePlaybackSession, isPrivateAudioCandidateBuild, validPrivateAudioCandidate } from './audio-candidate-policy.js';

const LABELS = {
  menus:'القوائم', badeeha:'بديهة', ersomha:'ارسمها', fabraka:'فبركة', meenfina:'مين فينا', jabeen:'على جبينك',
  mamnoo:'ممنوع', beep:'قبل ما يطق', mafia:'خلفية مافيا', 'mafia-transition':'انتقال مافيا',
  'mafia-ambience':'أجواء مافيا', click:'نقرة', select:'تحديد', correct:'إجابة صحيحة', wrong:'إجابة خاطئة',
  win:'نهاية المباراة', lose:'نتيجة الخسارة', card:'كشف بطاقة', pass:'تجاوز', clock:'دقات الساعة',
  'mafia-clock':'ساعة مافيا', pencil:'حركة القلم', 'mafia-judgment':'حكم مافيا', 'mafia-assassination':'اغتيال مافيا',
};
const secondsLabel = value => value < 10 ? `${value.toFixed(2)} ث` : `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2,'0')}`;
export const candidateCallBusy = lamma => !!(lamma?.activeCall || lamma?.callConnecting || lamma?.media?.connected || lamma?.media?.connecting || lamma?.media?.ending || lamma?.mafiaVoice?.requested);

function Audition({ entry, session, enabled, volume, onError }) {
  const cleanup = useRef(null), player = useRef(null), currentVolume = useRef(volume);
  currentVolume.current = volume;
  const attach = useCallback(element => {
    cleanup.current?.(); cleanup.current = null; player.current = element;
    if (element) { element.volume = currentVolume.current; cleanup.current = session.register(element, entry); }
  }, [session, entry]);
  useLayoutEffect(() => { if (player.current) player.current.volume = volume; }, [volume]);
  return <article className="audio-candidate-item">
    <div className="row-between"><strong>{LABELS[entry.sourceId] || entry.title}</strong><bdi>{secondsLabel(entry.seconds)}</bdi></div>
    <small>مرشّح للاستماع · غير معتمد للنشر</small>
    <audio ref={attach} controls={enabled} preload="none" playsInline muted={!enabled} aria-label={`معاينة ${LABELS[entry.sourceId] || entry.title}`}
      onPlay={event => session.onPlay(event.currentTarget)} onPause={event => session.onPause(event.currentTarget)}
      onEnded={event => session.onPause(event.currentTarget)} onError={event => { session.onPause(event.currentTarget); if (enabled) onError('تعذّر تشغيل المعاينة. أغلق النافذة وحاول مجددًا.'); }} />
    <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer"><bdi>{entry.title}</bdi> · <bdi>{entry.author}</bdi></a>
  </article>;
}

function PrivateAudioCandidateLab({ onClose }) {
  const { sound, settings } = usePlatform();
  const account = useAccount(), lamma = useLamma();
  const [owner] = useState(() => `voice-audio-candidate-${globalThis.crypto.randomUUID()}`);
  const [identity] = useState(() => account.user?.id || 'guest');
  const [revision, refresh] = useState(0), [error, setError] = useState('');
  const owners = useRef(new Set(activeAudioOwners()));
  const pageHidden = useRef(false), nativeHidden = useRef(false), close = useRef(onClose);
  close.current = onClose;
  const current = useRef(null);
  current.current = { identity: account.user?.id || 'guest', ready: account.ready !== false,
    call: candidateCallBusy(lamma), enabled: settings.soundOn && sound.enabled && sound.volume > 0 };
  const available = useCallback(() => {
    const privacy = socialInterruption.getSnapshot();
    return current.current.ready && current.current.identity === identity && current.current.enabled && !current.current.call &&
      !pageHidden.current && !nativeHidden.current && !document.hidden && !privacy.privateTurn && !privacy.communicationLocked &&
      ![...owners.current].some(key => key !== owner);
  }, [identity, owner]);
  const session = useMemo(() => createCandidatePlaybackSession(sound, { available, owner,
    activity: active => audioActivity(owner, active) }), [sound, available, owner]);
  const closeNow = useCallback(() => { session.interrupt(); close.current?.(); }, [session]);
  const enabled = isPrivateAudioCandidateBuild() && available();

  useLayoutEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useLayoutEffect(() => {
    if (current.current.identity !== identity) { closeNow(); return; }
    if (!enabled) session.interrupt(); else session.restore();
  }, [session, identity, enabled, revision, closeNow]);
  useLayoutEffect(() => registerBackLayer(closeNow, { priority: 30 }), [closeNow]);
  useEffect(() => {
    const changed = event => {
      const detail = event.detail || {};
      if (!detail.owner || detail.owner === owner) return;
      if (detail.active) owners.current.add(detail.owner); else owners.current.delete(detail.owner);
      if (!available()) session.interrupt();
      refresh(value => value + 1);
    };
    const visibility = () => { if (!available()) session.interrupt(); refresh(value => value + 1); };
    const hidden = () => { pageHidden.current = true; session.interrupt(); refresh(value => value + 1); };
    const shown = () => { pageHidden.current = false; refresh(value => value + 1); };
    const native = event => {
      const state = event.detail?.state;
      if (['background','interruption-began'].includes(state)) { nativeHidden.current = true; session.interrupt(); }
      else if (['foreground','interruption-ended','session-restored'].includes(state)) nativeHidden.current = false;
      else if (state === 'media-reset') session.interrupt();
      else return;
      refresh(value => value + 1);
    };
    const closeIntent = event => {
      const dialog = document.querySelector('.audio-candidate-modal');
      if (!dialog) return;
      const escape = event.type === 'keydown' && event.key === 'Escape';
      const closeButton = event.type === 'click' && event.target?.closest?.('[data-design-id="close"]') && dialog.contains(event.target);
      const backdrop = event.type === 'click' && event.target === dialog.closest('.modal-layer');
      if (!escape && !closeButton && !backdrop) return;
      event.preventDefault(); event.stopPropagation(); closeNow();
    };
    const privacy = socialInterruption.subscribe(visibility);
    window.addEventListener('maydan-social-audio', changed); document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hidden); window.addEventListener('pageshow', shown);
    window.addEventListener('maydan-audio-lifecycle', native);
    window.addEventListener('click', closeIntent, true); window.addEventListener('keydown', closeIntent, true);
    return () => {
      privacy(); window.removeEventListener('maydan-social-audio', changed); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hidden); window.removeEventListener('pageshow', shown);
      window.removeEventListener('maydan-audio-lifecycle', native);
      window.removeEventListener('click', closeIntent, true); window.removeEventListener('keydown', closeIntent, true);
    };
  }, [session, available, closeNow, owner]);

  if (!isPrivateAudioCandidateBuild()) return null;
  const entries = Object.values(CANDIDATE_AUDITIONS).filter(entry => validPrivateAudioCandidate(entry));
  return <Modal title="معاينة أصوات التحديث" onClose={closeNow} className="audio-candidate-modal" data-sound="none">
    <style>{`.audio-candidate-modal{max-width:680px}.audio-candidate-modal .modal-body{max-height:70dvh;overflow:auto}.audio-candidate-intro{font-size:14px;line-height:1.8;color:var(--muted)}.audio-candidate-item{padding:14px;margin-top:12px;border:1px solid var(--border,#ddcdb9);border-radius:16px;background:var(--card,#fffaf1);min-width:0}.audio-candidate-item small{display:block;margin:5px 0 9px;color:var(--muted);font-size:12px}.audio-candidate-item audio{display:block;width:100%;max-width:100%;min-width:0;height:44px}.audio-candidate-item a{display:block;font-size:11px;overflow-wrap:anywhere;margin-top:8px;color:var(--accent,#087b83)}.audio-candidate-item bdi{unicode-bidi:isolate}.audio-candidate-item .row-between{gap:8px;align-items:start}.audio-candidate-item .row-between>bdi{font-size:12px;white-space:nowrap}.audio-candidate-unavailable{margin-top:12px;padding:10px;border-radius:12px;background:#f6e8d7;color:#72503e;font-size:13px}`}</style>
    <p className="audio-candidate-intro">هذه أصوات مرشّحة داخل نسخة الاختبار الخاصة. اسمعها وقارنها؛ المعاينة لا تعتمدها للنشر ولا تغيّر إعدادات الصوت.</p>
    {!enabled && <p className="audio-candidate-unavailable" role="status">المعاينة متوقفة أثناء المكالمة أو التسجيل أو إخفاء التطبيق. تأكد من تفعيل الصوت، ثم شغّل المقطع بنفسك.</p>}
    {error && <p role="alert">{error}</p>}
    {entries.map(entry => <Audition key={entry.id} entry={entry} session={session} enabled={enabled} volume={Math.min(1, Math.max(0, sound.volume ** 2))} onError={setError} />)}
  </Modal>;
}

export function AudioCandidateLab(props) {
  return isPrivateAudioCandidateBuild() ? <PrivateAudioCandidateLab {...props} /> : null;
}
