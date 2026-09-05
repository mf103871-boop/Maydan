// «سلّم الجوال لـ …» — يخفي المحتوى الخاص باللاعب حتى يلمس الشاشة.
import React, { useState, useEffect } from 'react';
import { Button } from '../ui/components.jsx';

export function PassPhoneScreen({ player, hint = 'لا يرى الشاشة غيرك. عندما تكون جاهزًا اضغط الزر.', ready = 'أنا جاهز', children, api }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { setShown(false); }, [player && player.id]);
  if (!player) return children;
  if (shown) return children;
  return (
    <div className="pass-screen" style={{ '--pass-color': player.color }}>
      <div className="pass-avatar" aria-hidden="true">{player.emoji || '📱'}</div>
      <div className="pass-title">سلّم الجوال إلى</div>
      <div className="pass-name">{player.name}</div>
      <p className="pass-hint">{hint}</p>
      <Button variant="accent" size="lg" onClick={() => { api && api.sound.play('whoosh'); api && api.haptics.vibrate('light'); setShown(true); }}>{ready} — {player.name}</Button>
    </div>
  );
}
