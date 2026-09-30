# App Store review fix — 1 October 2026

App Store Connect's review of **1.5 (2)**, dated **28 September 2026**, identified two issues:

- **2.3.8 — Accurate Metadata:** the English App Store name and Arabic name displayed on the device did not identify the app consistently. Apple requests a replacement binary.
- **2.1(b) — App Completeness:** the in-app purchase products were not submitted for review. Apple requests the purchase products and their App Review screenshots with the new submission.

## Uploaded replacement

The replacement was built from **`9ea259e`**, the name fix on `2158682d5d55b491bbc12e1a558f6935660d1cc8` (`main`, including its latest audio updates). `CFBundleDisplayName` and the corresponding release metadata use **Maydan ميدان**, carrying the name used by both store languages. The app remains bundle `Maydan`, Apple ID `6808385717`, team `96WJBK2MB2` and version `1.5`. Subsequent documentation updates do not change the source of the uploaded binary.

The [signed build workflow](https://github.com/mf103871-boop/Maydan/actions/runs/36778391864) completed successfully, including the full Node test suite, signing-helper tests, resource preparation, signed archive, IPA export and upload. It exported `ios/build/export/*.ipa` and artifact `Maydan-iOS-1.5-5` with seven-day retention.

Apple processed **1.5 (5)**, build ID **`e00db909-dd40-44ec-a7f0-b3b49dbcad1f`**, uploaded **1 October 2026 at 00:21, Asia/Amman**, with state **`VALID`** and nonexempt encryption **`false`**. This confirms upload and processing; App Review acceptance and physical-device behavior remain unverified.

## Production and purchase-review checks

- Production DB migrations **0001–0007** are applied. The **`SOCIAL_HUB`** binding exists and the **`MODERATOR_USER_IDS`** secret is configured. The health endpoint and native billing configuration returned **200**. These checks do not verify the moderator account's identity, staffed report handling or behavior on an iPhone.
- App Store Connect still shows **Paid Apps Agreement: Pending User Info**, with bank and tax information missing.
- App Review screenshots and reviewer notes were saved for **both** `plus.monthly` and `plus.yearly`. Their provenance is explicitly a **local preview of the app purchase interface using App Store Connect catalog prices**. They are not device captures and do not establish a purchase or restoration. Final Apple API verification confirms **both products `READY_TO_SUBMIT`**, both screenshot deliveries **`COMPLETE`**, **no errors or warnings**, and dimensions **1242×2688** for each image.
- The old unresolved submission has not been cancelled. No reply to Apple or new App Review submission has been sent.

## Remaining release steps

1. Have the owner complete the missing bank/tax information and recheck the Paid Apps Agreement. Product and screenshot readiness has already been verified; agreement readiness remains incomplete.
2. Test **1.5 (5)** in TestFlight: device name, Apple/Google sign-in, StoreKit prices, purchase/restoration, and the current account/social/profile behavior. Verify the configured moderator account and report handling, plus age-rating and privacy metadata for the features in this binary.
3. Select the tested build in version 1.5 and create a **new App Review draft containing version 1.5, the subscription group and BOTH `plus.monthly` and `plus.yearly` products in the same draft**. The old unresolved submission cannot accept those additional items. The code already uses these product identifiers; editing source or selecting a build alone does not submit them.
4. Check all draft items and reviewer information, then submit the new draft and send a reply addressing 2.3.8 and 2.1(b). Neither action has been performed yet.

## Local verification

- Passed: native-account and Apple-purchase-readiness tests **11/11**, signing-helper tests **5/5** and whitespace validation.
- Passed: parsed the plist and release JSON; their display names match, both Xcode build defaults are `5`, and bundle/team/version remain unchanged.
- Passed: `ios:prepare` rebuilt and verified **3,227** embedded files from the current source. Build ID `1.4.1-062a567d`; HTML SHA-256 `062a567d18517f8a8c0842666a3f189d4446ccb4c535eca4d5f9e2c40e1d8bfc`; API `https://maydan-game.mf103871.workers.dev`.

The successful macOS workflow additionally verifies Swift compilation/signing, archive export and upload, and Apple's `VALID` state verifies processing. Physical-device testing and App Review approval remain unverified.
