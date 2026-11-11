# Trial / rewarded full-match access (local implementation)

This document describes source changes, not an activation receipt. No server,
AdMob dashboard, App Store or Google Play setting is changed by this work.

## Policy and compatibility

Both flags are absent by default:

- Server: `GAMEPLAY_ACCESS_POLICY=trial-ticket-v1`.
- Optional native build fallback: `MAYDAN_GAMEPLAY_ACCESS_POLICY=trial-ticket-v1`.

The fresh server billing configuration can explicitly select free access.
A cached `/api/me` from a free release cannot disable an explicitly gated
build while the current server request is unavailable. Disabling new ad
requests does not disable the product policy. Trials, earned tickets,
existing full matches and genuine server-side Plus remain independent of
AdMob availability. A missing ledger configuration is unavailable, not free.

Apply additive migration `0030_rewarded_game_trials.sql` before enabling the
policy. Existing per-offer claims retain a nullable game key. No duplicate
historical trials are deleted or rewritten. New trials are unique per
account, environment and game across its local/online modes, and historical
`trials` rows and claim rows both count as already used.

Eleven actual offers cover eight games:

| Game | Local | Online |
| --- | --- | --- |
| Badeeha | Yes | Yes |
| Beep | Yes | No |
| Mamnoo | Yes | No |
| Jabeen | Yes | No |
| Fabraka | Yes | Yes |
| Meenfina | Yes | Yes |
| Ersomha | No | Yes |
| Mafia | No | Yes |

The two pre-existing demo offers remain separate. Query flags cannot select
an alternative entitlement for a protected online room. Tutorials are not
full-match offers and do not consume trials. Hostless ranked Mafia queue
participants remain free joiners; no arbitrary participant is charged.

The ten always-free Badeeha packs are `general`, `geo`, `capitals`, `science`,
`animals`, `history`, `food`, `fruitsveg`, `sports`, and `football`. Online
free-deck validation checks the actual public question-ID manifest as well
as the category labels. Regenerate it with
`node scripts/badeeha-free-manifest.mjs` when the public bank changes.

## Match lifecycle

- Lobby creation, ready toggles, joining and account reads consume nothing.
- The current host needs one first trial, an earned offer-specific full-match
  ticket, or genuine Plus at the actual valid online start.
- The room persists the start intent before reserving D1 eligibility, then
  prepares game secrets and commits its start. Recovery settles the same ID.
- Local games persist a stable pending start ID before requesting the claim.
  A lost response retries that ID. Activating a board clears its pending
  start; a new board/rematch needs a new claim.
- A locally acknowledged saved board retains its grant for offline resume.
  This remains valid if Plus expires mid-match. New protected account match
  starts require the server.
- Local anonymous hosts get the first per-device trial; later starts require
  signing in. Joining another host's room remains free. Trial history is
  preserved when changing accounts; active private grant state is cleared.
- Saved matches from earlier free builds can finish without a new charge.
  Known saved-account ownership is still checked.
- No-fill, skipping and client-side native completion never mint a ticket.
  Only the existing signed server verification creates an earned ticket.
- Ads are explicitly opted into at safe setup/lobby surfaces. Free exit is
  always available, and there are no daily/weekly usage quotas.

## Security boundary and activation blockers

The server is authoritative for account claims and every ordinary online
start. Bundled local game data and user-controlled device storage are not
DRM: a deliberately modified/offline application can alter local boards or
legacy save metadata. Local journaling prevents ordinary replay/races; it
does not claim to stop a tampered client. A strict online-only local-start
policy would require a different product decision and still cannot hide an
already bundled question bank.

Activation requires a compatible published native build, migrated database,
reviewed server release, owned live AdMob unit, correct SSV callback/key
fetching, consent/privacy configuration and actual device acceptance. The
standard existing iOS source still defaults to ads off. Do not enable server
access locks on old clients that lack this gate, and do not raise minimum
versions before the compatible public build is downloadable.

The Android adapter is explicit and separate from iOS. It supports bounded
status/show/privacy calls and cancellation/account fencing, and accepts only
pending/skipped/unavailable presentation results. The offline Android build
reports unavailable. Its isolated SDK demo uses Google's test unit. Actual
Android account auth, owned ad unit/SSV transport and Google Play Billing
remain prerequisites; this change does not emit Android native ad attempts.
Android checkout/redeem and automatic Paddle loading are disabled.

## Reproducible verification

Run Node 22 from the checkout root. All tests use local accounts/databases,
loopback simulators or independently signed test callbacks, never live ads.

```text
node --test --test-concurrency=2 tests/gameplay-access-local.test.js tests/gameplay-access-server.test.js tests/rewarded-server.test.js tests/rewarded-rooms.test.js tests/rewarded-gameplay-rooms.test.js tests/rewarded-gameplay-cloudflare.test.js tests/rewarded-ios-project.test.js tests/account-gating.test.js tests/accounts-entitlements.test.js tests/accounts-cloudflare.test.js tests/plus-profile-only-policy.test.js tests/ios-release-environment.test.js tests/android-rewarded.test.js
node tests/e2e/gameplay-local-access.mjs
node tests/e2e/rewarded-gameplay-room.mjs
node tests/e2e/rewarded-local-preview.mjs
node tests/e2e/rewarded-room-preview.mjs
```

Focused combined suite: 111/111 passed on 2026-11-11. Actual local mobile
Chromium starts/resumes/second-match gates passed for all six local engines,
including a lost start response. The new ordinary room browser test covers
one full trial match, two free guests, gated rematch, simulated no-fill,
explicit simulated reward and ticket consumption. Workerd with D1 validates
two independent Durable Objects competing for one ticket. These results are
not AdMob fill or physical iPhone/Android acceptance.
