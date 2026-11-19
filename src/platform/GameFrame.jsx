import { tr, gameName } from '../shared/i18n/core.js';
import { useI18n } from '../shared/i18n/react.jsx';
// إطار كل لعبة: شريط علوي بلون اللعبة، زر خروج مع تأكيد أثناء اللعب، وحارس زر الرجوع.
import React, { useEffect, useState, useCallback } from 'react';
import { IconButton, ConfirmModal, ErrorBoundary } from '../shared/ui/components.jsx';
import { IconHome, IconVolume, IconVolumeOff } from '../shared/ui/icons.jsx';
import { setExitGuard, navigate } from './router.js';
import { GameFrameFooterContext, usePlatform } from './context.js';
import { createStorage } from '../shared/lib/storage.js';
import { socialInterruption } from '../social/interruption.js';

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
  const { locale } = useI18n();
  const displayName = gameName(game, locale);
  const [confirming, setConfirming] = useState(null); // target path | null
  const [clearedActive, setClearedActive] = useState(false);
  const [controlsInFooter, setControlsInFooter] = useState(false);
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

  // Games with their own exit handler already pause their clocks. For the
  // shared timer games, use the existing privacy/pause curtain while deciding;
  // cancelling requires the same explicit resume as returning from the drawer.
  useEffect(() => {
    if (!confirming || beforeExit) return undefined;
    socialInterruption.open();
    return () => socialInterruption.close();
  }, [confirming, beforeExit]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const previous = meta && meta.getAttribute('content');
    if (meta) meta.setAttribute('content', game.accent);
    return () => { if (meta && previous) meta.setAttribute('content', previous); };
  }, [game.accent]);

  const clearLabel = !clearedActive && game.activeKeys?.length ? tr("مسح المباراة الجارية وإعادة المحاولة") : tr("مسح كل بيانات هذه اللعبة");
  const clearGameData = () => {
    if (!clearedActive && clearActiveGameData(game)) { setClearedActive(true); leave(`/play/${game.id}`); return; }
    try { createStorage(game.id).clear(); } catch (error) { /* ignore */ }
    leave('/');
  };

  const title = <span data-design-id="title" className="title">{displayName}</span>;
  const home = <IconButton data-design-id="home" data-design-required="true" label={tr("العودة إلى المنصة")} onClick={() => requestExit('/')}><IconHome /></IconButton>;
  const social = <span className="online-social-slot" data-social-game-launcher />;
  const sound = <IconButton data-design-id="sound" label={platform.settings.soundOn ? tr("كتم الصوت") : tr("تشغيل الصوت")} aria-pressed={!platform.settings.soundOn} onClick={() => platform.setSettings({ soundOn: !platform.settings.soundOn })}>
    <span key={String(platform.settings.soundOn)} className="icon-swap">{platform.settings.soundOn ? <IconVolume /> : <IconVolumeOff />}</span>
  </IconButton>;
  return (
    <div data-design-screen="shell.game-frame" data-creator-game={game.id} data-creator-phase={inGame ? 'playing' : 'setup'} className="game-frame" style={{ '--game-accent': game.accent }}>
      <div data-design-id="header" className="game-bar">
        {!controlsInFooter && home}
        {game.id === 'badeeha' ? <div className="bl-shell-heading">{title}</div> : title}
        {!controlsInFooter && social}
        {!controlsInFooter && sound}
      </div>
      <div className="game-body">
        {/* لعبة تتعطّل لا تُسقط المنصة: رسالة، عودة للرئيسية، ومسح بيانات اللعبة. */}
        <ErrorBoundary
          scope="game"
          resetKey={`${game.id}:${clearedActive}`}
          title={tr("تعطّلت اللعبة")}
          message={tr("يمكنك العودة إلى الرئيسية أو بدء مباراة جديدة.")}
          clearLabel={clearLabel}
          onHome={() => leave('/')}
          onClear={clearGameData}
        >
          <GameFrameFooterContext.Provider value={setControlsInFooter}>{children}</GameFrameFooterContext.Provider>
        </ErrorBoundary>
      </div>
      {controlsInFooter && <footer className="game-footer-controls">{home}{social}{sound}</footer>}
      {confirming && (
        <ConfirmModal title={tr("الخروج من اللعبة؟")} placement="bottom" danger message={exitMessage || tr("سيضيع تقدّم الجولة الحالية.")} confirmLabel={tr("خروج")} cancelLabel={tr("متابعة اللعب")}
          onConfirm={() => { setConfirming(null); leave(confirming); }} onCancel={() => setConfirming(null)} />
      )}
    </div>
  );
}
