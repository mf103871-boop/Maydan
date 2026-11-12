# Maydan Android local proof

This module builds the bundled Maydan 1.9 UI for offline Android verification. The package ID `com.maydan.partygames` matches Google Play record `4973357662415065361`. The launcher labels the app as a preview. The APK is for local installation and the unsigned AAB is for structural validation.

- Install Node 22 dependencies at the repository root. Set `MAYDAN_NODE` if the Node executable is outside PATH.
- Use JDK 17, Gradle 8.13 or newer in the 8.x series, and Android SDK Platform and Build Tools 36.
- Run `gradle -p android :app:assembleOfflineDebug :app:bundleOfflineRelease`. With `MAYDAN_ANDROID_DEBUG_KEYSTORE` set, the APK uses the local Android debug key specified by that variable. Keep the key outside the checkout. The release AAB remains unsigned.

Gradle invokes the existing game compiler on each build, excludes Studio and private preview audio, and bundles the generated resources. The activity serves them from AndroidX WebViewAssetLoader’s local HTTPS origin. The proof has no Internet, microphone, login, voice, purchases or external checkout. Public distribution requires Play App Signing, connected-service implementation and device testing.

Both foundation flavors keep the first-trial/ticket policy disabled. Asset preparation rejects an environment that enables it, because these offline game clients cannot authenticate to obtain a ticket after their first trial. The source includes the default-off policy for later integration; bundling it is not policy activation.

The separate `rewardedDemoDebug` flavor adds Google’s official demo AdMob IDs and UMP consent. Its native `MaydanRewarded` message interface is limited to the trusted local main frame. It accepts a bounded server-attempt token, presents an ad only on request, and returns a pending outcome for the client to confirm with its server. It grants no gameplay access itself. This flavor has no release variant, and it does not activate an owner ad unit.

The game’s shared Android adapter routes status, privacy and display through this namespace and fences replies by screen/account ownership. The backend must explicitly issue an `android-native` attempt before display. Until Android account access and ad-unit/SSV configuration are connected, normal game screens report ads as unavailable. The SDK compilation and request-policy unit tests do not establish a completed ad or a server-confirmed ticket on a device.

The demo configures maximum ad content rating `G` and publisher personalization `DISABLED` before explicit SDK initialization. Each ad request adds the AdMob network extra `npa=1`. Google’s 25.5 API requires initialization before `putPublisherFirstPartyIdEnabled(false)`; it runs in the initialization callback, and ad loading remains unavailable unless the setting persists. UMP consent is still required where applicable. The merged demo manifest requests Internet/network-state and SDK-provided ad-services, wake-lock and foreground-service permissions; it requests no location or microphone and removes the standard Android advertising-ID permission. These flags do not claim that the SDK collects no data.

References: [targeting configuration](https://developers.google.com/admob/android/targeting), [nonpersonalized request extras](https://developers.google.com/admob/android/next-gen/migration/migrate-ad-requests), [first-party ID API](https://developers.google.com/admob/android/reference/com/google/android/gms/ads/MobileAds).

## Owner configuration recorded for later release

The owner’s Android AdMob record has public App ID `ca-app-pub-6382290742060099~3625469442` and Rewarded unit `ca-app-pub-6382290742060099/3803618750`, with one match ticket as the reward. It is unpublished and still needs its store link, independent readiness checks and SSV configuration. The demo flavor continues to compile Google’s sample IDs. It sends no requests to the owner’s ad unit.

## Remaining public-release integration

The asset-origin network boundary is deliberately closed. A connected build still needs a reviewed API/session transport and external Google OAuth return flow, Android microphone/audio lifecycle and LiveKit integration, and Play Billing products with server-side verification before selling Plus. It also needs an Android-specific rewarded attempt mode/ad-unit mapping and an account-bound SSV confirmation path. Neither the local proof nor the SDK demo substitutes for these services. A local Pixel 6 / API 36 emulator verified launch, Arabic/English shell synchronization, an English Beep prompt, and restoration after force-stopping the app in airplane mode while preserving the Arabic save. Physical-device, connected-service, purchase and iOS acceptance remain outstanding; these debug artifacts are for local testing.

## Shell language

The web UI sends `{type:"setLocale",locale:"ar"|"en"}` through `MaydanLocale.postMessage(JSON.stringify(...))` at startup and on a language change. The namespace accepts only the local main frame. The shell persists that choice for the next launch and resolves its banner, link feedback, WebView error and demo privacy button in the same language, without recreating the activity or losing an active match. The launcher's label follows Android's resource language. System and third-party SDK dialogs follow their own supported locale behavior; this bridge does not replace those dialogs or alter permissions. Room content language is independent.
