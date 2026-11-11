# تجربة إعلان ميدان على iOS محليًا

المشروع المُولّد يشغّل وحدة Google Rewarded الاختبارية على غلاف ميدان الأصلي. مسار Simulator يستخدم خادمًا محليًا وحسابات اصطناعية. مشاهدة الوحدة التجريبية تعرض حالة انتظار الخادم عند استحقاق المكافأة. التحقق الفعلي من SSV يحتاج وحدة اختبار مرتبطة بتطبيق AdMob ونقطة HTTPS معزولة يمكن لـGoogle الوصول إليها.

## إعداد المحاكي

1. على Mac جهّز Xcode 26.2 أو أحدث وNode.js 22 وثبّت اعتماديات المستودع بواسطة `npm ci`. هدف التطبيق iOS 16.4، وGoogle Mobile Ads 13.12.0 يدعم iOS 13 فأحدث. UMP 3.1.0 يدعم iOS 12 فأحدث. سير CI الحالي يطلب Xcode 26 على الأقل ويبني هدف النشر وحده.
2. شغّل الخادم في نافذة طرفية. عنوانه `http://127.0.0.1:4198` على الجهاز نفسه.

   ```sh
   node scripts/rewarded-preview/server.mjs --native
   ```

3. ولّد مشروع Xcode وموارده في نافذة أخرى. يطبع الأمر مسار المشروع داخل `.cache`. افتح المشروع الذي طُبع واختر جهاز iPhone في Simulator، ثم شغّل Debug.

   ```sh
   node scripts/ios/rewarded-preview.mjs
   ```

   يمكن بناء المشروع من الطرفية بتعيين `PROJECT` إلى المسار المطبوع:

   ```sh
   xcodebuild -project "$PROJECT" -scheme Maydan -configuration Debug \
     -destination 'generic/platform=iOS Simulator' \
     -onlyUsePackageVersionsFromResolvedFile CODE_SIGNING_ALLOWED=NO build
   ```

   لإنشاء إعدادات المشروع وحدها أضف `--project-only`. تحتوي نسخة المعاينة على حزمة `org.maydan.rewarded.preview` وتعرّف Google التجريبي وسجل شبكات SKAdNetwork من دليل Google. إعداد Debug هو الإعداد الوحيد، ويستخدم ملف الحزم المثبّت في المشروع المولّد.

4. افتح صفحة Web Inspector من قائمة Develop في Safari واختر صفحة `maydan://app/index.html` من Simulator. عند الحاجة فعّل ميزات مطوّري الويب من الإعدادات المتقدمة في Safari. استخدم التالي في وحدة التحكم لدخول حساب اصطناعي من مجموعة B في خادم المعاينة. ابدأ من تثبيت محاكاة جديد أو سجّل الخروج من الحساب الاصطناعي السابق أولًا.

   ```js
   await (async () => {
     const origin = "http://127.0.0.1:4198";
     for (let n = 1; n <= 12; n++) {
       const signIn = await fetch(origin + "/api/auth/dev", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ subject: "rewarded-ios-fixture-" + n, name: "لاعب اختبار", client: "ios" })
       });
       if (!signIn.ok) throw new Error("Local fixture sign-in failed: " + signIn.status);
       const { session } = await signIn.json();
       const result = await fetch(origin + "/api/rewarded/status?offer=badeeha-demo", {
         headers: { Authorization: "Bearer " + session.token }
       });
       if (!result.ok) throw new Error("Local fixture status failed: " + result.status);
       if ((await result.json()).group !== "B") continue;
       localStorage.setItem("maydan:environment:" + encodeURIComponent(origin) + ":account:session", JSON.stringify(session.token));
       location.hash = "#/game/badeeha?mode=local";
       location.reload();
       return "Local cohort B ready";
     }
     throw new Error("No local cohort B fixture found");
   })()
   ```

5. العب المباراة المجانية الأولى في تحدّي بديهة التجريبي وأكملها، ثم افتح خيار «شاهد إعلان والعب مباراة كاملة». جرّب الإغلاق المبكر، والمشاهدة الكاملة في حساب يسمح بطلب إعلان، والخروج من شاشة الاختيار أو وضع التطبيق في الخلفية أثناء التحميل. افتح «خيارات خصوصية الإعلانات» إذا عرضتها UMP. الإبلاغ عن آخر إعلان يفتح مسودة بريد داخل التطبيق أو لوحة المشاركة بعد ظهور إعلان فعلي؛ يراجع اللاعب البلاغ ويرسله بنفسه.

## حدود التحقق

- قبل فتح إعلان يتحقق الغلاف من المصدر والإطار الرئيسي والمسار وعمر الطلب وكون التطبيق في المقدمة، ويعيد فحص عناصر الاختيار بعد العمليات غير المتزامنة. أثناء العرض يوقف وسائط اللعبة مؤقتًا. تجربة استعادة الصوت، وصلاحيات UMP، وعدم الإعاقة أثناء المكالمة تحتاج تشغيل المحاكي ثم جهاز iPhone.
- معرف الوحدة التجريبي مثبت في معاينة iOS. بيانات SSV المرفقة رمز مبهم فقط. حالة اكتمال SDK تظهر «جارٍ تأكيد التذكرة» وتبقى التذكرة بانتظار إثبات الخادم. المحاكاة التي تمنح تذكرة موجودة في معاينة المتصفح فقط.
- التطبيق التجريبي لا يطلب إذن ATT. يُعطّل تخصيص الإعلانات ومعرف الناشر الأولي وخيار قراءة الموقع التقريبي من صلاحية الموقع، وتُضبط ملاءمة الإعلان على التصنيف العام. قد يستنتج المزوّد موقعًا تقريبيًا من عنوان IP. بيان Google Mobile Ads 13.12.0 يذكر بيانات مثل التشخيص والأداء، والموقع التقريبي، ومعرف الجهاز، وبيانات الإعلان والتفاعل. بيان UMP 3.1.0 يذكر الموقع التقريبي والأداء والتفاعل. قبل أي إصدار عام تُراجع التقارير المجمّعة على Xcode وإعدادات الجمهور والقاصرين ومزودو الإعلانات الفعليون وإفصاحات App Store وATT وفق الاستخدام الفعلي.
- جهاز iPhone فعلي يستخدم عنوان loopback الخاص به. لتجربة SSV الحقيقي لاحقًا يلزم خادم اختبار مستقل على HTTPS، ومفتاح تشغيل اختبار منفصل، ووحدة AdMob مع SSV وحسابات اختبار. المشروع هنا لا يتضمن إعدادات رفع أو توقيع للإنتاج.

[دليل Google Mobile Ads على iOS](https://developers.google.com/admob/ios/quick-start) · [ملاحظات الإصدارات](https://developers.google.com/admob/ios/rel-notes) · [UMP](https://developers.google.com/admob/ios/privacy) · [المكافآت](https://developers.google.com/admob/ios/rewarded) · [إفصاحات Google](https://developers.google.com/admob/ios/privacy/data-disclosure) · [خصوصية تطبيقات Apple](https://developer.apple.com/app-store/app-privacy-details/)
# Signed App Store/TestFlight configuration

The ordinary signed workflow defaults to `rewarded_mode=off`. The generator
writes a separate ignored Xcode project when a signed Rewarded mode is
explicitly selected. Xcode uses the existing `Maydan` bundle, distribution
signing and entitlements. The signed workflow verifies the app ID, unit ID
and API environment in the simulator product, archive and IPA.

| Mode | API environment | AdMob configuration |
| --- | --- | --- |
| `testflight` | `mafia-preview` | Google sample Rewarded unit. Optional owned iOS App ID. |
| `testflight-owned` | `mafia-preview` | Owned iOS App ID and dedicated QA unit. Exact marketing version verified with AdMob Test mode ON. Apple-verified sandbox distribution required. |
| `live` | `production` | Owned iOS App ID and Rewarded unit for the same publisher. Apple-verified production download required. |

Select `testflight` for visual and consent testing. A Google sample
impression on TestFlight does not prove that AdMob is serving from an owned
unit or that the real signed reward callback is connected. Verify the owned
unit in the AdMob dashboard and test its SSV endpoint separately. The server
controls ad availability and is the only authority that can issue a ticket.
Use Xcode 26.2 or newer for the signed Ads SDK project.

Before using `testflight-owned`, verify that the marketing version is beta-only
in App Store Connect, and read back Test mode ON for that exact version in
[AdMob Test apps](https://support.google.com/admob/answer/17080939). Enter
that value as `admob_test_version` with the same `version` in the signed
workflow. The beta unit's SSV URL must point to the preview API and its ads
switch must be enabled only while this provider-side safeguard is active.
Check that the displayed creative says Test mode. If it does not, close it
and disable the preview ads switch before continuing. Before submitting a
public version, check that it uses the separate live unit and that its
marketing version is out of Test mode. The dashboard's Verify URL result
proves receipt of its signed probe; verify ticket redemption from a device
by observing the actual completion callback for that device's attempt.

