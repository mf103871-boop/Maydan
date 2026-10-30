const PHASES = Object.freeze({
  role: ['start', 'توزّعت البطاقات', 'deal'],
  opening: ['start', 'بدأ المجلس', 'dawn'],
  night: ['night', 'حلّ الليل', 'night'],
  dawn: ['dawn', 'أشرقت شمس الميدان', 'dawn'],
  discussion: ['discussion', 'الكلمة لكم', 'dawn'],
  nomination: ['nomination', 'من يحتاج إلى دفاع؟', 'verdict'],
  defense: ['defense', 'وقت الدفاع', 'verdict'],
  verdict: ['verdict', 'حان الحكم', 'verdict'],
  over: ['ending', 'انكشفت الحكاية', 'ending'],
});

// One short visual at a time. Initial/reconnected/background snapshots consume
// identities silently. Private reports/roles/targets are never inspected.
export function createMafiaEventEffects({ now = Date.now } = {}) {
  let scope = null, initialized = false, phaseId = null, latestEvent = 0, suspended = false, warnedPhase = null;
  return {
    update(state, { ownerId = '', hidden = false, connected = true, preview = false, remaining = null } = {}) {
      const identity = JSON.stringify([ownerId, state?.code || '', state?.matchId ?? null, state?.scope || 'player']);
      if (identity !== scope) { scope = identity; initialized = false; latestEvent = 0; phaseId = null; warnedPhase = null; }
      const unavailable = hidden || !connected || preview || state?.waiting || !state?.matchId;
      const baseline = !initialized || unavailable || suspended;
      initialized = true; suspended = Boolean(unavailable);
      let publicEffect = null;
      for (const event of state?.log || []) {
        if (!Number.isSafeInteger(event.id) || event.id <= latestEvent) continue;
        latestEvent = event.id;
        if (baseline || !Number.isFinite(event.at) || !Number.isFinite(state.serverNow)) continue;
        const age = state.serverNow - event.at;
        if (age < -250 || age > 2500) continue;
        if (event.type === 'eliminated') publicEffect = { kind: event.reason === 'night' ? 'assassination' : 'elimination', title: event.reason === 'night' ? 'خبر من الليل' : 'أُغلق مقعد في المجلس', scene: 'elimination', caption: 'النتيجة المنشورة محفوظة في السجل.' };
        if (event.type === 'faction_revealed') publicEffect = { kind: 'reveal', title: 'ظهر دليل للمجلس', scene: 'deal', caption: 'اقرأ الكشف المعلن في سجل الأحداث.' };
      }
      const changedPhase = phaseId !== state?.phaseId;
      phaseId = state?.phaseId;
      const warning = Number.isFinite(remaining) && remaining > 0 && remaining <= 10 && warnedPhase !== phaseId;
      if (warning) warnedPhase = phaseId;
      if (baseline) return null;
      const phase = changedPhase && PHASES[state.phase];
      if (!publicEffect && !phase && !warning) return null;
      if (state.phase === 'over' && state.reason && !['faction', 'day_limit', 'time_limit'].includes(state.reason)) return null;
      const effect = publicEffect || (phase ? { kind: phase[0], title: phase[1], scene: phase[2], caption: 'المؤقت مستمر؛ أدواتك متاحة أثناء المشهد.' } : {kind:'clock',title:'بقيت ثوانٍ قليلة',scene:'verdict',caption:'أكمل قرارك؛ وقت الخادم لا يتوقف.'});
      return { ...effect, scope, id: `${scope}:${publicEffect ? `event:${latestEvent}` : warning && !phase ? `clock:${phaseId}` : `phase:${phaseId}`}`, durationMs: effect.kind==='clock'?900:1600, receivedAt: now() };
    },
    suspend() { suspended = true; },
  };
}
