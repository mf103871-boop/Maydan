# الحسابات واشتراك «ميدان بلس» — خادم المرحلة 1

هذا الدليل يشرح جانب **الخادم**: قاعدة D1، مسارات `/api`، الأسرار، وخطوات لوحات آبل وجوجل وPaddle. الواجهة موصوفة في `src/shared/account/` وملفات الجدار.

الاشتراك واحد اسمه **ميدان بلس** بمنتجين: `plus.monthly` و`plus.yearly`. الأسعار تُقرأ من المتجر (App Store) أو من Paddle وقت العرض، ولا تُكتب في الكود.

---

## المعمار في سطور

| الطبقة | المكان |
| --- | --- |
| التخزين | Cloudflare **D1** بالربط `DB`؛ المخطط في `server/migrations/0001_accounts.sql` |
| التوجيه | `server/accounts/router.mjs`، يُستدعى من `routeRequest` في `server/worker.mjs` **قبل** مسارات الغرف |
| الجلسة | `server/accounts/session.mjs` — رمز مبهم، الخادم يخزّن `sha256(السر)` فقط |
| التواقيع | `server/accounts/jwt.mjs` — JWKS وRS256/ES256 وHMAC عبر `crypto.subtle` وحدها، بلا اعتماديات npm |
| المزوّدون | `apple.mjs`، `google.mjs`، `paddle.mjs` |
| الاستحقاق | `entitlements.mjs` (نقي: `premiumOf`, `meResponse`) |
| التطوير المحلي | `server/local-d1.mjs` (غلاف D1 فوق `node:sqlite`) يُحقن في `server/local.mjs` |

**الخادم هو مصدر الحقيقة.** أي إثبات شراء يصل من العميل يُعامل تلميحًا: الخادم يعيد الجلب من App Store Server API أو يتحقق من توقيع Paddle قبل أي كتابة.

### الجداول

`users`، `identities` (provider+subject → user)، `sessions`، `auth_codes`، `subscriptions` (مفتاح أساسي `(source, external_id)`)، `trials` (`user_id`+`game`)، `webhook_events` (منع التكرار)، `paddle_customers`.

الحقول الشخصية أقلّ ما يمكن: معرّف المزوّد، واسم وبريد **يقبلان القيمة الفارغة**. لا صور ولا عناوين ولا أي شيء آخر.

### الجلسة

```
Authorization: Bearer mdn1.<معرّف 16 hex>.<سر base64url من 32 بايت>
```

- الصلاحية 180 يومًا، والسر لا يُخزَّن إطلاقًا — فقط `sha256`.
- **تدوير منزلق**: إذا مرّ أكثر من يوم على آخر استعمال، يعيد الردّ ترويسة `x-maydan-session: <رمز جديد>`؛ يستبدل العميل المخزّن عنده. الرمز القديم يبقى صالحًا خمس دقائق حتى لا تنقطع طلبات متوازية.
- `401` مع `{"error":"AUTH_EXPIRED"}` أو `AUTH_REQUIRED` تعني: امسح الجلسة المحلية.
- CORS يسمح بـ`Content-Type, Authorization` ويكشف `x-maydan-session`.

---

## المسارات

كل الردود JSON بلا تخزين مؤقت، والأخطاء بالشكل `{"error": "CODE"}`.

| المسار | الوصف |
| --- | --- |
| `GET /api/billing/config` | رمز عميل Paddle والبيئة والأسعار، ومعرّفا المنتجين، وأي المزوّدين مفعّل |
| `GET /api/auth/apple/start?client=&return=` | 302 إلى آبل (`response_mode=form_post`) |
| `POST /api/auth/apple/callback` | نموذج `code,id_token,state,user` ← 302 إلى `${return}#/auth?code=…` |
| `GET /api/auth/google/start?client=&return=` | 302 إلى جوجل (تدفق `code`) |
| `GET /api/auth/google/callback?code&state` | 302 كما أعلاه |
| `POST /api/auth/apple/native` | `{identityToken, authorizationCode?, fullName?}` ← جلسة مباشرة (iOS) |
| `POST /api/auth/exchange` | `{code, client}` ← `{session:{token,expiresAt}, me}` (الرمز لمرة واحدة، 60 ثانية) |
| `POST /api/auth/signout` | 204، تُبطَل الجلسة الحالية |
| `GET /api/me` | `{user, premium:{active,until,source,status,willRenew}, trials, serverTime}` |
| `POST /api/trials/:game` | تسجيل مباراة تجريبية (إدخال بلا تكرار) ← `{trials}` |
| `POST /api/trials/merge` | `{games:[…]}` اتحاد مع الموجود ← `{trials}` |
| `POST /api/apple/transactions` | `{jws}` ← يعيد الجلب من آبل ثم يربط المعاملة بالحساب ← `me` |
| `POST /api/apple/notifications` | إشعارات App Store V2 (بلا مصادقة، بلا فحص Origin) |
| `POST /api/paddle/checkout` | `{plan:'monthly'\|'yearly'}` ← `{transactionId, clientToken, environment}` |
| `POST /api/paddle/webhook` | جسم خام + `Paddle-Signature` |
| `GET /api/paddle/portal` | `{url}` لبوابة العميل |
| `DELETE /api/account` | إبطال رمز آبل، إلغاء Paddle بذل أفضل، ثم حذف متسلسل ← 204 |
| `POST /api/rooms` | كما كان؛ يُضاف إليه قفل الغرف (أسفله) |
| `GET /health` | يضيف `accounts: true` عند ربط D1 |

### أكواد الأخطاء

`AUTH_REQUIRED` 401 · `AUTH_EXPIRED` 401 · `PLUS_REQUIRED` 402 · `ALREADY_LINKED` 409 · `SIGNATURE` 401 · `PROVIDER` 502 · `STATE` 400 · `NOT_ELIGIBLE` 400 · `INVALID` 400 · `RATE_LIMIT` 429 · `NOT_FOUND` 404.

نصوصها العربية في `src/shared/account/errors.js`.

### قفل إنشاء الغرف

إنشاء غرفة يُحسب **مباراة** للّعبة المطلوبة (`input.game`، افتراضها `meenfina`):

- **مجهول**: مسموح دائمًا، والعلامة محلية عند العميل.
- **مسجّل غير مشترك**: أول إنشاء لكل لعبة ينجح ويُسجَّل في `trials`؛ الثاني يردّ `402 {"error":"PLUS_REQUIRED"}`.
- **مشترك**: مسموح دائمًا.
- الدخول إلى غرفة برمز مجاني للجميع.

رمز جلسة تالف أو منتهٍ عند إنشاء غرفة يُعامل صاحبه **ضيفًا** (لا يُرفض)، لأن الإنشاء المجهول مسموح أصلًا فالرفض لا يضيف أمانًا ويكسر التجربة.

### حدود الطلبات

`server/worker.mjs` يوسّع `RequestLimiter` بأنواع جديدة في جدول `LIMITS`: `auth` 40/10د، `billing` 30/10د، `me` 120/دقيقة، `trial` 60/دقيقة، إضافة إلى `create/join/leave/socket` كما كانت. الـwebhooks لا تُحسب على حصّة عنوان المتصل لأن المزوّد قد يعيد الإرسال دفعة واحدة.

---

## إنشاء قاعدة D1

```bash
npx wrangler d1 create maydan-accounts
```

يطبع الأمر معرّف القاعدة. أزل التعليق عن كتلة `d1_databases` في **`wrangler.jsonc`** و**`wrangler.rooms.jsonc`** معًا وضع المعرّف مكان `<database_id>` (الاثنان يتشاركان القاعدة نفسها، فحساب واحد يخدم الواجهتين). الكتلة معلَّقة عمدًا: Cloudflare يرفض نشر العامل كله حين يحمل معرّف قاعدة لا تطابق الحساب، فلا يُنشر الربط إلا بمعرّف حقيقي. ثم:

```bash
npm run db:migrate         # على Cloudflare
npm run db:migrate:local   # نسخة wrangler المحلية
```

الترحيلات في `server/migrations/` وتُطبَّق بالترتيب. **كل جملة SQL في سطر واحد**: أمر D1 `exec` يقسم مدخله على الأسطر، والاختبارات تعتمد ذلك.

بدون ربط `DB` تعمل الغرف كما كانت تمامًا، وتردّ مسارات الحسابات `404` (و`/health` يعطي `accounts: false`)؛ الواجهة تفهم ذلك وتتحوّل إلى وضع «دون اتصال»: القفل قائم، ولا دخول ولا شراء حتى تُربط القاعدة.

---

## الأسرار

إعدادات عامة (غير سرّية) في `vars` داخل ملفي wrangler: `APP_ORIGIN`، `EXTRA_ORIGINS`، `APPLE_BUNDLE_ID`، `APPLE_SERVICES_ID`، `GOOGLE_CLIENT_ID`، `PADDLE_ENV`، `PADDLE_CLIENT_TOKEN`، `PADDLE_PRICE_MONTHLY`، `PADDLE_PRICE_YEARLY`.

الأسرار تُرفع بأمر `wrangler secret put` ولا تُكتب في أي ملف بالمستودع:

```bash
npx wrangler secret put SESSION_SECRET           # عشوائي طويل، يوقّع state الخاص بـOAuth
npx wrangler secret put APPLE_TEAM_ID
npx wrangler secret put APPLE_SIGNIN_KEY_ID
npx wrangler secret put APPLE_SIGNIN_PRIVATE_KEY # محتوى ملف .p8 كاملًا
npx wrangler secret put APPLE_IAP_ISSUER_ID
npx wrangler secret put APPLE_IAP_KEY_ID
npx wrangler secret put APPLE_IAP_PRIVATE_KEY    # مفتاح App Store Server API (.p8)
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put PADDLE_API_KEY
npx wrangler secret put PADDLE_WEBHOOK_SECRET
```

كرّر الأوامر مع `--config wrangler.rooms.jsonc` إن كنت تشغّل خادم الغرف المنفصل أيضًا.

### روابط المزوّدين (للاختبار فقط)

كل رابط خارجي قابل للاستبدال بمتغيّر بيئة كي تصوّبه الاختبارات إلى خادم وهمي محلي: `APPLE_AUTH_URL`، `APPLE_TOKEN_URL`، `APPLE_JWKS_URL`، `APPLE_REVOKE_URL`، `APPLE_STORE_API_URL`، `GOOGLE_AUTH_URL`، `GOOGLE_TOKEN_URL`، `GOOGLE_JWKS_URL`، `PADDLE_API_URL`. اتركها فارغة في الإنتاج لتُستعمل عناوين المزوّدين الحقيقية.

### التطوير المحلي

`npm run rooms:dev` يشغّل `server/local.mjs` بقاعدة D1 في الذاكرة (الترحيلات مطبّقة) ويقرأ ملف **`.dev.vars`** إن وُجد (`KEY=value` في كل سطر، والملف مستثنى من git ومن أرشيف الإصدار). مثال:

```
AUTH_DEV_FAKE=1
SESSION_SECRET=dev-secret
```

`AUTH_DEV_FAKE=1` يفتح مزوّدًا وهميًا للتطوير والاختبارات فقط: `POST /api/auth/dev {subject,name?,email?}` و`POST /api/dev/grant {until,product?}`. **لا تضبطه أبدًا في الإنتاج**؛ بدونه يردّ المساران `404`.

---

## قائمة إعداد آبل

### Sign in with Apple

1. في **Certificates, Identifiers & Profiles** فعّل قدرة *Sign in with Apple* على App ID الخاص بالتطبيق، واضبط `APPLE_BUNDLE_ID` عليه.
2. أنشئ **Services ID** للويب (مثل `com.maydan.web`) وفعّل عليه Sign in with Apple. اضبط `APPLE_SERVICES_ID`.
3. في إعداد Services ID أضف:
   - **Domain**: مضيف الخادم (مثل `maydan-game.YOUR-SUBDOMAIN.workers.dev`).
   - **Return URL**: `https://<المضيف>/api/auth/apple/callback` — بالضبط، آبل تطابقه حرفيًا.
4. أنشئ **Key** من نوع Sign in with Apple، نزّل ملف `.p8` مرة واحدة، وسجّل `Key ID` و`Team ID` → `APPLE_SIGNIN_KEY_ID`، `APPLE_SIGNIN_PRIVATE_KEY`، `APPLE_TEAM_ID`.

الخادم يولّد «سر العميل» (JWT بـES256) عند كل تبادل ولا يخزّنه؛ المفتاح وحده هو السر.

### الاشتراكات وApp Store Server API

1. في **App Store Connect** أنشئ مجموعة اشتراك واحدة ومنتجين بالمعرّفين `plus.monthly` و`plus.yearly` بالضبط (يطابقان `PRODUCTS` في `src/shared/account/config.js`).
2. **Users and Access → Integrations → App Store Connect API → In-App Purchase**: أنشئ مفتاحًا، نزّل `.p8`، وسجّل `Issuer ID` و`Key ID` → `APPLE_IAP_ISSUER_ID`، `APPLE_IAP_KEY_ID`، `APPLE_IAP_PRIVATE_KEY`.
3. **App Information → App Store Server Notifications**: اختر **الإصدار 2** وضع رابط الإنتاج `https://<المضيف>/api/apple/notifications`، ورابط Sandbox نفسه (بيئتان، نقطة نهاية واحدة — الخادم يميّزهما من الحمولة).

عند الشراء داخل التطبيق يمرّر StoreKit **`appAccountToken` = معرّف المستخدم عندنا**، فيتحقق الخادم أن المعاملة تخص هذا الحساب فعلًا. معاملة مرتبطة بحساب آخر تُرفض بـ`ALREADY_LINKED`.

### sandbox مقابل الإنتاج

| | Sandbox | الإنتاج |
| --- | --- | --- |
| `APPLE_STORE_API_URL` | `https://api.storekit-sandbox.itunes.apple.com` | اتركه فارغًا (الافتراضي `https://api.storekit.itunes.apple.com`) |
| المشترون | حسابات Sandbox Tester من App Store Connect | حسابات حقيقية |
| مدد الاشتراك | مضغوطة (شهر = 5 دقائق) | حقيقية |

الخادم يقرأ `environment` من حمولة آبل ويخزّنه في `subscriptions.environment`، فتستطيع التمييز عند التشخيص.

---

## قائمة إعداد جوجل

1. في **Google Cloud Console → APIs & Services → Credentials** أنشئ **OAuth client ID** من نوع *Web application*.
2. **Authorized redirect URIs**: `https://<المضيف>/api/auth/google/callback`.
3. اضبط `GOOGLE_CLIENT_ID` (عام) و`GOOGLE_CLIENT_SECRET` (سرّ).
4. في **OAuth consent screen** اطلب النطاقات `openid`، `email`، `profile` فقط — وهي ما يطلبه الخادم.

البريد يُخزَّن فقط إن أكّدته جوجل (`email_verified`).

---

## قائمة إعداد Paddle

1. أنشئ حساب Paddle Billing وابدأ في **Sandbox**.
2. **Catalog → Products**: منتج «ميدان بلس» بسعرين متكرّرين (شهري وسنوي). انسخ `pri_…` إلى `PADDLE_PRICE_MONTHLY` و`PADDLE_PRICE_YEARLY`.
3. **Developer Tools → Authentication**: مفتاح API → `PADDLE_API_KEY`، ورمز عميل (client-side token) → `PADDLE_CLIENT_TOKEN`.
4. **Developer Tools → Notifications**: وجهة جديدة إلى `https://<المضيف>/api/paddle/webhook`، واشترك على الأقل في `subscription.created`, `subscription.activated`, `subscription.updated`, `subscription.canceled`, `subscription.paused`, `subscription.resumed`. انسخ سرّ التوقيع إلى `PADDLE_WEBHOOK_SECRET`.
5. اضبط `PADDLE_ENV` على `sandbox` أو `production`؛ منه يشتق الخادم `https://sandbox-api.paddle.com` أو `https://api.paddle.com`.
6. **Checkout → Website approval**: أضف نطاق الموقع وإلا رفض Paddle فتح صفحة الدفع.

الخادم ينشئ عميل Paddle عند أول شراء ويحفظ `customer_id`، ثم ينشئ معاملة بـ`custom_data.userId` — وهي الحلقة التي يربط بها الـwebhook الاشتراك بالحساب.

### التوقيع وإعادة الإرسال

ترويسة `Paddle-Signature: ts=<ثانية>;h1=<hex>` حيث `h1 = HMAC-SHA256(secret, "${ts}:${الجسم الخام}")`.

- الجسم يُقرأ **خامًا** ولا يمرّ على تحليل JSON قبل التحقق.
- انحراف زمني أكثر من **5 دقائق** يُرفض بـ`SIGNATURE`.
- التكرار يُمنع بـ`event_id` في `webhook_events`، فإعادة الإرسال من لوحة Paddle آمنة تمامًا: تردّ `200 {"duplicate": true}` بلا أي كتابة.
- التحديث **رتيب**: حدث أقدم (`occurred_at`) يصل متأخرًا لا يُرجع حالة الاشتراك إلى الوراء. لذلك إعادة إرسال دفعة قديمة لا تُفسد اشتراكًا حاليًا.

لإعادة الإرسال يدويًا: **Notifications → اختر الوجهة → Logs → Replay**. إشعارات آبل تُعاد بالطريقة نفسها عبر `Request a Test Notification` أو إعادة المحاولة التلقائية؛ التكرار محميّ بـ`notificationUUID`.

---

## الأمان

- **فحص Origin**: كل طلب يحمل `Origin` يجب أن يكون ضمن `ALLOWED_ORIGINS`. في النشر الكامل (الصفحة والـAPI على الأصل نفسه) لا يرسل المتصفح `Origin` مع GET من الصفحة، فيُقبل GET/HEAD بلا `Origin` حين يثبت المتصفح أنه من الأصل نفسه (`Sec-Fetch-Site: same-origin`، أو `Referer` بالأصل نفسه للمتصفحات الأقدم) وكان ذلك الأصل مسموحًا. الكتابة (POST/DELETE) تحمل `Origin` دائمًا فتبقى مشروطة به.
- الخادم مصدر الحقيقة: لا يُكتب استحقاق من حمولة يرسلها العميل.
- `PRIMARY KEY (source, external_id)` يمنع ربط معاملة واحدة بحسابين.
- `appAccountToken` يجب أن يطابق الحساب الطالب، وإلا `ALREADY_LINKED`.
- `state` موقّع بـHMAC مع nonce ومهلة 10 دقائق؛ لا يُخزَّن شيء بينهما.
- رمز الدخول بعد المصادقة لمرة واحدة ولمدة 60 ثانية، ويسافر في **شظية** الرابط على الويب فلا يدخل سجلات الخادم ولا ترويسة Referer.
- `return` محصور بـ`APP_ORIGIN` أو أحد `ALLOWED_ORIGINS`/`EXTRA_ORIGINS` أو `maydan://auth`.
- لا `null` في CORS أبدًا؛ الأصل المجهول يُرفض بـ403 إلا في المسارات العامة (إعادة توجيه المزوّد وwebhooks) التي تحميها تواقيع المزوّدين أنفسهم.
- الأسرار لا تُخزَّن مفكوكة: الجلسات تُجزَّأ، ورموز الدخول تُجزَّأ، وسر عميل آبل يُولَّد عند الطلب.

---

## الاختبارات

```bash
npm test
```

- `tests/accounts-entitlements.test.js` — منطق `premiumOf`/`meResponse` وقراءة أحداث Paddle وحالات آبل، نقي بلا شبكة.
- `tests/accounts-cloudflare.test.js` — workerd حقيقي عبر Miniflare مع D1 (`d1Databases: { DB: 'maydan-accounts' }`) ومزوّدين وهميين على `node:http`: تدفق جوجل كامل، آبل على الويب وأصليًا، تدوير الجلسة والخروج، التجارب والدمج، قفل إنشاء الغرف، معاملات آبل وإشعاراتها، توقيع Paddle صالح/مزوّر/مكرر، وحذف الحساب المتسلسل.

المزوّدون الوهميون يُحقنون عبر متغيّرات الروابط أعلاه، فلا يلمس الاختبار الإنترنت ولا يحتاج سرًّا حقيقيًا.
- `tests/account-client.test.js` و`tests/account-gating.test.js` — طبقة الحساب في الواجهة (المخزن، العميل، الجدار، الأخطاء) والقفل (الحزم المجانية العشر، 68 مقفولة في المُنتقي، شارات الرئيسية وتفاصيل اللعبة).

### فحص شامل بالمتصفح (اختياري)

```bash
CHROMIUM_PATH=/path/to/chrome npm run e2e:paywall
```

`scripts/e2e/paywall.mjs` يشغّل الخادم المحلي بـ`AUTH_DEV_FAKE=1`، يبني الحزمة في الذاكرة وهي تشير إليه، ويتحقق عبر Playwright من الرحلة كاملة: مجهول (68 مقفولة والنقر يفتح الجدار) → دخول وهمي (لا يزال مقفولًا) → منح اشتراك (صفر مقفول، لا ملاحظات) → مستخدم مجاني آخر: المباراة الأولى تمر، وبعد `POST /api/trials/beep` يفتح زر «العب» الجدار → إنشاء الغرف 402 بعد التجربة و201 للمشترك والمجهول → الخروج يُبطل الرمز. اللقطات في `$TMPDIR/maydan-e2e/paywall`.
