// مستشعر الميلان مع إذن iOS ومهلة بين الحركات، ويرجع fallback عند عدم توفره.
import { useEffect, useRef, useState, useCallback } from 'react';
import { tiltDecision, isNeutral, TILT_COOLDOWN_MS } from './logic.js';

export function useTilt({ enabled, onDecision }) {
  const [supported, setSupported] = useState(() => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window);
  const [granted, setGranted] = useState(false);
  const armed = useRef(true);
  const lastAt = useRef(0);
  const onDecisionRef = useRef(onDecision);
  onDecisionRef.current = onDecision;

  const needsPermission = typeof window !== 'undefined' && window.DeviceOrientationEvent
    && typeof window.DeviceOrientationEvent.requestPermission === 'function';

  const request = useCallback(async () => {
    if (!needsPermission) { setGranted(true); return true; }
    try {
      const result = await window.DeviceOrientationEvent.requestPermission();
      const ok = result === 'granted';
      setGranted(ok);
      if (!ok) setSupported(false);
      return ok;
    } catch (error) {
      setSupported(false);
      return false;
    }
  }, [needsPermission]);

  useEffect(() => {
    if (!enabled || !supported || (needsPermission && !granted)) return undefined;
    let sawEvent = false;
    const onOrientation = (event) => {
      const beta = event.beta;
      if (!Number.isFinite(beta)) return;
      sawEvent = true;
      if (isNeutral(beta)) { armed.current = true; return; }
      const now = Date.now();
      if (now - lastAt.current < TILT_COOLDOWN_MS) return;
      const decision = tiltDecision(beta, armed.current);
      if (!decision) return;
      armed.current = false;
      lastAt.current = now;
      onDecisionRef.current(decision);
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    // بعض الأجهزة تسجّل الحدث دون إرسال قيم — نعتبره غير مدعوم بعد ثانيتين.
    const probe = setTimeout(() => { if (!sawEvent) setSupported(false); }, 2500);
    return () => { window.removeEventListener('deviceorientation', onOrientation, true); clearTimeout(probe); };
  }, [enabled, supported, granted, needsPermission]);

  return { supported, granted: granted || !needsPermission, needsPermission, request };
}
