import { Avatar } from '../brand/art.jsx';
// «سلّم الجوال لـ …» — يخفي المحتوى الخاص باللاعب حتى يلمس الشاشة.
import React, { useState, useEffect, useRef } from 'react';
import { socialInterruption } from '../../social/interruption.js';
import { Button } from '../ui/components.jsx';
import { useReaction } from '../ui/useReaction.js';
import { wait } from '../fx/screen.js';

export function PassPhoneScreen({ player, hint = 'لا يرى الشاشة غيرك. عندما تكون جاهزًا اضغط الزر.', ready = 'أنا جاهز', children, api, designPreviewShown = false }) {
  const previewRevealed = !!api?.designPreview && designPreviewShown;
  const [shown, setShown] = useState(previewRevealed);
  const [reaction, react] = useReaction();
  const revealTimer = useRef(null);
  const playerId = player?.id;
  useEffect(() => { setShown(previewRevealed); return () => clearTimeout(revealTimer.current); }, [playerId, previewRevealed]);
  useEffect(() => !api?.designPreview && playerId && shown ? socialInterruption.private(Symbol('pass-phone')) : undefined, [playerId, shown, api?.designPreview]);
  useEffect(() => socialInterruption.subscribe(() => {
    if (socialInterruption.getSnapshot().open) { clearTimeout(revealTimer.current); setShown(false); }
  }), []);
  if (!player) return children;
  // غلاف الكشف يدخل بحركة رفع خفيفة (لا يعتمد الكشف نفسه على الحركة).
  if (shown) return <div className="pass-revealed">{children}</div>;
  const reveal = () => {
    api && api.sound.play('whoosh'); api && api.haptics.vibrate('light');
    react('clay-squash');
    revealTimer.current = setTimeout(() => { if (!socialInterruption.getSnapshot().paused) setShown(true); }, wait(180));
  };
  return (
    <div data-design-screen="setup.pass-phone" data-design-id="privacy" data-design-required="true" className="pass-screen" style={{ '--pass-color': player.color }}>
      <div className={`pass-avatar clay-stage clay-idle ${reaction}`} aria-hidden="true"><span className="clay-lift"><Avatar player={player} /></span></div>
      <div data-design-id="title" className="pass-title">سلّم الجوال إلى</div>
      <div data-design-id="player-name" className="pass-name">{player.name}</div>
      <p data-design-id="privacy-hint" data-design-required="true" className="pass-hint">{hint}</p>
      <Button variant="accent" size="lg" data-design-id="continue" data-design-required="true" onClick={reveal}>{ready} — {player.name}</Button>
    </div>
  );
}
