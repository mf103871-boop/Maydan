import { useState, useRef, useCallback, useEffect } from 'react';
// يعيد [className, react]: react('clay-jump' | 'clay-wiggle' | 'clay-squash') يضع الصنف على الحامل ≤700ms ثم يزيله.
// الإزالة ثم الإضافة في إطار لاحق تعيد تشغيل الحركة حتى لو تكرر الصنف نفسه.
export function useReaction() {
  const [cls, setCls] = useState(''); const t = useRef(0);
  const react = useCallback((name, ms = 700) => { clearTimeout(t.current); setCls(''); requestAnimationFrame(() => { setCls(name); t.current = setTimeout(() => setCls(''), ms); }); }, []);
  useEffect(() => () => clearTimeout(t.current), []);
  return [cls, react];
}
