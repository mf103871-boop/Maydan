# نشر ميدان كاملة على Cloudflare — 1.4.1

هذه الطريقة تضع **اللعبة والوسائط وخادم الغرف على رابط واحد**. الاتصال بالغرف يتبع رابط الموقع تلقائيًا؛ لا تحتاج إضافة Cloudflare داخل ChatGPT، ولا تعديل عنوان الخادم في `online.config.json`.

## النشر من الهاتف عبر GitHub

افتح لوحة Cloudflare في متصفح الهاتف. ضمن **Workers & Pages** اختر **Create application → Import a repository**، ثم مستودع `mf103871-boop/Maydan`. إذا سبق إنشاء Worker وربطه بالمستودع، افتحه ثم انتقل إلى **Settings → Builds**.

استخدم هذه الإعدادات:

| الحقل | القيمة |
| --- | --- |
| Worker name | `maydan-game` |
| Production branch / Git branch | `main` |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npm run cloudflare:deploy` |
| Root directory | جذر المستودع `/` |

اضغط **Save and Deploy**، أو احفظ الإعدادات وأعد محاولة البناء. تظهر وصلة اللعبة في صفحة Worker بعد نجاح النشر؛ افتحها وشاركها مع اللاعبين.

ضع أمر البناء في خانته حتى لو كان موجودًا في `wrangler.jsonc`؛ Workers Builds لا يطبّق إعداد Custom Builds من هذا الملف. اختر الفرع المذكور فرعًا للإنتاج، لأن معاينات الفروع وحدها لا توفّر رابط لعب للـWorker الذي يحتوي Durable Objects. [إعدادات Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

يجب أن يطابق اسم Worker الاسم `maydan-game` في `wrangler.jsonc`. إذا أنشأت Worker باسم مختلف، أرسل اسمه لنضبط الملف عليه قبل إعادة النشر. هذه الطريقة تستخدم **Workers** لتشغيل الغرف. إذا كانت الشاشة تعرض فقط Build output directory وإعدادات Pages، أنشئ تطبيق Worker من Workers & Pages.

النسخة تستخدم Workers Free وSQLite Durable Objects ضمن حصص الخطة المجانية. لا تحتاج تشغيل أوامر على الهاتف أو إدخال مفاتيح سرية هنا؛ التنفيذ والتفويض يجريان داخل حسابك في Cloudflare.

## النشر من كمبيوتر أو Codespaces

تحتاج حساب Cloudflare على Workers Free وNode.js 22 أو أحدث. فك ضغط المصدر الكامل، وافتح الطرفية داخل المجلد الذي يحتوي `package.json`، ثم شغّل:

```bash
npm ci
npx wrangler login
npm run cloudflare:deploy
```

أكمل تسجيل الدخول في المتصفح عندما يفتحه Wrangler. الأمر الأخير يبني اللعبة ثم ينشرها مع الغرف، ويطبع رابط الموقع الذي سترسله لأصدقائك. صيغة الرابط تكون مثل `https://maydan-game.YOUR-SUBDOMAIN.workers.dev`؛ استخدم الرابط الحقيقي الذي يظهر لديك.

اسم المشروع المقترح `maydan-game` في `wrangler.jsonc`. إذا كان لديك مشروع آخر بهذا الاسم على Cloudflare، اختر اسمًا مختلفًا قبل النشر؛ الأمر يحدّث المشروع الذي يحمل الاسم نفسه. راجع الحساب الذي تختاره عند تسجيل الدخول، وأبقِه على Workers Free للتجربة.

لا يلزم شراء نطاق أو رفع شيء إلى GitHub لتشغيل هذه الطريقة. لا يكفي رفع ZIP عبر واجهة رفع المواقع الثابتة: الغرف تحتاج Worker وSQLite Durable Objects، والأمر أعلاه ينشئ إعدادها.

## تجربة اللعبة بعد النشر

1. افتح رابط الموقع على ثلاثة هواتف.
2. اضغط «اللّمّة من كل جوال»، ثم اختر «فبركة» أو «مين فينا؟» وأنشئ غرفة على هاتف المضيف.
3. شارك رمز الغرفة أو الرابط أو QR. يكتب كل لاعب اسمًا مختلفًا ويختار شخصية.
4. اضغط «أنا جاهز» على الهواتف، ثم «ابدأ اللعب» عند المضيف.
5. في فبركة اكتبوا الإجابات معًا، ثم ناقشوا وصوّتوا، ويكشف المضيف الإجابات على دفعات. جرّبوا انقطاع أحد الهواتف والعودة منه إلى الغرفة نفسها.

كل لاعب يستخدم هاتفه أو متصفحًا مستقلًا؛ التبويبات داخل المتصفح نفسه تشترك في مفتاح اللاعب. عمر الغرفة ساعتان، والحد 3–12 لاعبًا لمين فينا و3–8 لفبركة. تفاصيل القواعد والخصوصية في `docs/ONLINE.md`.

## فحص دون نشر

```bash
npm test
npm run cloudflare:check
```

اختبارات المشروع تشمل قواعد الألعاب وخصوصية الغرف وواجهاتها. منها اختبار على محرك Cloudflare المحلي يجمع خدمة ملفات الموقع مع إنشاء الغرفة واتصال WebSocket، ويتحقق من رفض الأصول الأخرى وعدم تحويل أخطاء API إلى صفحة اللعبة. كذلك يتحقق الاختبار من أن عامل PWA لا يخزن طلبات الغرف مؤقتًا.

`cloudflare:check` يبني النسخة ويجري فحص Wrangler باستخدام `--dry-run`؛ لا يرفعها. يشمل الفحص مباريات كاملة لفبركة ومين فينا على محرك Cloudflare المحلي، مع SQLite وإسبات الغرف واستعادة الاتصال. تبقى تجربة الهواتف الفعلية مفيدة للتحقق من حجم الخط ولوحة المفاتيح والصوت.

## الحسابات واشتراك «ميدان بلس»

الحسابات تحتاج قاعدة **D1** بالربط `DB` وأسرارًا للمزوّدين. أنشئ القاعدة مرة واحدة بـ`npx wrangler d1 create maydan-accounts`، ضع المعرّف الذي يطبعه مكان `REPLACE_WITH_D1_DATABASE_ID` في `wrangler.jsonc`، ثم شغّل `npm run db:migrate`. الخطوات الكاملة — الأسرار، ولوحات آبل وجوجل وPaddle، وsandbox مقابل الإنتاج — في `docs/ACCOUNTS.md`.

بدون ربط `DB` يبقى كل ما سبق يعمل كما هو: الغرف والملفات والوسائط، وتردّ مسارات `/api/auth` و`/api/me` بـ404.

## الخيار الموجود سابقًا: GitHub Pages مع خادم منفصل

ما زال `npm run rooms:deploy` ينشر **خادم الغرف فقط** وفق `wrangler.rooms.jsonc`. بعده تضبط عنوان الخادم في `online.config.json` وترفع الواجهة بنفسك إلى GitHub Pages، كما في `docs/ONLINE.md`.

لرفع ميدان كاملة إلى Cloudflare استخدم **`npm run cloudflare:deploy`**. هذا الأمر يستعمل `wrangler.jsonc`، وخادم `server/full-worker.mjs`، وبناء `build:cloudflare` الذي يربط API بالموقع نفسه. عند الربط عبر Workers Builds ضع `npm run build:cloudflare` في خانة Build command كما هو موضح أعلاه.

إضافة فبركة تستخدم ربطَي `ROOMS` و`LIMITERS` الموجودين، ولا تتطلب ترحيل قاعدة بيانات أو إنشاء Worker آخر: الملفات والصور عبر Workers Static Assets، والغرف عبر SQLite Durable Objects. تدعم Cloudflare [الجمع بين الملفات الثابتة والخادم](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)، وتتيح SQLite Durable Objects ضمن [Workers Free وحدوده](https://developers.cloudflare.com/durable-objects/platform/pricing/). لا تتضمن أوامر المشروع ترقية إلى خطة مدفوعة.
