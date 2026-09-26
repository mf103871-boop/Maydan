// إطار كل لعبة: شريط علوي بلون اللعبة، زر خروج مع تأكيد أثناء اللعب، وحارس زر الرجوع.
import React, { useEffect, useState, useCallback } from 'react';
import { IconButton, ConfirmModal, ErrorBoundary } from '../shared/ui/components.jsx';
import { IconHome, IconVolume, IconVolumeOff } from '../shared/ui/icons.jsx';
import { setExitGuard, navigate } from './router.js';
import { usePlatform } from './context.js';
import { createStorage } from '../shared/lib/storage.js';

// «مسح بيانات اللعبة» من شاشة التعطّل كان يمسح النتائج والسجل أيضًا، والمباراة الجارية وحدها
// هي سبب الأعطال المتكررة عادة. الضغطة الأولى تمسح مفاتيح المباراة الجارية التي تعلنها اللعبة
// (`activeKeys` في manifest؛ مفتاح مطلق يبدأ بـ maydan: أو مفتاح داخل مخزن اللعبة)، والثانية
// تمسح مخزن اللعبة كله.
export function clearActiveGameData(game) {
  const keys = Array.isArray(game?.activeKeys) ? game.activeKeys : [];
  if (!keys.length) return false;
  const store = createStorage(game.id);
  for (const key of keys) {
    try {
      if (key.startsWith('maydan:')) localStorage.removeItem(key);
      else store.remove(key);
    } catch (error) { /* ignore */ }
  }
  return true;
}

export function GameFrame({ game, inGame, exitMessage, beforeExit, children, onExit }) {
  const platform = usePlatform();
  const [confirming, setConfirming] = useState(null); // target path | null
  const [clearedActive, setClearedActive] = useState(false);
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
    if (inGame) { beforeExit?.(); setConfirming(target); }
    else leave(target);
  }, [inGame, leave, beforeExit]);

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

  const clearLabel = !clearedActive && game.activeKeys?.length ? 'مسح المباراة الجارية وإعادة المحاولة' : 'مسح كل بيانات هذه اللعبة';
  const clearGameData = () => {
    if (!clearedActive && clearActiveGameData(game)) { setClearedActive(true); leave(`/play/${game.id}`); return; }
    try { createStorage(game.id).clear(); } catch (error) { /* ignore */ }
    leave('/');
  };

  return (
    <div className="game-frame" style={{ '--game-accent': game.accent }}>
      <div className="game-bar">
        <IconButton label="العودة إلى المنصة" onClick={() => requestExit('/')}><IconHome /></IconButton>
        <span className="title">{game.name}</span>
        <IconButton label={platform.settings.soundOn ? 'كتم الصوت' : 'تشغيل الصوت'} aria-pressed={!platform.settings.soundOn} onClick={() => { platform.setSettings({ soundOn: !platform.settings.soundOn }); platform.sound.play('click'); }}>
          {/* الأيقونة مفتاحها حالة الصوت: تنبثق عند التبديل */}
          <span key={String(platform.settings.soundOn)} className="icon-swap">{platform.settings.soundOn ? <IconVolume /> : <IconVolumeOff />}</span>
        </IconButton>
      </div>
      <div className="game-body">
        {/* لعبة تتعطّل لا تُسقط المنصة: رسالة، عودة للرئيسية، ومسح بيانات اللعبة. */}
        <ErrorBoundary
          resetKey={game.id}
          title="تعطّلت اللعبة"
          message={`حدث خطأ غير متوقع في ${game.name}. يمكنك العودة إلى الرئيسية، أو مسح بيانات هذه اللعبة إن تكرّر الخطأ.`}
          clearLabel={clearLabel}
          onHome={() => leave('/')}
          onClear={clearGameData}
        >
          {children}
        </ErrorBoundary>
      </div>
      {confirming && (
        <ConfirmModal title="الخروج من اللعبة؟" danger message={exitMessage || 'سيضيع تقدّم الجولة الحالية.'} confirmLabel="خروج" cancelLabel="متابعة اللعب"
          onConfirm={() => { setConfirming(null); leave(confirming); }} onCancel={() => setConfirming(null)} />
      )}
    </div>
  );
}
