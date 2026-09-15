// حلقة المؤقت: ذهبية ثم حمراء، تنبض مع صوت tick في آخر 5 ثوانٍ واهتزاز في آخر 3،
// وتظليل أحمر ثابت على الشاشة (fx.vignette) في آخر 3 ثوانٍ.
import React, { useEffect, useRef } from 'react';
import { ProgressRing } from './components.jsx';
import { vignette } from '../fx/screen.js';

function mix(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

export function Timer({ timer, size = 140, api = null, label = 'ثانية', accent = '#F5B82E' }) {
  const { left, total, running, paused, resuming } = timer;
  const fraction = total > 0 ? left / total : 0;
  const danger = left <= 5 && left > 0 && running;
  const color = fraction > 0.5 ? accent : mix('#FF4D4D', accent, Math.max(0, (fraction - 0.15) / 0.35));
  const lastBeep = useRef(null);

  useEffect(() => {
    if (!running || !api) return;
    if (left <= 5 && left > 0 && lastBeep.current !== left) {
      lastBeep.current = left;
      api.sound.play('tickFast');
      if (left <= 3) api.haptics.vibrate('tick');
    }
  }, [left, running, api]);

  useEffect(() => {
    if (resuming !== null && resuming > 0 && api) api.sound.play('countdown');
    if (resuming === 0 && api) api.sound.play('countdownGo');
  }, [resuming, api]);

  // التظليل الأحمر يعيش خارج شجرة المؤقت (عنصر ثابت في body) فلا يقع تحت أصل محوَّل.
  useEffect(() => { vignette(danger && left <= 3); return () => vignette(false); }, [danger, left]);

  // role/aria-live على الأصل الثابت؛ الرقم وحده يُعاد تركيبه (key) في ثواني الخطر ليُلكم كل ثانية.
  return (
    <div className={`timer ${danger ? 'is-danger' : ''} ${paused ? 'is-paused' : ''}`} role="timer" aria-live={left <= 5 ? 'assertive' : 'off'} aria-label={`${left} ${label}`}>
      <ProgressRing value={left} max={total} size={size} color={color}>
        <div className="center">
          <div className="timer-num" dir="ltr" key={danger ? left : 'n'}>{left}</div>
          <div className="timer-sub">{paused ? 'متوقف' : label}</div>
        </div>
      </ProgressRing>
      {resuming !== null && (
        <div className="timer-resume" role="status" aria-live="assertive">
          <div className="center"><div key={resuming}>{resuming > 0 ? resuming : 'انطلق'}</div><small>عدنا! يستأنف المؤقت الآن</small></div>
        </div>
      )}
    </div>
  );
}
