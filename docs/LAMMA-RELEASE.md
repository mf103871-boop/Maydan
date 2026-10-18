# Lamma backend and iOS release record

The original internal-pilot procedure below updated the two production API workers while retaining the existing public website. Its backend helper does **not** publish the website or upload a build to Apple. That rollout and its preview-provider prerequisites are historical; later backend and native release status is recorded in the dated sections below. Do not repeat the initial migration procedure against the already migrated production service.

## Current candidate — 18 October 2026

The current candidate is **1.8 (18)**. Its [release receipt](releases/lamma-reliability-2026-10-18/release.json) is the authoritative record for this update; [Arabic TestFlight notes](releases/lamma-reliability-2026-10-18/testflight-notes-ar.txt) describe the intended device trial. The dated records below preserve earlier release states and must not be read as this candidate's current App Store status.

Local validation, isolated preview API/storage acceptance (10/10), and actual LiveKit media/provider acceptance (7/7 with twelve concurrent peers) have passed. The compatible production backend update and additive migration 0009 are verified, with the existing 63 public assets, bindings, settings and schedules preserved. Build 18 has not yet reached TestFlight: two CI attempts stopped during simulator installation before any app launch; a bounded preparation-budget correction retains the complete launch/crash/update gates. Exact native signing/upload and Apple processing evidence will be added to the receipt after success. Physical iPhone latency, background/locked calls and push delivery remain unverified; public release waits for that device trial.

## Why this route

The signed iPhone build uses `https://maydan-game.mf103871.workers.dev` for accounts and social APIs. Its Keychain session is not scoped by API origin. Switching that build to the isolated preview service would mix existing production sessions with a different account database and authentication callbacks. Keep its current production origin and update the compatible backend first.

The pilot avoided the normal `cloudflare:deploy` command and automatic deployment through a branch merge because both can upload the current frontend assets. The current authorized release is for the App Store, so preserve those existing public web assets and coordinate any merge with the automatic deployment configuration. During any backend update, freeze competing uploads/configuration changes: the API does not expose an atomic compare-and-swap upload, so a small read/upload race remains even with immediate metadata checks.

Cloudflare officially supports [`keep_assets: true`](https://developers.cloudflare.com/workers/static-assets/direct-upload/) to retain the complete existing asset set. The helper uploads only worker JavaScript and asset configuration. It does not register an asset manifest or upload any static file. Asset headers and redirects are preserved through `assets.config._headers` and `_redirects`.

Existing bindings are inherited by name; secret binding types are retained without reading their values. The [upload API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) resolves inheritance against the **latest uploaded** version. The helper therefore requires latest uploaded = fully deployed and uses `bindings_inherit=strict`. Current variables, account database, Durable Object namespaces, security settings and cron schedules are checked again after deployment.

## Original pilot evidence and preparation

1. Commit and review the final backend and dependencies. Complete normal local checks and the isolated preview acceptance suite.
2. The live provider report must pass all seven checks, including real two-way media, twelve peers, verified webhooks, connected blocking, disconnected-token revocation, room end and complete fixture cleanup. The report must identify the source and preview deployment. A passing compilation or a successful synthetic APNs authentication probe does not establish delivery to an actual iPhone.
3. Provision production LiveKit, production APNs credentials and the private `maydan-social-audio` R2 bucket. Keep separate sandbox APNs credentials optional. Apply the `SOCIAL_AUDIO` binding to both production config files for future normal deployments. The helper checks that neither r2.dev nor a custom domain exposes the bucket publicly.
4. Configure the production LiveKit webhook destination for the production API. Confirm the tested provider configuration and authorized production project before running the helper. Secret names alone cannot verify their values.
5. Freeze other uploads/configuration changes. Recheck that the TestFlight group is internal and that no external group/public link will receive this build.

## Original pilot helper modes

Run from the repository on this Windows account, using its existing authenticated Wrangler installation:

```powershell
node scripts/lamma-release.mjs preflight
```

This is read-only. It records both live workers, their latest/deployed versions, runtime metadata, multipart source, schedules and the D1 migration ledger. It hashes the public entry documents, PWA manifest, service worker and their explicit local references, including security headers. The initial inspection covered 63 paths.

The complete stored Cloudflare asset manifest is not exposed by the inspected API. The hash ledger is therefore explicit-reference coverage, **not an enumeration of every stored asset**. Preservation of the full set comes from `keep_assets`; the hash ledger and full runtime asset configuration provide independent post-deployment checks.

The returned private directory is under `%USERPROFILE%\.codex\private\maydan-lamma-release`. Worker snapshots, bundles, database exports and receipts use Windows DPAPI CurrentUser encryption. They are not saved in the repository. Do not copy decrypted exports, sessions, bindings or provider credentials into logs or review descriptions.

Use the exact returned directory for the following steps:

```powershell
node scripts/lamma-release.mjs plan '<private-directory>'
node scripts/lamma-release.mjs backup '<private-directory>'
```

`plan` is local and read-only remotely. It bundles both reviewed workers, records their source inputs and hashes, generates exact upload metadata and prints a review digest. Only additive SQL migration `0008_lamma.sql` may be pending. Uncommitted/untracked backend changes are rejected. The plan records the source commit for traceability, while provider evidence matches the backend tree/content so later documentation-only commits do not invalidate the tested backend.

`backup` invokes Cloudflare's D1 export API and saves the complete SQL schema/data encrypted, together with a SHA-256 receipt. It does not modify application data. It verifies the encrypted round trip. The backup must be less than 30 minutes old at execution. If it expires, make a new preflight directory, plan and backup; records are never silently overwritten.

After reviewing the exact plan digest and evidence, and only when production execution is authorized/coordinated:

```powershell
node scripts/lamma-release.mjs --apply '<private-directory>' '<reviewed-plan-sha256>' '<passing-live-provider-result.json>'
```

No other mode writes production state. `--apply` checks the helper/source/dependency hashes, provider evidence, current preview deployment, fresh encrypted backup, both live metadata leases, private R2, production provider binding names, unchanged migration ledger and unchanged public assets **before** its first production mutation. It creates an exclusive local `apply.lock` and a redacted progress journal.

The executable sequence is:

1. Apply the one reviewed additive D1 migration with a private minimal Wrangler configuration pinned to the production account/database; no frontend build hook is present.
2. Upload `maydan-game` with inherited bindings, retained assets and the `v2-social` → `v3-lamma` migration adding only `LammaJobs`.
3. Verify the original public asset hashes, then retain the daily cron and add the minute jobs cron on the main worker.
4. Upload `maydan-rooms` with its original `v1` namespace history and a cross-worker `SOCIAL_JOBS` binding to the main worker. It receives no new cron. The original plan preserves its historical daily `17 3 * * *` schedule. On 2026-10-12 Cloudflare rejected the additional main minute cron with error `10072` because the free account already had five triggers. A separately reviewed recovery amendment removes only the duplicate rooms daily trigger and retains daily cleanup plus minute jobs on the main worker. It does not change other workers or upgrade the plan.
5. Verify both active worker module bytes against the reviewed bundles, original bindings/settings, new private storage/jobs bindings, migration ledger, cron schedules, full asset configuration and original public asset hashes.

The helper does not set secrets, create provider projects, send notifications, dispatch CI or upload TestFlight. Its successful result explicitly reports `testFlightUploaded: false`.

Read-only verification can be repeated:

```powershell
node scripts/lamma-release.mjs verify '<private-directory>'
```

An explicitly reviewed cron recovery uses a separate encrypted, original-plan-bound `recovery-receipt`. Only a completed receipt for the exact historical rooms daily duplicate changes the expected rooms schedule to empty. The original plan and failed apply journal remain immutable. Worker downloads may encode the main module as either a multipart file or UTF-8 text field; both representations must match the same reviewed SHA-256.

## Failure and recovery

The sequence is not an atomic transaction across D1, two workers and cron. If any step fails, stop, retain the private snapshot/journal and inspect what actually changed. Do not remove `apply.lock` and blindly repeat. An upload timeout can have an unknown remote outcome; compare current worker source and metadata first.

The additive D1 migration keeps old client contracts, but adding a Durable Object class constrains [rollback across lifecycle migrations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/). There is deliberately no automatic rollback or destructive SQL reversal. After `v3-lamma`, the practical recovery is a reviewed forward deployment retaining the new namespace/class while restoring compatible behavior. Keep the public assets unchanged and withhold/expire the internal build while resolving any failure. Restoring an old D1 export would overwrite newer user activity and requires a separate recovery decision.

## 2026-10-17: privacy page and dormant iOS update policy

This later release updated only `maydan-game`; it did not repeat the original
two-worker/database rollout above. The [backend receipt](releases/lamma-2026-10-17/backend-release.json)
records both the initial routing failure and the independently reviewed repair.

The first upload installed the exact reviewed module, but its post-upload check
found that `keep_assets` had also retained the original asset routing. The
requested `/privacy` and `/privacy/` additions were absent, and those URLs still
returned the old SPA. Read-only diagnosis verified the deployed code, all 63
public reference hashes/headers, bindings, settings, schedules, `v3-lamma`,
health and the disabled update policy. Execution stopped without retrying the
old plan or rolling back production.

A fresh plan from the actual live state served the privacy page inside the
existing `/api/*` worker-first route. The corrected source is
`78e6e1725369626f7ecbee388e65ef17e9f77c9f`; its main Worker version
`745b3112-099a-4d68-b16c-ddb958eb8bfe` passed verification at
`2026-10-16T21:42:07.324Z` (17 October in Amman). Both
[`/api/legal/privacy`](https://maydan-game.mf103871.workers.dev/api/legal/privacy)
and its trailing-slash form return the reviewed standalone HTML. The complete
raw asset configuration, original bindings/settings/schedules and the 63 public
references remain unchanged. There were no D1 operations, rooms-worker uploads,
cron writes, Durable Object migrations or public frontend asset uploads.

The public `/api/app-policy/ios` endpoint is deployed with mandatory updates
**disabled**. The [operator guide](IOS-UPDATE-POLICY.md) describes future
activation only after verifying the exact public App Store build/version and
per-store availability, plus the immediate disable switch and offline behavior.
Installed 1.5 clients cannot acquire the new native check through this backend
deployment. The intended native build is 1.7 (12), but this backend receipt does
not establish completion of that build, Apple processing, TestFlight availability,
physical-device acceptance or public App Store release.

## Native release status and device coverage

After confirming normal opening and reopening of build 11 on their iPhone, the
user authorized App Store submission of the update. Version 1.7 (12) is now
**waiting for Apple review**, with automatic public release after approval.
Submission `93054fb8-1f2b-4324-a21d-c6fe8fe703fd` was sent at
`2026-10-16T22:57:13.617Z` (17 October, 01:57:13 in Amman). The final UI and an
independent read-only App Store Connect API check at
`2026-10-16T22:57:59.636032Z` confirmed `WAITING_FOR_REVIEW` for both the
submission and version `e956921e-b535-4cee-813d-35e540198941`, with
`AFTER_APPROVAL` release mode. The selected build is
`ec80090a-5787-4764-b301-74d5c1e026f0`, build 12, processing `VALID`, with
non-exempt encryption declared false. It has not yet been published publicly.

The submitted version includes the dormant future-update check. Its signed
workflow is
[run 38976930635](https://github.com/mf103871-boop/Maydan/actions/runs/38976930635)
at commit `f4610be0d2bc290e520d063c452892ae71c1fdaf`. The workflow succeeded,
including signing cleanup, and Apple accepted the upload at
`2026-10-16T22:51:58Z`. Its JavaScript suite recorded 773 tests: 772 passed,
one skipped and zero failed. All 37 Python tests and 40 Swift policy decisions
passed. The [build 12 receipt](releases/lamma-2026-10-17/appstore-1.7-12.json)
records the verified launch artifact and signed-package/IPA hashes. Independent
inspection of the final IPA passed: all three iOS arm64 binaries and both
embedded dependency edges resolve, with `@executable_path/Frameworks` present.
Distribution profile/entitlement metadata matches production APNs and Sign in
with Apple, and simulator fixture markers are absent from the device binary.
Strict archive signature verification passed in macOS CI; local Windows checks
inspected the embedded profile/entitlements. Apple processing and submission
are confirmed above; Apple review and public release remain outstanding.
The broader physical-device call/push matrix below remains unverified coverage.
The release authorization does not establish that those checks passed.

Build 12 survived 45.13 seconds on cold launch, 15.08 seconds after relaunch and
5.16 seconds in the required-update fixture on the same installed simulator app,
with no crash reports or diagnostic warnings. Both mounted Arabic actions
measured 319 × 52 points and exposed Arabic accessibility labels and button
traits. The real Retry action released the gate under the offline fixture and
opened the game home screen; required-state and recovery screenshots were
visually inspected. These are simulator UI observations, not physical touches
or actual-device VoiceOver validation. Production's update policy stayed
disabled throughout this fixture.

Apple's upload accepted the package with two non-blocking warnings about
missing vendor dSYM files for `LiveKitWebRTC.framework` and
`RustLiveKitUniFFI.framework`. These limit symbolication of crashes inside the
vendor frameworks; they did not prevent upload acceptance.

### Corrected build 11 available for internal testing

The launch fix was uploaded as `1.7 (11)` from commit `57bddb1b189bdfa0c3e629065ae8e51b4f3a38d4` in [run 38231151756](https://github.com/mf103871-boop/Maydan/actions/runs/38231151756). All required steps passed, including Release simulator launch, archive, signature, exported-IPA dependency checks, upload and signing cleanup. The simulator stayed alive for 45.29 seconds on first launch and 15.16 seconds after relaunch, with no crash reports; saved screenshots show the rendered home screen. One screenshot command timed out, but the required images were present and inspected.

Independent inspection of the exported IPA confirms the corrected `@executable_path/Frameworks` runpath and resolves both embedded LiveKit dependencies. Apple build `c822237d-5b69-488d-a5aa-ec9759375b82` was rechecked on 2026-10-16: `VALID` and `IN_BETA_TESTING`. The [sanitized receipt](releases/lamma-2026-10-12/testflight-1.7-11.json) records the exact artifact hashes and limits. At that inspection, updated testing notes were unsaved because the API returned 405 and the browser session expired; internal build availability was verified independently.

On 2026-10-16, the internal tester confirmed that build 11 opens normally and reaches the home screen after reopening. Startup acceptance therefore passes on the reported physical iPhone. The wider device matrix remains unverified. The user subsequently authorized App Store submission; no public publication is established by the build 11 evidence.

### Build 10 immediate launch failure

The internal tester reported that `1.7 (10)` closes immediately on launch. Inspection of the exact uploaded IPA confirmed that its executable depends on `@rpath/LiveKitWebRTC.framework/LiveKitWebRTC` and `@rpath/RustLiveKitUniFFI.framework/RustLiveKitUniFFI`, while its only `LC_RPATH` is `/usr/lib/swift`. Both frameworks are embedded, but the executable cannot resolve their location. Archive, signature and export success did not catch this pre-main loading failure.

The corrective build added `@executable_path/Frameworks` to both app-target configurations. Both iOS workflows now validate actual Mach-O dependencies and launch the Release app on an iPhone simulator. The signed workflow also validates the archive and exported IPA before upload. Build 11 passed these checks and received physical-device startup confirmation as recorded above. Build 10 is superseded and is not accepted for release.

The signed `1.7 (10)` artifact at commit `cf1b8fa286a479b5d4743e8374ac854c53de425d` passed archive, signature and export checks in [run 38212813632](https://github.com/mf103871-boop/Maydan/actions/runs/38212813632). It was **not uploaded** by that run. This superseded artifact is historical evidence, not a candidate for a later release.

The subsequent [run 38226797638](https://github.com/mf103871-boop/Maydan/actions/runs/38226797638) rebuilt exact commit `dea94914f5935ed0da500247e4f72c54aec1c2df` with upload enabled. Archive, strict signature verification, export and upload succeeded. At the 2026-10-12 inspection, Apple build `a8414288-310a-4192-9105-12dc8c409771` was `VALID`, with internal state `IN_BETA_TESTING`. Its sole group was **Envysnowy Group**, internal with one tester, and Arabic testing notes were saved. External state was `READY_FOR_BETA_SUBMISSION`; that pilot had performed no external submission or public app release. The [sanitized receipt](releases/lamma-2026-10-12/testflight-1.7-10.json) records that historical CI/artifact evidence and the then-pending device check; the immediate-launch failure and correction are recorded above.

At the 2026-10-12 inspection, the only TestFlight group was **Envysnowy Group**, an internal group with one tester and automatic access to all builds. The pilot therefore required backend compatibility checks before upload and kept external groups/public links disabled. Recheck current group membership/access before an upload, since automatic tester access may still apply. Apple's [internal testing documentation](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers) describes internal tester access. The workflow creates a standard App Store Connect upload; the pilot's internal-only distribution depended on group configuration. The later App Store submission authorization is recorded separately above.

Unverified physical-device coverage includes foreground/background/locked incoming calls, accept/reject and multiple devices, ordinary push/deep links, notification privacy, microphone refusal, recording preview/120-second limit, headset and interruptions, network loss, logout/account switching, group membership/blocking, existing subscriptions, old direct-chat clients, and match/secret-role behavior. Keep this coverage explicit in subsequent testing records. The App Store-only release preserves the existing public frontend assets; a web rollout is a separate scope decision.

The original pilot limited distribution of the new UI. It did not add a server-side pilot allowlist: authenticated production accounts can reach the additive APIs. Continue reviewing provider minutes/storage and API health as distribution changes.
