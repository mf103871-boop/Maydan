# Lamma backend deployment and verification

Lamma adds private friend groups, voice notes, game invitations, LiveKit calls and APNs notifications. The existing direct-message endpoints and text DTOs remain compatible with v1 clients; typed messages retain readable fallback text. All core social features are free.

## Read-only preflight (2026-10-12)

- Production D1 `maydan-accounts` reports only `0008_lamma.sql` pending. No remote migration or deployment was performed during preflight.
- Cloudflare R2 bucket listing returned error **10042: Please enable R2 through the Cloudflare Dashboard**. R2 must be enabled before creating a bucket or activating audio.
- At this checkpoint, `npm test` passed **703/703**, with no failures or skips. Later changes require their own recorded results; this is a point-in-time result, not a standing production certification.
- After the provider/webhook and UI lifecycle follow-ups in this working tree, a second full run passed **712/712**, with no failures or skips. Backend ESLint and the preview worker's `wrangler deploy --dry-run` also passed; the dry run did not deploy or provision resources.
- The subsequent full suite passed **722/722**. The four browser regression suites cover the mobile drawer, actual local-game pause/privacy, voice playback/call interruption, and moderator audio. Newly mounted audio controls were additionally checked against an already active call.
- LiveKit and APNs behavior has local protocol coverage. Real provider delivery, real-device audio and locked/background iOS calls still require the acceptance checks below.

## Isolated trial before a public release

`wrangler.lamma-preview.jsonc` runs the API worker only: it serves no built frontend assets and references no production database, bucket or Durable Object namespace. Its isolated D1 binding was provisioned and all eight migrations were applied on 2026-10-12. R2 remains unbound until it is enabled. Do not paste the production database ID into this file.

The preview API is deployed at `https://maydan-lamma-preview.mf103871.workers.dev`, with its own session secret and synthetic test accounts only. Create the remaining private R2 bucket named `maydan-lamma-preview-audio` after R2 activation and insert that binding. For a replacement preview database, apply **all** migrations using the explicit preview config:

```powershell
npx wrangler d1 migrations apply maydan-lamma-preview-accounts --remote --config wrangler.lamma-preview.jsonc
```

Use synthetic accounts in the preview database. The newly created Maydan LiveKit project is for pre-release testing until cutover; it has no player sessions. Do not run preview and production against the same webhook destination/key. Use an internal TestFlight build and test accounts for production-environment APNs, or a native development build with a separate sandbox key. Production account sessions must not be copied into preview. Configure the login provider for the trial's callback URL if login is exercised. Point a local frontend or an internal native build explicitly at this preview API. Its permitted local frontend origin defaults to `http://localhost:5173`; adjust only to the actual test origin.

The existing `Maydan` Apple App ID now has Push Notifications enabled. Its distribution profile was regenerated, verified for `aps-environment:production` plus Apple sign-in, and the encrypted GitHub build secret was updated. The APNs key registration remains a separate step. A LiveKit project was created with agent recording/observability disabled; provider credentials and actual call acceptance are still required. These provisioning facts do not claim a public rollout or physical-device validation.

Remote REST acceptance on 2026-10-12 passed **10/10 checks**, using 13 synthetic identities, including the concurrent final seat (`200`/`409`), legacy direct-message compatibility, membership history boundaries, block filtering, preferences, and revoked authentication. All 13 accounts were deleted through the account API, followed by a remote check finding zero fixture users or sessions. Voice/call/push capabilities were correctly unavailable; this run does not test their providers. The guarded rerun script is `node scripts/lamma-preview-acceptance.mjs --run-preview`; it refuses other hostnames/database IDs and never persists bearer tokens. Sanitized results go to `.cache/lamma-preview/last-result.json`.

Deploying the preview config creates independent `Room`, `RequestLimiter`, `SocialHub` and `LammaJobs` Durable Objects. Never add `script_name: maydan-game` to its bindings. Do not add a route on the public app's domain. A worker.dev API URL is still network-accessible and requires normal account authentication; it is not an authorization bypass or a private network.

## Production dependencies and order

1. Enable R2 and create **private** bucket `maydan-social-audio`. Do not enable an R2 public development URL or custom public domain. Add `SOCIAL_AUDIO` to both `wrangler.jsonc` and `wrangler.rooms.jsonc`, targeting this same bucket. Playback is authorized through the worker for every request, including range requests.
2. Configure the settings below on **both** `maydan-game` and `maydan-rooms`. Use provider secrets through Wrangler's secret mechanism or the dashboard; never source-control their values.
3. After preview acceptance and release authorization, apply `0008_lamma.sql` **once** to the shared `maydan-accounts` database using `--config wrangler.jsonc`. The existing migrations tracker controls application; its three `ALTER TABLE` statements must not be manually replayed. Take a D1 export/recovery point first. The migration is additive and preserves current users, friend relations and direct text messages.
4. Deploy `maydan-game` first. It owns the new `LammaJobs` Durable Object under migration tag `v3-lamma`, plus the minute job/revocation maintenance cron. Deploy `maydan-rooms` second because it references `SOCIAL_HUB` and `SOCIAL_JOBS` in `maydan-game`.
5. Configure the LiveKit webhook and complete real-device acceptance before releasing the new frontend/native build. Existing clients continue receiving direct-message fallback text.

Production migration command, shown for the authorized release operator (not executed by this guide):

```powershell
npx wrangler d1 migrations apply maydan-accounts --remote --config wrangler.jsonc
```

| Setting | Purpose |
| --- | --- |
| `LIVEKIT_URL` | `wss://<project>.livekit.cloud`; Cloud is required for access-token revocation. |
| `LIVEKIT_API_KEY` | Key used to sign room-scoped join/service tokens and verify webhooks. |
| `LIVEKIT_API_SECRET` | Corresponding LiveKit secret. |
| `APNS_KEY_ID` | Apple APNs signing-key identifier. |
| `APNS_TEAM_ID` | Apple developer team identifier. |
| `APNS_PRIVATE_KEY` | Complete APNs `.p8` private-key PEM. |
| `APPLE_BUNDLE_ID` | Actual signed app bundle identifier; currently `Maydan`. VoIP uses its `.voip` topic. |
| `SOCIAL_AUDIO` | Private R2 binding, not a string secret. |
| `SOCIAL_MESSAGE_RETENTION_DAYS` | Optional; defaults to 365, with the existing 30-day minimum. Applies to direct/group messages and audio. |
| `SOCIAL_REPORT_RETENTION_DAYS` | Optional; defaults to 365. Report evidence is moderator-only. |

The main webhook URL is `https://maydan-game.mf103871.workers.dev/api/social/livekit/webhook`. Preview uses the same path on its isolated worker hostname. Select the matching LiveKit signing API key. Handle `participant_joined`, `participant_left`, and `room_finished`; other verified events are harmless acknowledgements. Verification uses the raw request-body SHA-256 and JWT signature. No account bearer token belongs in the webhook URL.

`GET /api/social/capabilities` advertises voice/calls/push only when their required bindings/settings exist. This detects configuration, not provider billing, network reachability or real-device readiness. Missing services stay unavailable rather than claiming successful delivery.

## Privacy and lifecycle behavior

Groups are private, capped at 12 accepted members. Owners/admins invite their own current friends, invitations expire after seven days, and accepting rechecks friendship, blocks and capacity in the D1 write. New/rejoining members only see messages after that join. Ownership transfers explicitly, or to an admin/earliest remaining member on owner departure. Blocking does not remove group membership; blocked authors' messages, unread counts, notifications and shared calls are filtered. A blocker exits an already shared active call, while unrelated participants may continue.

Voice uploads use authenticated JSON base64, at most 3 MiB and declared duration at most two minutes. Container signatures and size are checked; the worker does not transcode or fully decode the media duration. First-party recorders enforce the capture duration. Browser/native codec interoperability is a required device test. Unattached uploads expire after 24 hours. R2 IO is followed by another authorization check before playback. Deleted/reported audio is unavailable to ordinary members; a report can retain scoped evidence for authorized moderation until report retention expires.

The server issues five-minute, room-scoped, microphone-only LiveKit tokens. Tokens carry no room administration grants. One account can occupy only one active call on one device. Removal uses Cloud's explicit revocation cutoff and durable retries, including the same-second token boundary; a very brief rejoin can answer `CALL_RECONNECTING`. Failed provider revocations remain queued, so a provider outage can delay physical disconnection. Clients must also terminate media on revoked authentication, unavailable scope/call, terminal status, own left/rejected participation, or a different accepted device. Network errors require bounded retry rather than indefinite microphone capture.

Direct incoming calls alone use VoIP pushes/CallKit. Group calls use ordinary APNs invitations. Push payloads contain `recipientId` and opaque navigation IDs, never account tokens or LiveKit credentials. Text previews are opt-in; preferences and conversation mutes are checked before sending. Device registrations bind to current sessions and APNs rejects remove stale tokens. Actual background calling is implemented by the native engine; a WebView cannot be relied on to preserve the microphone when suspended.

## Acceptance matrix

| Area | Automated evidence | Required trial/device check |
| --- | --- | --- |
| Migration/compatibility | Existing v1 suite; additive migration preservation; actual D1/workerd tests | Existing direct chats still load and old client sees voice/invite fallback text. |
| Group privacy | Invite, owner/admin, join-boundary, block filtering and concurrent 12th-seat tests | Two accepted accounts plus outsider; remove/rejoin and reconnect on two devices. |
| Voice privacy | Private/Ranged playback, double-claim, delete/retention, delayed R2 block checks | iPhone AAC to browser and browser WebM/MP4 to iPhone; recording interrupted by calls; two-minute limit. |
| Reports/deletion | Moderator report queue, protected audio evidence, author deletion and owner succession | Moderator hears evidence; ordinary members cannot; deletion leaves only allowed shared history. |
| Calls | JWT grants, provider request authentication, device race, cutoff/revocation and webhook verification | 1:1 and 3-person calls; block/remove/suspend/logout; retry old token after removal; provider disconnect/reconnect. |
| Push | Preference/mute/block/session checks; payload identity; APNs rejection cleanup | Sandbox development plus production TestFlight APNs; locked/terminated direct calls; group-call invitation; account-switch stale push. |
| Offline/recovery | Persistent D1 jobs with leases/retry | Temporarily fail APNs/LiveKit/R2 in preview; restore and observe bounded retries without leaking stale events. |
| Native lifecycle | Native unit/build checks elsewhere in repository | Locked screen, Bluetooth, headphones, interruption by cellular call, multiple devices answering, and game privacy/ducking. |

Local protocol tests use a fake provider transport and verify JWTs/request semantics independently. They do not prove LiveKit Cloud accepts every wire request; the isolated trial must verify that explicitly. Relevant source references: [LiveKit token grants](https://docs.livekit.io/frontends/reference/tokens-grants/), [RoomService API](https://docs.livekit.io/reference/other/roomservice-api/), and [explicit token revocation](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/).

## Rollback

Record both worker version IDs and a D1 recovery point before release. Roll back UI/native exposure first while retaining the backend maintenance worker until active calls and deletion/revocation jobs drain. End active LiveKit rooms through the authorized provider operator if the application control path is impaired. Removing provider credentials alone does not revoke existing tokens or stop connected calls.

The additive tables/columns can remain if reverting application code; do not drop group/audio/report tables or rerun migration `0008`. A prior worker version does not process the new job outbox, so a full backend rollback needs an explicit maintenance plan for queued R2 deletion/provider revocation and evidence retention. Keep the private bucket private throughout. Do not restore an entire old D1 snapshot over newer account/social writes as a routine rollback. Preview cleanup must target only the named preview database, bucket, worker and LiveKit project after test data is no longer needed.
