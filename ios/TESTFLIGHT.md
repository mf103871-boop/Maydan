# بناء iOS موقّع ورفعه اختياريًا إلى TestFlight

سير GitHub Actions **iOS signed build and optional TestFlight upload** مثبّت في `.github/workflows/ios-testflight.yml` على الفرع الرئيسي منذ 25 سبتمبر 2026، ونسخته المرجعية محفوظة في `docs/ci/ios-testflight.yml.template`. يعمل يدويًا فقط. يُنتج IPA موقّعًا لسجل التطبيق الحالي `6808385717`، بالمعرّف `Maydan` والفريق `96WJBK2MB2`. الرفع مغلق افتراضيًا؛ لا يرسل إصدارًا إلى مراجعة App Store ولا ينشره للعامة. تثبيت السير لا يعني تجهيز أسرار التوقيع أو نجاح بناء موقّع؛ يلزم إكمال الخطوات التالية.

## الإعداد مرة واحدة

أضف الأسرار التالية في المستودع: **Settings → Secrets and variables → Actions**. استخدم شهادة Apple Distribution مع مفتاحها الخاص، وملف **App Store Connect distribution provisioning profile** الخاص بـ `Maydan` من الفريق نفسه. يجب أن يتضمن الملف Sign in with Apple وأن تكون الشهادة ضمن شهاداته. لا تضع الملفات أو قيمها في Git أو المحادثات. هذه هي طريقة [GitHub الموثقة لتوقيع تطبيقات Xcode](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications).

| السر | القيمة |
| --- | --- |
| `IOS_DISTRIBUTION_P12_BASE64` | ملف `.p12` المشفّر بكلمة مرور بعد تحويله إلى Base64، ويشمل المفتاح الخاص |
| `IOS_DISTRIBUTION_P12_PASSWORD` | كلمة مرور ملف `.p12` |
| `IOS_APP_STORE_PROFILE_BASE64` | ملف `.mobileprovision` لتوزيع App Store بعد تحويله إلى Base64 |
| `ASC_KEY_ID` | معرّف مفتاح **App Store Connect team API**، مطلوب عند اختيار الرفع |
| `ASC_ISSUER_ID` | Issuer ID لذلك المفتاح، مطلوب عند اختيار الرفع |
| `ASC_PRIVATE_KEY_BASE64` | ملف `.p8` الخاص بذلك المفتاح بعد تحويله إلى Base64، مطلوب عند اختيار الرفع |

مفتاح App Store Connect للرفع يختلف عن مفتاح In-App Purchase الذي يتحقق به خادم اللعبة من الاشتراكات. استخدم مفتاح فريق بصلاحية مناسبة لرفع الأبنية، وليس كلمة مرور Apple ID. لا ينشئ السير شهادة أو ملف provisioning أو مفتاح API؛ يتحقق من الموجود، ويطابق بصمة الشهادة مع الملف قبل بناء التطبيق.

يمكن على Mac نسخ الملف المشفّر مباشرة إلى حقل السر بالأمر `base64 -i /path/to/file | pbcopy`، مع استبدال المسار بالملف المناسب. تنشأ كلمة مرور عشوائية لسلسلة المفاتيح المؤقتة داخل كل تشغيل، ولا تحتاج سرًا إضافيًا.

## التشغيل

1. راجع الأبنية الموجودة في **App Store Connect → التطبيق 6808385717 → TestFlight**، واختر رقم بناء لم يُستخدم للإصدار المطلوب. قيم `preparedVersion` و`preparedBuild` في `ios/app-store.json` لا تثبت أن الرقم متاح.
2. من **Actions** اختر السير ثم **Run workflow**، وحدد الفرع المراد إصداره. يجب أن يوجد تعريف السير على الفرع الافتراضي ليظهر زر تشغيله.
3. أدخل `version` صراحة، مثل `1.5`، و`build` صراحة كعدد بين `1` و`9999`. الأمثلة ليست تأكيدًا لتوفر الأرقام. لا يختار السير الأرقام ولا يزيدها تلقائيًا.
4. اترك `upload_to_testflight` مغلقًا للبناء والتوقيع وحفظ ملف IPA فقط. نزّل الناتج من **Artifacts** خلال سبعة أيام. ملف App Store الموقّع لا يُثبّت مباشرة على iPhone مثل حزمة ad hoc.
5. فعّل خيار الرفع فقط عند الرغبة بإرسال البناء إلى App Store Connect. نجاح الرفع يسبق معالجة Apple؛ تحقق بعد ذلك من ظهوره في TestFlight ومن معلومات التصدير المطلوبة، ثم اختبره على iPhone. [Apple تشرح مرحلة الرفع والمعالجة](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).

التشغيل يفحص اللعبة ويجهز مواردها من الفرع المختار، ويستخدم Xcode 26 أو أحدث. ملف provisioning يُثبت في مسار Xcode الحالي، وتُحذف الشهادة والمفتاح الخاص وسلسلة المفاتيح ونسخة الملف المؤقتة في نهاية التشغيل حتى عند الفشل. لا يرفق السير أسرار التوقيع أو ملفاتها الخام ضمن الناتج؛ يحتفظ فقط بملف IPA.

## التحقق وحدود الجاهزية

تُختبر قواعد الأرقام وهوية التطبيق وصلاحية provisioning ومطابقة الشهادة محليًا وبداخل السير باستخدام `python3 -m unittest discover -s scripts/ios -p 'test_signing.py'`. فحص YAML وهذه الاختبارات لا يثبتان نجاح التوقيع أو رفع نسخة حقيقية؛ ذلك يتطلب الأسرار الصحيحة وتشغيل macOS.

بعد وصول البناء إلى TestFlight، اختبر تسجيل الدخول وشراء الاشتراك واستعادته والحفظ والتحديث فوق نسخة App Store الحالية على جهاز حقيقي. هذا السير لا يفعّل منتجات الاشتراك ولا يكمل اتفاقيات Apple أو بيانات المتجر نيابة عن صاحب الحساب.

المراجع التقنية: [التوقيع والتوزيع من سطر أوامر Xcode](https://developer.apple.com/videos/play/wwdc2021/10204/)، [مسار ملفات provisioning في Xcode](https://developer.apple.com/documentation/Xcode-Release-Notes/xcode-16-release-notes).
