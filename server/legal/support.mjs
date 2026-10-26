// Standalone App Store support destination; no account, SPA shell or tracking.
const ORIGIN = 'https://maydan-game.mf103871.workers.dev';
const EMAIL = 'mf103871@gmail.com';
const HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="دعم ميدان: الاشتراك واستعادة المشتريات والحساب والصوت والمكالمات والإشعارات.">
  <title>الدعم والمساعدة | ميدان</title>
  <link rel="canonical" href="${ORIGIN}/api/legal/support/">
  <style>
    :root{color-scheme:light;font-family:system-ui,sans-serif;color:#38234c;background:#fff7e7}
    *{box-sizing:border-box}body{margin:0;font-size:1rem;line-height:1.9}
    header,main,footer{width:min(100%,54rem);margin-inline:auto;padding:1.5rem}
    nav{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem}a{color:#006e79;text-underline-offset:.2em;overflow-wrap:anywhere}
    a:focus-visible{outline:3px solid #9250bd;outline-offset:4px;border-radius:3px}
    nav a,.contact{display:inline-flex;align-items:center;min-height:44px}
    h1{font-size:clamp(1.8rem,6vw,2.6rem);line-height:1.4;margin-block:1.25rem .5rem}
    h2{font-size:1.3rem;line-height:1.5;margin-block:0 .75rem}p{margin-block:0 1rem;overflow-wrap:anywhere}
    .brand{font-weight:800;color:#007b85}.intro{padding:1.5rem;border:1px solid #ddd3c5;border-radius:20px;background:#fffdfa;box-shadow:0 4px 0 #e8dece}
    .contact{padding:.5rem 1rem;border-radius:12px;color:#fff;background:#007b85;font-weight:700}
    section{padding-block:1.5rem;border-block-start:1px solid #ddd3c5}main{padding-block-start:0}footer{color:#62556e}
    @media print{nav,.contact{display:none}body{background:white}.intro{box-shadow:none}}
  </style>
</head>
<body>
  <header>
    <nav aria-label="التنقل والمساعدة"><a class="brand" href="${ORIGIN}/">ميدان</a><a href="${ORIGIN}/api/legal/support/" aria-current="page">الدعم</a><a href="${ORIGIN}/api/legal/privacy/">سياسة الخصوصية</a><a href="${ORIGIN}/#/terms">شروط الاستخدام</a></nav>
    <h1 id="support-title">نحن هنا لمساعدتك</h1>
    <div class="intro"><p>لديك سؤال عن ميدان أو واجهت مشكلة أثناء اللعب؟ راسلنا مع وصف مختصر للمشكلة وإصدار التطبيق وطراز الجهاز والخطوات التي سبقتها. يمكنك إرفاق صورة بعد إخفاء بياناتك الخاصة.</p><a class="contact" href="mailto:${EMAIL}" dir="ltr">${EMAIL}</a><p>لا ترسل كلمة مرور أو رمز تحقق أو بيانات بطاقة. إذا كان سؤالك عن عملية شراء، يكفي رقم الطلب بعد إخفاء المعلومات غير اللازمة.</p></div>
  </header>
  <main aria-labelledby="support-title">
    <section aria-labelledby="subscription-title"><h2 id="subscription-title">الاشتراك واستعادة المشتريات</h2><p>داخل تطبيق iPhone يتم الاشتراك والدفع عبر Apple. تأكد من استخدام حساب Apple الذي أتم الشراء، ثم افتح إعدادات ميدان واختر «استعادة المشتريات» أثناء الاتصال بالإنترنت.</p><p>لإدارة التجديد أو إلغائه افتح إعدادات iPhone ← اسمك ← الاشتراكات ← ميدان. حذف التطبيق أو حساب ميدان لا يلغي اشتراك Apple تلقائيًا. لمراجعة الخصم افتح سجل مشتريات Apple؛ مشتريات TestFlight التجريبية لا تخصم أموالًا حقيقية.</p><p>إذا اكتمل الشراء ولم يتفعّل بلس بعد الاستعادة، تواصل معنا مع إصدار التطبيق ورقم الطلب. راجع أيضًا <a href="${ORIGIN}/refunds/">سياسة الاسترداد</a>.</p></section>
    <section aria-labelledby="account-title"><h2 id="account-title">الدخول وحذف الحساب</h2><p>استخدم طريقة الدخول نفسها التي أنشأت بها الحساب، Apple أو Google. لحذف الحساب افتح إعدادات ميدان ← الحساب ← حذف الحساب، وأكمل التأكيد أثناء الاتصال بالإنترنت. انتظر رسالة نجاح الحذف.</p><p>«مسح البيانات» يزيل البيانات المحلية على الجهاز؛ حذف الحساب يزيل بيانات الحساب من الخدمة وفق <a href="${ORIGIN}/api/legal/privacy/">سياسة الخصوصية</a>. إذا تعذر الوصول إلى حسابك، راسلنا لطلب المساعدة دون إرسال رموز الدخول.</p></section>
    <section aria-labelledby="audio-title"><h2 id="audio-title">الصوت والمكالمات والتسجيلات</h2><p>راجع إعدادات الصوت والموسيقى داخل ميدان، ومستوى صوت الوسائط ومخرج الصوت في الجهاز، خصوصًا عند اتصال سماعات Bluetooth. اسمح بالميكروفون من إعدادات iPhone ← التطبيقات ← ميدان عند استخدام المكالمات أو التسجيل.</p><p>بعد انقطاع مكالمة أو صوت، افتح التطبيق مجددًا وتحقق من حالة الاتصال ومخرج الصوت. الميكروفون الذي كتمته لا يُفتح تلقائيًا، ويُقفل أثناء الأدوار السرية ودور الرسّام. إذا استمرت المشكلة، حدّث ميدان ثم أرسل لنا متى انقطع الصوت وهل كنت تستخدم مكالمة أو تسجيلًا أو سماعات.</p></section>
    <section aria-labelledby="notifications-title"><h2 id="notifications-title">الرسائل والإشعارات</h2><p>اسمح بإشعارات ميدان من إعدادات iPhone ← الإشعارات، ثم راجع إعدادات الإشعارات داخل اللعبة وكتم المحادثة. أوضاع التركيز وكتم المحادثة قد تؤخر التنبيه أو تخفيه. تتطلب الرسائل والمكالمات اتصالًا بالإنترنت.</p></section>
    <section aria-labelledby="safety-title"><h2 id="safety-title">الخصوصية والإبلاغ</h2><p>يمكنك حظر الحساب أو الإبلاغ عن الرسائل والتسجيلات والصور والرسومات من أدواتها داخل ميدان. للاستفسار عن بياناتك أو طلب نسخة أو تصحيح أو الاعتراض على قرار مراجعة، راسل <a href="mailto:${EMAIL}" dir="ltr">${EMAIL}</a>. لا نسجّل محتوى المكالمات.</p></section>
  </main>
  <footer><a href="${ORIGIN}/api/legal/privacy/">سياسة الخصوصية</a> · <a href="${ORIGIN}/#/terms">شروط الاستخدام</a> · <a href="${ORIGIN}/#/settings">إعدادات ميدان</a></footer>
</body>
</html>`;

export function supportPageResponse(method = 'GET') {
  if (!['GET', 'HEAD'].includes(method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  return new Response(method === 'HEAD' ? null : HTML, { status: 200, headers: {
    'content-type': 'text/html; charset=utf-8', 'content-language': 'ar', 'cache-control': 'public, max-age=300',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  } });
}
