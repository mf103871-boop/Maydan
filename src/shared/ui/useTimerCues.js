// إشارات المؤقت السمعية من مكان واحد: tick/tickFast في الثواني الأخيرة، اهتزاز في آخرها،
// وعدّ 3-2-1 عند الاستئناف. حلقة المؤقت (Timer.jsx) بصرية فقط، فلا يتكرر صوت الثانية
// بين مكوّن ولعبة، ولا تفوت الثانية الأولى لطلب جديد.
//
//   useTimerCues(timer, api, { last, fastBelow, hapticBelow })
//   last        آخر ثانية تصدر لها إشارة (5 افتراضيًا؛ Infinity لكل ثانية)
//   fastBelow   من هذه الثانية فما دون يُستعمل tickFast بدل tick
//   hapticBelow من هذه الثانية فما دون يهتز الجهاز مع كل ثانية
import { useEffect, useRef } from 'react';

export function useTimerCues(timer, api, { last = 5, fastBelow = 2, hapticBelow = 3 } = {}) {
  const { left, running, paused, resuming } = timer;
  const cued = useRef(null); // آخر ثانية صدرت لها إشارة
  const rest = useRef(null); // الثانية التي توقف عندها المؤقت مؤقتًا (null بعد النهاية أو التصفير)
  useEffect(() => {
    if (!running) {
      cued.current = null;
      rest.current = paused || (resuming !== null && resuming !== undefined) ? left : null;
      return;
    }
    if (rest.current !== null) {
      // العودة من إيقاف مؤقت أو من عدّ 3-2-1 على الثانية نفسها: «انطلق» يكفي ولا نكدّس tick عليه.
      const sameSecond = rest.current === left;
      rest.current = null;
      if (sameSecond) { cued.current = left; return; }
    }
    if (!(left >= 1) || left > last || cued.current === left) return;
    cued.current = left;
    api?.sound?.play(left <= fastBelow ? 'tickFast' : 'tick');
    if (left <= hapticBelow) api?.haptics?.vibrate('tick');
  }, [left, running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (resuming === null || resuming === undefined) return;
    if (resuming > 0) { api?.sound?.play('countdown'); api?.haptics?.vibrate('light'); }
    else { api?.sound?.play('countdownGo'); api?.haptics?.vibrate('medium'); }
  }, [resuming]); // eslint-disable-line react-hooks/exhaustive-deps
}
