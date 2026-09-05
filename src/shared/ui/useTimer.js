// مؤقت تنازلي مبني على «موعد نهائي» لا على عدّ الفواصل، فلا ينحرف مع بطء الجهاز.
// يتوقف تلقائيًا عند إخفاء الصفحة أو قفل الشاشة ويستأنف بعد عدّ 3-2-1.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useTimer({ seconds, onEnd, onSecond, autoStart = false, resumeCountdown = 3 } = {}) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resuming, setResuming] = useState(null); // 3 | 2 | 1 | null
  const deadline = useRef(null);
  const remaining = useRef(seconds);
  const autoPaused = useRef(false);
  const onEndRef = useRef(onEnd);
  const onSecondRef = useRef(onSecond);
  const lastSecond = useRef(seconds);
  onEndRef.current = onEnd;
  onSecondRef.current = onSecond;

  const reset = useCallback((next = seconds) => {
    deadline.current = null;
    remaining.current = next;
    lastSecond.current = next;
    setLeft(next);
    setRunning(false);
    setPaused(false);
    setResuming(null);
  }, [seconds]);

  const start = useCallback(() => {
    deadline.current = Date.now() + remaining.current * 1000;
    setRunning(true);
    setPaused(false);
    setResuming(null);
  }, []);

  const pause = useCallback(() => {
    if (!deadline.current) return;
    remaining.current = Math.max(0, (deadline.current - Date.now()) / 1000);
    deadline.current = null;
    setRunning(false);
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    if (remaining.current <= 0) return;
    if (resumeCountdown > 0) {
      setResuming(resumeCountdown);
    } else start();
  }, [resumeCountdown, start]);

  const add = useCallback((extra) => {
    if (deadline.current) deadline.current += extra * 1000;
    else remaining.current += extra;
    setLeft((v) => v + extra);
  }, []);

  // the 3-2-1 overlay drives itself down to zero, then starts
  useEffect(() => {
    if (resuming === null) return undefined;
    if (resuming <= 0) { setResuming(null); start(); return undefined; }
    const t = setTimeout(() => setResuming((v) => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(t);
  }, [resuming, start]);

  useEffect(() => {
    if (!running) return undefined;
    const tick = () => {
      if (!deadline.current) return;
      const secs = Math.max(0, (deadline.current - Date.now()) / 1000);
      const whole = Math.ceil(secs);
      setLeft(whole);
      if (whole !== lastSecond.current) {
        lastSecond.current = whole;
        if (onSecondRef.current) onSecondRef.current(whole);
      }
      if (secs <= 0) {
        deadline.current = null;
        remaining.current = 0;
        setRunning(false);
        if (onEndRef.current) onEndRef.current();
      }
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        if (deadline.current) { autoPaused.current = true; pause(); }
        if (resuming !== null) { setResuming(null); autoPaused.current = true; }
      } else if (autoPaused.current) {
        autoPaused.current = false;
        resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause, resume, resuming]);

  useEffect(() => {
    if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { left, running, paused, resuming, start, pause, resume, reset, add, total: seconds };
}
