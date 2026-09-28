// حلقة المؤقت: ذهبية ثم حمراء، تنبض في آخر 5 ثوانٍ، وتظليل أحمر ثابت على الشاشة (fx.vignette)
// في آخر 3 ثوانٍ. بصرية فقط: الأصوات والاهتزاز من useTimerCues في اللعبة.
import React, { useEffect } from 'react';
import { ProgressRing } from './components.jsx';
import { vignette } from '../fx/screen.js';

function mix(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

// طبقة عدّ الاستئناف 3-2-1 (ثابتة تغطي الشاشة؛ تصلح مع حلقة المؤقت أو بدونها كما في القنبلة).
export function ResumeCountdown({ resuming }) {
  if (resuming === null || resuming === undefined) return null;
  return (
    <div className="timer-resume" role="status" aria-live="assertive">
      <div className="center"><div key={resuming}>{resuming > 0 ? resuming : 'انطلق'}</div><small>عدنا! يستأنف المؤقت الآن</small></div>
    </div>
  );
}

export function Timer({ timer, size = 140, label = 'ثانية', accent = '#F5B82E' }) {
  const { left, total, running, paused, resuming } = timer;
  const fraction = total > 0 ? left / total : 0;
  const danger = left <= 5 && left > 0 && running;
  const color = fraction > 0.5 ? accent : mix('#FF4D4D', accent, Math.max(0, (fraction - 0.15) / 0.35));

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
      <ResumeCountdown resuming={resuming} />
    </div>
  );
}
