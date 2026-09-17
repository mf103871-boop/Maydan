// Values shared by the browser and the authoritative room server.
export const PROTOCOL = 1;
export const FABRAKA_PROTOCOL = 3;
export const ONLINE_GAMES = {
  meenfina: { name: 'مين فينا؟', min: 3, max: 12 },
  fabraka: { name: 'فبركة', min: 3, max: 8 },
};
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;
export const ROUND_OPTIONS = [5, 8, 12];
export const VOTE_SECONDS = 30;
export const ROOM_TTL = 2 * 60 * 60 * 1000;
export const HOST_GRACE = 20_000;
export const AVATARS = ['😎', '🦋', '🌟', '🚀'];
export const COLORS = ['#118D96', '#9250BD', '#8651AD', '#A67A21'];
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
  INVALID: 'تحقق من البيانات وحاول مرة ثانية.',
  NAME: 'اكتب اسمًا من حرف إلى ٢٠ حرفًا.',
  NAME_TAKEN: 'هذا الاسم مستخدم في الغرفة. اختر اسمًا آخر.',
  FULL: 'الغرفة ممتلئة؛ الحد الأعلى ١٢ لاعبًا.',
  FULL_FABRAKA: 'غرفة فبركة ممتلئة؛ الحد الأعلى ٨ لاعبين.',
  GAME: 'هذه اللعبة غير متاحة للغرف. اختر مين فينا أو فبركة.',
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
  PHASE: 'تغيّرت الجولة. راجع الحالة الحالية وحاول مجددًا.',
  STALE: 'انتهت هذه الجولة. انتظر تحديث الشاشة.',
  VOTED: 'تم اعتماد تصويتك لهذه الجولة بالفعل.',
  TARGET: 'اختر لاعبًا موجودًا في الجولة.',
  RATE_LIMIT: 'طلبات كثيرة خلال وقت قصير. انتظر دقيقة واحدة ثم حاول مجددًا.',
  CREATE_LIMIT: 'أنشأت غرفًا كثيرة من هذا الجهاز. انتظر ١٠ دقائق ثم أنشئ غرفة جديدة، أو ادخل برمز غرفة جاهزة.',
  COLLISION: 'تعذر حجز رمز غرفة فارغ الآن. حاول مرة ثانية بعد لحظات.',
  TARGET_GONE: 'غادر هذا المقعد الغرفة بالفعل. حدّثت القائمة تلقائيًا.',
  ORIGIN: 'رابط اللعبة غير مفعّل للاتصال بالغرف.',
  PLUS_REQUIRED: 'إنشاء الغرف بعد الغرفة المجانية يحتاج إلى ميدان بلس.',
  CONFIG: 'حدّث صفحة اللعبة للحصول على أحدث نسخة من الغرف.',
  NETWORK: 'تعذر الاتصال. تحقق من الإنترنت وحاول مجددًا.',
  DISCONNECTED: 'انقطع الاتصال. سنحاول العودة تلقائيًا.',
  TIMEOUT: 'لم يصل تأكيد الخادم. انتظر تحديث الحالة قبل المحاولة مجددًا.',
  REPLACED: 'فُتحت الغرفة في تبويب آخر على جهازك. أكمل اللعب هناك أو أعد الاتصال هنا.',
  REMOVED: 'غادرت الغرفة أو أزال المضيف مقعدك من الانتظار.',
  STORAGE: 'المتصفح لا يحفظ الجلسة. أبقِ هذه الصفحة مفتوحة لتحتفظ بمقعدك.',
  INTERNAL: 'حدث خطأ مؤقت. حاول مجددًا.',
};
export function errorText(code) { return ERRORS[code] || ERRORS.INTERNAL; }
