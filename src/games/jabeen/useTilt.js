// مستشعر الميلان مع إذن iOS ومهلة بين الحركات، ويرجع fallback عند عدم توفره.
// نسخة واحدة فقط من هذا الخطّاف تُنشأ في اللعبة وتُمرَّر نتيجتها للأبناء،
// وإلا طلبت نسخةٌ الإذن وقرأت نسخةٌ أخرى لا إذن لها فلا يعمل شيء.
import { useEffect, useRef, useState, useCallback } from 'react';
import { tiltDecision, isNeutral, orientedTilt, screenAngle, tiltBaseline, TILT_COOLDOWN_MS, TILT_PROBE_MS, TILT_BASELINE_SAMPLES } from './logic.js';

export function useTilt({ enabled, onDecision }) {
  const [supported, setSupported] = useState(() => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window);
  const [granted, setGranted] = useState(false);
  const [reading, setReading] = useState(false); // وصلتنا قراءة حقيقية من المستشعر
  const armed = useRef(false); // لا نقبل قرارًا قبل مرور الجهاز بالوضع المحايد
  const lastAt = useRef(0);
  // المعايرة: أول العينات بعد التفعيل (أو بعد recalibrate) تحدّد وضع الجبين لهذا الدور.
  const samples = useRef([]);
  const baseline = useRef(null);
  const [calibrated, setCalibrated] = useState(false);
  const onDecisionRef = useRef(onDecision);
  onDecisionRef.current = onDecision;
  const recalibrate = useCallback(() => { samples.current = []; baseline.current = null; armed.current = false; setCalibrated(false); }, []);

  const needsPermission = typeof window !== 'undefined' && window.DeviceOrientationEvent
    && typeof window.DeviceOrientationEvent.requestPermission === 'function';

  const request = useCallback(async () => {
    if (!needsPermission) { setGranted(true); return true; }
    try {
      const result = await window.DeviceOrientationEvent.requestPermission();
      const ok = result === 'granted';
      setGranted(ok);
      if (ok) setSupported(true); else setSupported(false);
      return ok;
    } catch (error) {
      setSupported(false);
      return false;
    }
  }, [needsPermission]);

  // فشل الفحص (لا قراءات) كان يعطّل الميلان للأبد في هذه الجلسة؛ الزر «إعادة تفعيل
  // الميلان» يعيد المحاولة ويطلب الإذن من جديد إن لزم.
  const retry = useCallback(async () => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return false;
    recalibrate();
    setReading(false);
    setSupported(true);
    return request();
  }, [recalibrate, request]);

  useEffect(() => {
    if (!enabled || !supported) return undefined;
    const waiting = needsPermission && !granted; // ما زلنا ننتظر إذن سفاري
    let sawEvent = false;
    armed.current = false;
    samples.current = []; baseline.current = null; setCalibrated(false);
    const onOrientation = (event) => {
      const angle = orientedTilt(event, screenAngle());
      if (!Number.isFinite(angle)) return;
      if (!sawEvent) { sawEvent = true; setReading(true); }
      if (baseline.current === null) {
        samples.current.push(angle);
        if (samples.current.length < TILT_BASELINE_SAMPLES) return;
        baseline.current = tiltBaseline(samples.current);
        setCalibrated(true);
        armed.current = true; // وضع الجبين نفسه هو الوضع المحايد بعد المعايرة
        return;
      }
      if (isNeutral(angle, baseline.current)) { armed.current = true; return; }
      const now = Date.now();
      if (now - lastAt.current < TILT_COOLDOWN_MS) return;
      const decision = tiltDecision(angle, armed.current, baseline.current);
      if (!decision) return;
      armed.current = false;
      lastAt.current = now;
      onDecisionRef.current(decision);
    };
    if (!waiting) window.addEventListener('deviceorientation', onOrientation, true);
    // بعض الأجهزة تسجّل الحدث دون إرسال قيم، وبعضها لا يمنح الإذن أبدًا —
    // المؤقّت يعمل في الحالتين حتى يظهر بديل اللمس بدل شاشة بلا تحكّم.
    const probe = setTimeout(() => { if (!sawEvent) setSupported(false); }, TILT_PROBE_MS);
    return () => { window.removeEventListener('deviceorientation', onOrientation, true); clearTimeout(probe); };
  }, [enabled, supported, granted, needsPermission]);

  return { supported, granted: granted || !needsPermission, needsPermission, reading, calibrated, request, retry, recalibrate };
}
