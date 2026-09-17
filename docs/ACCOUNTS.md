# الحسابات واشتراك «ميدان بلس» — التشغيل والاختبار والنشر

هذا الدليل يشرح جانب **الخادم**: قاعدة D1، مسارات `/api`، الأسرار، وخطوات لوحات آبل وجوجل وPaddle. الواجهة موصوفة في `src/shared/account/` وملفات الجدار.

الاشتراك واحد اسمه **ميدان بلس**. يدعم الكود المنتجين `plus.monthly` و`plus.yearly`، لكن عرض الويب المعتمد حاليًا هو **5 USD شهريًا فقط**، ولا توجد خطة سنوية معتمدة للويب. تُقرأ أسعار واجهة الدفع من Paddle وأسعار التطبيق من App Store؛ يظهر المبلغ النهائي والضرائب عند الدفع.

## سجل نشر الويب — 18 سبتمبر 2026

نُشرت نسخة الويب المختبرة فعليًا على [موقع ميدان](https://maydan-game.mf103871.workers.dev)، بمعرّف إصدار Cloudflare **`d47e6893-7717-4e81-9119-2262852be537`**.

- نُشرت [صفحة التسعير](https://maydan-game.mf103871.workers.dev/pricing/) بسعر الويب المعتمد **5 USD شهريًا**، و[سياسة الاسترداد](https://maydan-game.mf103871.workers.dev/refunds/)، و[صفحة الدفع المستقلة](https://maydan-game.mf103871.workers.dev/pay.html).
- صُدّرت نسخة احتياطية خاصة من D1، ثم طُبّق الترحيلان `0002_paddle_customer_environments.sql` و`0003_paddle_checkout_reservations.sql` بنجاح على القاعدة البعيدة قبل نشر الكود الذي يعتمد عليهما.
- لم تتغير `vars` أو `secrets` للعامل العام؛ ما زال الدفع **Sandbox**. اعتُمد نطاق الموقع في Paddle، وأُنشئت خطة Live بسعر5USD شهريًا. تحقق النشاط والهوية ما زال قيد المراجعة حسب تأكيد المالك؛ لم يبدأ اختبار دفع حقيقي.
- يشير هذا الإصدار إلى `maydan-game`. نُشر لاحقًا مستقبِل إشعارات مستقل باسم `maydan-paddle-live`؛ لم يُنشر `maydan-rooms` بصورة منفصلة أو إصدار iOS.
- تحفظ الشيفرة وتقارير المراجعة على فرع `codex/maydan-release-audit-2026-09-17`. [سجل الفحص والتجهيز والأدلة](reviews/2026-09-18/README.md).

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
| `DELETE /api/account` | تأكيد إبطال رمز آبل وإلغاء تجديد Paddle، ثم حذف متسلسل ← 204 |
| `POST /api/rooms` | كما كان؛ يُضاف إليه قفل الغرف (أسفله) |
| `GET /health` | يضيف `accounts: true` عند ربط D1 |

### أكواد الأخطاء

`AUTH_REQUIRED` 401 · `AUTH_EXPIRED` 401 · `PLUS_REQUIRED` 402 · `ALREADY_LINKED` 409 · `ALREADY_SUBSCRIBED` 409 (اشتراك مدفوع سارٍ يمنع معاملة Paddle ثانية) · `SIGNATURE` 401 · `PROVIDER` 502 · `STATE` 400 · `NOT_ELIGIBLE` 400 · `INVALID` 400 · `RATE_LIMIT` 429 · `NOT_FOUND` 404.

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

ملفا wrangler.jsonc وwrangler.rooms.jsonc يحتويان حاليًا ربط D1 للقاعدة المشتركة. تأكد من ملكية القاعدة وصلاحيات حساب Cloudflare؛ عند إنشاء بيئة مستقلة استبدل معرّف القاعدة في الملفين. ثم:

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

### التحقق من توقيعات آبل (x5c)

كل JWS يصل من آبل — `signedTransactionInfo` و`signedRenewalInfo` من App Store Server API، و`signedPayload` في الإشعارات، و`jwsRepresentation` الذي يرسله الجهاز — يُتحقق منه في `server/accounts/x509.mjs`: توقيع ES256 بمفتاح الورقة، ثم سلسلة `x5c` شهادةً شهادة حتى الجذر، وتثبيت الجذر ببصمة SHA-256 لـ**Apple Root CA - G3** (`APPLE_ROOT_CA_G3_SHA256`)، وفترات الصلاحية، وامتدادا آبل (`1.2.840.113635.100.6.11.1` في الورقة و`1.2.840.113635.100.6.2.1` في الوسيط). الإشعارات تُفحص **قبل** فحص التكرار، فلا يستطيع أحد إسقاط إشعار حقيقي بإرسال `notificationUUID` مسبقًا. للاختبارات تُبدَّل البصمة بـ`APPLE_ROOT_CA_SHA256` مع سلسلة وهمية في `tests/fixtures/apple-chain/`؛ لا تضبط هذا المتغيّر في الإنتاج.

### داخل تطبيق iOS

- `APPLE_BUNDLE_ID` يجب أن يساوي معرّف حزمة التطبيق (`Maydan` في `ios/Maydan.xcodeproj`)؛ هو الجمهور (`aud`) في identityToken الذي يرسله الدخول الأصلي إلى `POST /api/auth/apple/native`.
- الغلاف يبني اللعبة على أصل `maydan://app` (موجود في `EXTRA_ORIGINS`) ويقصر متصفح المصادقة على مضيف `MAYDAN_ROOMS_URL` الذي بُنيت به الحزمة (`www/native-config.json`).
- الشراء عبر StoreKit 2 يمرّر `appAccountToken` = معرّف المستخدم، ثم يرسل الويب توقيع المعاملة إلى `POST /api/apple/transactions`؛ التجديدات والمشتريات المعلّقة تصل من `Transaction.updates` كحدث `transaction` وتُرسل بالطريقة نفسها. تفاصيل الغلاف في `ios/README.md`.

### sandbox مقابل الإنتاج

| | Sandbox | الإنتاج |
| --- | --- | --- |
| `APPLE_STORE_API_URL` | اتركه فارغًا: الاختيار من البيئة الموقّعة | اتركه فارغًا: الإنتاج أو Sandbox حسب المعاملة |
| المشترون | حسابات Sandbox Tester من App Store Connect | حسابات حقيقية |
| مدد الاشتراك | مضغوطة (شهر = 5 دقائق) | حقيقية |

الخادم يختار api.storekit-sandbox.apple.com لمعاملة Sandbox الموقّعة، وapi.storekit.apple.com للإنتاج. إذا غابت البيئة فقط، يعيد المحاولة في Sandbox عند الخطأ 4040010. الرابط البديل مخصص للاختبار المحلي. افصل صلاحيات حسابات اختبار Sandbox عن العملاء التجاريين عند تحديد بيئات النشر.

---

## قائمة إعداد جوجل

1. في **Google Cloud Console → APIs & Services → Credentials** أنشئ **OAuth client ID** من نوع *Web application*.
2. **Authorized redirect URIs**: `https://<المضيف>/api/auth/google/callback`.
3. اضبط `GOOGLE_CLIENT_ID` (عام) و`GOOGLE_CLIENT_SECRET` (سرّ).
4. في **OAuth consent screen** اطلب النطاقات `openid`، `email`، `profile` فقط — وهي ما يطلبه الخادم.

البريد يُخزَّن فقط إن أكّدته جوجل (`email_verified`).

---

## قائمة إعداد Paddle

1. استخدم حساب Paddle Billing الموجود، وأكمل التحقق واعتماد الموقع في Live. الربط الحالي للمشروع والموقع المنشور هو **Sandbox**.
2. **Catalog → Products**: منتج «ميدان بلس» بسعر شهري متكرر. قرار المالك بتاريخ 2026-09-18: **5 USD شهريًا فقط**؛ لا سعر سنوي معتمد. أنشئ سعر Live الشهري وانسخ `pri_…` إلى `PADDLE_PRICE_MONTHLY`، واترك `PADDLE_PRICE_YEARLY` فارغًا في إعداد الإنتاج حتى اعتماد خطة سنوية. لا تنسخ معرّفات أسعار Sandbox إلى Live. صفحة `/pricing/` المنشورة تعرض السعر المعتمد، بينما تقرأ واجهة الدفع السعر من المزوّد؛ الضرائب والمبلغ النهائي يظهران في Checkout.
3. **Developer Tools → Authentication**: مفتاح API → `PADDLE_API_KEY`، ورمز عميل (client-side token) → `PADDLE_CLIENT_TOKEN`.
4. **Developer Tools → Notifications**: افحص وجهات Live الموجودة أولًا وأعد استخدام الوجهة الصحيحة وسرّها دون تغيير أو تدوير. أنشئ وجهة إلى `https://<مضيف Live>/api/paddle/webhook` فقط إذا لم توجد وجهة Live. يلزم `subscription.created` و`subscription.updated` للاستحقاقات، و`transaction.created` و`transaction.updated` لاستعادة ربط محاولة دفع انقطع ردها. إذا كانت وجهة موجودة ناقصة أو خاطئة، سجّل الفرق ولا تعدّلها تلقائيًا أثناء الترحيل. احفظ سر الوجهة المختارة في `PADDLE_WEBHOOK_SECRET` الخاص بنشر Live. لا توجه إشعارات Live إلى نشر ما زال Sandbox، ولا تشارك سر الوجهتين.
5. اضبط `PADDLE_ENV` على `sandbox` أو `production`؛ منه يشتق الخادم `https://sandbox-api.paddle.com` أو `https://api.paddle.com`. في كود تجهيز Live الأحدث يتجاهل الإنتاج أي `PADDLE_API_URL` بديل، ويبقى الشراء مغلقًا حتى `PADDLE_CHECKOUT_ENABLED=true`. اترك القيمة `false` أثناء التجهيز قبل الاعتماد.
6. **Checkout → Website approval**: أضف نطاق الموقع وإلا رفض Paddle فتح صفحة الدفع.
7. **Checkout → Checkout settings → Default payment link**: استخدم `https://maydan-game.mf103871.workers.dev/pay.html`؛ نُشرت صفحة الدفع المستقلة واختُبرت ضمن إصدار 2026-09-18 (قد يطبع Cloudflare المسار `/pay`). يبقى ضبطها في حساب Paddle Live مرتبطًا باستكمال اعتماد الموقع. لا تعتمد الصفحة الرئيسية رابطًا افتراضيًا: تحميل Paddle.js داخل اللعبة كسول، ولا يكفي وصول `_ptxn` وحده إلى الرئيسية لفتح الدفع.

الخادم ينشئ عميل Paddle عند أول شراء ويحفظ `customer_id`، ثم ينشئ معاملة بـ`custom_data.userId` — وهي الحلقة التي يربط بها الـwebhook الاشتراك بالحساب.

### تحويل محافظ إلى الإنتاج

أكد المالك في 2026-09-18 وجود حساب Paddle إنتاجي يمكنه دخوله، ثم أكد نجاح شراء Sandbox وظهور الاشتراك في ميدان؛ هذا تأكيد من المالك ولم نقرأ معاملة الحساب للتحقق منه بعد. التحقق واعتماد الموقع لم يكتملَا بحسب آخر حالة متاحة. نُشرت نسخة الويب والترحيلات المذكورة في سجل النشر أعلاه، وبقي الموقع مربوطًا بـSandbox. يمكن تجهيز Live محليًا أو في بيئة مرحلية معزولة مع تعطيل الشراء؛ لا تحوّل الموقع العام قبل اكتمال الاعتماد والإعدادات. إضافات Retain وحصر IP ومفتاح تعطيل الشراء اللاحقة لسجل النشر ما زالت محلية ولم تُنشر.

- الترحيل `0002_paddle_customer_environments.sql` يضيف `paddle_customers_scoped` فقط بمفتاح `(environment, user_id)` وقيد ملكية `(environment, customer_id)`. لا يحذف صفوفًا ولا يعيد تصنيف الجدول القديم `paddle_customers`؛ يبقى مرجعًا تاريخيًا. قبل تبني ربط قديم، يتحقق الخادم بقراءة العميل من API البيئة المختارة. نتيجة 404 تعني عدم استخدامه في تلك البيئة؛ تعطل API لا يبرر تبنيه أو إنشاء بديل عشوائي.
- الترحيل `0003_paddle_checkout_reservations.sql` يضيف حجز دفع دائمًا لكل حساب وبيئة، وعلامة مستقلة أثناء حذف الحساب؛ لا يحذف بيانات قائمة. طُبّق الترحيلان `0002` و`0003` بنجاح عن بعد في 2026-09-18؛ عند تجهيز قاعدة مستقلة يجب تطبيقهما قبل نشر الكود الذي يحتاجهما.
- `/api/me` وبوابة الغرف ومنع الشراء المكرر لا تحتسب من Paddle إلا `environment` المطابق لـ`PADDLE_ENV`. صف Sandbox يبقى في القاعدة لكنه لا يمنح Plus أو يمنع شراء Live. الصفوف القديمة بلا بيئة لا تُصنّف تلقائيًا؛ يلزم إشعار موثوق أو مراجعة للمزوّد قبل اعتمادها. لا يتغير استحقاق Apple أو المنحة، وتظل معاملات Apple الموقعة Sandbox مدعومة لاختبار TestFlight.
- مفاتيح منع تكرار الأحداث أصبحت `paddle:<environment>:<event_id>`، مع الإبقاء على السجل القديم. لا يُسمح لحدث بتغيير بيئة اشتراك معروف. التوقيع يعتمد على سر الوجهة المختارة: تغيير `PADDLE_ENV` وحده مع إبقاء سر/أسعار Sandbox ليس تحويلًا صحيحًا.
- البوابة والمعاملات تستعمل عميل البيئة الحالية فقط. حذف حساب من Live لا يرسل اشتراك Sandbox إلى API الإنتاج للإلغاء. التشغيل من Sandbox لا يستطيع حذف سجل تجديد Production؛ كذلك تتوقف عملية الحذف عند تجديد قديم مجهول البيئة حتى مراجعته. هذه الحماية لا تغيّر الإلغاء الأصلي لمشتريات App Store.
- تُحدَّث نسخة الاستحقاق عند الإقلاع وفتح الإعدادات أو الجدار، وعند العودة أثناء الشراء. قبل فتح أي دفع يجب نجاح `/api/me` جديد؛ فشل الشبكة يوقف الشراء ويحفظ سجل Apple/المنحة المخزن، ولا يُعتبر نجاح تفعيل.
- قبل التحويل إلى Live: حدّث النسخة الاحتياطية وراجع إحصاءً مجمّعًا للاشتراكات حسب المصدر والبيئة، وتحقق من سجل الترحيلات المطبّقة. نسخة D1 الخاصة السابقة للترحيلين صُدّرت بالفعل في 2026-09-18. راجع **العاملين** إذا كان `maydan-game` و`maydan-rooms` منشورين ويشتركان في D1؛ لم يتضمن هذا الإصدار نشر `maydan-rooms` بصورة منفصلة، فلا تفترض تحديثه أو تترك نسخة قديمة تتجاهل عزل البيئة أو تكتب ربط العميل القديم.
- بدّل الإعدادات كحزمة واحدة في النشر المعتمد: `PADDLE_ENV=production`، رمز عميل Live، مفتاح API Live، سر webhook Live، ومعرف سعر Live الشهري فقط. اترك `PADDLE_API_URL` غير مضبوط كي يُشتق عنوان الإنتاج الصحيح، ولا تغير متغيرات `APPLE_*`. إعادة تحميل الصفحة بعد التحويل تضمن بدء Paddle.js بإعدادات البيئة الجديدة.

شروط التحقق بعد التحويل المستقبلي إلى Live، دون تنفيذ شراء حقيقي: `/api/billing/config` يعلن `production` ومعرف السعر الشهري فقط؛ المعاينة تعرض السعر المجلوب من Live ولا تعرض السنوية؛ صفحة الدفع الافتراضية تحمل SDK وتتعامل مع `_ptxn`؛ لا يمنح حساب له سجل Sandbox فقط استحقاقًا في `/api/me` أو الغرف؛ معاملة Checkout جديدة تستعمل عميل Live؛ رابط البوابة يأتي من Live؛ إشعار صحيح يصل ويُحفظ مرة واحدة، والمزوّر/سر Sandbox يُرفض؛ Apple والمنح المسجلة يبقيان صالحين. هذه متطلبات تفعيل Live وليست وصفًا لبيئة إصدار 2026-09-18 التي بقيت Sandbox. إنشاء معاملة أو فتح Checkout لا يثبت تسوية دفع حقيقي، وإكمال عملية دفع يحتاج إذنًا منفصلًا.

المراجع: [قائمة التحويل إلى Live](https://developer.paddle.com/build/go-live-checklist/)، [فصل بيانات Sandbox](https://developer.paddle.com/sdks/sandbox/)، [أحداث الاستحقاق](https://developer.paddle.com/build/subscriptions/provision-access-webhooks/).

### منع تكرار الشراء واستعادة المحاولة

قبل إنشاء المعاملة يحجز الخادم صفًا ذريًا في D1، ويرسل `custom_data.checkoutAttemptId` مع `userId`. الطلب المتزامن ينتظر بنتيجة `CHECKOUT_PENDING`. إعادة المحاولة تستخدم معرّف المعاملة نفسها فقط بعد قراءتها من Paddle والتحقق من الحساب والمحاولة والسعر، إذا كانت `draft` أو `ready`. تغيير الخطة لا ينشئ رابطًا ثانيًا ما دام الأول قابلًا للدفع. `paid` و`completed` ليستا محاولتين فاشلتين، و`paused` قد يستأنف الخصم؛ لا يُفتح حجز جديد إلا بعد تأكيد إلغاء المعاملة، أو تأكيد انتهاء اشتراكها وحالته `canceled` من المزوّد.

لا يدعم Paddle مفتاح idempotency يحدده العميل، وانقطاع الرد لا يثبت فشل الإنشاء. لذلك timeout أو 5xx أو الرد الملتبس يُبقي الحجز ويعيد `CHECKOUT_REVIEW`، دون مهلة تحرره آليًا. إشعار `transaction.created` أو `transaction.updated` الموقّع يربط المعاملة بالحجز نفسه؛ لا يمنح صلاحية بحد ذاته. بعدها تعيد المحاولة قراءة المزوّد وتفتح المعاملة السابقة. رفض تحقق/مصادقة صريح قبل إنشاء المعاملة يسمح بمحاولة لاحقة، وكذلك فشل تجهيز العميل قبل POST المعاملة.

للدعم عند غياب الإشعار: ابحث في حساب Paddle الصحيح والإشعارات والسجلات عن `checkoutAttemptId` و`userId`، وأعد إرسال الإشعار الأصلي من Paddle إن وُجد. لا تمسح الحجز بسبب عمره أو غياب نتيجة بحث واحدة، ولا تطلب دفعًا آخر قبل حسم المعاملة السابقة. إذا تعطل العامل قبل إرسال الطلب أصلًا، يلزم إثبات عدم وجود معاملة قابلة للدفع ثم رفع الحجز المحدد بإجراء إداري موثق. حذف الحساب يتوقف أثناء محاولة مجهولة أو رابط قابل للدفع، ويحرر علامة الحذف عند فشل الطلب مع إبقاء حجز الدفع. الاشتراك الموقوف `paused` يُلغى بعد التحقق منه لأن توقفه لا يمنع استئناف الخصم؛ الإلغاء المجدول المؤكد من Paddle لا يُرسل مرة ثانية. تعطل العامل أثناء الحذف قد يترك `account_deletions`: يراجع الدعم نتائج الإلغاء والحجز ثم يرفع علامة المحاولة المحددة؛ لا تُحذف حجوزات الدفع معها. الحساب وإدارة الاشتراك يبقيان متاحين أثناء هذه المراجعة.

هذه الحماية تسري على معاملات ينشئها الكود الجديد. قبل التفعيل التجاري، راجع أي معاملات Live قديمة أُنشئت قبل الترحيل ولم تصل اشتراكاتها بعد؛ لا يمكن استنتاج عدم وجودها من جدول الحجز الجديد الفارغ.

المراجع: [حدود إعادة الطلب وidempotency](https://developer.paddle.com/sdks/libraries/)، [بيانات المعاملة المخصصة](https://developer.paddle.com/build/transactions/custom-data/)، [إعادة فتح معاملة موجودة](https://developer.paddle.com/build/transactions/pass-transaction-checkout/).

### التوقيع وإعادة الإرسال

ترويسة `Paddle-Signature: ts=<ثانية>;h1=<hex>` حيث `h1 = HMAC-SHA256(secret, "${ts}:${الجسم الخام}")`.

- الجسم يُقرأ **خامًا** ولا يمرّ على تحليل JSON قبل التحقق.
- انحراف زمني أكثر من **5 دقائق** يُرفض بـ`SIGNATURE`.
- تُكتب علامة المعالجة بـ`event_id` في `webhook_events` بعد نجاح تحديث الاستحقاق، فإعادة الإرسال من لوحة Paddle آمنة تمامًا: تردّ `200 {"duplicate": true}` بلا أي كتابة.
- التحديث **رتيب**: حدث أقدم (`occurred_at`) يصل متأخرًا لا يُرجع حالة الاشتراك إلى الوراء. لذلك إعادة إرسال دفعة قديمة لا تُفسد اشتراكًا حاليًا.

لإعادة الإرسال يدويًا: **Notifications → اختر الوجهة → Logs → Replay**. إشعارات آبل تُعاد بالطريقة نفسها عبر `Request a Test Notification` أو إعادة المحاولة التلقائية؛ التكرار محميّ بـ`notificationUUID`.

---

## رموز الهدايا

- التفعيل يحتاج تسجيل الدخول واتصالًا بالخادم؛ POST /api/redeem هو المسؤول الوحيد عن القبول. لا بصمات صالحة ولا رموز خام في حزمة العميل.
- ضع بصمات SHA-256 للرموز المطَبَّعة في السر REDEEM_CODE_HASHES مفصولة بفواصل. التطبيع في src/shared/account/redeem.js: أرقام عربية/فارسية إلى لاتينية، إزالة المسافات والشرطات، وأحرف كبيرة. استعمل رموزًا عشوائية طويلة، ولا تعِد استخدام الرمز القديم المنشور في تاريخ المستودع.
- المنحة الحالية تحتفظ بمدتها السابقة (100 سنة بلا تجديد)؛ إزالة بصمة توقف تفعيلات جديدة، ولا تلغي المنح المسجلة فعلًا في قاعدة البيانات.
- الترحيل الأمني بتاريخ 2026-09-17 يغلق التفعيل المحلي دون حساب ويحذف الرمز الخام القديم من الجهاز. التفعيلات التي كانت محلية فقط تحتاج منحة جديدة يصرح بها المالك؛ لا تتحول تلقائيًا إلى اشتراك. الاشتراكات والمنح المسجلة على الخادم محفوظة.
- هذه رموز جماعية قابلة للاستعمال على أكثر من حساب، وليست كوبونات لمرة واحدة أو محدودة العدد. يلزم سجل مستقل للإصدارات وحدود الاستعمال والانتهاء إذا أُريد بيع كوبونات.
- لا يظهر زر إدخال الرموز داخل iOS؛ راجع قواعد المتجر المناسبة لبلدان التوزيع قبل تغيير ذلك.

## التنظيف الدوري

`triggers.crons` في `wrangler.jsonc` و`wrangler.rooms.jsonc` يشغّل `scheduled` (server/accounts/cleanup.mjs) يوميًا: يحذف الجلسات التي انتهت أو أُبطلت قبل أكثر من 30 يومًا، ورموز الدخول المنتهية، وأحداث webhooks الأقدم من 90 يومًا. لا يمسّ المستخدمين ولا الاشتراكات ولا التجارب. للتشغيل اليدوي محليًا: `npx wrangler dev --test-scheduled` ثم `curl "http://localhost:8787/__scheduled?cron=17+3+*+*+*"`.

## التشغيل

- **إعادة إرسال webhook من Paddle**: لوحة Paddle → Notifications → اختر الإشعار → Replay. الخادم يمنع التكرار بـ`event_id` داخل نافذة 90 يومًا، فالإعادة آمنة. من آبل: App Store Connect → App Information → App Store Server Notifications → Request a Test Notification، أو أعد إرسال الإشعار من سجل الإشعارات؛ التكرار محمي بـ`notificationUUID`.
- **نسخة احتياطية من D1**: `npx wrangler d1 export maydan-accounts --remote --output backup.sql` (أو `--no-data` للمخطط فقط)، والاستعادة بـ`npx wrangler d1 execute maydan-accounts --remote --file backup.sql`. D1 يحتفظ أيضًا بـTime Travel لمدة 30 يومًا: `npx wrangler d1 time-travel restore maydan-accounts --timestamp=<ISO>`.
- **حذف الحساب**: `DELETE /api/account` يؤكد إلغاء تجديد Paddle عند نهاية الفترة، ثم يؤكد إبطال رمز تحديث آبل، ثم يحذف صفوف المستخدم. إذا تعذر التأكيد يبقى الحساب وتظهر رسالة خطأ قابلة لإعادة المحاولة؛ لا يفقد العميل وسيلة إدارة اشتراك ما زال يتجدد. اشتراك App Store لا يُلغى من الخادم؛ الجدار وبطاقة الحساب يذكّران المستخدم بإلغائه من إعدادات جهازه.
- **الصفحات القانونية والتسعير**: `#/terms` و`#/privacy` داخل التطبيق والموقع (`src/platform/screens/Legal.jsx`)؛ روابطهما العامة في `ios/app-store.json` تُستعمل في App Store Connect وPaddle. نُشرت أيضًا `/pricing/` و`/refunds/` في إصدار الويب بتاريخ 2026-09-18. بريد الدعم في `SUPPORT_EMAIL` (`src/shared/account/config.js`)، وتاريخ آخر تحديث في `LEGAL_UPDATED`.
- **مرآة التجارب على iOS**: علامات المباريات المجانية تُحفظ أيضًا في UserDefaults عبر الجسر (`getTrials`/`markTrial`) وتُدمج عند الإقلاع، فمسح بيانات WebKit لا يعيد التجربة للمجهول.

## الأمان

- **فحص Origin**: كل طلب يحمل `Origin` يجب أن يكون ضمن `ALLOWED_ORIGINS`. في النشر الكامل (الصفحة والـAPI على الأصل نفسه) لا يرسل المتصفح `Origin` مع GET من الصفحة، فيُقبل GET/HEAD بلا `Origin` حين يثبت المتصفح أنه من الأصل نفسه (`Sec-Fetch-Site: same-origin`، أو `Referer` بالأصل نفسه للمتصفحات الأقدم) وكان ذلك الأصل مسموحًا. الكتابة (POST/DELETE) تحمل `Origin` دائمًا فتبقى مشروطة به.
- الخادم مصدر الحقيقة: لا يُكتب استحقاق من حمولة يرسلها العميل.
- `PRIMARY KEY (source, external_id)` يمنع ربط معاملة واحدة بحسابين.
- `appAccountToken` يجب أن يطابق الحساب الطالب، وإلا `ALREADY_LINKED`.
- `state` موقّع بـHMAC مع nonce ومهلة 10 دقائق؛ لا يُخزَّن شيء بينهما.
- رمز الدخول بعد المصادقة لمرة واحدة ولمدة 60 ثانية، ويسافر في **شظية** الرابط على الويب فلا يدخل سجلات الخادم ولا ترويسة Referer.
- `return` محصور بـ`APP_ORIGIN` أو أحد `ALLOWED_ORIGINS`/`EXTRA_ORIGINS` أو `maydan://auth`.
- لا `null` في CORS أبدًا؛ الأصل المجهول يُرفض بـ403 إلا في المسارات العامة (إعادة توجيه المزوّد وwebhooks) التي تحميها تواقيع المزوّدين أنفسهم.
- الجلسات ورموز الدخول مخزنة كبصمات، وسر عميل آبل يُولّد عند الطلب. رمز تحديث Apple محفوظ حاليًا في D1 لاستخدامه عند إلغاء التفويض؛ يجب تقييد الوصول إلى القاعدة ونسخها الاحتياطية. تشفير هذا الحقل بمفتاح مستقل تحسين إضافي.

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

## مراجعة الجاهزية (2026-09-17)

- لا تؤكد webhooks المعالجة قبل حفظ الاستحقاق؛ الأعطال العابرة لا تضيّع إعادة الإرسال. الاشتراك وعميل Paddle لا يُنقلان بصمت إلى حساب آخر.
- أسعار Paddle غير المعروفة لا تمنح Plus؛ الإيقاف أو الإلغاء الفعلي يوقف الاستحقاق، والإلغاء المجدول يحافظ عليه حتى نهاية الفترة. لا يبدأ الدفع دون سر webhook.
- اكتمال نافذة Paddle يتبعه انتظار لتأكيد الخادم. عند التأخر تظهر حالة انتظار وزر تحديث، بلا رسالة تفعيل زائفة. الحساب بلا بريد يدخله داخل Checkout بدل بريد مختلق.
- StoreKit يبقي المعاملة غير منتهية حتى يؤكد الخادم حفظ الاستحقاق. أوامر الجسر الجديدة pendingTransactions وfinishTransaction تعيد ما لم يُعالج عند الدخول والإقلاع وعودة الشبكة والواجهة.
- سر Apple يستخدم جمهور التطبيق أو Services ID المناسب؛ OAuth يرفض nonce المفقود ولا يستخدم سر state افتراضيًا في الإنتاج.
- إدارة اشتراك Apple من الويب تتجه إلى صفحة Apple، وعلى iPhone إلى ورقة المتجر. اشتراك Paddle يُدار من الموقع.
- تحقق شهادات Apple محلي بسلسلة مثبتة؛ صلاحية الشهادة تفحص عند تاريخ توقيع المعاملة لاستعادة المعاملات القديمة. فحص الإبطال عبر OCSP غير مطبق؛ اختبر المسار مقابل مكتبة Apple الرسمية قبل الاعتماد التجاري الواسع.

## بوابة النشر الفعلي

الاختبارات الوهمية لا تثبت شراءً حقيقيًا. نُشر إصدار الويب المختبر في 2026-09-18 كما هو مسجل أعلاه، مع تطبيق ترحيلات D1 وبقاء Paddle في Sandbox دون تغيير إعداداته أو أسراره. وجود المعرّفات العامة لا يثبت نجاح تبادل OAuth أو صحة كل الأسرار. المطلوب قبل الإطلاق المدفوع:

1. اختبار دخول Apple على الويب وiPhone، وGoogle، وروابط العودة، وSESSION_SECRET. fallback دخول Apple دون مفتاح تبادل لا يحفظ refresh token، لذلك لا يعد إعداد إنتاج مكتملًا.
2. منتجا StoreKit في مجموعة واحدة، اتفاقيات وضرائب وبيانات الدفع في App Store Connect، مفاتيح Server API، webhook V2، وحسابات Sandbox/TestFlight.
3. أسعار ورمز عميل ومفتاح API وسر webhook من Paddle Production، موافقة الموقع ونقطة دفع افتراضية؛ لا تستخدم أسعار Sandbox في الإنتاج.
4. دورة شراء فعلية في Sandbox لكلا المنصتين: شراء واستعادة وتجديد وإلغاء واسترداد، وتأخر webhook وفشل الشبكة بعد الدفع وتسجيل الدخول على جهاز ثانٍ.
5. بناء Xcode وتوقيعه واختبار جهاز حقيقي؛ فحص عقد Swift في Node لا يترجم Swift. معاملات StoreKit المحلية موقعة بشهادة اختبار Xcode؛ استخدم Sandbox لاختبار الخادم ذي جذر Apple الحقيقي.
6. اختبار حذف الحساب مع اشتراك قائم. إلغاء App Store مستقل. الدخول بالمزوّد نفسه يعمل على الأجهزة؛ ربط هويتي Apple وGoogle مختلفتين ليس تدفقًا منفذًا حاليًا.
7. مراقبة فشل webhook ومطابقة دورية مع المزوّد لاكتشاف الإشعارات المفقودة؛ مهمة التنظيف الحالية لا تنفذ هذه المطابقة.

الاختبار tests/accounts-billing-reliability.test.js يغطي فشل الحفظ والإلغاء وإعادة الإرسال والملكية والبيئة وترتيب إنهاء StoreKit والتفعيل المؤجل. لا يستدعي فوترة حقيقية.

مصادر رسمية: [أحداث Paddle](https://developer.paddle.com/webhooks/about/how-webhooks-work/)، [حالات الاستحقاق](https://developer.paddle.com/build/subscriptions/provision-access-webhooks/)، [إنهاء معاملة Apple](https://developer.apple.com/documentation/storekit/transaction/finish%28%29)، [بيئات App Store Server API](https://developer.apple.com/documentation/appstoreserverapi)، [مكتبة تحقق Apple](https://github.com/apple/app-store-server-library-node/blob/main/jws_verification.ts).

### إضافات تجهيز Live المحلية — 18 سبتمبر 2026

أُنجز اتصال Live ونقل المنتج والخطة الشهرية المعتمدة بقيمة5USD بعد جرد الحسابين. أُضيفت كيانات مفقودة فقط؛ لم تُعدّل كيانات قائمة أو بيانات عملاء/اشتراكات. الموقع العام يبقىSandbox، ومعاينةLive محلية والشراء مغلق.

- `.env.example` قالب فارغ للتجهيز، وليس ملفًا تقرؤه خدمة Cloudflare المنشورة. مفاتيح الخادم أسرار بيئة تشغيل، ورمز الواجهة ومعرّفات الأسعار إعدادات عامة. لم توضع مفاتيح Live في الشيفرة. يحتاج نقل الكتالوج قراءة الحسابين وتسجيل ربط معرّف كل كيان قبل الإنشاء، وإعادة استخدام الكيانات المتطابقة الموجودة. السعر السنوي غير معتمد في واجهة الإنتاج.
- `PADDLE_CHECKOUT_ENABLED=false` يمنع إنشاء المعاملات من الخادم قبل أي حجز أو إنشاء عميل. الإنتاج مغلق افتراضيًا؛ Sandbox يبقى على سلوكه السابق. إعلان `checkoutEnabled` في الإعداد العام يسمح للواجهة وصفحة `_ptxn` بعرض حالة الانتظار دون فتح الدفع.
- `server/accounts/paddle-ips.mjs` يحمّل `data.ipv4_cidrs` من `https://api.paddle.com/ips`؛ لا تُنسخ قائمة ثابتة إلى الإعدادات. يطبّق Live فقط، ويتحقق من `CF-Connecting-IP` عند دخول Cloudflare المباشر. لا يعتمد `X-Forwarded-For`، ولا يغني عن HMAC. قوائم IPv4 الحالية `/32`؛ تغيير شكلها يتطلب مراجعة.
- مدة الجلب القصوى1.5 ثانية، مع طلب مشترك وذاكرة قائمة صحيحة لساعة. أثناء تعطل المصدر يُسمح فقط لعنوان معروف من آخر قائمة بعمر أقل من24 ساعة؛ غياب قائمة موثوقة يعيد503، والعنوان غير المسموح مع قائمة حديثة يعيد403. لا يصل رفض IP إلى تحليل الجسم أو كتابة بيانات الاشتراك. يجب أن تشير وجهة Paddle مباشرةً إلى Worker؛ أي وسيط يغيّر عنوان المصدر يحتاج مراجعة قبل التفعيل.
- واجهات المنتج والسياسات المنشورة متاحة، لكن تغييرات الشيفرة المحلية اللاحقة لا تظهر للمستخدمين حتى نشر منفصل. لا تبدأ تحقق حساب أو دفع Live آليًا من سكربتات التدقيق.

مصادر الإعداد: [مفاتيح API](https://developer.paddle.com/api-reference/about/authentication/)، [صلاحيات المفاتيح](https://developer.paddle.com/api-reference/about/permissions/)، [عناوين Paddle](https://developer.paddle.com/api-reference/ip-addresses/get-ip-addresses/)، [تسليم الإشعارات](https://developer.paddle.com/webhooks/about/respond-to-webhooks/).


### مستقبِل Live الدائم

نُشر `server/paddle-live-worker.mjs` عبر `wrangler.paddle-live.jsonc` باسم `maydan-paddle-live`. الوجهة `https://maydan-paddle-live.mf103871.workers.dev/api/paddle/webhook` مربوطة بوجهةPaddle `ntfset_01m2rqw7p3y1ze2nyqbsma21gx` وسرها فيCloudflare. لا تُعد إنشاء الوجهة أوتدوير سرها. العامل يشترك فيD1 الأصلية، ويتحقق منproduction والإعدادات ثمIP ثمHMAC قبلD1، ولا يفتح إلاhealth وPOST webhook. لا يحتاجAPI key أوclient token. لم تُغيّر قاعدة الإنتاج في اختبار النقل.

رمز الواجهة وAPI key وسرالتوقيع ومعرّفالسعر الحقيقي للمعاينة محفوظة خارجالمصدر في ملف محلي خاص. `.env.example` قالب فقط. عندالإطلاق انقل هذه الإعدادات إلى العامل العام في نشر منسق بعد اعتماد الحساب؛ لا تغيّر بيئةSandbox العامة الآن.

اعتمد Cloudflare `redirect:manual` لطلب قائمةIP، ثم رفض أي3xx. `redirect:error` غير مدعوم فيworkerd؛ يحمي اختبارالتكامل من إعادة هذا الخلل.
