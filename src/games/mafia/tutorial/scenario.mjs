export * from './version.mjs';

// Fictional, local-only lesson data. This roster is never a live room input.
export const TUTORIAL_HUMAN_ID = 'tutorial-human';
export const TUTORIAL_ACTORS = Object.freeze([
  { id: TUTORIAL_HUMAN_ID, name: 'أنت', roleId: 'investigator', avatar: 0 },
  { id: 'tutorial-doctor', name: 'ليان', roleId: 'doctor', avatar: 1 },
  { id: 'tutorial-guard', name: 'عمر', roleId: 'guard', avatar: 2 },
  { id: 'tutorial-citizen-1', name: 'نور', roleId: 'citizen', avatar: 3 },
  { id: 'tutorial-citizen-2', name: 'سامر', roleId: 'citizen', avatar: 0 },
  { id: 'tutorial-citizen-3', name: 'هالة', roleId: 'citizen', avatar: 1 },
  { id: 'tutorial-mafia', name: 'سليم', roleId: 'mafia', avatar: 2 },
  { id: 'tutorial-masker', name: 'مازن', roleId: 'masker', avatar: 3 },
].map(Object.freeze));

// Versioned Fisher–Yates choices, not a persisted seed or a client command.
// Tests pin the semantic roster/outcomes; an engine shuffle change requires a
// reviewed lesson update, never a silent assignment to a different human role.
export function tutorialRandomWord() {
  const words = [0, 4, 3, 2, 1, 3, 2, 2, 2, 3, 2, 1];
  let index = 0;
  return () => {
    if (index >= words.length) throw new Error('TUTORIAL_RULESET_CHANGED');
    return words[index++];
  };
}

const lesson = (title, text, target, mode = 'guide', extra = {}) => Object.freeze({ title, text, target, mode, ...extra });
export const TUTORIAL_LESSONS = Object.freeze({
  welcome: lesson('أول ليلة في الميدان', 'هذه مباراة تدريب كاملة مع سبع شخصيات مكتوبة مسبقًا. نجرّب أول قرار معًا، ثم تعتمد على قرائنك. لا ميكروفون ولا لاعبين حقيقيين هنا.', 'coach', 'guide', { event: 'continue', buttonLabel: 'خلّينا نبدأ' }),
  'lobby-chat': lesson('سلّم على المجلس', 'اكتب رسالة قصيرة من خانة المحادثة. لا تغادر رسالتك هذا الجهاز ولا تُحفظ ضمن نقطة الاستكمال.', 'chat', 'practice'),
  'lobby-voice': lesson('جرّب تحكم الصوت', 'انضم للصوت التجريبي ثم افتح الكتم مرة واحدة. هذا زر محاكاة فقط؛ لن نطلب الميكروفون ولن نغيّر أي مكالمة حقيقية.', 'voice', 'practice'),
  'lobby-ready': lesson('أنا جاهز', 'اضغط «أنا جاهز». في الغرفة الحقيقية ينتظر المضيف اتصال اللاعبين وجاهزيتهم.', 'ready', 'practice'),
  'lobby-start': lesson('ابدأ المجلس', 'الجميع جاهز الآن. ابدأ المباراة من زرها الحقيقي.', 'start', 'practice'),
  'role-open': lesson('افتح دورك الخاص', 'بطاقتك تخصك وحدك. افتحها لتتعرف إلى المحقق وشحنتي التحقيق.', 'role', 'practice'),
  'role-close': lesson('احتفظ بسرّك', 'أغلق البطاقة بعد قراءتها. ادعاء لاعب أنه طبيب أو محقق لا يثبت دوره.', 'role-close', 'practice'),
  opening: lesson('اقرأ قبل الحكم', 'اقرأ التعارف القصير. الشخصيات هنا تدريبية، وفي المباراة الحقيقية يكتب اللاعبون ويتحدثون بأنفسهم.', 'chat', 'guide', { event: 'continue', buttonLabel: 'إلى الليلة الأولى' }),
  'night-1-intro': lesson('تحقيقك الأول', 'الليل للقدرات السرية. سنفحص سليم هذه المرة؛ تقرير المحقق لا يظهر لباقي المجلس.', 'ability', 'guide', { event: 'continue', buttonLabel: 'جرّب التحقيق' }),
  'night-1-pick': lesson('افحص سليم', 'اختر سليم ثم اعتمد اختيار الليل. نكمل بقية الوقت تلقائيًا بعد تأكيدك.', 'ability', 'guide', { expectedTargetId: 'tutorial-mafia', event: 'continue', buttonLabel: 'شغّل مؤقت التجربة' }),
  'night-1-result': lesson('تقرير خاص وفجر هادئ', 'افتح أدلتك واقرأ تقرير سليم. لم يُقص أحد هذه الليلة؛ الخبر العام لا يخبرنا بمن حمى مَن ولا بسبب النجاة.', 'clues', 'review', { event: 'continue', buttonLabel: 'إلى النقاش' }),
  'discussion-1': lesson('من يستحق الشك؟', 'راجع تقريرك وحديث المجلس. لاحظ كيف يدافع مازن عن سليم بيقين دون تقديم دليل.', 'chat', 'guide', { event: 'continue', buttonLabel: 'إلى الترشيح' }),
  'nomination-1': lesson('رشّح بناءً على التقرير', 'رشّح سليم ثم أكّد. الترشيح يختار من سيدافع عن نفسه؛ لا يقصيه وحده.', 'ability', 'guide', { expectedTargetId: 'tutorial-mafia', event: 'continue', buttonLabel: 'شغّل مؤقت الترشيح' }),
  'defense-1': lesson('حق الدفاع', 'اقرأ دفاع المرشح. خلال هذه المرحلة يستطيع المرشح وحده الكتابة للأحياء؛ لا تقاطعه.', 'chat', 'guide', { event: 'continue', buttonLabel: 'إلى الحكم' }),
  'verdict-1': lesson('نحتاج أكثر من النصف', 'ثمانية أحياء يعني أن أربعة أصوات لا تكفي. قرر بناءً على تحقيقك؛ الإقصاء يحتاج خمسة أصوات على الأقل.', 'verdict', 'guide', { event: 'continue', buttonLabel: 'شغّل مؤقت الحكم' }),
  'verdict-1-result': lesson('حُسم الحكم', 'خمسة أصوات من ثمانية أقصت المرشح. الأدوار لا تُكشف تلقائيًا عند الإقصاء؛ تقريرك الخاص هو دليل انتمائه هنا.', 'events', 'review', { event: 'continue', buttonLabel: 'إلى الليلة الثانية' }),
  'night-2-intro': lesson('دورك تجمع القرائن', 'بقي تحقيق واحد. تذكّر من دافع عن سليم دون دليل، ثم افحص الشخص الأنسب. لن نحدد الهدف لك هذه المرة.', 'ability', 'practice', { event: 'continue', buttonLabel: 'أختار بنفسي' }),
  'night-2-pick': lesson('استخدم شحنتك الأخيرة', 'اختر هدف التحقيق اعتمادًا على النقاش السابق، ثم اعتمد اختيارك. يمكنك مراجعة الأدلة والرسائل قبل القرار.', 'ability', 'practice', { event: 'continue', buttonLabel: 'شغّل مؤقت التحقيق' }),
  'night-2-result': lesson('المقصي لا يقاطع الأحياء', 'أُقصيت هالة. تبقى قادرة على متابعة النقاش العام، لكنها لا ترسل كلامًا للأحياء. افتح أدلتك لترى نتيجة تحقيقك الأخير.', 'clues', 'review', { event: 'continue', buttonLabel: 'إلى النقاش الأخير' }),
  'discussion-2': lesson('اجمع النتيجتين', 'اقرأ التقرير الأخير وراجع تناقضات الكلام. لم تعد لديك شحنات، لكن ما تعلمته يكفي لقرارك.', 'chat', 'practice', { event: 'continue', buttonLabel: 'إلى الترشيح' }),
  'nomination-2': lesson('من سترشح الآن؟', 'اختر المرشح الذي تدعمه نتيجة التحقيق، ثم أكّد. القرار هذه المرة لك.', 'ability', 'practice', { event: 'continue', buttonLabel: 'شغّل مؤقت الترشيح' }),
  'defense-2': lesson('ادعاء أم دليل؟', 'اقرأ الدفاع الأخير وقارنه بتقريرك الخاص.', 'chat', 'review', { event: 'continue', buttonLabel: 'إلى الحكم الأخير' }),
  'verdict-2': lesson('أغلبية ستة أحياء', 'بقي ستة لاعبين. الإقصاء يحتاج أكثر من ثلاثة أصوات. استخدم الدليل الذي جمعته.', 'verdict', 'practice', { event: 'continue', buttonLabel: 'شغّل مؤقت الحكم' }),
  ending: lesson('أهل الميدان فازوا', 'الآن فقط تُكشف التشكيلة. ليان حمت نور في الليلة الأولى، ثم حمت سامر في الثانية. مازن لم يستخدم التمويه في هذا الدرس. هذه نتيجة تدريبية بلا إحصاءات أو مكافآت.', 'results', 'review', { event: 'continue', buttonLabel: 'راجع ما تعلمته' }),
  'quiz-majority': lesson('فحص سريع: الأغلبية', 'إذا بقي ستة أحياء، كم موافقة يحتاج الإقصاء؟', 'coach', 'practice', { choices: [{ id: 'three', label: 'ثلاثة' }, { id: 'four', label: 'أربعة' }, { id: 'all', label: 'الجميع' }] }),
  'quiz-information': lesson('فحص سريع: المعلومة', 'هل تقرير المحقق ضمان أن انتماء اللاعب صحيح وإلى الأبد؟', 'coach', 'practice', { choices: [{ id: 'certain', label: 'نعم، التقرير إثبات دائم' }, { id: 'dated', label: 'لا؛ التمويه قد يضلله والانتماء قد يتغير' }] }),
  shadow: lesson('رابطة الظل باختصار', 'في غرف ٩–١٢ يظهر طرف ثالث يستطيع تجنيد بعض أهل الميدان في ليالٍ محددة. يحتفظ المتحوّل بقدرته، ويتغير فريقه؛ لذلك للتقرير تاريخ. لا يوجد إحياء ضمن أدوار ميدان الحالية.', 'coach', 'review', { event: 'continue', buttonLabel: 'تعرف إلى بقية الأدوار' }),
  encyclopedia: lesson('موسوعة الأدوار', 'افتح الدليل وراجع الأدوار الاثني عشر، ثم ارجع. وجود دور في الموسوعة لا يعني أنه موزع في مباراتك.', 'guide', 'review'),
  complete: lesson('جاهز لأول مجلس', 'أنهيت التدريب. الأزرار والقواعد نفسها تنتظرك في الغرف الحقيقية، ويمكنك إعادة هذا الدرس لاحقًا.', 'coach', 'review'),
});

export const TUTORIAL_DIALOGUE = Object.freeze({
  opening: [['tutorial-citizen-1', 'آخر مرة شفت سليم كان عند باب المجلس.'], ['tutorial-mafia', 'كنت مع مازن طول الوقت.'], ['tutorial-doctor', 'الكلام لحاله مش دليل. خلينا نسمع الكل.'], ['tutorial-guard', 'نرتب الشكوك ونتأكد قبل الحكم.']],
  'discussion-1': [['tutorial-masker', 'سليم بريء أكيد، لا تضيعوا وقتنا عليه.'], ['tutorial-citizen-2', 'كيف تأكدت يا مازن قبل ما نسمع نتيجة التحقيق؟'], ['tutorial-citizen-1', 'الادعاء مش إثبات. خلينا نجمع الأدلة.']],
  'defense-1': [['tutorial-mafia', 'وجودي عند الباب مش دليل. أنا من أهل الميدان.']],
  'discussion-2': [['tutorial-masker', 'أنا ما حكيت إني متأكد من سليم!'], ['tutorial-citizen-2', 'رسالتك لسه موجودة: قلت بريء أكيد.'], ['tutorial-guard', 'خلينا نقارن هذا الكلام بالأدلة.']],
  'defense-2': [['tutorial-masker', 'التناقض بالكلام مش كفاية. إذا عندكم تقرير راجعوه.']],
});
