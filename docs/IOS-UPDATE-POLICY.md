# iOS update policy

The native update check is first included in 1.7 (12). It is disabled by default.
Shipping this capability does not activate a required update. Installed 1.5
clients cannot acquire the native check through a backend or website change.

`GET /api/app-policy/ios?storefront=JOR&osVersion=26.6.1` is public and requires no
account, cookie, session, or IP-derived location. `HEAD` returns the same headers
with no body; other methods return 405. The native client supplies its StoreKit
storefront and operating-system version. Unknown values leave the app usable.

The response contains `schemaVersion: 1`, `enabled`, `minimumBuild`,
`minimumVersion`, `appStoreId: "6808385717"`, and an Arabic `message`. Disabled
responses use `minimumBuild: 0` and `minimumVersion: null`. Responses are
`Cache-Control: no-store`.

## Activating a future release

1. Publish the intended replacement to the App Store. Verify in App Store
   Connect that its exact marketing version and build are the public release,
   not merely uploaded, approved for TestFlight, or waiting for release.
2. Verify the public listing and installation in the relevant storefronts. A
   future date is not evidence of availability. Apple lookup exposes the
   marketing version, not the build number, so this build/version check must be
   performed before enabling the policy.
3. Set the main Worker's `IOS_MIN_SUPPORTED_VERSION` to that public marketing
   version and `IOS_MIN_SUPPORTED_BUILD` to its build number (1–999999).
   `IOS_UPDATE_POLICY_ENABLED` must equal the string `1` to activate. Missing,
   malformed, or disabled configuration fails open.
4. Fetch the policy with the actual storefront and OS of a supported test device
   and confirm the new version can be installed there. For example, **only after
   a future 1.8 release is public**, its verified build can become the configured
   minimum. Do not activate 1.7 (12) as part of deploying this dormant feature.

For every enabled configuration, the server independently checks Apple's fixed
public lookup endpoint for the exact application in the requested country. It
requires a public version at least as new as the configured minimum and a
minimum supported OS no newer than the device. A missing app, a fallback to a
different country, or any verification failure returns a disabled policy.
Successful lookups are cached for five minutes per country and configured
minimum; the device's OS is checked separately. Failed requests are not cached,
and expired positive results are never reused during an outage. The lookup
deadline is 1.8 seconds. Native network failure also leaves the app usable.

## Disabling and deploying safely

Set `IOS_UPDATE_POLICY_ENABLED` to `0` to disable the policy. The server checks
configuration before its availability cache, so an older cached lookup cannot
override this switch. Devices receive the disabled response on their next
check. There is no generic server rule blocking old clients or deleting saved
games, accounts, settings, or results.

For the initial backend-only deployment, commit and review the source, then run
`node scripts/ios/publish-policy-backend.mjs --plan`. This is read-only against
production and creates an encrypted private worker snapshot, reviewed bundle,
and plan digest. Review the printed digest and exact original asset settings. Run
`--apply <private-directory> <exact-plan-sha256>` only after authorizing that
specific plan; plans expire after 30 minutes. `--verify` with the same arguments
performs read-only verification of an already-applied plan.

This helper inherits existing bindings and preserves the complete stored asset
set and its complete routing configuration with `keep_assets: true`. It serves
the standalone privacy page at
`https://maydan-game.mf103871.workers.dev/api/legal/privacy/` (also without the
trailing slash), within the existing `/api/*` worker-first route, and uploads
only the main Worker. It requires the already
existing `v3-lamma` migration and job schedule. It does not upload public
frontend assets, modify D1, deploy the rooms Worker, change cron schedules,
or activate the policy. Public document/reference hashes and the exact deployed
module, bindings, settings, unchanged asset configuration, privacy HTML and
disabled policy are checked afterward. Do not reuse the superseded deployment
plan that attempted to add `/privacy` routes: production retained the original
asset routing when `keep_assets` was used. A new plan has a separate operation
identifier and must snapshot the actual current Worker before deployment.

If an upload or verification is interrupted, stop and inspect the encrypted
snapshot and private progress journal. A failed request may already have
changed production; do not rerun blindly or delete the apply lock. There is no
automatic rollback. Prepare and review a fresh main-only recovery from the
actual live state. No database restoration is needed for this deployment.

References: [Apple lookup API](https://performance-partners.apple.com/search-api)
and [Cloudflare worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).
