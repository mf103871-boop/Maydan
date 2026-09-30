# App Store review fix — 1 October 2026

App Store Connect's review of **1.5 (2)**, dated **28 September 2026**, identified two issues:

- **2.3.8 — Accurate Metadata:** the English App Store name and Arabic name displayed on the device did not identify the app consistently. Apple requests a replacement binary.
- **2.1(b) — App Completeness:** the in-app purchase products were not submitted for review. Apple requests the purchase products and their App Review screenshots with the new submission.

## Prepared replacement

The replacement keeps the current game source based on `2158682d5d55b491bbc12e1a558f6935660d1cc8` (`main`, including its latest audio updates). `CFBundleDisplayName` and the corresponding release metadata now use **Maydan ميدان**, carrying the name used by both store languages. The app remains bundle `Maydan`, Apple ID `6808385717`, team `96WJBK2MB2` and version `1.5`.

The Xcode Debug/Release defaults and `ios/app-store.json` agree on **1.5 (5)**. App Store Connect showed builds 1–4 on 1 October; recheck immediately before uploading. Preparing a number does not reserve it. No replacement IPA, upload or App Review submission is claimed by this record.

## Remaining release steps

1. Recheck agreements and confirm `plus.monthly` / `plus.yearly` are ready for submission. Add an authentic screenshot of the purchase interface to each product's App Review information, then attach both products to version 1.5 for review. The code already uses these product identifiers; a source edit alone cannot submit them.
2. Verify the production dependencies of the preserved current source: account DB migrations `0004_social.sql` through `0007_moderation.sql`, the `SOCIAL_HUB` binding and an authorized moderator configured through `MODERATOR_USER_IDS`. The 25 September preparation record did not verify production moderation. Check the current deployment before treating those features as ready. Confirm age-rating and privacy metadata for the actual features in the replacement.
3. Run the existing **iOS signed build and optional TestFlight upload** workflow from the verified fix commit with `version=1.5`, an unused `build` (currently planned as `5`) and upload enabled. The workflow prepares embedded assets, archives with those explicit numbers, exports `ios/build/export/*.ipa` and keeps artifact `Maydan-iOS-1.5-5` for seven days. Its upload step sends the same archive to the existing App Store Connect app; it does not submit App Review.
4. After Apple processes the replacement, test that exact build in TestFlight: device name, Apple/Google sign-in, StoreKit prices, purchase/restoration, and the current account/social/profile behavior. Select the new tested build in version 1.5, confirm the store names and IAP attachments, and resubmit with a reply addressing 2.3.8 and 2.1(b).

## Local verification

- Passed: native-account and Apple-purchase-readiness tests **11/11**, signing-helper tests **5/5** and whitespace validation.
- Passed: parsed the plist and release JSON; their display names match, both Xcode build defaults are `5`, and bundle/team/version remain unchanged.
- Passed: `ios:prepare` rebuilt and verified **3,227** embedded files from the current source. Build ID `1.4.1-062a567d`; HTML SHA-256 `062a567d18517f8a8c0842666a3f189d4446ccb4c535eca4d5f9e2c40e1d8bfc`; API `https://maydan-game.mf103871.workers.dev`.

Local resource preparation and bridge tests do not verify Swift compilation/signing, Apple processing, physical-device behavior or approval. The signed macOS workflow and subsequent TestFlight check remain.
