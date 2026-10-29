// Public rules only. Role assignments and all night choices live on the server.
export const MAFIA_PROTOCOL = 2;
export const supportsMafiaProtocol = (capability, protocol = 1) => [1,2].includes(protocol) && [1,2].includes(capability) && capability >= protocol;
export const MAFIA_RULESET_VERSION = 1;
export const MAFIA_DEFAULT_SETTINGS = Object.freeze({ mode: 'classic', capacity: 8, visibility: 'public', roomName: '', community: 'ar', voiceMode: 'optional' });
export const MAFIA_TIMERS = Object.freeze({ role: 10, opening: 45, night: 35, dawn: 8, discussion: 90, shadowDiscussion: 120, nomination: 20, defense: 20, verdict: 15 });
export const MAFIA_RECONNECT_MS = 90_000;
export const MAFIA_MAX_DAYS = 8;
export const MAFIA_MAX_MATCH_MS = 30 * 60_000;
export const MAFIA_FACTIONS = Object.freeze({ town: 'أهل الميدان', mafia: 'المافيا', shadow: 'رابطة الظل' });
export const MAFIA_PHASES = Object.freeze({ lobby: 'الاستعداد', role: 'دورك السري', opening: 'التعارف', night: 'الليل', dawn: 'الفجر', discussion: 'النقاش', nomination: 'الترشيح', defense: 'الدفاع', verdict: 'الحكم', over: 'النتيجة', closed: 'انتهت الغرفة' });
// Public explanations describe the rules, never the roles or choices drawn in a room.
// Keep the machine-readable contract beside the labels used by both card and guide.
export const MAFIA_ROLE_GUIDE_VERSION = 1;
const freezeGuide = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeGuide); Object.freeze(value); }
  return value;
};
const nightSelection = { editable: true, cancellable: true, until: 'night_close', description: 'غيّر أو ألغِ اختيارك حتى إغلاق الليل على الخادم.' };
const nightConsumption = { when: 'night_close', description: 'يُستهلك الاختيار المثبت عند إغلاق الليل، ولو عُطّل أو فشل.' };
const noSelection = { editable: false, cancellable: false, until: null, description: 'لا تختار هدفًا.' };
const livingOther = ['living_other', 'لاعب حي آخر.'];
const privateReport = ['private', 'تقرير خاص إن بقيت حيًا عند الحسم.'];
const secretEffect = ['secret', 'الاختيار وأثر القدرة لا يعلنان للمجلس.'];
const sharedAttack = 'تشارك أيضًا في هجوم المافيا كل ليلة، حتى بعد موت العضو العادي.';
// Compact tuples avoid repeating public schema keys in the shipped document.
// target = [scope, label, count=1, self=false]; evidence/visibility = [kind, label].
const guide = (timing, target, evidence, visibility, limitations, interactions, example, options = {}) => ({
  phase: options.phase || 'night', timing,
  targets: { scope: target[0], count: target[2] ?? 1, self: Boolean(target[3]), description: target[1] },
  evidence: { kind: evidence[0], description: evidence[1] }, visibility: { kind: visibility[0], description: visibility[1] },
  selection: options.selection || nightSelection, consumption: options.consumption || nightConsumption,
  limitations, interactions, example,
});
export const MAFIA_ROLE_GUIDES = freezeGuide({
  citizen: guide('نقاش النهار والترشيح والحكم؛ لا فعل ليلي.', ['none', 'لا هدف خاص؛ التصويت العام متاح للأحياء.', 0],
    ['none', 'تستدل بالأخبار والادعاءات؛ لا تقرير خاص.'], ['none', 'دورك سري.'],
    ['لا اختيار ليلي.'], ['التجنيد يغيّر فريق فوزك، ويبقى دورك مواطنًا.'],
    '«أنا محقق» ادعاء؛ اسأل صاحبه عن الليلة والدليل.',
    { phase: 'none', selection: noSelection, consumption: { when: 'none', description: 'لا شحنات؛ التصويت يتبع المرحلة والحياة.' } }),
  investigator: guide('تحقيقان ليلًا؛ التقرير بعد الحسم.', livingOther,
    ['apparent_faction', 'الفصيل الظاهر في تلك الليلة، دون اسم الدور.'], privateReport,
    ['أهل الميدان ليست براءة دائمة.'], ['التمويه يُظهر المافيا من أهل الميدان.', 'الفحص بعد تجنيد الليلة؛ قد يتغير الولاء لاحقًا.'],
    'تحقيق الليلة الأولى لا يبرئ هدفًا جُنّد بعدها.'),
  doctor: guide('حماية كل ليلة؛ نفسك مرة بالمباراة.', ['living_protection', 'حي، ونفسك مرة؛ باستثناء هدف الليلة السابقة.', 1, true],
    ['protection', 'تمنع هجوم الليلة، دون كشف الدور أو سبب غياب الضحية.'], secretEffect,
    ['لا تكرر الهدف ليلتين متتاليتين؛ ليلة بلا اختيار تفصل بين حمايتين.'], ['التعطيل يمنع الحماية.', 'الحماية تسبق درع الحارس فتحفظه، ولا تمنع التجنيد.'],
    'حميت ليان؛ الليلة التالية غيّر الهدف أو امتنع، ثم يمكن حمايتها.',
    { consumption: { when: 'night_close', description: 'يثبت الهدف ويُخصم دفاع النفس عند إغلاق الليل، ولو عُطّلت.' } }),
  guard: guide('درع تلقائي لأول هجوم غير محمي.', ['self', 'نفسك فقط.', 0, true],
    ['shield', 'إشعار باستهلاك درعك.'], ['private', 'الإشعار لك؛ لا يعلن سبب نجاتك.'],
    ['درع واحد؛ لا يتجدد.'], ['التعطيل لا يمنع الدرع، وحماية الطبيب تحفظه.', 'الدرع لا يمنع التجنيد.'],
    'حماك الطبيب من هجوم؛ درعك باقٍ للهجوم غير المحمي التالي.',
    { phase: 'passive', selection: noSelection, consumption: { when: 'unprotected_attack', description: 'عند هجوم لم تمنعه حماية الطبيب.' } }),
  observer: guide('مراقبتان ليلًا.', livingOther,
    ['accepted_activity', 'هل قدّم فعلًا ليليًا مقبولًا غير معطّل؛ دون نوعه أو هدفه أو نجاحه.'], privateReport,
    ['النشاط لا يحدد الفريق؛ غيابه لا يكذّب ادعاء دور.'], ['اختيار هجوم المافيا نشاط؛ الفعل المعطّل لا يُحسب.'],
    'تحرك عمر؛ قد يكون محققًا أو طبيبًا أو مافيا.'),
  reporter: guide('كشف واحد؛ اختر مقصيًا ليلًا.', ['eliminated', 'مقصي له فصيل مسجل عند الإقصاء.'],
    ['faction_at_death', 'فصيله الحقيقي لحظة الإقصاء، لا دوره أو ولاؤه السابق.'], ['public_anonymous', 'إعلان للجميع بلا اسم المراسل؛ المصدر يُكشف بالنهاية.'],
    ['لا يكشف حيًا أو اسم الدور.'], ['التعطيل يمنع الإعلان؛ التمويه لا يغيّر السجل.', 'يُنفذ الاختيار ولو مات المراسل بهجوم الليلة نفسها.'],
    'مقصي من الظل؛ قد يكون بدأ من أهل الميدان.'),
  herald: guide('تمديد النقاش ٢٠ ثانية مرة واحدة.', ['none', 'النقاش الحالي؛ دون هدف.', 0],
    ['public_extension', 'تمديد وقت، دون إثبات الفريق.'], ['public_named', 'اسم المستخدم معلن.'],
    ['لا يعمل بالافتتاح أو الدفاع أو الحكم.'], ['يبقى متاحًا بعد التجنيد.'], 'مدّدت النقاش؛ عرفوا اسمك دون ولائك.',
    { phase: 'discussion', selection: { editable: false, cancellable: false, until: null, description: 'ينفذ فور التأكيد ولا يُلغى.' }, consumption: { when: 'activation', description: 'فور تنفيذ التمديد.' } }),
  analyst: guide('مقارنة ليلية واحدة.', ['living_other_pair', 'حيان آخران مختلفان.', 2],
    ['apparent_faction_comparison', 'متطابق أو مختلف بالفصيل الظاهر؛ دون تسمية الفصائل.'], privateReport,
    ['الاختلاف لا يحدد الخصم أو فصيل كل هدف.'], ['التمويه يؤثر فيها؛ التجنيد يُحسم قبلها.'],
    'ليان وعمر مختلفان؛ يلزم دليل آخر لتحديد الخصم.'),
  mafia: guide('هجوم مشترك كل ليلة.', ['living_non_mafia', 'حي خارج المافيا.'],
    ['team_attack_ballot', 'ترى اختيارات الحلفاء الأحياء حتى إغلاق الليل.'], ['team', 'الاختيارات للفريق؛ العامة تعرف إقصاءً أو ليلة هادئة.'],
    ['تعادل أعلى الأهداف أو غيابها يلغي الهجوم.'], ['الطبيب والدرع قد يمنعان القتل.', 'المموّه والمعطّل يهاجمان حتى بعد موت العضو العادي.'],
    'تعادل اختيار ليان وعمر؛ لا هجوم حتى يُحسم قبل الإغلاق.',
    { consumption: { when: 'none', description: 'بلا شحنات؛ يُهاجم أعلى هدف منفرد بالاختيارات.' } }),
  masker: guide('تمويه ليلي واحد.', ['living_mafia', 'نفسك أو حليف مافيا حي.', 1, true],
    ['apparent_faction_override', 'يبدو الهدف من أهل الميدان لهذه الليلة فقط.'], secretEffect,
    ['لا يغيّر الفصيل الحقيقي أو الفوز.'], ['يؤثر في المحقق والمحلل، دون نشاط المراقب أو سجل المراسل.', sharedAttack],
    'بدا حليفك بريئًا بالتحقيق؛ بقي مافيا لحسم الفوز.'),
  blocker: guide('تعطيل ليلي واحد.', ['living_non_mafia', 'حي خارج المافيا.'],
    ['active_ability_block', 'يمنع قدرة الهدف النشطة لهذه الليلة.'], ['secret', 'اسمك سري؛ قد يتلقى صاحب التقرير «بلا نتيجة».'],
    ['لا يمنع التصويت أو النقاش أو الدرع.'], ['يمنع الحماية والتحقيق والمقارنة والمراقبة والإعلان والتجنيد؛ الشحنة المثبتة تُستهلك.', sharedAttack],
    'تعطيل الطبيب يمنع الحماية؛ تعطيل الحارس لا يكسر الدرع.'),
  leader: guide('ثلاث محاولات، بالليالي ٢ و٤ و٦ فقط.', ['living_non_shadow_other', 'حي آخر خارج الرابطة، ولو جهلت فصيله.'],
    ['recruitment_success', 'نجاح أو فشل دون كشف السبب.'], ['team_private', 'التقرير للقائد؛ أعضاء الرابطة الأحياء والمجند يعرفون حلفاءهم، دون إعلان للمجلس.'],
    ['ينجح على أهل الميدان فقط مع بقاء القائد والهدف حيّين.', 'موت القائد يوقف التجنيد ولا يعيد المجندين.'],
    ['المجند يحتفظ بدوره ورصيده.', 'التعطيل يمنعه؛ الحماية والدرع لا يمنعانه.', 'القائمة لا تكشف المافيا؛ اختيارها يفشل دون سبب.'],
    'جُنّد محقق له تحقيق باقٍ؛ يحتفظ به ويفوز مع الرابطة.'),
});
const role = (id, name, faction, description, ability = null, charges = null) => Object.freeze({ id, name, faction, description, ability, charges, guide: MAFIA_ROLE_GUIDES[id] });
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
  const visibility = input.visibility ?? 'public';
  const community = input.community ?? 'ar', voiceMode = input.voiceMode ?? 'optional';
  if (typeof (input.roomName ?? '') !== 'string') return null;
  const roomName = (input.roomName ?? '').normalize('NFKC').trim().replace(/\s+/g,' ');
  if (Array.from(roomName).length > 30 || /[\p{Cc}\p{Cf}]/u.test(roomName) || community !== 'ar' || !['optional','off'].includes(voiceMode)) return null;
  if (!['classic', 'shadow'].includes(mode) || !['private', 'public'].includes(visibility) || !Number.isInteger(capacity) || capacity < (mode === 'shadow' ? 9 : 6) || capacity > (mode === 'shadow' ? 12 : 8)) return null;
  return { mode, capacity, visibility, roomName, community, voiceMode };
}
export function mafiaMinimumPlayers(mode) { return mode === 'shadow' ? 9 : 6; }
