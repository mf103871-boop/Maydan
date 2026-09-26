// حفظ حالة اللعبة على هذا الجهاز كما تفعل فبركة: تغيّر المرحلة يُحفظ فورًا، وما عداه بعد
// ربع ثانية، والإخفاء والخروج يفرّغان ما تأخر. عند انتهاء المباراة تُحذف الجلسة فلا تظهر
// بطاقة «استئناف» لمباراة منتهية. يُعيد هل الحفظ يصل إلى تخزين دائم.
import { useCallback, useEffect, useRef, useState } from 'react';
import { saveSession, clearSession, SESSION_KEY } from '../lib/session.js';

const SAVED_MESSAGE = 'تقدم اللعبة محفوظ على هذا الجهاز. يمكنك استئنافها من شاشة إعدادها عند العودة.';
const UNSAVED_MESSAGE = 'تعذر حفظ آخر تقدم. مغادرة اللعبة أو إغلاق الصفحة قد يفقد هذه الجولة.';

export function useSessionSave({ api, state, snapshot, phaseKey, active, key = SESSION_KEY }) {
  const [saveOk, setSaveOk] = useState(api.storage.persistent !== false);
  const latest = useRef({ state, snapshot, active }); latest.current = { state, snapshot, active };
  const timer = useRef(0);
  const persist = useCallback(() => {
    clearTimeout(timer.current); timer.current = 0;
    const { state: current, snapshot: build, active: live } = latest.current;
    if (!live) return; // مباراة منتهية: لا تُكتب لقطة فوق مفتاح حُذف
    const ok = saveSession(api.storage, build ? build(current) : current, key);
    setSaveOk(ok);
    api.setExitMessage?.(ok ? SAVED_MESSAGE : UNSAVED_MESSAGE);
  }, [api, key]);
  const lastPhase = useRef(null);
  useEffect(() => {
    if (!active) {
      clearTimeout(timer.current); timer.current = 0;
      clearSession(api.storage, key);
      api.setExitMessage?.(null);
      return undefined;
    }
    if (lastPhase.current !== phaseKey) { lastPhase.current = phaseKey; persist(); return undefined; }
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 250);
    return () => clearTimeout(timer.current);
  }, [state, phaseKey, active, persist, api, key]);
  useEffect(() => {
    if (!active) return undefined;
    // الإخفاء يحفظ دائمًا: الوقت المتبقي في المؤقت لا يغيّر الحالة فلا يطلق حفظًا مؤجلًا.
    const flush = () => { if (document.hidden) persist(); };
    document.addEventListener('visibilitychange', flush); window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush);
      persist();
    };
  }, [active, persist]);
  return saveOk;
}
