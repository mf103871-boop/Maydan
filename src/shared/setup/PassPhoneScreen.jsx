import { Avatar } from '../brand/art.jsx';
// «سلّم الجوال لـ …» — يخفي المحتوى الخاص باللاعب حتى يلمس الشاشة.
import React, { useState, useEffect, useRef } from 'react';
import { socialInterruption } from '../../social/interruption.js';
import { Button } from '../ui/components.jsx';
import { useReaction } from '../ui/useReaction.js';
import { wait } from '../fx/screen.js';

export function PassPhoneScreen({ player, hint = 'لا يرى الشاشة غيرك. عندما تكون جاهزًا اضغط الزر.', ready = 'أنا جاهز', children, api }) {
  const [shown, setShown] = useState(false);
  const [reaction, react] = useReaction();
  const revealTimer = useRef(null);
  const playerId = player?.id;
  useEffect(() => { setShown(false); return () => clearTimeout(revealTimer.current); }, [playerId]);
  useEffect(() => playerId && shown ? socialInterruption.private(Symbol('pass-phone')) : undefined, [playerId, shown]);
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
    <div className="pass-screen" style={{ '--pass-color': player.color }}>
      <div className={`pass-avatar clay-stage clay-idle ${reaction}`} aria-hidden="true"><span className="clay-lift"><Avatar player={player} /></span></div>
      <div className="pass-title">سلّم الجوال إلى</div>
      <div className="pass-name">{player.name}</div>
      <p className="pass-hint">{hint}</p>
      <Button variant="accent" size="lg" onClick={reveal}>{ready} — {player.name}</Button>
    </div>
  );
}
