// إطار كل لعبة: شريط علوي بلون اللعبة، زر خروج مع تأكيد أثناء اللعب، وحارس زر الرجوع.
import React, { useEffect, useState, useCallback } from 'react';
import { IconButton, ConfirmModal } from '../shared/ui/components.jsx';
import { IconHome, IconVolume, IconVolumeOff } from '../shared/ui/icons.jsx';
import { setExitGuard, navigate } from './router.js';
import { usePlatform } from './context.js';

export function GameFrame({ game, inGame, exitMessage, children, onExit }) {
  const platform = usePlatform();
  const [confirming, setConfirming] = useState(null); // target path | null
  const leave = useCallback((target = '/') => {
    setExitGuard(null);
    if (onExit) onExit();
    navigate(target, { replace: true });
  }, [onExit]);

  // زر الرجوع في المتصفح يعني «رجوع خطوة»، فتتعامل معه اللعبة أولًا إن كانت
  // تدير ملاحتها الداخلية (بَديهة تفعل عبر window.maydanBack). أما زر المنصة
  // فيعني «اخرج من اللعبة»، ولا يمرّ باللعبة أبدًا وإلا تعذّر الخروج منها.
  const requestExit = useCallback((target = '/', { fromBack = false } = {}) => {
    if (fromBack && typeof window.maydanBack === 'function' && window.maydanBack()) return;
    if (inGame) setConfirming(target);
    else leave(target);
  }, [inGame, leave]);

  useEffect(() => {
    setExitGuard((target) => { requestExit(target, { fromBack: true }); return true; });
    return () => setExitGuard(null);
  }, [requestExit]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const previous = meta && meta.getAttribute('content');
    if (meta) meta.setAttribute('content', game.accent);
    return () => { if (meta && previous) meta.setAttribute('content', previous); };
  }, [game.accent]);

  return (
    <div className="game-frame" style={{ '--game-accent': game.accent }}>
      <div className="game-bar">
        <IconButton label="العودة إلى المنصة" onClick={() => requestExit('/')}><IconHome /></IconButton>
        <span className="title">{game.name}</span>
        <IconButton label={platform.settings.soundOn ? 'كتم الصوت' : 'تشغيل الصوت'} aria-pressed={!platform.settings.soundOn} onClick={() => { platform.setSettings({ soundOn: !platform.settings.soundOn }); platform.sound.play('click'); }}>
          {platform.settings.soundOn ? <IconVolume /> : <IconVolumeOff />}
        </IconButton>
      </div>
      <div className="game-body">{children}</div>
      {confirming && (
        <ConfirmModal title="الخروج من اللعبة؟" danger message={exitMessage || 'سيضيع تقدّم الجولة الحالية.'} confirmLabel="خروج" cancelLabel="متابعة اللعب"
          onConfirm={() => { setConfirming(null); leave(confirming); }} onCancel={() => setConfirming(null)} />
      )}
    </div>
  );
}
