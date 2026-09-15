import { Avatar } from '../brand/art.jsx';
// «سلّم الجوال لـ …» — يخفي المحتوى الخاص باللاعب حتى يلمس الشاشة.
import React, { useState, useEffect } from 'react';
import { Button } from '../ui/components.jsx';
import { useReaction } from '../ui/useReaction.js';
import { wait } from '../fx/screen.js';

export function PassPhoneScreen({ player, hint = 'لا يرى الشاشة غيرك. عندما تكون جاهزًا اضغط الزر.', ready = 'أنا جاهز', children, api }) {
  const [shown, setShown] = useState(false);
  const [reaction, react] = useReaction();
  useEffect(() => { setShown(false); }, [player && player.id]);
  if (!player) return children;
  // غلاف الكشف يدخل بحركة رفع خفيفة (لا يعتمد الكشف نفسه على الحركة).
  if (shown) return <div className="pass-revealed">{children}</div>;
  const reveal = () => {
    api && api.sound.play('whoosh'); api && api.haptics.vibrate('light');
    react('clay-squash');
    setTimeout(() => setShown(true), wait(180));
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
