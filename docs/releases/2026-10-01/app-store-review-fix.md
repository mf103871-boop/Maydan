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
2. Verify the current account/social/profile behavior and configured moderator account. Correct the pending version's age-rating declaration (`messagingAndChat` is still false) and Arabic privacy links (they still reference an obsolete policy); the published privacy labels already contain all twelve declared data types. Updated review notes were prepared, but App Store Connect did not save the attempted metadata changes.
3. Select the tested build in version 1.5 and create a **new App Review draft containing version 1.5, the subscription group and BOTH `plus.monthly` and `plus.yearly` products in the same draft**. The old unresolved submission cannot accept those additional items. The code already uses these product identifiers; editing source or selecting a build alone does not submit them.
4. Check all draft items and reviewer information, then submit the new draft and send a reply addressing 2.3.8 and 2.1(b). Neither action has been performed yet.

## Build 5 verification

- Passed: native-account and Apple-purchase-readiness tests **11/11**, signing-helper tests **5/5** and whitespace validation.
- Passed: parsed the plist and release JSON; their display names match, both Xcode build defaults are `5`, and bundle/team/version remain unchanged.
- Passed: `ios:prepare` rebuilt and verified **3,227** embedded files from the current source. Build ID `1.4.1-062a567d`; HTML SHA-256 `062a567d18517f8a8c0842666a3f189d4446ccb4c535eca4d5f9e2c40e1d8bfc`; API `https://maydan-game.mf103871.workers.dev`.

The successful macOS workflow additionally verifies Swift compilation/signing, archive export and upload, and Apple's `VALID` state verifies processing. A successful on-device purchase/restoration and App Review approval remain unverified.

## TestFlight catalog failure and build 6 preparation

The owner tested **1.5 (5)** on an iPhone and supplied screenshots showing only a monthly placeholder price and the error **هذا الحساب غير مؤهل** immediately after tapping Subscribe, without an Apple purchase sheet. The native bridge mapped an empty `Product.products` lookup (`StoreError.unknownProduct`) to the account-eligibility error. The paywall left its monthly placeholder purchasable when the catalog was missing.

Build **1.5 (6)** is prepared to distinguish unavailable products from account eligibility, display native catalog loading/retry states, and prevent purchase until the selected product has a StoreKit price. Restoration remains independent of catalog availability. These changes do not manufacture StoreKit products or prove that Apple's catalog is available on a device.

Local checks passed: **33 targeted Node tests**, **28 browser regression cases** across native catalog/readiness, web checkout and sign-in (the **16 native cases** rerun after the final change), **5 signing-helper tests**, and whitespace checks. The actual paywall was inspected at phone width with local empty/loaded catalog fixtures. `ios:prepare` verified **3,227** files with HTML SHA-256 `a59d9b9e447b42d3872021dc59c6e0f9d4c39f7a7d1bc9ba7610624fb7265d89`. These simulated tests do not perform Apple purchases. ESLint was unavailable in the existing local dependencies.

Read-only checks confirmed the bundle/product identifiers, localized metadata, Jordan/US prices and internal TestFlight availability. The actual signed build 5 IPA from the successful workflow was also inspected: its artifact SHA-256 matched GitHub, and its bundled native configuration contains the correct API origin and both product IDs. Apple explains that TestFlight uses sandbox and products do not require review approval for sandbox testing; metadata changes can take up to one hour to propagate. The recent account activation is a possible contributor, not a proven root cause of the empty catalog. A fresh device test is still required.

References: [Apple sandbox availability troubleshooting](https://developer.apple.com/documentation/technotes/tn3186-troubleshooting-in-app-purchases-availability-in-the-sandbox), [sandbox testing](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox).
