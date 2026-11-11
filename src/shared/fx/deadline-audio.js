// A public, server-aligned deadline only. No answer, role or private progress is
// projected. Sparse updates produce one current warning, never missed ticks.
export function createDeadlineAudio(sound, { now = Date.now, warningOnly = false } = {}) {
  let key = null, remaining = null, initialized = false, suspended = false, generation = 0, disposed = false, ownsWarning = false;
  const consumed = new Set();
  const stopWarning = () => { if (ownsWarning) sound?.stopCues?.(['timerWarning']); ownsWarning = false; };
  return {
    update(nextKey, seconds, { active = true, hidden = false } = {}) {
      if (disposed) return;
      if (key !== nextKey) { stopWarning(); key = nextKey; remaining = null; initialized = false; consumed.clear(); generation++; }
      const unavailable = !key || !active || hidden;
      if (unavailable || seconds === 0) stopWarning();
      const baseline = !initialized || suspended || unavailable;
      const before = remaining;
      if (unavailable || suspended) generation++;
      initialized = true; suspended = unavailable; remaining = seconds;
      if (!Number.isInteger(seconds) || seconds < 0 || before === seconds) return;
      // Reconnects/late viewers consume the threshold rather than announcing it.
      if (baseline) { if (seconds <= 5) consumed.add('warning'); if (seconds === 0) consumed.add('timeout'); return; }
      const event = seconds === 0 ? 'timeout' : seconds <= 5 && before > seconds ? 'warning' : null;
      if (!event || consumed.has(event)) return;
      consumed.add(event);
      if (warningOnly && event === 'timeout') return;
      const epoch = generation, currentKey = key;
      const accepted = sound?.emit?.(event === 'timeout' ? 'game.timeout' : 'game.timer-warning', {
        // The visible number is rounded up: its lower bound is a second less.
        deadlineAt: now() + Math.max(0, seconds - 1) * 1000,
        id: `deadline:${currentKey}:${event}`, guard: () => !disposed && !suspended && epoch === generation && key === currentKey,
      });
      if (event === 'warning' && accepted !== false) ownsWarning = true;
    },
    suspend() { generation++; suspended = true; stopWarning(); },
    dispose() { generation++; disposed = true; stopWarning(); },
  };
}
