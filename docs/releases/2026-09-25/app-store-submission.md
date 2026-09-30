# App Store submission preparation — 2026-09-25

This is a preparation record, not evidence that the new release has been uploaded, submitted or approved. The release operator checked the observations below in signed-in App Store Connect and GitHub sessions on 25 September 2026. They supersede earlier same-day notes that signing secrets or TestFlight builds did not exist.

For the rejection received on 28 September and replacement-build preparation, see [the 1 October review-fix record](../2026-10-01/app-store-review-fix.md). The observations below retain their original dates.

## Observed release state

| Item | Observed state |
| --- | --- |
| Existing application | Apple ID `6808385717`, bundle `Maydan`, team `96WJBK2MB2`; use this record rather than creating an app. |
| App Store version | `1.5`, **Prepare for Submission**; build `1.5 (2)` is currently selected. Five screenshots and older six-game/purchase metadata were present. |
| TestFlight builds | Builds `1.5 (1)`, `(2)`, `(3)` and `(4)` were all processed, shown Complete / Ready to Submit. Latest: **1.5 (4)**, uploaded 25 September at **5:40 PM local time**. This does not establish App Review approval or device-test success. |
| Signed workflow history | Four successful TestFlight workflow runs were observed. Latest: [run 36148561528](https://github.com/mf103871-boop/Maydan/actions/runs/36148561528), source commit `6bdbf89`, matching build 4. |
| GitHub signing configuration | All six required Actions secret names were present: `IOS_DISTRIBUTION_P12_BASE64`, `IOS_DISTRIBUTION_P12_PASSWORD`, `IOS_APP_STORE_PROFILE_BASE64`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY_BASE64`. No values or certificate/private-key contents are recorded here. |
| Source to release | The release branch is now based on `e8b4a41`, including the latest Google sign-in diagnostic fix; build 4's `6bdbf89` contains friends/chat from `d11c7be`, but predates profiles, moderation and these privacy changes. This source has **not yet been uploaded** to TestFlight. |
| Planned build | **1.5 (5)** is prepared after checking builds 1–4. This is not an upload or reservation: check for another upload immediately before dispatch. Explicit workflow inputs determine archive numbers. |
| Agreements | Free Apps: **Active**. Paid Apps Agreement: **Pending User Info**. Bank details missing; US tax questionnaire: **Missing Tax Info**. DSA: **Active**. The owner was asked to complete financial/tax information privately. |
| Review contact | Support email: `mf103871@gmail.com`. A review-contact phone number has been requested from the owner; do not invent it. |
| Apple purchase backend | The public configuration reported `apple.purchasesConfigured: true` on 25 September. Earlier signed TEST notifications succeeded. Neither proves a purchase, renewal or restoration. |
| Privacy labels | All **12** categories matching the manifest were entered in App Store Connect and showed **Published** during the release check. Recheck before submission. |

The existing `.github/workflows/ios-testflight.yml` uses macOS and stable Xcode 26 or newer, builds current resources, validates manual distribution signing and exports an IPA. Optional upload reaches App Store Connect/TestFlight; it does not submit App Review or publish the app. See [the signing guide](../../../ios/TESTFLIGHT.md).

## Remaining release checks

1. The release branch now includes text filtering, report review/removal and private pending-image moderation. Local server tests cover authorization, image approval, preservation of the old approved photo during replacement, and account deletion; full tests and Cloudflare dry-run passed. Before production deployment, configure and verify the owner's moderator account via `MODERATOR_USER_IDS`, then apply `0007_moderation.sql`. That migration queues existing profile photos, which remain hidden until approved. Do not claim a staffed response time.
2. The **12** privacy categories were published in App Store Connect and are mapped in [the privacy audit](../../../ios/PRIVACY-DISCLOSURES.md); recheck them before submission. Finish the age-rating questionnaire for messaging and user-generated content; do not infer a rating from the old version.
3. Have the owner finish the bank/tax requirements and provide the review-contact phone. Recheck Paid Apps and subscription-product status before declaring paid subscriptions ready. Attach the first submission of `plus.monthly` / `plus.yearly` where Apple requires it.
4. After production moderation is configured and code/tests are final, check the latest App Store Connect build list, then dispatch the existing workflow from the verified release ref with `version=1.5`, the next unused build number, and upload enabled. Record the SHA, run URL and Apple processing result here. Do not assume build 5 is still unused.
5. Install that exact build through TestFlight on a real iPhone. Check Apple/Google sign-in, sign-out/account isolation, update over the installed version, retained local saves, photo selection/camera/crop and final image-review visibility, friend request/accept, private messages/read receipts, block/report, profile editing and deletion of an expendable test account. Check eligible completed-game statistics without attributing local players' wins to the host account.
6. Test subscription purchase/restore and interrupted transaction recovery in Apple's test environment; verify localized monthly/yearly StoreKit prices. A paid agreement, configured key or JavaScript bridge test does not replace this check.
7. Replace selected build 2 with the new processed/tested build, refresh screenshots, and update metadata/reviewer notes. Confirm support/privacy/terms links and review information, then submit App Review. This record does not claim that submission or public release has happened.

Apple references: [upload and processing](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/), [choosing a build](https://developer.apple.com/help/app-store-connect/manage-builds/choose-a-build-to-submit/), [user-generated content requirements](https://developer.apple.com/app-store/review/guidelines/#user-generated-content).

## Draft Arabic store metadata

These texts describe the intended new build. Do not present its features as available in selected build 2. Keep purchase availability and image-review wording consistent with the final tested build.

**Name:** ميدان: ألعاب جمعتنا

**Subtitle:** تحديات وضحك للأصدقاء والعائلة

**Promotional text:** ست ألعاب عربية لجمعتكم، وأصدقاء ومحادثات نصية وملف شخصي يعرض إنجازاتك. العبوا على جهاز واحد، أو انضموا لغرف مين فينا وفبركة من أجهزتكم.

**Description:**

جمعتكم تحتاج لعبة؟ ميدان يجمع ست ألعاب عربية للأصدقاء والعائلة: بَديهة، بيب، ممنوع، جبين، فبركة ومين فينا.

تنافسوا في المعرفة وسرعة البديهة والتخمين، وجرّبوا ألعاب الجهاز الواحد. وفي مين فينا وفبركة، أنشئوا غرفة أو انضموا إليها برمز من أجهزة مختلفة عبر الإنترنت.

أضف أصحابك بالاسم أو رمز الصديق. بعد قبول الطلب، افتح محادثة نصية خاصة، وشاهد قراءة الرسائل ومؤشر الكتابة. يمكنك تعديل رسالتك أو حذفها، وحظر حساب أو الإبلاغ عن محتوى مسيء. المحادثات نصية فقط.

اجعل لملفك لمستك: اسم ونبذة وصورة شخصية وغلاف وألوان تختارها، مع ألقاب وشارات تفتحها من الإنجازات. تابع الجلسات المكتملة التي استضفتها، ومبارياتك عبر الإنترنت والألعاب التي جرّبتها. تبدأ هذه الإحصاءات مع الميزة، ولا تستعيد نتائج اللعب القديمة؛ انتصارات الأونلاين تخص فبركة.

عشر فئات في بَديهة مجانية دائمًا، ولك مباراة كاملة مجانية في كل لعبة أخرى. الانضمام إلى الغرف برمز مجاني. يفتح اشتراك ميدان بلس كل فئات بَديهة والمباريات وإنشاء الغرف بلا حدود، بخطة شهرية أو سنوية متجددة تلقائيًا. يظهر سعر كل خطة ومدتها داخل التطبيق قبل الشراء، ويمكن إدارة الاشتراك أو إلغاؤه من حساب App Store واستعادة المشتريات من الإعدادات. لا يلزم الاشتراك لإنشاء ملفك أو التواصل مع أصدقائك.

تسجيل الدخول بحساب Apple أو Google مطلوب للأصدقاء والمحادثات والملف الشخصي وربط المشتريات بالحساب. تحتاج هذه الميزات والغرف عبر الإنترنت إلى اتصال بالإنترنت.

الخصوصية: https://maydan-game.mf103871.workers.dev/#/privacy

الشروط: https://maydan-game.mf103871.workers.dev/#/terms

الدعم: mf103871@gmail.com

**What's New:**

أضف أصحابك بالاسم أو رمز الصديق وتحدث معهم برسائل نصية خاصة بعد قبول الطلب، مع مؤشرات القراءة والكتابة وخيارات الحظر والإبلاغ.

خصّص ملفك بالاسم والنبذة والصورة والغلاف، واختر ألقابك وشاراتك المكتسبة. تابع الجلسات التي استضفتها ومبارياتك عبر الإنترنت وإنجازاتك الجديدة.

أسئلة بَديهة أكثر تحديًا وصور تُجهّز عند بداية اللعبة، مع اشتراك ميدان بلس الشهري أو السنوي وشراء واستعادة عبر App Store.

## Draft App Review notes (English)

Do not copy this section until the new build and moderation checks above are verified. Add the final tested build identifier and confirmed moderation behavior; no reviewer login, phone number or moderation response time is fabricated here.

Maydan is an Arabic party-game collection with six games. Most local game play is available without signing in. Ten Badeeha categories remain free; the other games each offer one complete free game. Joining an online room by code is free. Meen Fina and Fabraka support online rooms; the other game modes are designed around a shared device.

Sign in with Apple is available natively; Google is an alternative. An account is needed for friends, private text conversations, player profiles and linking a subscription. There is no separate Maydan password or hidden reviewer bypass. Review access to account features must be checked before submission; if Apple requires a dedicated review account, provide approved access through App Store Connect rather than inventing credentials.

To test friends and chat, sign in on two devices with separate accounts. Open Friends, copy one account's friend code, search it on the other device and send a request. Accept from Requests, then open the conversation. Messaging is available only between accepted friends and has no image, video or voice attachments. Message options include edit/delete for your own messages and reporting received messages. Account options provide block/report; blocked users cannot access the conversation. Conversations are stored server-side with access checks; they are not end-to-end encrypted.

Open your avatar/profile from Home or account settings to edit your display name, biography, theme, avatar and cover, or select earned titles and up to three earned badges. Pictures are user-selected; only the cropped/compressed image is uploaded. Profile statistics cover eligible completed sessions recorded since this feature was introduced. Local-hosted sessions do not award another local player's win to the account; online wins are recorded for Fabraka. Profiles/search do not expose the sign-in email.

Maydan Plus offers auto-renewable subscriptions `plus.monthly` and `plus.yearly`. Both unlock the same game content; StoreKit supplies the localized price and period. Purchases inside iOS use App Store in-app purchase. Restore Purchases and subscription management are available from account settings/the paywall. An account must be signed in so the verified entitlement can be attached to it. No web checkout or redemption-code purchase flow is offered inside iOS.

Account deletion is available in Settings while signed in and removes the Maydan account's related profile/social data. An App Store subscription is managed separately in the Apple account. Support and user-content reports can also be directed to mf103871@gmail.com. Privacy and terms are accessible within the app and at the links above.

## Validation recorded for this documentation change

- Passed: parsed the plist and compared all 12 unique categories with the audit table; each has App Functionality / linked / no tracking, tracking domains are empty, and UserDefaults retains reason `CA92.1`.
- Passed: native account contract tests **8/8** and signing helper tests **5/5**.
- Passed: unchanged app identity, prepared version/build `1.5 (5)`, current legal URLs, UTF-8/LF and whitespace checks. Draft name/subtitle/promotional text/What's New are 19/29/135/392 characters respectively, within their field limits.
- Branch follow-up verification: the full Node test suite, web build, Cloudflare deploy dry-run, question-bank validation and iOS resource preparation passed after syncing to `e8b4a41`. The production moderator binding, migration, TestFlight upload and physical-device behavior are not verified here.
- This work does not create a signed archive, upload a build, update private bank/tax information or submit App Review.
