// Public copy only. The same-origin server remains authoritative for access;
// this page never reads account data, grants a ticket or enables a checkout.
(() => {
  const set = (key, value) => {
    const node = document.querySelector(`[data-gameplay-copy="${key}"]`);
    if (node) node.textContent = value;
  };
  const apply = gameplay => {
    const policy = gameplay?.policy;
    if (gameplay?.access === 'trial-ticket' && policy === 'game-entry-ticket-v2') {
      set('lead', 'أول مباراة كاملة لكل حساب في كل لعبة مجانية. بعدها تذكرة للمضيف أو ميدان بلس، بما فيها جميع حزم بديهة. بلس يخصّص البروفايل والإطار ولا يغيّر فرص الفوز.');
      set('matches', 'أول مباراة كاملة لكل لعبة مجانية؛ تذكرة واحدة تشمل جميع جولات المباراة التالية وجميع حزم بديهة');
      set('rooms', 'خيارات الدخول تظهر من بطاقة اللعبة قبل اختيار النمط؛ انضمام الضيوف إلى غرفة المضيف مجاني');
      set('plus', 'بدء المباريات دون تذكرة إعلان طوال استحقاق بلس');
      set('details', 'تُستخدم التذكرة عند بدء المباراة الفعلي فقط. فتح بطاقة اللعبة أو الرجوع أو إنشاء غرفة انتظار لا يستهلكها. مشاهدة الإعلان اختيارية؛ يمكن الرجوع أو الانضمام مجانًا إلى غرفة مضيف آخر. الإعلان غير المتاح أو غير المكتمل لا يمنح تذكرة.');
    } else if (gameplay?.access === 'trial-ticket' && policy === 'trial-ticket-v1') {
      set('lead', 'أول مباراة لكل لعبة وعشر حزم بديهة الأساسية مجانية. بعدها يبدأ المضيف بتذكرة إعلان اختياري أو ميدان بلس؛ بلس يضيف تخصيص البروفايل والإطار دون تغيير فرص الفوز.');
      set('matches', 'عشر حزم بديهة الأساسية مجانية دائمًا، وأول مباراة لكل لعبة مجانية');
      set('rooms', 'انضمام الضيوف مجاني؛ المباريات الأخرى للمضيف بتذكرة كاملة أو بلس');
      set('plus', 'بدء المباريات دون تذكرة إعلان طوال استحقاق بلس');
      set('details', 'إنشاء غرفة انتظار لا يستهلك تذكرة. مشاهدة الإعلان اختيارية، وعدم توفره أو عدم إكماله لا يمنح تذكرة.');
    } else if (gameplay?.access === 'free' && !policy) {
      set('lead', 'كل ألعاب ميدان وحزمها وغرفها مجانية في هذه النسخة. ميدان بلس اشتراك اختياري لمظهر بروفايلك وإطار صورتك؛ لا يغيّر فرص الفوز.');
      set('matches', 'كل فئات بديهة وجميع الألعاب والمباريات مجانية في هذه النسخة');
      set('rooms', 'إنشاء الغرف وإعادة اللعب والانضمام مجانية');
      set('plus', 'اللعب متاح دون اشتراك؛ بلس للمظهر والتخصيص');
      set('details', 'اختر لعبة وابدأ مع أصدقائك. تبقى الحاجة إلى الحساب والإنترنت حيث تتطلبها اللعبة.');
    } else throw new Error('Unknown gameplay policy');
    set('status', 'تم التحقق من سياسة اللعب الحالية من هذا الخادم.');
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  fetch('/api/billing/config', { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal })
    .then(response => {
      if (!response.ok) throw new Error('Gameplay configuration unavailable');
      return response.json();
    })
    .then(config => apply(config.gameplay))
    .catch(() => set('status', 'تعذّر التحقق من سياسة اللعب الحالية. التفاصيل المحايدة أعلاه لا تمنح دخولًا أو تذكرة؛ افتح التطبيق عند عودة الاتصال.'))
    .finally(() => clearTimeout(timer));
})();
