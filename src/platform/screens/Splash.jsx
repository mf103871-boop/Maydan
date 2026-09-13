import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Wordmark, WorldArtwork } from '../../shared/brand/art.jsx';

export function Splash({ onDone, duration = 2200 }) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const exitTimer = useRef(null);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    exitTimer.current = setTimeout(onDone, 250);
  }, [onDone]);

  useEffect(() => {
    const reduced = document.documentElement.dataset.reducedMotion === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(finish, reduced ? 600 : duration);
    return () => { clearTimeout(timer); clearTimeout(exitTimer.current); };
  }, [duration, finish]);

  return <div className={`splash ${leaving ? 'is-leaving' : ''}`} onClick={finish} role="button" tabIndex={0} aria-label="تخطي شاشة البداية" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); finish(); } }}>
    <WorldArtwork className="splash-world" />
    <div className="splash-inner"><Wordmark sculpted /><div className="splash-sub">ألعاب جمعتنا</div></div>
    <div className="splash-skip">المس الشاشة للتخطي</div>
  </div>;
}
