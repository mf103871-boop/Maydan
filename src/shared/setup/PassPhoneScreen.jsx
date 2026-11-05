import { Avatar } from '../brand/art.jsx';
// «سلّم الجوال لـ …» — يخفي المحتوى الخاص باللاعب حتى يلمس الشاشة.
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { socialInterruption } from '../../social/interruption.js';
import { Button } from '../ui/components.jsx';
import { useReaction } from '../ui/useReaction.js';
import { wait } from '../fx/screen.js';

export function PassPhoneLock() {
  return <span className="pass-lock" aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 22v-7a9 9 0 0 1 18 0v7" />
      <rect x="10" y="21" width="28" height="22" rx="5" />
      <path d="M24 30v5" /><circle cx="24" cy="29.5" r="1.5" />
    </svg>
  </span>;
}

export function PassPhoneScreen({ player, hint = 'لا يرى الشاشة غيرك. عندما تكون جاهزًا اضغط الزر.', ready = 'أنا جاهز', children, api, designPreviewShown = false }) {
  const previewRevealed = !!api?.designPreview && designPreviewShown;
  const playerId = player?.id;
  const [revealState, setRevealState] = useState({ playerId, shown: previewRevealed });
  const shown = revealState.playerId === playerId && revealState.shown;
  const [reaction, react] = useReaction();
  const revealTimer = useRef(null);
  const owner = useRef(playerId); owner.current = playerId;
  // Identity gates the render itself: no frame of the next player's secret.
  useLayoutEffect(() => { setRevealState({ playerId, shown: previewRevealed }); return () => clearTimeout(revealTimer.current); }, [playerId, previewRevealed]);
  useEffect(() => !api?.designPreview && playerId && shown ? socialInterruption.private(Symbol('pass-phone')) : undefined, [playerId, shown, api?.designPreview]);
  useEffect(() => socialInterruption.subscribe(() => {
    if (socialInterruption.getSnapshot().open) { clearTimeout(revealTimer.current); setRevealState({ playerId: owner.current, shown: false }); }
  }), []);
  useEffect(() => {
    const conceal = () => { if (document.hidden) { clearTimeout(revealTimer.current); setRevealState({ playerId: owner.current, shown: false }); } };
    document.addEventListener('visibilitychange', conceal);
    return () => document.removeEventListener('visibilitychange', conceal);
  }, []);
  if (!player) return children;
  // غلاف الكشف يدخل بحركة رفع خفيفة (لا يعتمد الكشف نفسه على الحركة).
  if (shown) return <div className="pass-revealed">{children}</div>;
  const reveal = () => {
    api && api.sound.play('whoosh'); api && api.haptics.vibrate('light');
    react('clay-squash');
    clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => { if (owner.current === playerId && !document.hidden && !socialInterruption.getSnapshot().paused) setRevealState({ playerId, shown: true }); }, wait(180));
  };
  return (
    <div data-design-screen="setup.pass-phone" data-design-id="privacy" data-design-required="true" className="pass-screen" style={{ '--pass-color': player.color }}>
      <div className="pass-panel">
        <PassPhoneLock />
        <h2 data-design-id="title" className="pass-title">سلّم الجوال إلى <span data-design-id="player-name" className="pass-name">{player.name}</span></h2>
        <p data-design-id="privacy-hint" data-design-required="true" className="pass-hint">{hint}</p>
        <div className={`pass-avatar clay-stage clay-static ${reaction}`} aria-hidden="true"><span className="clay-lift"><Avatar player={player} /></span></div>
        <Button variant="accent" size="lg" full data-design-id="continue" data-design-required="true" onClick={reveal}>{ready} — {player.name}</Button>
      </div>
    </div>
  );
}
