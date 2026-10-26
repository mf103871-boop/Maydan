# Mafia Maydan validation record

Date: 2026-10-26. This is implementation evidence for the isolated `codex/mafia-maydan-20261026` branch, not approval to expose the feature in production.

## Integrated source freeze checks

- The complete Node suite passed **1,302 / 1,302 tests**, with no skipped tests, in 93.2 seconds (`.cache/mafia-root-freeze-suite.log`). This includes existing games, account rules, environment isolation and new Mafia coverage.
- Repository ESLint completed with **0 errors and 23 existing warnings**. The focused new-file checks are clean.
- Python release-tool tests completed **63 tests with 2 platform skips** on Windows. Printed simulator failure/timeout lines are deliberate unit-test fixtures, not an actual simulator run. Swift/UIKit compilation and the four real simulator release gates remain required in CI.
- The preview uses a separate account/session namespace in web storage and native Keychain while preserving production key names. Same-origin production web builds retain their existing account keys. Preview cleanup preserves production identity and local game progress.
- The test environment is a separate worker, database, Durable Object namespaces, audio bucket and LiveKit test project. No production deployment or migration is part of this source freeze.

## Automated evidence completed locally

Commands:

```text
node --test tests/mafia-model*.test.js tests/mafia-integration-audit.test.js
node --test tests/social-realtime.test.js
node --test tests/mafia-native-media.test.js tests/lamma-media-native.test.js
node --test tests/mafia-release-guard.test.js
node --test tests/mafia-preserved-bundle.test.js tests/support-page.test.js
node node_modules/eslint/bin/eslint.js server/mafia-model.mjs src/online/mafia-shared.js server/social/realtime.mjs tests/mafia-model*.test.js tests/mafia-integration-audit.test.js tests/mafia-native-media.test.js
```

- 26 tests passed in the model and focused integration audit suites, including 3,150 complete deterministic synthetic matches across every player count 6–12.
- The latest synthetic run executed 76,348 phase transitions and 170,635 accepted commands. It exercised skipped actions, random legal actions, reversed night-command arrival, repeated JSON persistence/restoration, termination, resource bounds, and unrelated-view privacy after private commands.
- The 22 focused model cases cover distributions, immutable deadlines and phase fences, block/mask/heal/attack/recruit order, charge consumption, shield use, self-protection, tied attack votes, surviving Mafia assistants, observer semantics, generic recruitment failures, reporter truth at death, herald extension, strict verdict majority, all victory conditions, private revisions, conversion chat boundaries, eliminated/waiting-player permissions, 90-second grace, delayed alarms, replay privacy, idempotence, and chat filtering/rate limits.
- Three focused SocialHub cases verify that an existing socket cannot send typing or receive message/group-message/call events while the Mafia lease is active; queued typing from a newly locked sender is suppressed. Deletion invalidations and session revocation still work.
- The pre-existing SocialHub suite passed 13 tests, including workerd/D1/WebSocket tests for tickets, presence, hibernation, typing authorization, deletion and revocation.
- Native media bridge tests passed 19 cases: nine new Mafia cases and ten existing Lamma cases. They verify stale epoch/session rejection, pause without ending the visible call, no queued old-audience restoration while authorization is suspended, session-fenced cleanup, listen-only/quiet microphone denial, and the existing recorder/privacy races. The native background curtain has a source-contract check for a synchronous opaque full-window cover. These use a JavaScript bridge fixture and fake web transport; the Swift checks inspect source contracts only.
- Four offline release-preservation fixture tests reject binding/asset/private-bank/support/update-policy drift, stale or mismatched evidence, unreviewed migrations, missing provider isolation proof, excess capacity, and premature public activation. They perform no live reads or writes, and are not yet connected to the generic deployment command. See `RELEASE-PRESERVATION.md` for exact blockers and the pending simulator snapshot procedure.
- Six private-overlay preparation tests and three restored support-route tests passed. A separate read-only inspection verified exact private-bank sections against both production workers (1,432 catalog / 1,400 active / 32 retired) and exact support HTML, then sealed an explicitly non-deployable candidate draft outside the checkout. No private answers, production snapshots or candidate bytes were added to public source/assets. See `RELEASE-PRESERVATION.md` for the dated evidence and remaining operator/acceptance blockers.
- ESLint passed for the files above.

Synthetic outcomes in the latest run were town 388, Mafia 2,652, shadow 67 and draw 43. These are **not balance measurements**: the simulated Mafia preferentially coordinates attacks while other actors choose arbitrary legal actions without reasoning. They must not be used as win-rate targets or claims of enjoyment.

## Evidence not established by the model tests

The tests above do not establish hosted latency, actual LiveKit revocation behavior, provider capacity, APNs/CallKit operation, native Swift compilation, a signed IPA, TestFlight delivery, physical-device behavior, human understanding or balance. Separate backend and client/native suites are tracked by their implementation owners and must be rerun against the integrated revision.

Production remains gated. Do not turn on Mafia until the private environment has a measured voice-room cap and reserved capacity, verified account leases, an end-to-end revoke-before-commit test, migration/rollback evidence and compatible clients.

Provider assumption checked against the [official LiveKit token lifecycle documentation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-revocation): a short initial token lifetime does not end an existing connection, and automatic refresh can extend reconnect credentials. A failed revocation must therefore retain the account lock until explicit cleanup succeeds; an expiry inferred only from the originally issued token is insufficient evidence of isolation.

## Required real-device acceptance matrix

Use at least two physical iPhones and a third independent browser to verify all three audiences. Record device model, OS, app build, account, role, time and network conditions. A simulator or source assertion cannot replace these checks.

| Seats | Mode | Mandatory playtest focus | Current evidence |
|---:|---|---|---|
|6|Classic|Single Mafia survivability, guaranteed investigator/doctor, short waiting time|Synthetic only|
|7|Classic|Dedicated balance review: two Mafia and no supporting town role; first-cycle elimination and coordinated voting|Synthetic only|
|8|Classic|One support role, voice discussion, each utility role over repeated matches|Synthetic only|
|9|Shadow|Initial leader plus one support, night 2 conversion and team changes|Synthetic only|
|10|Shadow|Two support roles, simultaneous protection/investigation/conversion|Synthetic only|
|11|Shadow|Three Mafia, masked/blocked information and separated channels|Synthetic only|
|12|Shadow|Maximum capacity, three support roles, concurrent speakers and reconnect storms|Synthetic only|

For each count, record a full match and rematch, victory conditions reached, confusion about abilities, time spent waiting after elimination, willingness to replay, and proposed rule changes. Use the same ruleset for a batch; do not tune a running match.

## Adversarial and lifecycle checks before release

- Capture each participant's actual network payload and decode only their own test credentials. Change an unauthorized secret and confirm that neither payload, counters, notification metadata nor observable message cadence changes for the observer.
- During public→night, night→public, defense, conversion, elimination and reconnect: attempt to reuse all previous issued and refreshed credentials from another client. Confirm that old audiences are revoked before any new private grants or private snapshots are delivered.
- Race the last room seat, account entry in two rooms, a replacement phone, host handoff, a block, deletion/suspension and lease expiry. Confirm that device/account fencing cannot be bypassed through old social calls or sockets.
- Deny microphone permission and verify listening/text still work. Test explicit unmute, headphones, speaker output, screen lock, background, incoming system calls, Wi-Fi/cellular change, network loss, late provider responses and return from interruption.
- Confirm that one stable visible call spans internal channel changes, that reconnecting never restores an earlier audience/microphone, and that ending/rejoining cannot let an older leave request revoke a new connection.
- Force failures before and after each D1/DO/provider boundary: no trial spent twice, no unrevoked old audience allowed into a new game, retryable durable final results, and no duplicate release/refund.
- Complete every role as its original team and each convertible role after conversion. Test narrator/report text without revealing unapproved secrets.
- Phone portrait/landscape, keyboard, system back, browser back, long Arabic names, font scaling, screen reader, reduced motion and Studio overrides. Hidden role content must remain hidden when entering the background.
- Verify frontend and server disable flags prevent new starts but let safe in-progress matches end. Verify fixed release contents, migrations, room-worker compatibility and private content preservation independently of Mafia rules.

## Performance and release evidence

Measure action acknowledgment p95 ≤ 300ms and safe audio transition ≤ 3s only on an identified network with RTT ≤ 150ms. Report slower networks separately, along with provider latency and failures; do not infer either target from these local unit tests.

Before a public release, attach the tested revision, migration and deployment artifacts, signed TestFlight build number, actual provider settings/capacity evidence, physical-device results and human playtest notes. A successful automated build by itself is not a release decision.
