# Lamma backend deployment and verification

Lamma adds private friend groups, voice notes, game invitations, LiveKit calls and APNs notifications. The existing direct-message endpoints and text DTOs remain compatible with v1 clients; typed messages retain readable fallback text. All core social features are free.

## Verification snapshot (2026-10-12)

- Production D1 `maydan-accounts` now has migrations `0001`–`0008`. A full encrypted backup was verified before applying `0008` once. Both API workers were deployed and verified at 08:53 UTC, with their original bindings/settings and all 63 explicitly checked public assets unchanged. Main worker version: `2cda020a-e86c-470e-8585-6bba6d47040d`; rooms: `de6bd8e1-10ff-4d18-998a-76a058a783ef`. See the [sanitized release receipt](releases/lamma-2026-10-12/backend-release.json).
- Cloudflare's existing five-cron free limit blocked an extra trigger. A reviewed recovery removed only the duplicate rooms daily trigger; daily cleanup and minute jobs now run on the main worker. No plan upgrade, SQL replay, or public frontend deployment was performed.
- Cloudflare R2 is activated. The isolated `maydan-lamma-preview-audio` bucket is bound to the preview worker. The private production bucket `maydan-social-audio` is provisioned and referenced by both production worker configurations. Public `r2.dev` access and custom domains are disabled.
- The local `npm test` run after device-session and call-lifecycle fixes passed **749/749**, with no failures or skips. ESLint passed with zero errors and 33 existing warnings; generated test caches are excluded. Production and preview worker dry runs passed without deploying production resources.
- Four browser regression suites cover the mobile drawer, account-specific favorites, actual local-game pause/privacy, voice playback/call interruption, and moderator audio. The drawer fixture also checks home group shortcuts and a 12-person participant view using simulated call state; it does not establish 12 real media connections. Newly mounted audio controls were checked against an already active call.
- Real LiveKit acceptance passed **7/7**, including twelve media peers and token revocation. Actual APNs delivery, real-device audio and locked/background iOS calls still require the acceptance checks below.
- **TestFlight 1.7 (10) is available internally.** [Run 38226797638](https://github.com/mf103871-boop/Maydan/actions/runs/38226797638) built, signed and uploaded commit `dea94914f5935ed0da500247e4f72c54aec1c2df`. Apple reports `VALID` and `IN_BETA_TESTING`; the build belongs to the existing internal **Envysnowy Group** with one tester. Arabic testing notes are saved. This is not a public release or a completed physical-device test.
- The upload run reports 753 tests: 752 passed, zero failed, one skipped because its compiled `dist/index.html` check runs before resource preparation on a clean checkout. The skipped check was then run locally against the prepared page and passed (one passed, zero skipped). Full build/signature/export/upload evidence is in [the TestFlight receipt](releases/lamma-2026-10-12/testflight-1.7-10.json).

## Isolated trial before a public release

`wrangler.lamma-preview.jsonc` runs the API worker only: it serves no built frontend assets and references no production database, bucket or Durable Object namespace. Its isolated D1 binding was provisioned and all eight migrations were applied on 2026-10-12. Its private R2 binding is active. Do not paste the production database ID into this file.

The preview API is deployed at `https://maydan-lamma-preview.mf103871.workers.dev`, with its own session secret and synthetic test accounts only. Version `4862d1fc-5f62-487e-b646-6c4f26f39665` was used for the final passing provider test. For a replacement preview database, apply **all** migrations using the explicit preview config:

```powershell
npx wrangler d1 migrations apply maydan-lamma-preview-accounts --remote --config wrangler.lamma-preview.jsonc
```

After verified production cutover, the three preview LiveKit secrets were removed (URL first). Preview version `5ae62f83-e4cc-4954-b0db-cdc50275b482`, deployed at 08:55:50 UTC, therefore has calls disabled. Its R2, D1, APNs and session secret remain intact. A subsequent read-only check found zero synthetic accounts, sessions and provider jobs. The seven-check report identifies the earlier tested version; it must not be treated as evidence for a future changed preview deployment.

Use synthetic accounts in the preview database. The Maydan LiveKit project has now been cut over to the production webhook. Future preview call tests require an independently configured project/key/webhook; do not run preview and production against the same webhook destination/key. Use an internal TestFlight build and test accounts for production-environment APNs, or a native development build with a separate sandbox key. Production account sessions must not be copied into preview. Configure the login provider for the trial's callback URL if login is exercised. A separate local preview frontend may point explicitly at this preview API; its permitted local origin defaults to `http://localhost:5173`. The internal iPhone build retains the production origin and its existing Keychain session namespace, as explained in [the release route](LAMMA-RELEASE.md).

The existing `Maydan` Apple App ID now has Push Notifications enabled. Its distribution profile was regenerated, verified for `aps-environment:production` plus Apple sign-in, and the encrypted GitHub build secret was updated. A topic-specific production APNs key named `Maydan Lamma Push` is registered. Its credentials and the LiveKit credentials are configured as secrets on both production workers. LiveKit project `p_3de7i1u6io3` (`maydan-gvk8joay.livekit.cloud`) has agent recording/observability disabled. Its signed webhook targets the production endpoint. Local backups of the provider credentials are Windows DPAPI-encrypted; the downloaded plaintext Apple key was removed after verifying its encrypted backup. These provisioning facts do not claim a public frontend rollout or physical-device validation.

A non-delivery HTTP/2 probe against production APNs used an intentionally all-zero synthetic device token. Both the `Maydan` alert topic and `Maydan.voip` topic returned `400 BadDeviceToken`; neither returned a provider-token or topic-authorization error. This only records the observed protocol response. It is not evidence of an actual device registration, notification receipt, locked-screen call, or successful Cloudflare-to-APNs delivery.

Remote REST acceptance on 2026-10-12 passed **10/10 checks**, using 13 synthetic identities, including the concurrent final seat (`200`/`409`), legacy direct-message compatibility, membership history boundaries, block filtering, preferences, and revoked authentication. The second run exercised real private R2 storage: a 16,044-byte synthetic WAV round-tripped byte-for-byte, `bytes=0-15` returned `206` with the correct `Content-Range` and private/no-store headers, invalid ranges returned `416`, anonymous access returned `401`, and unsent/outsider/deleted playback returned `404`. All 13 accounts were deleted through the account API, followed by a remote check finding zero fixture users or sessions. All three provider capabilities were configured for the trial; configuration alone does not prove call or push delivery. Preview calls were subsequently disabled at production cutover. The guarded rerun script is `node scripts/lamma-preview-acceptance.mjs --run-preview`; it refuses other hostnames/database IDs and never persists bearer tokens. Sanitized results go to `.cache/lamma-preview/last-result.json`.

Deploying the preview config creates independent `Room`, `RequestLimiter`, `SocialHub` and `LammaJobs` Durable Objects. Never add `script_name: maydan-game` to its bindings. Do not add a route on the public app's domain. A worker.dev API URL is still network-accessible and requires normal account authentication; it is not an authorization bypass or a private network.

The final [sanitized live-provider report](releases/lamma-2026-10-12/live-provider-acceptance.json) records seven passing checks. Twelve real LiveKit participants subscribed to 132 remote audio tracks; each participant received nonzero inbound audio bytes. Signed webhooks bound each participant SID; refreshed tokens preserved the server join generation. Blocking disconnected the blocker and rejected its still-unexpired token while eleven unrelated members continued. A voluntary provider disconnect triggered a signed departure webhook and acknowledged the durable revocation cutoff in 1,218 ms; retrying the old token was rejected. Both calls ended, all twelve synthetic accounts were deleted, and the final remote checks found zero fixture users, sessions or pending provider jobs. Tests used generated tones without microphones, cameras or call recording. This establishes provider behavior, not physical iPhone lifecycle behavior.

## Production dependencies and order

1. Enable R2 and create **private** bucket `maydan-social-audio`. Do not enable an R2 public development URL or custom public domain. Add `SOCIAL_AUDIO` to both `wrangler.jsonc` and `wrangler.rooms.jsonc`, targeting this same bucket. Playback is authorized through the worker for every request, including range requests.
2. Configure the settings below on **both** `maydan-game` and `maydan-rooms`. Use provider secrets through Wrangler's secret mechanism or the dashboard; never source-control their values.
3. After preview acceptance and release authorization, apply `0008_lamma.sql` **once** to the shared `maydan-accounts` database using `--config wrangler.jsonc`. The existing migrations tracker controls application; its three `ALTER TABLE` statements must not be manually replayed. Take a D1 export/recovery point first. The migration is additive and preserves current users, friend relations and direct text messages.
4. Deploy `maydan-game` first. It owns the new `LammaJobs` Durable Object under migration tag `v3-lamma`, plus the minute job/revocation maintenance cron. Deploy `maydan-rooms` second because it references `SOCIAL_HUB` and `SOCIAL_JOBS` in `maydan-game`.
5. Configure the LiveKit webhook, distribute the internal TestFlight trial, and complete real-device acceptance before publicly releasing the new frontend/native build. Existing clients continue receiving direct-message fallback text.

Production migration command, shown for the authorized release operator (not executed by this guide):

```powershell
npx wrangler d1 migrations apply maydan-accounts --remote --config wrangler.jsonc
```

| Setting | Purpose |
| --- | --- |
| `LIVEKIT_URL` | `wss://<project>.livekit.cloud`; Cloud is required for access-token revocation. |
| `LIVEKIT_API_KEY` | Key used to sign room-scoped join/service tokens and verify webhooks. |
| `LIVEKIT_API_SECRET` | Corresponding LiveKit secret. |
| `APNS_KEY_ID` | Production Apple APNs signing-key identifier. |
| `APNS_TEAM_ID` | Developer team identifier for the production key. |
| `APNS_PRIVATE_KEY` | Complete production APNs `.p8` private-key PEM. |
| `APNS_SANDBOX_KEY_ID` | Optional, separate sandbox APNs signing-key identifier for native development builds. |
| `APNS_SANDBOX_TEAM_ID` | Developer team identifier for the sandbox key; must be explicitly configured even when the team is the same. |
| `APNS_SANDBOX_PRIVATE_KEY` | Complete sandbox APNs `.p8` private-key PEM. Requires both other sandbox settings. |
| `APPLE_BUNDLE_ID` | Actual signed app bundle identifier; currently `Maydan`. VoIP uses its `.voip` topic. |
| `SOCIAL_AUDIO` | Private R2 binding, not a string secret. |
| `SOCIAL_MESSAGE_RETENTION_DAYS` | Optional; defaults to 365, with the existing 30-day minimum. Applies to direct/group messages and audio. |
| `SOCIAL_REPORT_RETENTION_DAYS` | Optional; defaults to 365. Report evidence is moderator-only. |

The main webhook URL is `https://maydan-game.mf103871.workers.dev/api/social/livekit/webhook`. Preview uses the same path on its isolated worker hostname. Select the matching LiveKit signing API key. Handle `participant_joined`, `participant_left`, and `room_finished`; other verified events are harmless acknowledgements. Verification uses the raw request-body SHA-256 and JWT signature. No account bearer token belongs in the webhook URL.

`GET /api/social/capabilities` advertises voice/calls/push only when their required bindings/settings exist. This detects configuration, not provider billing, network reachability or real-device readiness. Missing services stay unavailable rather than claiming successful delivery.

The existing `pushNotifications` capability specifically describes **production** configuration. `PUT /api/social/devices` returns `{ok:true, configured}` for that registration's environment: `production`, or `sandbox` (`development` is accepted as an alias). Production/TestFlight devices use only `APNS_*`; development devices use only `APNS_SANDBOX_*`. There is no fallback between environments, including for incomplete credentials. Registering a device is allowed while its provider configuration is absent, but its queued pushes are skipped and completed rather than retried or replayed after configuration is added. New events can use the retained registration once all three matching credentials exist. A sandbox-only setup therefore leaves the general production capability false; development acceptance must inspect the registration response. Actual provider failures continue using the bounded outbox retry window.

Apple's [token-authentication documentation](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns) restricts newly created keys to one environment. Select the matching environment and app bundle ID when creating each key. The ordinary topic is `Maydan`; incoming direct calls use `Maydan.voip` with the separate PushKit token. Both topics need real-device acceptance; configuration presence alone does not verify Apple's topic authorization. No additional VoIP certificate is used by this token-based backend.

During the trial, review LiveKit dashboard participant minutes and Cloudflare private-bucket stored bytes and read/write operations, alongside each provider's billing/usage view. Call recording is not enabled. These dashboards provide usage visibility; no automatic budget alert, spend limit, or recurring monitoring automation has been configured, and this guide does not assume a price or free allowance. Record observed usage and applicable account pricing before release.

## Privacy and lifecycle behavior

Groups are private, capped at 12 accepted members. Owners/admins invite their own current friends, invitations expire after seven days, and accepting rechecks friendship, blocks and capacity in the D1 write. New/rejoining members only see messages after that join. Ownership transfers explicitly, or to an admin/earliest remaining member on owner departure. Blocking does not remove group membership; blocked authors' messages, unread counts, notifications and shared calls are filtered. A blocker exits an already shared active call, while unrelated participants may continue.

Voice uploads use authenticated JSON base64, at most 3 MiB and declared duration at most two minutes. Container signatures and size are checked; the worker does not transcode or fully decode the media duration. First-party recorders enforce the capture duration. Browser/native codec interoperability is a required device test. Unattached uploads expire after 24 hours. R2 IO is followed by another authorization check before playback. Deleted/reported audio is unavailable to ordinary members; a report can retain scoped evidence for authorized moderation until report retention expires.

The server issues five-minute, room-scoped, microphone-only LiveKit tokens. Tokens carry no room administration grants. One account can occupy only one active call on one device. Removal uses Cloud's explicit revocation cutoff and durable retries, including the same-second token boundary; a very brief rejoin can answer `CALL_RECONNECTING`. Failed provider revocations remain queued, so a provider outage can delay physical disconnection. Clients must also terminate media on revoked authentication, unavailable scope/call, terminal status, own left/rejected participation, or a different accepted device. Network errors require bounded retry rather than indefinite microphone capture.

Each activation carries a server-issued join generation in signed participant metadata; clients cannot update that metadata. Idempotent joins retain the generation, while a true rejoin advances it and clears the previous provider SID. Joined/left webhooks cannot attach or terminate a newer activation using delayed events from an older connection. Webhook-triggered provider revocation is queued to the durable job worker, with its alarm armed before notification fanout, so it does not depend on the incoming webhook connection remaining open.

Direct incoming calls alone use VoIP pushes/CallKit. Group calls use ordinary APNs invitations. Push payloads contain `recipientId` and opaque navigation IDs, never account tokens or LiveKit credentials. Text previews are opt-in; preferences and conversation mutes are checked before sending. Device registrations bind to current sessions and APNs rejects remove stale tokens. Actual background calling is implemented by the native engine; a WebView cannot be relied on to preserve the microphone when suspended.

Device registration rechecks session ownership, expiry and revocation inside its atomic database writes. An older session cannot delete or replace a newer account's registration on the same installation or push token, including requests that authenticated before an account switch. Equal creation timestamps retain the existing session. Delayed device deletion is session-fenced too, so retiring a prior login cannot erase the current login's registration.

## Acceptance matrix

| Area | Automated evidence | Required trial/device check |
| --- | --- | --- |
| Migration/compatibility | Existing v1 suite; additive migration preservation; actual D1/workerd tests | Existing direct chats still load and old client sees voice/invite fallback text. |
| Group privacy | Invite, owner/admin, join-boundary, block filtering and concurrent 12th-seat tests | Two accepted accounts plus outsider; remove/rejoin and reconnect on two devices. |
| Voice privacy | Private/Ranged playback, double-claim, delete/retention, delayed R2 block checks | iPhone AAC to browser and browser WebM/MP4 to iPhone; recording interrupted by calls; two-minute limit. |
| Reports/deletion | Moderator report queue, protected audio evidence, author deletion and owner succession | Moderator hears evidence; ordinary members cannot; deletion leaves only allowed shared history. |
| Calls | JWT grants, provider request authentication, device race, cutoff/revocation and webhook verification | 1:1 and 3-person calls; block/remove/suspend/logout; retry old token after removal; provider disconnect/reconnect. |
| Push | Preference/mute/block/session checks; payload identity; APNs rejection cleanup; independently verified production/sandbox signatures and origins, incomplete-key isolation, and registration-environment races | Sandbox development plus production TestFlight APNs; locked/terminated direct calls; group-call invitation; account-switch stale push. |
| Offline/recovery | Persistent D1 jobs with leases/retry | Temporarily fail APNs/LiveKit/R2 in preview; restore and observe bounded retries without leaking stale events. |
| Native lifecycle | Native unit/build checks elsewhere in repository | Locked screen, Bluetooth, headphones, interruption by cellular call, multiple devices answering, and game privacy/ducking. |

Local protocol tests use a fake provider transport and verify JWTs/request semantics independently; the additional live-provider report above verifies the exercised Cloud requests and media paths. Relevant source references: [LiveKit token grants](https://docs.livekit.io/frontends/reference/tokens-grants/), [RoomService API](https://docs.livekit.io/reference/other/roomservice-api/), and [explicit token revocation](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/).

## Rollback

Record both worker version IDs and a D1 recovery point before release. Roll back UI/native exposure first while retaining the backend maintenance worker until active calls and deletion/revocation jobs drain. End active LiveKit rooms through the authorized provider operator if the application control path is impaired. Removing provider credentials alone does not revoke existing tokens or stop connected calls.

The additive tables/columns can remain if reverting application code; do not drop group/audio/report tables or rerun migration `0008`. A prior worker version does not process the new job outbox, so a full backend rollback needs an explicit maintenance plan for queued R2 deletion/provider revocation and evidence retention. Keep the private bucket private throughout. Do not restore an entire old D1 snapshot over newer account/social writes as a routine rollback. Preview cleanup must target only the named preview database, bucket, worker and LiveKit project after test data is no longer needed.
