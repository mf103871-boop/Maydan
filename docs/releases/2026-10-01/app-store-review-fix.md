# App Store review fix — 1 October 2026

App Store Connect's review of **1.5 (2)**, dated **28 September 2026**, identified two issues:

- **2.3.8 — Accurate Metadata:** the English App Store name and Arabic name displayed on the device did not identify the app consistently. Apple requests a replacement binary.
- **2.1(b) — App Completeness:** the in-app purchase products were not submitted for review. Apple requests the purchase products and their App Review screenshots with the new submission.

## Uploaded replacement

The replacement was built from **`9ea259e`**, the name fix on `2158682d5d55b491bbc12e1a558f6935660d1cc8` (`main`, including its latest audio updates). `CFBundleDisplayName` and the corresponding release metadata use **Maydan ميدان**, carrying the name used by both store languages. The app remains bundle `Maydan`, Apple ID `6808385717`, team `96WJBK2MB2` and version `1.5`. Subsequent documentation updates do not change the source of the uploaded binary.

The [signed build workflow](https://github.com/mf103871-boop/Maydan/actions/runs/36778391864) completed successfully, including the full Node test suite, signing-helper tests, resource preparation, signed archive, IPA export and upload. It exported `ios/build/export/*.ipa` and artifact `Maydan-iOS-1.5-5` with seven-day retention.

Apple processed **1.5 (5)**, build ID **`e00db909-dd40-44ec-a7f0-b3b49dbcad1f`**, uploaded **1 October 2026 at 00:21, Asia/Amman**, with state **`VALID`** and nonexempt encryption **`false`**. A subsequent device test found the purchase failure described below; App Review acceptance remains unverified.

## Production and purchase-review checks

- Production DB migrations **0001–0007** are applied. The **`SOCIAL_HUB`** binding exists and the **`MODERATOR_USER_IDS`** secret is configured. The health endpoint and native billing configuration returned **200**. These checks do not verify the moderator account's identity, staffed report handling or behavior on an iPhone.
- App Store Connect now shows **Paid Apps Agreement: Active**, the bank account **Active**, and both required US tax forms **Active**. The owner supplied the bank details and approved submission of the tax declarations.
- App Review screenshots and reviewer notes were saved for **both** `plus.monthly` and `plus.yearly`. Their provenance is explicitly a **local preview of the app purchase interface using App Store Connect catalog prices**. They are not device captures and do not establish a purchase or restoration. Final Apple API verification confirms **both products `READY_TO_SUBMIT`**, both screenshot deliveries **`COMPLETE`**, **no errors or warnings**, and dimensions **1242×2688** for each image.
- The old unresolved submission has not been cancelled. No reply to Apple or new App Review submission has been sent.

## Remaining release steps

1. Re-test StoreKit prices, purchase and restoration after the catalog fix below. Account configuration is complete, but a real successful purchase has not been observed.
2. Verify the current account/social/profile behavior and configured moderator account. The pending version's messaging declaration and Arabic privacy links were corrected on the evening of 1 October (see below); the published privacy labels already contain all twelve declared data types. Updated review notes were prepared, but have not been saved in App Store Connect.
3. Select the tested build in version 1.5 and create a **new App Review draft containing version 1.5, the subscription group and BOTH `plus.monthly` and `plus.yearly` products in the same draft**. The old unresolved submission cannot accept those additional items. The code already uses these product identifiers; editing source or selecting a build alone does not submit them.
4. Check all draft items and reviewer information, then submit the new draft and send a reply addressing 2.3.8 and 2.1(b). Neither action has been performed yet.

## Build 5 verification

- Passed: native-account and Apple-purchase-readiness tests **11/11**, signing-helper tests **5/5** and whitespace validation.
- Passed: parsed the plist and release JSON; their display names match, both Xcode build defaults are `5`, and bundle/team/version remain unchanged.
- Passed: `ios:prepare` rebuilt and verified **3,227** embedded files from the current source. Build ID `1.4.1-062a567d`; HTML SHA-256 `062a567d18517f8a8c0842666a3f189d4446ccb4c535eca4d5f9e2c40e1d8bfc`; API `https://maydan-game.mf103871.workers.dev`.

The successful macOS workflow additionally verifies Swift compilation/signing, archive export and upload, and Apple's `VALID` state verifies processing. A successful on-device purchase/restoration and App Review approval remain unverified.

## TestFlight catalog failure and build 6 upload

The owner tested **1.5 (5)** on an iPhone and supplied screenshots showing only a monthly placeholder price and the error **هذا الحساب غير مؤهل** immediately after tapping Subscribe, without an Apple purchase sheet. The native bridge mapped an empty `Product.products` lookup (`StoreError.unknownProduct`) to the account-eligibility error. The paywall left its monthly placeholder purchasable when the catalog was missing.

Build **1.5 (6)** distinguishes unavailable products from account eligibility, displays native catalog loading/retry states, and prevents purchase until the selected product has a StoreKit price. Restoration remains independent of catalog availability. These changes do not manufacture StoreKit products or prove that Apple's catalog is available on a device.

Local checks passed: **33 targeted Node tests**, **28 browser regression cases** across native catalog/readiness, web checkout and sign-in (the **16 native cases** rerun after the final change), **5 signing-helper tests**, and whitespace checks. The actual paywall was inspected at phone width with local empty/loaded catalog fixtures. `ios:prepare` verified **3,227** files with HTML SHA-256 `a59d9b9e447b42d3872021dc59c6e0f9d4c39f7a7d1bc9ba7610624fb7265d89`. These simulated tests do not perform Apple purchases. ESLint was unavailable in the existing local dependencies.

The [build 6 signed workflow](https://github.com/mf103871-boop/Maydan/actions/runs/36791803887), source **`9ab1360085a8ae08e02092d7142050223a8ef985`**, succeeded. Its full Node suite reported **657 tests: 656 passed, 1 skipped, 0 failed**; signing checks, Swift archive and IPA export also succeeded. Apple confirmed **Upload succeeded** at **1 October 2026, 02:38:47 Asia/Amman**. Artifact `Maydan-iOS-1.5-6` is retained for seven days. At the 02:42 check, the public builds API still returned build 5 as the newest processed record; build 6 processing and internal TestFlight availability remain unconfirmed. No App Review submission was sent.

Read-only checks confirmed the bundle/product identifiers, localized metadata, Jordan/US prices and internal TestFlight availability. The actual signed build 5 IPA from the successful workflow was also inspected: its artifact SHA-256 matched GitHub, and its bundled native configuration contains the correct API origin and both product IDs. Apple explains that TestFlight uses sandbox and products do not require review approval for sandbox testing; metadata changes can take up to one hour to propagate. The recent account activation is a possible contributor, not a proven root cause of the empty catalog. A fresh device test is still required.

References: [Apple sandbox availability troubleshooting](https://developer.apple.com/documentation/technotes/tn3186-troubleshooting-in-app-purchases-availability-in-the-sandbox), [sandbox testing](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox).

## Build 6 device failure and build 7 diagnostic upload

At approximately 21:00 Asia/Amman on 1 October, the owner confirmed **1.5 (6)** still showed no prices and no Apple purchase sheet. The App Store account is Jordan. Retrying over cellular data also failed after approximately one minute. This matches the web/native request's 60-second timeout, but does not establish whether StoreKit itself or the bridge is stalled. The earlier empty-catalog explanation was a possible path, not an observed native result.

Fresh checks confirm build 6 is **VALID**, unexpired and **IN_BETA_TESTING** for the internal group. Paid Apps Agreement, bank and required US forms remain Active. Jordan monthly/yearly price records remain USD5/USD50. Both subscription pages show **All countries or regions selected** under Availability (the annual plan is **1 Year Upfront**), confirming Jordan is included. Apple's service status showed In-App Purchases, Sandbox and TestFlight available. More than 18 hours have passed since account activation, so the documented one-hour metadata propagation window does not by itself explain this failure.

The **actual signed build 6 IPA** was inspected without executing it. Its GitHub artifact digest is **`9c522e39ced875948f7268b6a6fb4c968e3de283fa03fea6503698bd40857c4a`**, verified against GitHub metadata. The IPA has bundle `Maydan`, version `1.5`, build `6`, the correct native API and `plus.monthly`/`plus.yearly` IDs, and the updated catalog/retry UI. Its distribution profile identifies `96WJBK2MB2.Maydan`. No packaging fault was found.

Prepared build **1.5 (7)** adds local, collapsed **تفاصيل المشكلة للدعم** when catalog loading fails. It distinguishes an empty catalog, missing native configuration, StoreKit errors (domain and numeric code only), and timeouts. An independent synchronous native status response distinguishes a stalled product request from an unresponsive bridge. It includes build/iOS/storefront and payment-permission context, with no receipts, account identifiers, raw error descriptions, persistence or automatic telemetry. Retry clears stale details after recovery. Purchase and restore rules remain unchanged.

Local checks passed **42 tests** across bridge/client contracts, diagnostic redaction, actual React catalog behavior, purchase readiness, timeout differentiation and recovery. The phone-width support details were visually checked using a clearly synthetic timeout fixture. These tests use local fixtures; **the underlying device purchase failure is not yet fixed or verified**. The next step is to read the support details from the diagnostic build on the affected iPhone, then act on the observed cause.

The [build 7 signed workflow](https://github.com/mf103871-boop/Maydan/actions/runs/36905587823), source **`9701790cbbd4b9785e02cd4f1a3e8e636be99877`**, completed successfully: **659 tests, 658 passed, 1 skipped, 0 failed**, plus signing checks, Swift archive and IPA export. Apple confirmed **Upload succeeded** at **1 October 2026, 21:20:39 Asia/Amman**. At **21:23**, ASC confirmed build **`21307101-7ea7-414f-b463-33b659a69919`** is **VALID**, unexpired, and **IN_BETA_TESTING** internally. External beta status remains **READY_FOR_BETA_SUBMISSION**.

Separately, the pending version's age-rating questionnaire was saved with **Messaging and Chat = Yes**, and the API confirmed `messagingAndChat=true` and `userGeneratedContent=true`. Both Arabic privacy links were saved to **`https://maydan-game.mf103871.workers.dev/#/privacy`**, replacing the obsolete policy; the saved Arabic page visibly shows both corrected URLs. No new App Review submission or Resolution Center message was sent. The app version still needs the tested replacement build and the group/both products included in a new submission.

## Real build 7 result

The owner's expanded diagnostic screenshot confirms **`outcome: empty`**, bundle `Maydan`, version `1.5 (7)`, iOS `26.6.1`, StoreKit storefront **USA**, `canMakePayments: true`, **18 ms**, requested IDs `plus.monthly` and `plus.yearly`, returned IDs `[]`, and no error chain. This supersedes the earlier timeout hypothesis: on this attempt, the native StoreKit call completed and returned no products. The storefront shown by the native API differs from the Jordan region the owner reported; both regions are configured for the app and subscriptions.

The owner also tried Restore Purchases and reported the generic connection-error text; the underlying native/backend error has not been captured. Retrying over cellular and restarting the iPhone did not restore prices. No code change is justified as a confirmed fix from this evidence alone.

Further checks verified the **live IN_APP_PURCHASE capability** for bundle resource `5QJWHF62FT`, with team `96WJBK2MB2`; the app's Available-country list explicitly includes USA and Jordan. Developer membership renews in September 2027 and the current Developer Program License Agreement is accepted. Both subscriptions' localized metadata/screenshots remain complete. The documented one-hour window concerns metadata edits and does not establish an account-activation synchronization deadline. A technical support case has been prepared locally; it has not been sent to Apple.
