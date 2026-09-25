import React, { useEffect, useRef, useState } from 'react';
import { Wordmark, WorldArtwork, GameArtwork, ClayStage } from '../../shared/brand/art.jsx';
import { prepareVisuals } from '../../shared/fx/readiness.js';
import { Button } from '../../shared/ui/components.jsx';
import { cacheStartupImages } from '../../shared/media/startup-cache.js';
import { startupImageUrls } from '../../shared/media/startup-images.js';
import gameIcons from '../../shared/brand/assets/game-icons.webp';
import avatars from '../../shared/brand/assets/avatars.webp';
import world from '../../shared/brand/assets/world.webp';

export function useVisualReadiness({ includeWorld = false } = {}) {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState({ complete: 0, total: 0 });
  useEffect(() => {
    let active = true;
    prepareVisuals({ images: includeWorld ? [world, gameIcons, avatars] : [gameIcons, avatars],
      onProgress: (next) => { if (active) setProgress(next); },
    }).then(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [includeWorld]);
  return { ready, progress };
}

function LoadingStatus({ progress, label }) {
  return <div className="loading-status" role="status" aria-live="polite">
    <span className="loading-orbit" aria-hidden="true"><i /><i /><i /></span>
    <b>{label}</b>
    <span className="loading-track" aria-hidden="true"><span style={{ transform: `scaleX(${progress.total ? progress.complete / progress.total : 0})` }} /></span>
  </div>;
}

export function GameLoading({ game, progress }) {
  return <section className="game-loading" aria-busy="true" aria-label={`تجهيز ${game.name}`}>
    <ClayStage className="clay-static"><GameArtwork game={game.id} /></ClayStage>
    <h1>{game.name}</h1>
    <LoadingStatus progress={progress} label="نجهّز ساحة اللعب…" />
  </section>;
}

export function Splash({ onDone, visible = true, reducedMotion = false }) {
  const { ready } = useVisualReadiness({ includeWorld: true });
  const [attempt, setAttempt] = useState(0);
  const [images, setImages] = useState({ done: 0, total: startupImageUrls.length, ok: 0, failed: 0 });
  const [phase, setPhase] = useState('loading');
  const [canLeave, setCanLeave] = useState(false);
  const [statusHidden, setStatusHidden] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setPhase('loading');
    setImages({ done: 0, total: startupImageUrls.length, ok: 0, failed: 0 });
    cacheStartupImages(startupImageUrls, {
      signal: abort.signal,
      concurrency: 3, // Leave connections available for the active game's media.
      onProgress: (next) => { if (active) setImages(next); },
    }).then((result) => {
      if (!active || result.aborted) return;
      setImages(result);
      setPhase(result.failed ? 'error' : 'ready');
    }).catch(() => { if (active) setPhase('error'); });
    return () => { active = false; abort.abort(); };
  }, [attempt]);

  // Cap only the image wait. Fast/cached loads enter immediately; large first
  // downloads keep running after the splash goes away, in this mounted owner.
  useEffect(() => {
    const timer = setTimeout(() => setCanLeave(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (ready && (phase === 'ready' || canLeave) && !finished.current) { finished.current = true; onDone(); }
  }, [ready, phase, canLeave, onDone]);

  const enterWithAvailableImages = () => {
    if (finished.current || !ready) return;
    finished.current = true;
    onDone();
  };
  const percent = images.total ? Math.floor(images.ok / images.total * 100) : 0;
  const number = (value) => value.toLocaleString('ar');
  const incomplete = Math.max(0, images.total - images.ok);

  if (!visible) {
    if (phase === 'ready' || statusHidden) return null;
    return <aside className="startup-background" aria-label="حالة تحميل الصور">
      <span role="status">{phase === 'error' ? `باقي ${number(incomplete)} صورة` : `نجهّز الصور بالخلفية · ${number(images.ok)} / ${number(images.total)}`}</span>
      {phase === 'error' && <button type="button" onClick={() => setAttempt((value) => value + 1)}>إعادة المحاولة</button>}
      <button type="button" className="startup-background-close" aria-label="إخفاء حالة الصور" onClick={() => setStatusHidden(true)}>×</button>
    </aside>;
  }

  return <div className="splash" aria-busy={phase === 'loading'} aria-label="تجهيز ميدان" data-reduced-motion={reducedMotion ? 'true' : undefined}>
    <div className="splash-sky" aria-hidden="true">
      <i className="splash-cloud" style={{ '--i': 0 }} /><i className="splash-cloud" style={{ '--i': 1 }} />
      <i className="splash-balloon" style={{ '--i': 0 }} /><i className="splash-balloon" style={{ '--i': 1 }} />
      <i className="splash-star" /><i className="splash-star" /><i className="splash-star" /><i className="splash-star" />
    </div>
    <WorldArtwork className="splash-world" />
    <div className="splash-inner"><Wordmark sculpted /><div className="splash-sub">ألعاب جمعتنا</div></div>
    <div className="splash-loading">
      <div className="loading-status startup-download">
        <span className="startup-download-kicker">نجهّز كل الصور للّعب</span>
        <h1>{phase === 'error' ? 'باقي صور لم يكتمل تحميلها' : phase === 'ready' ? 'الصور جاهزة، نفتح الساحة…' : 'نحمّل صور الألعاب…'}</h1>
        <div className="startup-download-count" aria-hidden="true">
          <b>{number(percent)}٪</b><span>{number(images.ok)} من {number(images.total)} صورة</span>
        </div>
        <progress className="startup-download-progress" max={images.total || 1} value={images.ok} aria-label="تحميل صور اللعبة" aria-valuetext={`${number(images.ok)} من ${number(images.total)} صورة`} />
        <p className="startup-download-note" role="status" aria-live="polite">
          {phase === 'error'
            ? `تعذّر تجهيز ${number(incomplete)} صورة. تحقّق من الاتصال وأعد المحاولة؛ الصور المكتملة محفوظة إذا كانت مساحة الجهاز تسمح.`
            : 'ستفتح اللعبة خلال لحظات، وتكتمل الصور في الخلفية. الصور المحفوظة لا نحمّلها مجددًا.'}
        </p>
        <div className="startup-download-actions">
          {phase === 'error' && <Button variant="primary" full onClick={() => setAttempt((value) => value + 1)}>إعادة المحاولة</Button>}
          <Button variant="ghost" full disabled={!ready} onClick={enterWithAvailableImages}>الدخول بالصور المتاحة</Button>
          <small>التحميل يستمر أثناء اللعب دون انتظار.</small>
        </div>
      </div>
    </div>
  </div>;
}
