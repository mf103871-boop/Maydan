// Values shared by the browser and the authoritative room server.
export const PROTOCOL = 1;
export const FABRAKA_PROTOCOL = 3;
export const ERSOMHA_PROTOCOL = 1;
export const BADEEHA_PROTOCOL = 1;
export const MAFIA_PROTOCOL = 1;
export const GAME_PROTOCOLS = Object.freeze({ meenfina: PROTOCOL, fabraka: FABRAKA_PROTOCOL, ersomha: ERSOMHA_PROTOCOL, badeeha: BADEEHA_PROTOCOL, mafia: MAFIA_PROTOCOL });
// بَديهة أونلاين: جوال لكل فريق (من فريقين إلى أربعة)، والمؤقت كما في اللعبة على جهاز واحد.
export const BADEEHA_MAX_TEAMS = 4;
export const BADEEHA_TIMERS = Object.freeze([30, 60, 90]);
export const ROOM_CAPABILITIES = Object.freeze({ ersomha: ERSOMHA_PROTOCOL, badeeha: BADEEHA_PROTOCOL, mafia: MAFIA_PROTOCOL });
// تفاعلات سريعة داخل الغرفة: طقم رموز ثابت بلا نص حر، يُبث للحاضرين ولا يُحفظ.
// رسالة `reaction` جديدة لا تكسر عميلًا أقدم (يتجاهل الأنواع التي لا يعرفها)، فلا يُرفع البروتوكول.
export const ROOM_REACTIONS = Object.freeze(['😂', '👏', '😮', '🔥', '😅', '❤️']);
export const REACTION_BURST = 4;
export const REACTION_REFILL_MS = 1500;
// رسّام «ارسمها» صامت أثناء الاختيار والرسم (كتم الميكروفون شرط لبدء دوره)؛ رمز مثل 🔥 يصير تلميحًا.
export function reactionsAllowed(state, seatId) {
  if (state?.game === 'mafia') return ['lobby','over'].includes(state.phase);
  if (!state || state.game !== 'ersomha' || !['select', 'draw'].includes(state.phase)) return true;
  return seatId !== (state.draw?.drawerId ?? state.drawerId);
}
export const ERSOMHA_CATEGORIES = Object.freeze([
  { id: 'animals', label: 'الحيوانات' }, { id: 'nature', label: 'الطبيعة' },
  { id: 'food', label: 'الأطعمة' }, { id: 'home', label: 'المنزل' },
  { id: 'places', label: 'الأماكن' }, { id: 'jobs', label: 'المهن' },
  { id: 'sports', label: 'الرياضة' }, { id: 'transport', label: 'المواصلات' },
  { id: 'technology', label: 'التقنية' }, { id: 'actions', label: 'الأفعال' },
  { id: 'situations', label: 'المواقف الطريفة' }, { id: 'expressions', label: 'التعابير العربية' },
]);
export const ERSOMHA_DEFAULT_SETTINGS = Object.freeze({ cycles: 1, drawSeconds: 60, difficulty: 'easy', categories: [] });
export const ONLINE_GAMES = {
  meenfina: { name: 'مين فينا؟', min: 3, max: 12 },
  fabraka: { name: 'فبركة', min: 2, max: 8 },
  ersomha: { name: 'ارسمها', min: 2, max: 8 },
  badeeha: { name: 'بَديهة', min: 2, max: 4 },
  mafia: { name: 'مافيا ميدان', min: 6, max: 12 },
};
// A personal truth round needs its owner and at least two writers. The other
// Fabraka modes keep a real choice for two players by adding house decoys.
export const minimumOnlinePlayers = (game, settings) => game === 'mafia' ? (settings?.mode === 'shadow' ? 9 : 6) : game === 'ersomha' || game === 'badeeha' || (game === 'fabraka' && settings?.mode !== 'friends') ? 2 : 3;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;
export const ROUND_OPTIONS = [5, 8, 12];
export const VOTE_SECONDS = 30;
// عمر الغرفة: ساعتان من الإنشاء، ويُمدَّد عند كل بداية مباراة إلى ساعتين من تلك اللحظة
// بحد أقصى ست ساعات، فلا تُقطع جلسة بدأت متأخرًا في منتصف جولة.
export const ROOM_TTL = 2 * 60 * 60 * 1000;
export const ROOM_MAX_TTL = 6 * 60 * 60 * 1000;
export const MATCH_EXTENSION = ROOM_TTL;
export const START_MIN_REMAINING = 15 * 60 * 1000;
export const EXPIRY_WARNING = 10 * 60 * 1000;
export const HOST_GRACE = 20_000;
// مقعد منقطع أكثر من هذه المدة لا يُنتظر في الكتابة أو التصويت؛ يعود متى شاء.
export const SEAT_GRACE = 15_000;
export const AVATARS = ['😎', '🦋', '🌟', '🚀'];
// لون لكل مقعد (لا لكل شخصية): الأربعة الأولى كما كانت لتوافق الغرف القائمة، والبقية
// تمنح غرفة من اثني عشر لاعبًا ألوانًا مميزة في لوحة النقاط والمنصة.
export const COLORS = ['#118D96', '#9250BD', '#8651AD', '#A67A21', '#C2503A', '#2E7D4F', '#B0367A', '#3A63B8', '#D0651B', '#1F8A70', '#6B4FB3', '#8C2F39'];
// CLDR now gives the bare `ar` locale Latin digits, so generated numbers used to
// sit next to the hand-written Arabic-Indic ones. Ask for the arab numbering
// system explicitly, and map anything a reduced-ICU build still returns.
const ARABIC_DIGITS = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
export function arabicNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  let text;
  try { text = amount.toLocaleString('ar-EG-u-nu-arab'); } catch { text = String(amount); }
  return text.replace(/[0-9]/g, (digit) => ARABIC_DIGITS[Number(digit)]);
}
export function normalizeCode(value) {
  return String(value ?? '').replace(/[٠-٩۰-۹]/g, (c) => String(c.charCodeAt(0) - (c <= '٩' ? 0x660 : 0x6f0))).replace(/\s/g, '');
}
export function validCode(value) { return /^\d{6}$/.test(value); }
export function validateServerUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return '';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return '';
    return url.origin;
  } catch { return ''; }
}
export function resolveServerUrl(value, pageOrigin = '') {
  return validateServerUrl(value === 'same-origin' ? pageOrigin : value);
}
export const ERRORS = {
  MAFIA_DISABLED: 'مافيا ميدان غير متاحة لبدء مباريات جديدة حاليًا.',
  MAFIA_ACTIVE_ELSEWHERE: 'لديك مقعد مافيا في غرفة أخرى. عُد إليه أو غادره أولًا.',
  MAFIA_NO_ROOMS: 'لا توجد غرفة مناسبة الآن. جرّب مرة أخرى أو أنشئ غرفة.',
  MAFIA_BLOCKED: 'لا يمكن جمع حسابات بينها حظر في هذه الغرفة.',
  MAFIA_UNAVAILABLE: 'تعذّر تجهيز غرفة مافيا. حاول مجددًا بعد قليل.',
  MAFIA_VOICE_UNAVAILABLE: 'تعذّر تأمين قنوات الصوت. لم نفتح قناة سرية.',
  MAFIA_VOICE_CAPACITY: 'غرف مافيا الصوتية مشغولة حاليًا. انتظر انتهاء مباراة ثم جرّب.',
  MAFIA_VOICE_TRANSITION: 'يجري تأمين قناة الصوت للمرحلة الجديدة.',
  MAFIA_VOICE_DEVICE: 'صوت المباراة مفتوح على جهازك الآخر. أغلقه هناك أولًا.',
  MAFIA_VOICE_SESSION: 'انتهت جلسة الاتصال السابقة. اضغط الانضمام للصوت مجددًا.',
  MAFIA_SOCIAL_LOCKED: 'التواصل متاح من داخل مباراة مافيا حتى نهايتها.',
  INVALID: 'تحقق من البيانات وحاول مرة ثانية.',
  NAME: 'اكتب اسمًا من حرف إلى ٢٠ حرفًا.',
  NAME_TAKEN: 'هذا الاسم مستخدم في الغرفة. اختر اسمًا آخر.',
  ACCOUNT_IN_ROOM: 'حسابك موجود في هذه الغرفة بالفعل. عُد إلى مقعدك الحالي.',
  ACCOUNT_SUSPENDED: 'حسابك معلّق. راجع السبب ووسيلة التواصل من الإعدادات.',
  CONTENT_REJECTED: 'يحتوي النص على محتوى غير مسموح. عدّله وحاول مجددًا.',
  FULL: 'الغرفة ممتلئة؛ الحد الأعلى ١٢ لاعبًا.',
  FULL_FABRAKA: 'غرفة فبركة ممتلئة؛ الحد الأعلى ٨ لاعبين.',
  FULL_BADEEHA: 'غرفة بَديهة ممتلئة؛ الحد الأعلى أربعة فرق، جوال لكل فريق.',
  NOT_READY_BADEEHA: 'نحتاج فريقين على الأقل (جوال لكل فريق)، متصلين وجاهزين جميعًا.',
  TURN: 'هذا ليس دور فريقك. المضيف أو الفريق صاحب الدور يختار.',
  CELL: 'لُعب هذا السؤال أو لم يعد في اللوحة.',
  TOOL_USED: 'استعمل فريقك هذه الوسيلة في هذه المباراة.',
  FULL_ERSOMHA: 'غرفة ارسمها ممتلئة؛ الحد الأعلى ٨ لاعبين.',
  GAME: 'هذه اللعبة غير متاحة للغرف. اختر لعبة من قائمة غرف ميدان.',
  UPDATE_REQUIRED: 'هذه الغرفة تحتاج إصدارًا أحدث من ميدان. حدّث التطبيق ثم افتح الدعوة مجددًا.',
  AUTH_REQUIRED: 'سجّل الدخول للانضمام إلى هذه اللعبة وحفظ تقدمك عبر أجهزتك.',
  ERSOMHA_BUSY: 'لديك مباراة ارسمها جارية في غرفة أخرى. عُد إليها أو غادرها قبل البدء هنا.',
  ERSOMHA_EXHAUSTED: 'لا توجد كلمات جديدة كافية لهذه المجموعة. وسّع الفئات أو اختر إعادة الكلمات القديمة بوضوح.',
  ERSOMHA_CONTENT_EXHAUSTED: 'لا توجد كلمات جديدة كافية لهذه المجموعة. وسّع الفئات أو اختر إعادة الكلمات القديمة بوضوح.',
  ERSOMHA_ACTIVE_ELSEWHERE: 'لديك مباراة ارسمها جارية في غرفة أخرى. عُد إليها أو غادرها قبل البدء هنا.',
  ERSOMHA_HISTORY_CONFLICT: 'تغيّر سجل الكلمات أثناء التجهيز. أعد المحاولة لنختار أفكارًا جديدة.',
  ERSOMHA_UNAVAILABLE: 'تعذّر تجهيز ارسمها الآن. أعد المحاولة بعد لحظات.',
  ERSOMHA_CANVAS_LIMIT: 'وصلت اللوحة إلى حدها. يمكنك التراجع أو مسحها للمتابعة.',
  ERSOMHA_CANVAS_STALE: 'تغيّرت اللوحة؛ نزامنها قبل متابعة الرسم.',
  ERSOMHA_CANVAS_UNAVAILABLE: 'تعذّرت مزامنة اللوحة. أعد الاتصال لاسترجاع الرسم المحفوظ.',
  ERSOMHA_DRAWER_ONLY: 'أدوات الرسم متاحة للرسّام الحالي فقط.',
  ERSOMHA_GUESSER_ONLY: 'دورك الآن ترسم؛ أصحابك يتولّون التخمين.',
  LOGIN_REQUIRED: 'سجّل الدخول للعب ارسمها وحفظ الكلمات التي شاهدتها عبر أجهزتك.',
  ERSOMHA_CATEGORIES: 'اختر ثلاث فئات على الأقل لتتنوع خيارات الرسم.',
  DRAWER_ONLY: 'أدوات الرسم متاحة للرسّام الحالي فقط.',
  GUESSED: 'عرفت الحل بالفعل؛ انتظر الكشف وشاهد رسم صاحبك.',
  DRAWING_LIMIT: 'وصلت اللوحة إلى حدها. يمكنك التراجع أو مسحها للمتابعة.',
  DRAWING_SYNC: 'نزامن اللوحة الآن؛ انتظر لحظة قبل متابعة الرسم.',
  HISTORY_UNAVAILABLE: 'تعذّر تجهيز كلمات جديدة الآن. أعد المحاولة؛ لم تبدأ المباراة.',
  ANSWER: 'اكتب إجابة واضحة من حرف إلى ٦٠ حرفًا.',
  SUBMITTED: 'تم تثبيت إجابتك لهذه الجولة بالفعل.',
  OWN_ANSWER: 'لا يمكنك التصويت لإجابة كتبتها بنفسك.',
  OPTION: 'اختر إجابة من خيارات هذه الجولة.',
  HELP_USED: 'استخدمت مساعدتك الوحيدة في هذه اللعبة.',
  NO_HELP: 'لا توجد مساعدة متاحة لهذا السؤال.',
  TRUTH_OWNER: 'هذه الخطوة متاحة لصاحب الحقيقة في هذه الجولة.',
  NO_PROMPT: 'لا توجد أسئلة إضافية للتبديل.',
  QUESTIONS: 'الأسئلة المتاحة لا تكفي لهذه الجولات. وسّع المواضيع المختارة أو اختر «كل الأسئلة».',
  STARTED: 'بدأت اللعبة. يمكنك الانضمام بعد العودة إلى غرفة الانتظار.',
  NOT_FOUND: 'الغرفة غير موجودة أو انتهت. تحقق من الرمز.',
  EXPIRED: 'انتهت صلاحية الغرفة. أنشئ غرفة جديدة.',
  AUTH: 'تعذرت العودة بهذا الجهاز. افتح غرفة جديدة أو انضم باسم آخر بعد انتهاء اللعبة.',
  HOST_ONLY: 'هذا الزر متاح لمضيف الغرفة.',
  NOT_READY: 'نحتاج ٣ لاعبين على الأقل، متصلين وجاهزين جميعًا.',
  NOT_READY_DUO: 'نحتاج لاعبين على الأقل، متصلين وجاهزين جميعًا.',
  TRIAL_OWNER_LEFT: 'منشئ الغرفة غادر قبل بدء المباراة. أنشئوا غرفة جديدة لبدء اللعب.',
  PHASE: 'تغيّرت الجولة. راجع الحالة الحالية وحاول مجددًا.',
  STALE: 'انتهت هذه الجولة. انتظر تحديث الشاشة.',
  VOTED: 'تم اعتماد تصويتك لهذه الجولة بالفعل.',
  TARGET: 'اختر لاعبًا موجودًا في الجولة.',
  RATE_LIMIT: 'طلبات كثيرة خلال وقت قصير. انتظر دقيقة واحدة ثم حاول مجددًا.',
  CREATE_LIMIT: 'أنشأت غرفًا كثيرة من هذا الجهاز. انتظر ١٠ دقائق ثم أنشئ غرفة جديدة، أو ادخل برمز غرفة جاهزة.',
  COLLISION: 'تعذر حجز رمز غرفة فارغ الآن. حاول مرة ثانية بعد لحظات.',
  TARGET_GONE: 'غادر هذا المقعد الغرفة بالفعل. حدّثت القائمة تلقائيًا.',
  BANNED: 'أزال المضيف مقعدك من هذه الغرفة، ولا يمكن العودة إليها.',
  EXPIRING: 'لم يبقَ من عمر الغرفة ما يكفي لمباراة كاملة. أنشئ غرفة جديدة.',
  ORIGIN: 'رابط اللعبة غير مفعّل للاتصال بالغرف.',
  PLUS_REQUIRED: 'هذا التخصيص من ميدان بلس. اللعب وإنشاء الغرف مجانيان.',
  CONFIG: 'حدّث صفحة اللعبة للحصول على أحدث نسخة من الغرف.',
  ROOM_OUTDATED: 'وصلت نسخة أحدث من الغرف أثناء اللعب. مقعدك محفوظ: حدّث لتكمل في الغرفة نفسها.',
  ROOM_OUTDATED_APP: 'وصلت نسخة أحدث من الغرف. حدّث تطبيق ميدان من App Store ثم افتح الغرفة من جديد؛ مقعدك محفوظ.',
  NETWORK: 'تعذر الاتصال. تحقق من الإنترنت وحاول مجددًا.',
  DISCONNECTED: 'انقطع الاتصال. سنحاول العودة تلقائيًا.',
  TIMEOUT: 'لم يصل تأكيد الخادم. انتظر تحديث الحالة قبل المحاولة مجددًا.',
  REPLACED: 'فُتحت الغرفة في تبويب آخر على جهازك. أكمل اللعب هناك أو أعد الاتصال هنا.',
  REMOVED: 'غادرت الغرفة أو أزال المضيف مقعدك من الانتظار.',
  STORAGE: 'المتصفح لا يحفظ الجلسة. أبقِ هذه الصفحة مفتوحة لتحتفظ بمقعدك.',
  INTERNAL: 'حدث خطأ مؤقت. حاول مجددًا.',
};
export function errorText(code) { return ERRORS[code] || ERRORS.INTERNAL; }
