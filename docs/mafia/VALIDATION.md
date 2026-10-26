# Mafia Maydan validation record

Date: 2026-10-26. This is implementation evidence for the isolated `codex/mafia-maydan-20261026` branch, not approval to expose the feature in production.

## Integrated source freeze checks

- The complete Node suite passed **1,350 / 1,350 tests**, with no skipped tests, in 85.0 seconds (`.cache/mafia-voice-query-final-suite.log`). This includes existing games, account rules, environment isolation and new Mafia coverage.
- Repository ESLint completed with **0 errors and 23 existing warnings**. The focused new-file checks are clean.
- Python release-tool tests completed **64 tests with 2 platform skips** on Windows. Printed simulator failure/timeout lines are deliberate unit-test fixtures, not an actual simulator run. The four real simulator release gates remain required in CI for the final source.
- The preview uses a separate account/session namespace in web storage and native Keychain while preserving production key names. Same-origin production web builds retain their existing account keys. Preview cleanup preserves production identity and local game progress.
- The test environment is a separate worker, database, Durable Object namespaces, audio bucket and LiveKit test project. No production deployment or migration is part of this source freeze.

## Automated evidence completed locally

### Final hardening after the first hosted runs

- Account provider capabilities are now advertised separately for native iOS and web. Google requires both its client ID and secret; a native Apple bundle ID does not imply that Apple web redirect login is configured. Sign-in loads this public configuration independently of StoreKit, deduplicates concurrent reads, exposes retry on failure, and rechecks before authorization. The isolated Google client is restricted to the preview origin and callback; production credentials are unchanged.
- The actual browser/native-bridge provider, sign-in and StoreKit regressions passed **47/47**, plus **14/14** catalog/readiness/environment checks. Correcting the old unscoped test account fixtures exposed a missing `getMe` import in purchase preflight; restoring it is covered by the successful purchase test. These fixtures do not prove a real Apple purchase or Google login.
- Optional web image prefetch now pauses before dequeuing work during online play, calls, recording/playback and hidden pages. Already-started requests finish and preserve progress. Native bundled-resource behavior remains unchanged. Mandatory Fabraka service-worker installation keeps all 32 prerequisites while bounding concurrency to three. Actual Chromium Splash/Lamma integration and focused regression checks passed; this is not a hosted latency measurement.
- Successful D1 metadata synchronization is cached only for unchanged room metadata. Private choices retain their durable commit and live authorization checks. Membership, media epoch/failure and terminal changes still synchronize; cold objects and failed writes do not reuse success fingerprints. Routine commands now use one live union query to authorize the actor before mutation and reconcile other sessions within the same serialized task. There is no authorization cache across requests. Changed phase, audience, session set, expiry, renewal or pending revocation invalidates reuse; start and transition boundaries retain fresh checks.
- Mafia voice grants are bound to the authenticated account session and its expiry on the server. Signout and suspension wake the owning room even after its WebSocket closes; exact expiry survives rehydration. Strict provider cleanup, quarantine, legitimate rotation, separate valid sessions and the ordinary-command batching are covered by **28/28** Mafia backend tests and **117/117** combined backend regressions. Independent review reran the focused suite and verified that a revoked peer's cleanup blocks snapshots and acknowledgments.
- Swift release compilation passed for source `f787b5e561cbda4140bcf04018477bd5c96955ba`. Its simulator launch gate correctly refused an outdated seven-card expectation while the healthy Home screen displayed eight games. The Swift receipt, Python verifier and actual-Home tests now require exactly eight, including Mafia; no readiness, migration, token, PID, survival or timeout gate was weakened. A fresh complete signed workflow is still required.

### Hosted evidence before the final hardening deployment

The isolated server at source `f787b5e561cbda4140bcf04018477bd5c96955ba` passed six-client WebSocket checks and two real LiveKit connections with synthetic microphones, bidirectional audio bytes, and rejection of both original and provider-refreshed prior-phase credentials. A separate twelve-client run observed twelve published participants through the provider API, then distinct opaque night channels for three Mafia and one shadow participant while eight town participants were quiet. An eliminated participant received listen-only grants, defense allowed one publisher, and cleanup returned capacity to zero. These are automated browser/provider tests, not physical phones or human playtests.

Performance acceptance is **not established** by that run: ready acknowledgements had p95 380ms, voice API requests p95 1427ms, initial SDK publication median 5617ms (maximum 14247ms), private-channel publication median 1951ms, and WebSocket ping p95 2534ms. Twelve RTC clients shared one PC. Provider latency, request queues, network conditions and optional asset downloads were not isolated, so these figures cannot be attributed only to the external network. The final source must be redeployed and remeasured with an independent RTT baseline; the 300ms/3s targets remain open until supported by those results.

### Continuity defect found by the subsequent hosted UI run

The six actual React clients on `cb93faf85fb2ea353c75ea961d7e8dc55acc9625` passed creation, public/code joining, readiness, opening chat, two-way RTP and night privacy assertions, but screenshot review exposed an untested continuity failure: provider removal of the previous channel could arrive before the next state snapshot, be treated as a terminal call end, and clear the player's voice request. This earlier run is **not** accepted as evidence of automatic day/night/day continuity.

The corrected web transport silences and discards the retired transport, fences late SDK events, and fetches a fresh grant while retaining the logical call. It immediately refetches an in-flight `unchanged` response that no longer includes the needed credentials. Definitive authorization denial and voluntary leave remain terminal, and recovery retains a usable disconnect action. Native changes fence late HTTP and CallKit transaction results, recover initial/reconnecting SDK failures without replaying old credentials, and keep CallKit action completion bounded. Native UI reports connected only after a matching media snapshot. Web continuity was subsequently verified as described below; the native changes still require a new signed build and physical-device acceptance.

The superseded React run measured 21 command acknowledgments at p95 606.4ms with WebSocket RTT p95 95.8ms; chat p95 was 222.4ms and night actions approximately 563ms. Thus the 300ms target was not met on that observed network. A separate twelve-publisher run received RTP on every client, but only nine clients had all eleven remote subscriptions within its deadline (the others had three, three and seven). It was stopped and cleaned up; it is not a full twelve-listener acceptance pass. The new single-query command path and stronger subscription diagnostics must be measured separately from these older results.

GitHub run `40389918068` passed Swift compilation, signed archive/IPA validation, and all four real simulator gates for the superseded source. Cancellation was requested while upload was pending, but the runner entered upload before acknowledging cancellation. Apple had no build 29 on subsequent official reads; this alone does not prove upload never happened. Build **29 is reserved and must not be reused or delivered**. The corrected candidate uses build **30**, after hosted continuity verification. No public release follows from these checks.

### Verified continuity and twelve-client limits on source `581898aa`

Six actual React clients used the deployed assets without a local compile or bundle replacement. All six received HTML SHA256 `53cabecedfb5cb524e1844ca01b5883d72b809ac860ec7632ee5af37995a43c1`. Creation, public/code joining, chat, readiness and start worked. A town and a Mafia participant retained their requested call across provider retirement: town had zero active RTP at night, Mafia published into its authorized private channel, and both returned to bidirectional public RTP with fresh RTC transports without another join click. All five assertions passed, each client retained one room WebSocket, and foreground privacy covering passed in a browser simulation. This is not proof of the native App Switcher curtain.

That six-client run measured 22 command acknowledgments at p95 464.1ms and WebSocket ping p95 101.6ms. Night actions were 246.5ms and Mafia votes 236.2ms; chat was 357.9ms, readiness 464.1ms and the single start 717ms. Initial voice publication took 4.336 and 4.848 seconds. The overall 300ms target is not met by this sample.

A stronger twelve-client raw-SDK run verified **132/132 inbound remote audio streams**, rejected original and provider-refreshed earlier credentials, isolated three Mafia and one shadow participant from eight quiet town participants, denied an observer publication, and allowed only the defender to publish. One initial publication took 22.71 seconds and the slowest stream settling took 30.11 seconds. Voice-grant requests had median 991ms and p95 1426ms. These establish functional provider checks, not prompt twelve-client UI delivery.

The separate twelve-React-client run retained normal authorization polling and failed the unchanged twelve-second full-stream deadline: **131/132** streams arrived, with one client receiving ten instead of eleven. It stopped before night. All twelve connected and published, with no active-window HTTP failures, but voice synchronization medians were 569–1065ms per client and some requests took 3–5.5 seconds. Event-loop p95 was 1.0–2.8ms with isolated 631–1165ms peaks; available PC memory fell to about 1GB. This does not isolate network, provider, queue and local pressure, and cannot be attributed solely to the PC. Failure and cleanup evidence remain separate from successful six-client continuity. Production was unchanged and isolated slots/seats/leases returned to zero.

The next narrow server optimization combines live session/account and media-lease validation into **one fresh SQL read per request**, preserving `AUTH` versus `MAFIA_ACTIVE_ELSEWHERE` and all revocation/device/phase barriers. Only an unchanged `sync` may skip a durable alarm write, and only after a fresh `getAlarm()` exactly matches the newly computed deadline. Earlier/later authentication, phase or socket deadlines still write; repeated joins and other games keep normal scheduling. Focused tests passed **31/31**, including ten actual-SQLite boundary cases, a database read failure, no cross-request authorization reuse and scheduling equivalence. A new hosted measurement is required before claiming a latency improvement.

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
