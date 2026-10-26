// Public rules only. Role assignments and all night choices live on the server.
export const MAFIA_PROTOCOL = 1;
export const MAFIA_RULESET_VERSION = 1;
export const MAFIA_DEFAULT_SETTINGS = Object.freeze({ mode: 'classic', capacity: 8, visibility: 'private' });
export const MAFIA_TIMERS = Object.freeze({ role: 10, opening: 45, night: 35, dawn: 8, discussion: 90, shadowDiscussion: 120, nomination: 20, defense: 20, verdict: 15 });
export const MAFIA_RECONNECT_MS = 90_000;
export const MAFIA_MAX_DAYS = 8;
export const MAFIA_MAX_MATCH_MS = 30 * 60_000;
export const MAFIA_FACTIONS = Object.freeze({ town: 'أهل الميدان', mafia: 'المافيا', shadow: 'رابطة الظل' });
export const MAFIA_PHASES = Object.freeze({ lobby: 'الاستعداد', role: 'دورك السري', opening: 'التعارف', night: 'الليل', dawn: 'الفجر', discussion: 'النقاش', nomination: 'الترشيح', defense: 'الدفاع', verdict: 'الحكم', over: 'النتيجة', closed: 'انتهت الغرفة' });
const role = (id, name, faction, description, ability = null, charges = null) => Object.freeze({ id, name, faction, description, ability, charges });
export const MAFIA_ROLES = Object.freeze({
  citizen: role('citizen', 'المواطن', 'town', 'استمع، اربط الأدلة وصوّت. لا تملك قدرة ليلية.'),
  investigator: role('investigator', 'المحقق', 'town', 'تحقق من انتماء لاعب مرتين. قد يضللك التمويه، وقد يتغير انتماؤه بعد التقرير.', 'investigate', 2),
  doctor: role('doctor', 'الطبيب', 'town', 'احم لاعبًا كل ليلة. لا تحم الشخص نفسه ليلتين متتاليتين، ونفسك مرة واحدة.', 'protect'),
  guard: role('guard', 'الحارس', 'town', 'تنجو تلقائيًا من أول هجوم غير محمي تتعرض له.', 'shield', 1),
  observer: role('observer', 'المراقب', 'town', 'مرتان: تعرف هل قدّم لاعب فعلًا ليليًا غير معطّل، دون معرفة نوعه أو نجاحه.', 'observe', 2),
  reporter: role('reporter', 'المراسل', 'town', 'مرة واحدة: اكشف للجميع انتماء لاعب مقصي كما كان لحظة إقصائه.', 'report', 1),
  herald: role('herald', 'المنادي', 'town', 'مرة واحدة: مدّد نقاش النهار عشرين ثانية. استخدام القدرة لا يثبت انتماءك.', 'extend', 1),
  analyst: role('analyst', 'المحلل', 'town', 'مرة واحدة: قارن الانتماء الظاهر للاعبين آخرين، مع احتمال التمويه.', 'compare', 1),
  mafia: role('mafia', 'عضو المافيا', 'mafia', 'تعاون ليلًا مع المافيا واختاروا هدف الهجوم. التعادل يلغي الهجوم.', 'attack'),
  masker: role('masker', 'المموّه', 'mafia', 'مرة واحدة: اجعل نفسك أو حليفًا يبدو من أهل الميدان في تحقيقات هذه الليلة.', 'mask', 1),
  blocker: role('blocker', 'المعطّل', 'mafia', 'مرة واحدة: عطّل قدرة نشطة للاعب خارج المافيا لليلة. لا تمنع دفاعه السلبي.', 'block', 1),
  leader: role('leader', 'قائد الرابطة', 'shadow', 'ثلاث محاولات على الأكثر في الليالي ٢ و٤ و٦ لتجنيد أحد أهل الميدان. المقصي لا يُجنّد.', 'recruit', 3),
});
export const MAFIA_ROLE_LIST = Object.freeze(Object.values(MAFIA_ROLES));
export const MAFIA_SUPPORT_ROLES = Object.freeze(['guard', 'observer', 'reporter', 'herald', 'analyst']);
export function mafiaComposition(count) {
  if (!Number.isInteger(count) || count < 6 || count > 12) return null;
  const mafia = count === 6 ? 1 : count >= 11 ? 3 : 2;
  const shadow = count >= 9 ? 1 : 0;
  const support = count < 8 ? 0 : count < 10 ? 1 : count < 12 ? 2 : 3;
  return { mafia, shadow, town: count - mafia - shadow, support };
}
export const composition = mafiaComposition;
export function normalizeMafiaSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const mode = input.mode ?? MAFIA_DEFAULT_SETTINGS.mode;
  const capacity = input.capacity ?? (mode === 'shadow' ? 10 : 8);
  const visibility = input.visibility ?? 'private';
  if (!['classic', 'shadow'].includes(mode) || !['private', 'public'].includes(visibility) || !Number.isInteger(capacity) || capacity < (mode === 'shadow' ? 9 : 6) || capacity > (mode === 'shadow' ? 12 : 8)) return null;
  return { mode, capacity, visibility };
}
export function mafiaMinimumPlayers(mode) { return mode === 'shadow' ? 9 : 6; }
