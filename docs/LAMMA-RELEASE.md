# Lamma internal TestFlight release route

This procedure updates the two production API workers while retaining the existing public website. It does **not** publish the new website or upload a build to Apple. Production execution remains a separately coordinated action after the preview provider suite passes.

## Why this route

The signed iPhone build uses `https://maydan-game.mf103871.workers.dev` for accounts and social APIs. Its Keychain session is not scoped by API origin. Switching that build to the isolated preview service would mix existing production sessions with a different account database and authentication callbacks. Keep its current production origin and update the compatible backend first.

Do not use the normal `cloudflare:deploy` command for this pilot: its custom build uploads the current frontend assets. Do not merge into an automatically deployed branch during the pilot. Coordinate a deployment freeze for both workers; the API does not expose an atomic compare-and-swap upload, so a small read/upload race remains even with immediate metadata checks.

Cloudflare officially supports [`keep_assets: true`](https://developers.cloudflare.com/workers/static-assets/direct-upload/) to retain the complete existing asset set. The helper uploads only worker JavaScript and asset configuration. It does not register an asset manifest or upload any static file. Asset headers and redirects are preserved through `assets.config._headers` and `_redirects`.

Existing bindings are inherited by name; secret binding types are retained without reading their values. The [upload API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) resolves inheritance against the **latest uploaded** version. The helper therefore requires latest uploaded = fully deployed and uses `bindings_inherit=strict`. Current variables, account database, Durable Object namespaces, security settings and cron schedules are checked again after deployment.

## Required evidence and preparation

1. Commit and review the final backend and dependencies. Complete normal local checks and the isolated preview acceptance suite.
2. The live provider report must pass all seven checks, including real two-way media, twelve peers, verified webhooks, connected blocking, disconnected-token revocation, room end and complete fixture cleanup. The report must identify the source and preview deployment. A passing compilation or a successful synthetic APNs authentication probe does not establish delivery to an actual iPhone.
3. Provision production LiveKit, production APNs credentials and the private `maydan-social-audio` R2 bucket. Keep separate sandbox APNs credentials optional. Apply the `SOCIAL_AUDIO` binding to both production config files for future normal deployments. The helper checks that neither r2.dev nor a custom domain exposes the bucket publicly.
4. Configure the production LiveKit webhook destination for the production API. Confirm the tested provider configuration and authorized production project before running the helper. Secret names alone cannot verify their values.
5. Freeze other uploads/configuration changes. Recheck that the TestFlight group is internal and that no external group/public link will receive this build.

## Helper modes

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
4. Upload `maydan-rooms` with its original `v1` namespace history and a cross-worker `SOCIAL_JOBS` binding to the main worker. It receives no new cron. The live service already has a historical daily `17 3 * * *` schedule despite the repository's main-only comment; this procedure preserves it. Removing that historical duplicate is a separate change.
5. Verify both active worker module bytes against the reviewed bundles, original bindings/settings, new private storage/jobs bindings, migration ledger, cron schedules, full asset configuration and original public asset hashes.

The helper does not set secrets, create provider projects, send notifications, dispatch CI or upload TestFlight. Its successful result explicitly reports `testFlightUploaded: false`.

Read-only verification can be repeated:

```powershell
node scripts/lamma-release.mjs verify '<private-directory>'
```

## Failure and recovery

The sequence is not an atomic transaction across D1, two workers and cron. If any step fails, stop, retain the private snapshot/journal and inspect what actually changed. Do not remove `apply.lock` and blindly repeat. An upload timeout can have an unknown remote outcome; compare current worker source and metadata first.

The additive D1 migration keeps old client contracts, but adding a Durable Object class constrains [rollback across lifecycle migrations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/). There is deliberately no automatic rollback or destructive SQL reversal. After `v3-lamma`, the practical recovery is a reviewed forward deployment retaining the new namespace/class while restoring compatible behavior. Keep the public assets unchanged and withhold/expire the internal build while resolving any failure. Restoring an old D1 export would overwrite newer user activity and requires a separate recovery decision.

## Internal TestFlight and actual device gate

The signed `1.7 (10)` artifact at commit `cf1b8fa286a479b5d4743e8374ac854c53de425d` passed archive, signature and export checks in [run 38212813632](https://github.com/mf103871-boop/Maydan/actions/runs/38212813632). It was **not uploaded** by that run. Verify artifact retention and integrity before any later upload; rebuild if the native/UI source changes.

At the 2026-10-12 inspection, the only TestFlight group was **Envysnowy Group**, an internal group with one tester and automatic access to all builds. A successful upload can therefore expose the build to that tester automatically. Wait for the backend release and compatibility checks first. Recheck group membership/access immediately before upload; do not add an external group or public link. Apple's [internal testing documentation](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers) describes internal tester access. The existing workflow creates a standard App Store Connect upload, not an Xcode-enforced “TestFlight Internal Only” artifact; internal-only distribution here depends on group configuration.

After upload, test real iPhones: foreground/background/locked incoming calls, accept/reject and multiple devices, ordinary push/deep links, notification privacy, microphone refusal, recording preview/120-second limit, headset and interruptions, network loss, logout/account switching, group membership/blocking, existing subscriptions, old direct-chat clients, and match/secret-role behavior. Keep the public frontend on its old assets until this device acceptance is complete.

This route limits distribution of the new UI. It does not add a server-side pilot allowlist: authenticated production accounts can reach the additive APIs. Monitor provider minutes/storage and API health during the internal trial.
