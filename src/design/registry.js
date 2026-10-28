import { DESIGN_RENDERED_NODE_IDS, DESIGN_CONDITIONAL_NODE_REASONS } from './coverage-map.js';
// Semantic IDs are a public layout contract. Keep them stable across releases;
// saved designs must never depend on CSS classes, translated text or DOM order.
export const DESIGN_REGISTRY_VERSION = 1;

const protectedContainers = new Set(['content','actions','header','topbar','room-actions','navigation','controls','canvas-panel','guess-form','composer','settings-account','settings-privacy','legal']);
const dynamicContent = new Set(['question','question-media','prompt','word','answer','category','turn','round','timer','players','scoreboard','score-cards','podium','results','history','lives','draft','options-list','word-choices','word-banner','guesses','cooperative-result','name','bio','code','identity','avatar','cover','badges','achievements','stats','messages','message-input','guess-input','room-code','invite-code','group-name','members','participants','notice','error','loading','privacy','rotate','mic-note','connection','expiry','legal','account-delete','account-signout','subscription','restore']);
const dynamicIcons = new Set(['sound','mute','speaker','avatar','profile','friend-avatar','cover','color','width','option','word-choice','game-icon']);
const node = (id, label, kind = 'container', extra = {}) => Object.freeze({ id, label, kind,
  editableText: !dynamicContent.has(id) && !extra.repeat && ['text','button'].includes(kind),
  editableIcon: !dynamicIcons.has(id) && !extra.repeat && kind === 'button',
  ...(id === 'color' ? { editableStyle: ['borderWidth','borderRadius','opacity','padding','gap'] } : {}),
  ...(protectedContainers.has(id) ? { required: true } : {}), ...extra });
const common = [
  node('header', 'الترويسة'), node('title', 'العنوان', 'text'), node('topbar', 'شريط العنوان'),
  node('back', 'الرجوع', 'button', { required: true }), node('home', 'الرئيسية', 'button', { required: true }),
  node('menu','خيارات العنصر','button'), node('profile','الملف الشخصي','button',{editableText:false,editableIcon:false}),
  node('sound', 'الصوت', 'button'), node('content', 'المحتوى'), node('notice', 'التنبيه', 'text'),
  node('error', 'رسالة الخطأ', 'text', { required: true }), node('loading', 'التحميل'),
  node('actions', 'الإجراءات'), node('start', 'بدء اللعب', 'button', { required: true }),
  node('continue', 'المتابعة', 'button', { required: true }), node('exit', 'الخروج', 'button', { required: true }),
  node('restart', 'إعادة اللعب', 'button'), node('resume', 'استئناف اللعب', 'button', { required: true }),
  node('close', 'إغلاق', 'button', { required:true, editableText:false }), node('cancel', 'إلغاء', 'button', { required:true, editableText:false }), node('confirm', 'تأكيد', 'button', { required:true, editableText:false }),
  node('player-name', 'اسم صاحب الدور', 'text', { editableText:false }), node('privacy-hint','إرشاد الدور السري','text',{required:true,editableText:false}),
  node('timer', 'المؤقت'), node('players', 'اللاعبون', 'list', { repeat: true }),
  node('scoreboard', 'لوحة النقاط', 'list', { repeat: true }), node('podium', 'منصة النتائج'),
  node('results', 'النتائج'), node('rules', 'طريقة اللعب'), node('artwork', 'الرسم التوضيحي', 'image'),
];
const platformNodes = [
  node('brand', 'شعار ميدان'), node('profile', 'حسابي', 'button'), node('presence', 'الأصدقاء المتصلون', 'button'),
  node('games', 'شبكة الألعاب', 'list', { repeat: true }), node('game-card', 'قالب بطاقة اللعبة', 'button', { repeat: true }),
  ...[['badeeha','بديهة'],['mafia','مافيا ميدان'],['ersomha','ارسمها'],['beep','بيب'],['mamnoo','ممنوع'],['jabeen','على جبينك'],['fabraka','فبركة'],['meenfina','مين فينا']].map(([id,label]) => node(`game-card.${id}`, `بطاقة ${label}`, 'button', { editableText:false, editableIcon:false })),
  node('game-icon', 'صورة اللعبة', 'image'), node('game-name', 'اسم اللعبة', 'text'), node('game-description', 'وصف اللعبة', 'text'),
  node('tools', 'أدوات اللّمّة'), node('rooms', 'الغرف', 'button'), node('roster', 'دفتر اللاعبين', 'button'),
  node('groups', 'الشِّلَل', 'list', { repeat: true }), node('group-card', 'قالب الشلّة', 'button', { repeat: true }),
  node('footer', 'تذييل الصفحة'), node('hero', 'مقدمة الصفحة'), node('facts', 'معلومات اللعبة'),
  node('steps', 'خطوات اللعب', 'list', { repeat: true }), node('online', 'اللعب أونلاين', 'button'),
  node('local', 'اللعب على جهاز واحد', 'button'), node('settings-account', 'الحساب والاشتراك', 'container', { required: true }),
  node('settings-audio', 'الصوت والموسيقى'), node('settings-experience', 'تجربة اللعب'),
  node('settings-privacy', 'الخصوصية والأمان', 'container', { required: true }), node('settings-support', 'المساعدة'),
  node('settings-local', 'بيانات الجهاز'), node('setting', 'قالب الإعداد', 'container', { repeat: true }),
  node('setting-toggle', 'قالب مفتاح الإعداد', 'button', { repeat: true }), node('sound-volume', 'مستوى الصوت', 'input'),
  node('music-volume', 'مستوى الموسيقى', 'input'), node('clear-data', 'مسح البيانات', 'button'),
  ...['plus-store','plus-retry','collection-preview','collection-use','plus-details','setup-presets-toggle'].map(id=>node(id,({'plus-store':'متجر بلس','plus-retry':'إعادة تحميل بلس','collection-preview':'معاينة الطقم','collection-use':'استخدام الطقم','plus-details':'تفاصيل الاشتراك','setup-presets-toggle':'جلساتي الجاهزة'})[id],'button',{required:id==='plus-details',repeat:id.startsWith('collection-'),editableText:false,editableIcon:false})),
  node('store-empty', 'مقدمة المتجر'), node('collections', 'أطقم بلس', 'list', { repeat: true }), node('collection', 'قالب الطقم', 'container', { repeat: true }), node('name-input', 'اسم اللاعب', 'input'),
  node('add-player', 'إضافة لاعب', 'button'), node('player-row', 'قالب اللاعب', 'container', { repeat: true }),
  node('players-setup','اختيار اللاعبين'), node('teams-setup','إعداد الفرق'), node('player-choice','قالب اختيار اللاعب','button',{repeat:true}),
  node('team-row','قالب الفريق','container',{repeat:true}), node('team-name','اسم الفريق','input',{repeat:true,editableText:false}),
];
const gameNodes = [
  ...[['discard-save','حذف المباراة المحفوظة'],['team-count','عدد الفرق'],['mode-choice','نمط اللعب'],['round-size','حجم الجولة'],['timer-length','مدة السؤال'],['random-categories','فئات عشوائية'],['favorite','المفضّلة'],['clear-history','مسح سجل الأسئلة'],['finish','إنهاء المباراة'],['cancel','إلغاء'],['undo','التراجع'],['answer-toggle','إظهار وإخفاء الحل'],['judge-team','قالب منح النقاط للفريق'],['judge-nobody','لم يجب أحد'],['share-result','مشاركة النتيجة'],['clear-results','مسح النتائج'],['share-reports','مشاركة البلاغات'],['score-minus','خصم نقاط'],['score-plus','إضافة نقاط'],['question-audio','تشغيل صوت السؤال']].map(([id,label]) => node(id,label,'button',{ repeat: ['team-count','mode-choice','round-size','timer-length','favorite','judge-team','score-minus','score-plus'].includes(id), ...(id === 'cancel' ? { required:true } : {}) })),
  node('options', 'خيارات اللعبة'), node('question', 'السؤال أو الطلب'), node('question-media', 'صورة أو صوت السؤال'),
  node('answer', 'الإجابة'), node('word', 'الكلمة'), node('category', 'الفئة', 'text'),
  node('turn', 'صاحب الدور'), node('intro', 'الاستعداد'), node('prompt', 'الطلب'),
  node('judge', 'التقييم'), node('correct', 'صحيح', 'button'), node('wrong', 'خطأ', 'button'),
  node('skip', 'تخطي', 'button'), node('pause', 'إيقاف مؤقت', 'button'), node('reveal', 'كشف الإجابة', 'button'),
  node('report', 'الإبلاغ', 'button', { required: true }), node('hint', 'التلميح'), node('assistance', 'المساعدة'),
  node('tools', 'وسائل المساعدة'), node('tool', 'قالب وسيلة المساعدة', 'button', { repeat: true }),
  node('score-cards', 'بطاقات الفرق', 'list', { repeat: true }), node('board', 'لوحة الاختيار'),
  node('category-card', 'قالب الفئة', 'button', { repeat: true }), node('tier', 'قالب شريحة النقاط', 'button', { repeat: true }),
  node('history', 'سجل المباريات', 'list', { repeat: true }), node('lives', 'الأرواح'),
  node('bomb', 'القنبلة'), node('round', 'الجولة', 'text'), node('controls', 'التحكم'),
  node('rotate', 'طلب تدوير الهاتف', 'container', { required: true }), node('privacy', 'ستار الدور السري', 'container', { required: true }),
  node('draft', 'كتابة الإجابة', 'input'), node('submit', 'إرسال الإجابة', 'button', { required: true }),
  node('options-list', 'قائمة الاختيارات', 'list', { repeat: true }), node('option', 'قالب الاختيار', 'button', { repeat: true }),
  node('discussion', 'النقاش'), node('reveal-card', 'قالب بطاقة الكشف', 'container', { repeat: true }),
  node('round-scores', 'نقاط الجولة', 'list', { repeat: true }), node('laugh-award', 'جائزة الضحك'),
];
const onlineNodes = [
  node('entry', 'نموذج الغرفة'), node('entry-mode', 'إنشاء أو انضمام'), node('game-picker', 'اختيار لعبة الغرفة'),
  node('name-input', 'اسم اللاعب', 'input'), node('room-code', 'رمز الغرفة', 'input'), node('avatar-picker', 'اختيار الشخصية'),
  node('settings', 'إعدادات الغرفة'), node('invite', 'الدعوة'), node('invite-code', 'رمز الدعوة'), node('invite-qr', 'رمز QR', 'image'),
  node('invite-copy', 'نسخ الدعوة', 'button'), node('invite-share', 'مشاركة الدعوة', 'button'),
  node('connection', 'حالة الاتصال', 'text', { required: true }), node('room-actions', 'أدوات الغرفة'),
  node('member', 'قالب عضو الغرفة', 'container', { repeat: true }), node('ready', 'الاستعداد', 'button'),
  node('reconnect', 'إعادة الاتصال', 'button', { required: true }), node('dropped', 'المقاعد المنقطعة'),
  node('expiry', 'انتهاء الغرفة', 'text', { required: true }),
];
const drawNodes = [
  node('canvas-panel', 'منطقة الرسم'), node('canvas', 'لوحة الرسم', 'canvas', { canvasViewport: true, worldAspectRatio: 1, required: true }),
  node('canvas-status', 'حالة اللوحة', 'text', { required: true }), node('drawing-tools', 'أدوات الرسم', 'container', { required: true }),
  node('focus-toggle', 'تكبير اللوحة والرجوع للغرفة', 'button', { required: true, editableText: false, editableIcon: false }),
  node('orientation', 'توجيه الهاتف أثناء الرسم', 'button', { editableText: false, editableIcon: false }),
  node('tools-more', 'الألوان وأدوات الرسم الإضافية', 'button', { required: true, editableIcon: false }),
  node('camera-controls', 'عرض وتحريك اللوحة', 'container', { required: true }),
  node('camera-view', 'عرض اللوحة كاملة أو المساحة الواسعة', 'button', { required: true, editableText: false, editableIcon: false }),
  node('camera-hand', 'تحريك اللوحة للوصول لبقية الرسم', 'button', { required: true, editableText: false, editableIcon: false }),
  node('pen', 'القلم', 'button'), node('eraser', 'الممحاة', 'button'), node('undo', 'التراجع', 'button'),
  node('redo', 'الإعادة', 'button'), node('clear', 'مسح اللوحة', 'button'), node('palette', 'لوحة الألوان'),
  node('color', 'قالب اللون', 'button', { repeat: true }), node('widths', 'سماكات الرسم'),
  node('width', 'قالب السماكة', 'button', { repeat: true }), node('word-choices', 'اختيارات الرسّام'),
  node('word-choice', 'قالب اختيار الكلمة', 'button', { repeat: true }), node('word-banner', 'الكلمة أو التلميحات'),
  node('mic-note', 'تنبيه كتم الميكروفون', 'text', { required: true }), node('guess-form', 'التخمين'),
  node('guess-input', 'نص التخمين', 'input'), node('guess-send', 'إرسال التخمين', 'button'),
  node('guesses', 'تخمينات الأصدقاء', 'list', { repeat: true }), node('aside', 'الأصدقاء والتخمينات'),
  node('cooperative-result', 'نتيجة التعاون'),
];
const socialNodes = [
  node('privacy','حماية المحادثة','container',{required:true,editableText:false}), node('record-stop','إنهاء التسجيل','button'),
  node('voice-play','تشغيل التسجيل','button',{repeat:true}), node('voice-message','قالب التسجيل الصوتي','audio',{repeat:true}),
  node('game-invite-card','قالب دعوة اللعب','container',{repeat:true}), node('message-edit','تعديل الرسالة','button',{repeat:true}),
  node('message-delete','حذف الرسالة','button',{repeat:true}), node('message-retry','إعادة إرسال الرسالة','button',{repeat:true}),
  node('older-messages','الرسائل الأقدم','button'), node('new-messages','الرسائل الجديدة','button'),
  node('options-list', 'اختيارات الدعوة'), node('option', 'قالب الاختيار', 'button', { repeat: true }),
  node('tabs', 'تبويبات اللّمّة'), node('search', 'البحث', 'input'), node('list', 'القائمة', 'list', { repeat: true }),
  node('friend-row', 'قالب الصديق', 'container', { repeat: true }), node('friend-avatar', 'صورة الصديق', 'button', { repeat: true }),
  node('friend-chat', 'محادثة الصديق', 'button', { repeat: true }), node('favorite', 'المفضّلة', 'button', { repeat: true }),
  node('friend-invite', 'دعوة الصديق', 'button', { repeat: true }), node('group-row', 'قالب الشلّة', 'button', { repeat: true }),
  node('new-group', 'إنشاء شلّة', 'button'), node('add-friend', 'إضافة صديق', 'button'), node('preferences', 'تنبيهات اللّمّة', 'button'),
  node('messages', 'سجل الرسائل', 'list', { repeat: true }), node('message', 'قالب الرسالة', 'container', { repeat: true }),
  node('composer', 'كتابة الرسالة'), node('message-input', 'نص الرسالة', 'input'), node('send', 'إرسال الرسالة', 'button'),
  node('record', 'تسجيل صوتي', 'button'), node('record-preview', 'معاينة التسجيل', 'audio'), node('record-cancel', 'إلغاء التسجيل', 'button'),
  node('call', 'الاتصال', 'button'), node('game-invite', 'دعوة للعب', 'button'), node('mute', 'الكتم', 'button', { required: true }),
  node('end-call', 'إنهاء المكالمة', 'button', { required: true }), node('participants', 'مشاركو المكالمة', 'list', { repeat: true }),
  node('speaker', 'قالب صورة المتحدث', 'button', { repeat: true }), node('call-drag', 'تحريك المكالمة'),
  node('group-name', 'اسم الشلّة', 'input'), node('group-avatar', 'صورة الشلّة'), node('members', 'الأعضاء', 'list', { repeat: true }),
  node('member', 'قالب العضو', 'container', { repeat: true }), node('member-picker', 'دعوة الأعضاء'),
  node('leave-group', 'مغادرة الشلّة', 'button', { required: true }), node('notification-setting', 'قالب تفضيل التنبيهات', 'container', { repeat: true }),
  node('block', 'الحظر', 'button', { required: true }), node('report', 'الإبلاغ', 'button', { required: true }),
];
const profileNodes = [
  node('avatar-choice','قالب الشخصية','button',{repeat:true}),node('theme-choice','قالب لون الملف','button',{repeat:true}),node('badge-choice','قالب الشارة','button',{repeat:true}),
  node('avatar-upload','رفع الصورة الشخصية','button'),node('avatar-remove','حذف الصورة الشخصية','button'),node('cover-upload','رفع الغلاف','button'),node('cover-remove','حذف الغلاف','button'),
  node('field','قالب حقل الملف','container',{repeat:true,editableText:false}),
  node('cover', 'الغلاف', 'image'), node('identity', 'هوية اللاعب'), node('avatar', 'الصورة الشخصية', 'image'),
  node('name', 'اسم اللاعب', 'text'), node('bio', 'نبذة اللاعب', 'text'), node('code', 'رمز اللاعب', 'button'),
  node('edit', 'تعديل الملف', 'button'), node('share', 'مشاركة الملف', 'button'), node('contact', 'التواصل والصداقة'),
  node('badges', 'الشارات'), node('achievements', 'الإنجازات', 'list', { repeat: true }), node('achievement', 'قالب الإنجاز', 'container', { repeat: true }),
  node('stats', 'إحصاءات اللاعب'), node('stat', 'قالب الإحصائية', 'container', { repeat: true }),
  node('edit-section', 'قالب قسم التعديل', 'container', { repeat: true }), node('crop', 'إطار قص الصورة', 'image'),
  node('zoom', 'تكبير الصورة', 'input'), node('save', 'حفظ التغييرات', 'button', { required: true }),
  node('cancel', 'إلغاء', 'button', { required: true }), node('block', 'الحظر', 'button', { required: true }),
  node('report', 'الإبلاغ', 'button', { required: true }),
];

// Native control templates and fixed semantic sections. Repeated controls preserve
// their list flow; account identity, answers and stateful labels are never copy-editable.
const extraNodes = [
  ...[['about','عن ميدان'],['abstain','الامتناع'],['categories-reset','إعادة ضبط الفئات'],['entry-create','إنشاء غرفة'],['entry-join','دخول برمز'],['funny-clear','إلغاء ترشيح الضحك'],['notification-enable','طلب إذن التنبيهات'],['show-all','عرض القائمة الكاملة'],['sound-test','تجربة الصوت'],['call-collapse','طي المكالمة'],['call-open','فتح أدوات المكالمة'],['resume-audio','استعادة صوت المكالمة'],['unblock','إلغاء الحظر'],['retry','إعادة المحاولة'],['setup','تغيير إعداد المباراة'],['download-pack','تنزيل وسائط الحزمة'],['audio-play','تشغيل صوت السؤال'],['audio-restart','تشغيل من البداية'],['tiles-reveal','كشف قطعة'],['media-retry','إعادة تحميل الوسائط'],['tilt-retry','إعادة تفعيل الميلان']].map(([id,label]) => node(id,label,'button',{editableText:false})),
  ...[['category-choice','قالب اختيار الفئة'],['category-filter','قالب مرشح الفئات'],['friend-filter','قالب مرشح الأصدقاء'],['member-remove','إزالة عضو'],['member-host','قالب المضيف الجديد'],['member-transfer','نقل ملكية اللّمّة'],['player-remove','حذف لاعب'],['game-choice','قالب لعبة الدعوة'],['friend-accept','قبول الصداقة'],['friend-reject','رفض الصداقة'],['friend-cancel','إلغاء طلب الصداقة'],['group-accept','قبول دعوة اللّمّة'],['group-reject','رفض دعوة اللّمّة'],['segment-option','قالب اختيار الإعداد'],['plan-option','قالب خطة الاشتراك']].map(([id,label]) => node(id,label,'button',{repeat:true})),
  ...[['answer-input','كتابة الإجابة'],['answer-aliases','الإجابات البديلة'],['bio-input','كتابة النبذة'],['category-search','البحث في الفئات'],['cycles','عدد دورات الرسم'],['difficulty','مستوى الأفكار'],['round-count','عدد جولات الغرفة'],['member-role','صلاحية العضو'],['member-select','اختيار عضو للدعوة'],['notification-toggle','قالب مفتاح التنبيهات'],['report-details','تفاصيل البلاغ'],['report-reason','سبب البلاغ'],['search-input','نص البحث'],['title-select','اختيار اللقب'],['zoom-input','تكبير الصورة'],['allow-replay','السماح بإعادة الأفكار'],['audio-output','مخرج صوت المكالمة'],['share-link','رابط الملف الشخصي'],['setting-funny','جائزة الضحك'],['setting-double','مضاعفة الجولة الأخيرة']].map(([id,label]) => node(id,label,'input',{repeat:['member-role','member-select','notification-toggle'].includes(id)})),
  ...[['vote-panel','لوحة التصويت'],['setting-mode','نمط اللعب'],['setting-duration','مدة الجولة'],['setting-rounds','عدد الجولات'],['setting-cycles','دورات الأصحاب'],['setting-style','نوع الأسئلة'],['setting-write-time','مدة الكتابة'],['setting-discussion-time','مدة النقاش']].map(([id,label]) => node(id,label)),
  ...[['tab.friends','تبويب الأصدقاء'],['tab.chats','تبويب المحادثات'],['tab.groups','تبويب اللّمات'],['tab.requests','تبويب الطلبات'],['game-choice.mafia','اختيار مافيا ميدان'],['game-choice.badeeha','اختيار بَديهة'],['game-choice.ersomha','اختيار ارسمها'],['game-choice.fabraka','اختيار فبركة'],['game-choice.meenfina','اختيار مين فينا']].map(([id,label]) => node(id,label,'button')),
  ...[['source-link','رابط المصدر'],['license-link','رابط الترخيص']].map(([id,label]) => node(id,label,'button',{repeat:true,editableText:false,editableIcon:false})),
  ...[['pricing-link','التسعير'],['privacy-link','سياسة الخصوصية'],['refunds-link','سياسة الاسترداد'],['terms-link','شروط الاستخدام'],['support-link','التواصل مع الدعم'],['legal-pricing','تسعير الاشتراك'],['legal-terms','شروط الاشتراك'],['legal-privacy','خصوصية الاشتراك'],['legal-refunds','استرداد الاشتراك']].map(([id,label]) => node(id,label,'button',{required:!['pricing-link','legal-pricing','support-link'].includes(id),editableText:false,editableIcon:false})),
  node('room-settings','تعديل إعدادات الغرفة','button',{editableText:false}),
  node('host-handover','تسليم استضافة المجلس','button'),
  node('call-drag','تحريك دوائر المكالمة','button',{editableText:false,editableIcon:false}),
  node('group-manage','إدارة اللّمّة','button',{editableText:false}),
  node('game-invite-join','الانضمام من الدعوة','button',{repeat:true,editableText:false}),
  node('media-close','إغلاق الصورة المكبرة','button',{required:true,editableText:false}),
  node('sheet-drag-handle','مقبض إغلاق اللوحة','button',{required:true,editableText:false,editableIcon:false}),
  node('image-enlarge','تكبير صورة السؤال','button',{repeat:true,editableText:false,editableIcon:false}),
];


const mafiaNodes = [
  ...[['mafia-tools','أدوات المجلس'],['player-safety','إجراءات اللاعب'],['observer-join','الانتقال من المشاهدة'],['room-observe','مشاهدة المجلس'],['directory-next','المجالس التالية'],['directory-previous','المجالس السابقة']].map(([id,label])=>node(id,label,'button',{editableText:false,editableIcon:false,required:['mafia-tools','player-safety'].includes(id),repeat:id==='player-safety'||id==='room-observe'})),
  node('observer-delay','تنبيه المشاهدة المؤجلة','text',{required:true,editableText:false}),
  ...[['room-name','اسم المجلس'],['voice-mode','الصوت في المجلس'],['directory-voice','تصفية التواصل'],['directory-status','تصفية حالة المجلس'],['room-theme','ستايل المجلس']].map(([id,label])=>node(id,label,'input',{editableText:false,editableIcon:false})),
  ...[['create-public-room','إنشاء مجلس عام'],['role-hide','إخفاء البطاقة الخاصة'],['voice-resume','استعادة صوت المجلس']].map(([id,label]) => node(id,label,'button',{editableText:false,editableIcon:false,required:['role-hide','voice-resume'].includes(id)})),
  node('narrative','حكاية المرحلة','container',{editableText:false}),
  node('event','قالب الحدث العام','container',{repeat:true,editableText:false}),
  node('player-rail','شريط مقاعد المجلس','container',{required:true,editableText:false}),
  ...[['capacity','سعة المجلس'],['visibility','ظهور الغرفة'],['directory-mode','نمط المجالس'],['message-input','نص الرسالة'],['notes-input','ملاحظاتي']].map(([id,label]) => node(id,label,'input',{editableText:false,editableIcon:false})),
  ...[['players-toggle','عرض مقاعد المجلس'],['night-attack-tab','اختيار الهجوم'],['night-ability-tab','اختيار القدرة'],['my-history','سجل مجالسي'],['cancel-ability','إلغاء اختيار الليل'],['mode-option','اختيار الطور'],['chat-channel','قناة المحادثة'],['block-exit','الحظر والخروج'],['tab.council','المجلس'],['tab.clues','أدلتي'],['tab.notes','دفتر الشكوك'],['entry-public','المجالس العامة'],['quick-join','الانضمام السريع'],['refresh','تحديث المجالس'],['room-join','دخول المجلس'],['role-toggle','ستر البطاقة'],['voice-join','الاتصال الصوتي'],['voice-leave','قطع الاستماع'],['ability-submit','تأكيد القدرة'],['abstain','الامتناع'],['verdict-yes','إقرار الإقصاء'],['verdict-no','رفض الإقصاء'],['herald','تمديد النقاش'],['return-call','العودة لمكالمة الشلة']].map(([id,label]) => node(id,label,'button',{editableText:false,editableIcon:false,required:['role-toggle','voice-leave'].includes(id)})),
  ...[['player-seat','قالب مقعد اللاعب'],['target','قالب هدف القدرة'],['mafia-vote','قالب اختيار الهجوم']].map(([id,label]) => node(id,label,'button',{repeat:true,editableText:false,editableIcon:false,required:id==='player-seat'})),
  ...[['phase-title','اسم المرحلة'],['observer-notice','حالة المقصي'],['defense','دفاع المرشح']].map(([id,label]) => node(id,label,'text',{editableText:false,required:true})),
  ...[['players-fold','طي مقاعد المجلس'],['rooms','قائمة المجالس'],['empty','مجالس فارغة'],['role-card','البطاقة السرية'],['role-content','تفاصيل الدور'],['ability','القدرة المسموحة'],['targets','الأهداف المتاحة'],['voice','صوت المجلس'],['chat','محادثة المرحلة'],['events','الأحداث العامة'],['reports','أدلتي الخاصة'],['notebook','دفتر الشكوك'],['recap','كشف المباراة']].map(([id,label]) => node(id,label,'container',{editableText:false,required:['role-card','role-content','ability','targets','voice','chat','reports'].includes(id)})),
];

const dedupe = values => [...new Map(values.map(value => [value.id, value])).values()];
const phaseLabels = { home:'البداية',setup:'الإعداد',board:'لوحة الأسئلة',question:'السؤال',result:'نتيجة الجولة',history:'السجل',intro:'الاستعداد',prompt:'الطلب',judge:'الحكم',over:'النتيجة النهائية',boom:'انفجار القنبلة',play:'اللعب',roundEnd:'حصيلة الجولة',review:'مراجعة الإجابات',countdown:'العدّ التنازلي',pick:'اختيار اللاعب',vote:'التصويت',host:'الحقيقة السرّية',write:'الكتابة',discussion:'النقاش',gather:'اجتمعوا للكشف',reveal:'كشف الإجابات',select:'اختيار الفكرة',draw:'الرسم',three:'ثلاثة قبل الصفارة',bomb:'القنبلة' };
const screen = (id, label, group, nodes, states = {}) => Object.freeze({ id, label: label.split(' · ').map(part => phaseLabels[part] || part).join(' · '), group, nodes: Object.freeze(dedupe([...common, ...nodes])), ...states });
const definitions = [];
for (const [id, label] of [['home', 'الألعاب'], ['game-details', 'تفاصيل اللعبة'], ['players', 'دفتر اللاعبين'], ['settings', 'الإعدادات'], ['store', 'المتجر'], ['about', 'عن ميدان'], ['audio-credits', 'مصادر الصوت'], ['legal', 'الشروط والخصوصية'], ['play-setup', 'إعداد اللاعبين والفرق']]) definitions.push(screen(id, label, 'المنصة', id === 'play-setup' ? [...platformNodes, ...gameNodes] : platformNodes));
for (const phase of ['home', 'setup', 'board', 'question', 'result', 'history']) definitions.push(screen(`badeeha.${phase}`, `بديهة · ${phase}`, 'بديهة', gameNodes, { game: 'badeeha', phase }));
for (const [mode, phases] of [['three', ['intro', 'prompt', 'judge', 'over']], ['bomb', ['intro', 'prompt', 'boom', 'over']]]) for (const phase of phases) definitions.push(screen(`beep.${mode}.${phase}`, `بيب · ${mode} · ${phase}`, 'بيب', gameNodes, { game: 'beep', phase, mode }));
for (const [game, label, phases] of [['mamnoo', 'ممنوع', ['intro', 'play', 'roundEnd', 'over']], ['jabeen', 'على جبينك', ['intro', 'play', 'review', 'over']]]) for (const phase of phases) definitions.push(screen(`${game}.${phase}`, `${label} · ${phase}`, label, gameNodes, { game, phase }));
for (const phase of ['intro', 'countdown', 'pick', 'vote', 'result', 'over']) definitions.push(screen(`meenfina.local.${phase}`, `مين فينا · ${phase}`, 'مين فينا', gameNodes, { game: 'meenfina', phase, mode: 'local' }));
for (const phase of ['intro', 'question', 'host', 'write', 'discussion', 'vote', 'gather', 'reveal', 'roundEnd', 'over']) definitions.push(screen(`fabraka.local.${phase}`, `فبركة · ${phase}`, 'فبركة', gameNodes, { game: 'fabraka', phase, mode: 'local' }));
definitions.push(screen('online.entry', 'إنشاء الغرف والانضمام', 'الغرف', [...platformNodes, ...gameNodes, ...onlineNodes]));
definitions.push(screen('online.lobby', 'انتظار الغرفة', 'الغرف', [...gameNodes, ...onlineNodes]));
definitions.push(screen('online.chrome', 'شريط الغرفة والاتصال', 'الغرف', onlineNodes));
for (const [game, phases] of [['meenfina', ['vote', 'result', 'over']], ['fabraka', ['host', 'write', 'discussion', 'vote', 'reveal', 'result', 'over']]]) for (const phase of phases) definitions.push(screen(`online.${game}.${phase}`, `${game === 'fabraka' ? 'فبركة' : 'مين فينا'} أونلاين · ${phase}`, 'الغرف', [...gameNodes, ...onlineNodes], { game, phase, mode: 'online' }));
for (const phase of ['setup', 'board', 'question', 'reveal', 'over']) definitions.push(screen(`online.badeeha.${phase}`, `بَديهة أونلاين · ${phase}`, 'الغرف', [...gameNodes, ...onlineNodes], { game: 'badeeha', phase, mode: 'online' }));
definitions.push(screen('online.mafia.tools','مافيا ميدان · أدوات المجلس','مافيا ميدان',mafiaNodes,{game:'mafia',phase:'discussion',mode:'online'}));
definitions.push(screen('online.mafia.spectator','مافيا ميدان · المشاهدة المؤجلة','مافيا ميدان',[...onlineNodes,...mafiaNodes],{game:'mafia',phase:'discussion',mode:'online'}));
definitions.push(screen('online.mafia.privacy','مافيا ميدان · حماية الأسرار','مافيا ميدان',[node('privacy','ستار الأسرار','container',{required:true,editableText:false})],{game:'mafia',phase:'privacy',mode:'online'}));
definitions.push(screen('online.mafia.history','مافيا ميدان · السجل','مافيا ميدان',[...mafiaNodes,...profileNodes],{game:'mafia',phase:'history',mode:'online'}));
definitions.push(screen('online.mafia.guide','مافيا ميدان · الدليل','مافيا ميدان',mafiaNodes,{game:'mafia',phase:'guide',mode:'online'}));
definitions.push(screen('online.mafia.role-card','مافيا ميدان · البطاقة الخاصة','مافيا ميدان',mafiaNodes,{game:'mafia',phase:'role',mode:'online'}));
definitions.push(screen('online.mafia.safety','مافيا ميدان · الأمان','مافيا ميدان',[...mafiaNodes,...profileNodes],{game:'mafia',phase:'safety',mode:'online'}));
for (const phase of ['setup','directory','lobby','role','opening','night','dawn','discussion','nomination','defense','verdict','over','closed','waiting']) definitions.push(screen(`online.mafia.${phase}`, `مافيا ميدان · ${phase}`, 'مافيا ميدان', [...gameNodes,...onlineNodes,...mafiaNodes], {game:'mafia',phase,mode:'online'}));
for (const role of ['citizen','investigator','doctor','guard','observer','reporter','herald','analyst','mafia','masker','blocker','leader']) definitions.push(screen(`online.mafia.night.${role}`, `مافيا ميدان · الليل · ${role}`, 'مافيا ميدان', [...gameNodes,...onlineNodes,...mafiaNodes], {game:'mafia',phase:'night',mode:'online',role}));
for (const phase of ['clues','notes']) definitions.push(screen(`online.mafia.${phase}`, `مافيا ميدان · ${phase === 'clues' ? 'أدلتي' : 'دفتر الشكوك'}`, 'مافيا ميدان', [...gameNodes,...onlineNodes,...mafiaNodes], {game:'mafia',phase:'discussion',mode:'online',role:phase}));
for (const phase of ['select', 'draw', 'result']) for (const role of ['drawer', 'guesser']) definitions.push(screen(`ersomha.${phase}.${role}`, `ارسمها · ${phase} · ${role === 'drawer' ? 'الرسّام' : 'المخمّن'}`, 'ارسمها', [...gameNodes, ...drawNodes], { game: 'ersomha', phase, role }));
definitions.push(screen('ersomha.over', 'ارسمها · النتيجة النهائية', 'ارسمها', [...gameNodes, ...drawNodes], { game: 'ersomha', phase: 'over' }));
definitions.push(screen('ersomha.private-wait', 'ارسمها · حماية الفكرة', 'ارسمها', [...gameNodes, ...drawNodes], { game: 'ersomha', phase: 'private-wait' }));
for (const [id, label] of [['social.list', 'الأصدقاء والشِّلَل'], ['social.conversation', 'المحادثة'], ['social.group-editor', 'إنشاء الشلّة وإدارتها'], ['social.invite', 'دعوة للعب'], ['social.preferences', 'تنبيهات اللّمّة'], ['social.search', 'البحث عن الأصدقاء'], ['social.action', 'إجراءات المحادثة'], ['social.voice', 'تسجيل صوتي'], ['social.call', 'المكالمة']]) definitions.push(screen(id, label, 'اللّمّة', socialNodes));
for (const [id, label] of [['profile', 'ملف اللاعب'], ['profile.editor', 'تعديل الملف'], ['profile.crop', 'قص صورة الملف'], ['profile.safety', 'حظر وإبلاغ']]) definitions.push(screen(id, label, 'الملف الشخصي', profileNodes));
definitions.push(screen('shell.navigation', 'شريط التنقّل الرئيسي', 'إطار ميدان', [node('navigation', 'الشريط'), ...['games','friends','store','settings'].map(id => node(id, ({ games: 'الألعاب', friends: 'الأصدقاء', store: 'المتجر', settings: 'الإعدادات' })[id], 'button', { required: id === 'games' || id === 'settings' }))]));
definitions.push(screen('shell.game-frame', 'إطار اللعبة', 'إطار ميدان', [node('privacy', 'ستار حماية الدور', 'container', { required: true })]));
for (const id of ['system.dialog','system.sheet']) definitions.push(screen(id, id.endsWith('dialog') ? 'النافذة الحوارية' : 'الورقة السفلية', 'النظام', [node('close', 'إغلاق', 'button', { required: true }), node('cancel', 'إلغاء', 'button', { required: true }), node('confirm', 'تأكيد', 'button', { required: true })]));
const accountNodes = [node('account-signin', 'تسجيل الدخول', 'button', { required: true }), node('account-signout', 'تسجيل الخروج', 'button', { required: true }), node('account-delete', 'حذف الحساب', 'button', { required: true }), node('subscription', 'إدارة الاشتراك', 'button', { required: true }), node('restore', 'استعادة المشتريات', 'button', { required: true }), node('purchase', 'الاشتراك', 'button'), node('products', 'خطط الاشتراك'), node('legal', 'الشروط والخصوصية', 'container', { required: true })];
definitions.push(screen('account.card', 'الحساب والاشتراك', 'الحساب', accountNodes));
definitions.push(screen('account.paywall', 'ميدان بلس', 'الحساب', accountNodes));
definitions.push(screen('account.signin','تسجيل الدخول','الحساب',[node('providers','طرق تسجيل الدخول'),node('signin-apple','الدخول بحساب Apple','button',{required:true,editableText:false,editableIcon:false}),node('signin-google','الدخول بحساب Google','button',{required:true,editableText:false,editableIcon:false}),node('privacy-note','بيان تسجيل الدخول','text',{required:true,editableText:false})]));
definitions.push(screen('play-setup.teams','إعداد الفرق','إعداد اللعب',[...platformNodes,...gameNodes]));
definitions.push(screen('setup.add-player','إضافة لاعب سريع','إعداد اللعب',platformNodes));
definitions.push(screen('setup.pass-phone','تسليم الهاتف للدور السري','إعداد اللعب',gameNodes));

for (const [id,label] of [['beep','بيب'],['mamnoo','ممنوع'],['jabeen','على جبينك'],['meenfina','مين فينا'],['fabraka','فبركة']]) definitions.push(screen(`setup.${id}`, `إعداد ${label}`, 'إعداد اللعب', [...gameNodes,...platformNodes]));

// Only expose elements that the real components render. The coverage map is
// verified against all preview fixtures; exceptional state-dependent elements
// carry a precise reason instead of pretending every screen has every control.
const allNodes = new Map(dedupe([...common,...platformNodes,...gameNodes,...onlineNodes,...drawNodes,...socialNodes,...profileNodes,...accountNodes,...extraNodes,...mafiaNodes]).map(value => [value.id,value]));
const dynamicLabels = new Set(['presence','roster','game-name','game-description','start','continue','submit','skip','correct','wrong','reveal','answer-toggle','ready','history','hint','assistance','setup','options']);
const statefulTitles = new Set(['game-details','shell.game-frame','online.chrome','profile',...definitions.filter(value => value.id.startsWith('ersomha.')).map(value => value.id)]);
export const DESIGN_SCREENS = Object.freeze(definitions.map(definition => {
  const observed = DESIGN_RENDERED_NODE_IDS[definition.id] || [];
  const conditional = DESIGN_CONDITIONAL_NODE_REASONS[definition.id] || {};
  const own = new Map(definition.nodes.map(value => [value.id,value]));
  const nodes = [...new Set([...observed,...Object.keys(conditional)])].map(id => {
    const value = extraNodes.find(value => value.id === id) || own.get(id) || allNodes.get(id);
    if (!value) throw new Error(`Missing semantic node metadata: ${definition.id}:${id}`);
    const patch = {};
    if (dynamicLabels.has(id) || id === 'title' && statefulTitles.has(definition.id)) patch.editableText = false;
    if (id === 'game-name' || id === 'game-description') patch.editableIcon = false;
    if (id === 'history' || id === 'rules' || id === 'hint' || id === 'options' && definition.id.endsWith('.over')) Object.assign(patch,{kind:'button',repeat:false});
    if (id === 'question-media') Object.assign(patch,{repeat:true,editableText:false});
    if (definition.id === 'social.call' && ['call-open','speaker'].includes(id)) patch.required = true;
    // Seats are the only in-match route to report/block a participant. Styling
    // the rail must not hide its nested list or every repeated seat button.
    if (definition.id.startsWith('online.mafia.') && id === 'invite') Object.assign(patch,{kind:'button',repeat:false});
    if (definition.id.startsWith('online.mafia.') && id === 'players') patch.required = true;
    if (definition.id === 'system.dialog' && id === 'report') Object.assign(patch,{repeat:true,editableText:false});
    if (id === 'search') Object.assign(patch,{kind:'container',editableText:false});
    if (id === 'team-count' && definition.id === 'play-setup.teams') Object.assign(patch,{kind:'container',repeat:false,editableText:false});
    return Object.freeze({...value,...patch,...(conditional[id] ? {coverageReason:conditional[id]} : {})});
  });
  return Object.freeze({...definition,nodes:Object.freeze(nodes)});
}));
const byId = new Map(DESIGN_SCREENS.map(value => [value.id, value]));
export function getScreenDefinition(id) { return byId.get(String(id || '')) || null; }
export function getNodeDefinition(screenId, nodeId) { return getScreenDefinition(screenId)?.nodes.find(value => value.id === nodeId) || null; }
