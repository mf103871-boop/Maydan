import React, { useEffect, useRef, useState } from 'react';
import { Wordmark, WorldArtwork, GameArtwork, ClayStage } from '../../shared/brand/art.jsx';
import { prepareVisuals } from '../../shared/fx/readiness.js';
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

export function Splash({ onDone, reducedMotion = false }) {
  const { ready, progress } = useVisualReadiness({ includeWorld: true });
  const finished = useRef(false);
  useEffect(() => {
    if (ready && !finished.current) { finished.current = true; onDone(); }
  }, [ready, onDone]);

  return <div className="splash" aria-busy="true" aria-label="تجهيز ميدان" data-reduced-motion={reducedMotion ? 'true' : undefined}>
    <div className="splash-sky" aria-hidden="true">
      <i className="splash-cloud" style={{ '--i': 0 }} /><i className="splash-cloud" style={{ '--i': 1 }} />
      <i className="splash-balloon" style={{ '--i': 0 }} /><i className="splash-balloon" style={{ '--i': 1 }} />
      <i className="splash-star" /><i className="splash-star" /><i className="splash-star" /><i className="splash-star" />
    </div>
    <WorldArtwork className="splash-world" />
    <div className="splash-inner"><Wordmark sculpted /><div className="splash-sub">ألعاب جمعتنا</div></div>
    <div className="splash-loading"><LoadingStatus progress={progress} label="تجهز الساحة…" /></div>
  </div>;
}
