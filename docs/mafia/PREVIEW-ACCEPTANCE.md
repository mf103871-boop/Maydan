# Mafia Maydan preview acceptance

Follow-up 2026-10-30: the owner subsequently requested completion of the remaining implementation without tests. E/F/G are documented in `EFG-PREVIEW.md` and have a separate current-candidate receipt. The D evidence below remains historical; D2/D3 are still unperformed acceptance work, and no previous test result covers the new E/F/G source.

Updated 2026-10-30 (Asia/Amman). This is the operating and acceptance record for batch D, building on the isolated A/B/C preview. D1 measurement, D4 local specialty labs/review, and D5 reporting have implementation and automated evidence. D2 physical-device acceptance and D3 human playtesting remain open. This document does not mark the whole plan complete or authorize production activation.

Keep the final candidate commit, artifact hashes, active Worker version, migration evidence, test output and native build identity in the external release receipt. Do not insert the candidate's own commit hash into this file and create a self-referencing freeze. Existing receipts for earlier revisions remain historical evidence.

## Evidence and delivery boundaries

| Layer | Recorded state | What it establishes |
|---|---|---|
| Current D source | Local rules/SQLite/transport/privacy tests and actual Chromium/WebKit component tests cover the new features. Final integrated suite/build results belong in the frozen D receipt. | Implemented behavior on the tested local source and browser fixtures. |
| Hosted C | Source `b53f318b0988192d438688498ad6de14e5d9c78d`; isolated Worker version `fe88f8b0-72a1-45a7-8f80-a627f226486f`. External receipts: `release-c.json` and `hosted-profile-c.json`. | A hosted synthetic text match, profile/privacy/reward behavior and earned-item equipment without Plus. |
| Hosted D | Use the separate frozen `release-d.json` and `hosted-validation-d.json` receipts for the actual active version, artifact correspondence and hosted acceptance. This source document defines the acceptance contract and does not attest to a live deployment. | Local D checks alone do not establish what is served at the preview URL. |
| Physical iPhone browser | No completed D2 acceptance recorded for these batches. | Responsive browser emulation/WebKit on a PC is not a physical iPhone. |
| Updated native app | No new TestFlight upload for batches A–D in this work; no matched updated-native physical acceptance recorded. | Historical signed builds/TestFlight receipts apply only to their recorded source. A web/backend deployment does not update resources bundled in an installed app. |
| Human play/balance | No completed D3 human sample recorded. | NPCs, local teaching casts and synthetic WebSocket clients do not establish understanding, fun or balance. |
| Production | Outside this preview delivery. | No production or public App Store acceptance follows from these checks. |

Hosted C passed seven recorded checks using six synthetic accounts and real WebSocket clients, an authoritative natural text-only END, no receipts at the recorded early check about 535 ms after END, and later six processed receipts totaling 120 XP after the reward delay. Totals remained unchanged after a further 35 seconds/next alarm. It also exercised private-by-default progress, public visibility choice, bilateral blocks, stale preference revisions, and actual Chromium/WebKit profile/equipment flows at 320, 390 and 844 pixels without Plus. Cleanup deleted all six fixtures and verified their users, sessions, leases, result/progression/profile/cosmetic rows and directory state absent. This is a hosted transport/ledger/product check; it is not human balance, physical-device or LiveKit acceptance. The C migration receipt records an empty pending-name list; migration names alone do not independently attest applied SQL bytes.

The older evidence and its limitations remain in [VALIDATION.md](VALIDATION.md). Profile/reward policy is in [PROGRESSION.md](PROGRESSION.md). Release preservation and native environment selection remain governed by [RELEASE-PRESERVATION.md](RELEASE-PRESERVATION.md) and [TESTFLIGHT-ENVIRONMENT.md](TESTFLIGHT-ENVIRONMENT.md).

## Operating the isolated preview

The preview is `https://maydan-mafia-preview.mf103871.workers.dev`. Its reviewed configuration is `wrangler.mafia-preview.jsonc`, using Worker `maydan-mafia-preview`, D1 `maydan-mafia-preview-accounts`, and R2 `maydan-mafia-preview-audio`. The manifest validates the exact resource IDs and bindings, not just these names. Preview accounts, rooms and results are separate from production. Current ruleset is 1, protocol is 2, and configured capacity values are `MAFIA_MAX_ACTIVE_ROOMS=1` and `MAFIA_MAX_VOICE_PARTICIPANTS=80`. Those values do not prove the voice provider's actual quota.

Before testing a new candidate:

1. Freeze the intended source and record the branch/commit externally. Stop competing builds that share `dist` before packaging the reviewed artifact.
2. Run the local suite, lint and shipped build. A focused investigation can use the commands below, but it does not replace the integrated release checks.
3. Produce and review `node scripts/mafia-preview-manifest.mjs`. Its default output is a local, unverified receipt: it performs no live read, migration or deployment. Supplied ledger/manifest files must match the exact preview target; an empty pending list is not acceptance.
4. Reconcile the live preview version and migration ledger with the receipt. Review all migration bytes; D5 adds `0022_mafia_report_cases.sql` after the B/C migrations. Apply required preview schema before the D Worker, because existing moderation/deletion paths also reference the new columns. Use the preview configuration explicitly for every operator command and retain the existing preservation checks. The generic production deployment/migration scripts are not the preview procedure.
5. Build/check the exact full-worker artifact, then let the authorized preview operator deploy the reviewed bytes. On an ambiguous response, read the actual active version/ledger before retrying. Do not compensate by manually writing room state, rewards or XP.
6. Verify served artifact/version correspondence, run a bounded hosted smoke, reconcile/clean up only its fixtures, and seal the external receipt. Attach the D release and hosted acceptance receipts; preserve earlier receipts as historical evidence. A new source edit invalidates a previous artifact freeze.

Useful local commands from the repository root:

```sh
npm run lint
npm test
node --test tests/mafia-metrics*.test.js tests/mafia-review.test.js
node --test tests/mafia-specialty.test.js tests/mafia-specialty-browser.test.js
node --test tests/mafia-report-cases.test.js tests/mafia-report-ui-browser.test.js
node --test tests/mafia-review-browser.test.js tests/mafia-preview-manifest.test.js tests/mafia-release-guard.test.js
npm run build:cloudflare
node scripts/mafia-preview-manifest.mjs
npx wrangler deploy --config wrangler.mafia-preview.jsonc --dry-run --outdir .wrangler/mafia-preview-check
```

The static `npm run dev` server serves the generated frontend and deliberately answers its own `/api` requests with `PREVIEW_ONLY`; it is not an account server. `npm run rooms:dev` is the separate local in-memory backend, normally port 8787, with local variables read from the ignored `.dev.vars`. Frontend builds can target that local backend with `MAYDAN_ROOMS_URL`; restart/rebuild after changing it. Use only intentional local/test credentials and gates. Automated browser fixtures are the reproducible local path without a real authentication provider. The hosted preview is the practical multi-device path.

## D1: bounded measurement

Server measurement is off unless `String(MAFIA_METRICS_ENABLED) === '1'`. The reviewed preview configuration explicitly sets `1`; absence elsewhere means off. The client accepts an optional `RoomClient` `onMetrics` callback for controlled local experiments. It has no automatic upload, new endpoint, analytics binding or metric storage.

The fixed payload contains `schemaVersion`, `type: 'mafia_metrics'`, `side`, initial/recovery connection histograms, generic command-settlement counters, command/queue duration histograms, eight nonterminal phase counters, a phase-lag histogram, `resultDrained`, and `capped`. It does not contain room/account/seat/session/request/match identifiers, URLs, roles, factions, targets, command types, error text/codes, chat, audio, IPs, tokens, XP, or precise activity timestamps. There are no dynamic labels or dimensions.

Interpret the observations precisely:

- `connectionReady.initial` runs from `RoomClient.start` to the first accepted authenticated Mafia state. It excludes the preceding HTTP create/join admission request and is not a complete join-time measurement.
- Recovery includes the existing retry/backoff and handshake up to the next accepted state. Repeated snapshots, stale replaced sockets and duplicate/late ACKs do not add settlements.
- Client settlements are `ok`, `rejected`, `timeout`, or `transport`. Server command counters measure RPC attempts: an actually resent request is another transport/service attempt, not another committed game action.
- Server queue time measures waiting for the serialized handler. Phase counts follow successful durable commits; phase lag measures the committed transition after the prior deadline. `over` and `closed` are not immediate phase samples.
- `resultDrained` becomes eligible only after archive and progression consumers succeed and removal from the durable outbox is acknowledged. A second independent guard holds it until `max(finishedAt + 30000, notBefore)`, including legacy results. Failed consumers or failed outbox ACKs do not emit a completion sample. The sample is a drained result, not every possible technical abort or room closure.

Histogram bounds in milliseconds are `[50, 100, 250, 500, 1000, 5000, 15000, 60000, 120000]`; longer durations are clipped to 120 seconds. Each counter/cell saturates at 4095, at most 16 future result deadlines are retained, and the fixed record stays within 1 KiB. Flushes piggyback on existing activity at most once per 60 seconds per collector; they add no timers or alarms. A clock rollback cannot bypass the interval or result barrier. A throwing, rejecting or unavailable sink cannot fail gameplay and is not retried.

These are RAM-only, best-effort samples. Hibernation/reconstruction or a failed sink can lose them, including an already acknowledged result sample waiting for the flush interval. There is no durable metrics ledger, completeness guarantee, user funnel or accounting function. They cannot replace reward receipts or reconstruct exact population totals. Coarse/clipped histograms alone cannot prove a 300 ms acceptance percentile.

The privacy guarantee above applies to the application payload. Preview logging enables custom logs and disables `observability.logs.invocation_logs`; Cloudflare documents that invocation logs otherwise include request/response context and Fetch method/URL. Provider-added metadata is outside the payload guarantee and must be reviewed separately; disabling invocation logs is not a claim that all provider metadata is identity-free. See the official [Cloudflare Workers Logs documentation](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#invocation-logs).

## D4: local specialty labs and participant review

The five specialty labs are separate from the original first-night lesson:

| Lab | Learning case |
|---|---|
| Doctor | One self-protection and changing the protected target between nights. |
| Masker | A one-night misleading investigation result and its expiry. |
| Blocker | Blocking active protection while a guard's passive shield still resolves. |
| Conversion | Investigator recruitment changes faction while retaining the role and remaining charge. |
| Abstention | Tied nominations and the difference between an absent verdict vote and a rejection. |

They use the current local rules engine with fixed fictional casts and reviewed teaching choices. The learner's actual action is resolved; an incorrect choice gets feedback and a checkpoint retry. Resume records store bounded decisions scoped to the current account/API origin and lab version on that device, with memory fallback. They do not store a live room snapshot or let a learner submit a chosen live role/seed. They use no online transport, microphone or reward writer, grant no XP/mastery, and do not complete the original lesson on the server. Version/rules incompatibility requires restarting the exercise.

After D is served, the specialty hub is `#/tutorial/mafia?labs=1`; individual exercises use `?lab=doctor`, `masker`, `blocker`, `conversion`, or `abstention`. Test exit/resume, wrong-choice retry, storage failure, account A→B→A, background privacy and incompatible progress. A tutorial is teaching evidence, not a human multiplayer sample.

Completed online matches can be reviewed through the owner's history and `GET /api/mafia/history/:matchKey`. A current live account must own a `mafia_results` row for that match; knowing a key or being a friend is insufficient. The archive must be at least 30 seconds old and less than 30 days old. The observer restriction is checked in SQL, and authorization/source content is read again after projection to suppress deletion, suspension, changed membership or replaced archives. Lobby seat, match and media leases alone do not introduce a new lock on historical review.

The projection exposes only anonymous numeric seats, approved roles/factions and result flags, and allowlisted events with relative elapsed seconds and seat references. It includes no names, persistent player/account/room identifiers, chat or media. Unknown versions/malformed data fail closed. The last 500 valid events are returned with `earlierEventsOmitted`; input size/event/player bounds apply before projection. The GET response is `no-store` and does not award XP. Deleting any participant removes the shared archive; other participants' independent result/progression data follow the existing deletion policy. This is a limited event review, not a recording of the whole match.

## D5: reporting and existing moderation

Reporting adds categories and safe owner status tracking to the existing Mafia evidence and social moderation queue. A new case captures only messages the reporter was authorized to see, with player/observer perspective and actual included channels. Observer evidence remains delayed 30 seconds and public-only. Role maps, unauthorized channels, public audit/reveal history and audio recordings are not copied into the new case evidence.

The owner sees their own reference, room/match reference, category, creation time and `queued`, `reviewing`, or `reviewed` status. They do not receive the private staff attachment, another owner's cases or staff-only account identifiers. Staff evidence uses the existing moderator/session checks. Marking a case as reviewing records work without automatically sanctioning anyone; resolving it and any moderation action use the existing action/decision system. Stable request hashes provide retry/conflict behavior, with final source/authorization checks preventing stale evidence or status after deletion and replacement.

An appeal uses the existing Maydan support contact shown in the product. D5 does not add a separate appeal service, automatic appeal decision or guaranteed resolution deadline.

Retention is unchanged: match history/results have their existing 30-day window; reports follow `SOCIAL_REPORT_RETENTION_DAYS`, default 365 days with a minimum of 30, through the existing cleanup paths. A moderation attachment may therefore outlive the replay window. Account deletion removes related cases through the existing deletion transaction. Durable progression/reward receipts have their separate lifetime described in [PROGRESSION.md](PROGRESSION.md); 30-day replay expiry does not erase them.

## D2: physical-device and browser acceptance checklist

Use two physical iPhones and an independent browser to observe different audiences. Record models/OS, browser version, exact web artifact/Worker version and, separately, the installed native version/build/origin. A physical Safari pass and a native pass are separate rows. Fill other required seats with authorized test participants/helpers; label synthetic helpers as technical coverage, not D3 humans. Use a public room when exercising the delayed observer.

- [ ] Establish a known-good initial join and same-seat reconnect on both phones. Confirm one controlling connection, correct current state, and no replay of an uncertain command. Exercise a replacement connection and late old replies.
- [ ] Check portrait/landscape, safe areas, long Arabic text, font scaling, keyboard open/send/dismiss, Back, dialogs, scrolling and touch targets. Finish all five labs and verify exit/resume and privacy cover on each relevant client.
- [ ] Reveal a role intentionally, then background/foreground, lock/unlock, switch apps, rotate, reload/relaunch and change accounts. Confirm the role closes/covers correctly and private content is not left in the App Switcher. Test the signed updated app for native lifecycle claims.
- [ ] Move Wi-Fi→cellular→Wi-Fi, briefly disconnect, return from a longer outage and interrupt during an in-flight action/phase boundary. Confirm bounded recovery, no duplicate controlling seat/action/reward, and a usable leave path. Record network conditions and independent RTT.
- [ ] With voice off, confirm the text game and privacy still work. With voice enabled, test microphone denial, listen-only use, explicit unmute, playback resume, speaker/headphones, incoming system calls, interruptions and return from background/lock. Verify what the other devices actually hear, not just grant/UI state.
- [ ] Cover public→night→public, defense, conversion and elimination. Old audiences must stop before a new private audience is used; a previous grant/session must not restore unauthorized microphone/listening. Compare a town participant, a faction participant and the delayed observer independently.
- [ ] Verify the observer stays at least 30 seconds behind, receives no role/team/target/voice secrets, and cannot send player actions. Check promotion/admission, block/removal and stale observer credentials without bypassing server authorization.
- [ ] Exercise secret choices and inspect only authorized test payloads: no other role/action, report, target or private-message cadence should become available to an unrelated audience. Confirm the representative profile role is historical and never derived from the live assignment.
- [ ] Verify private/friends/public progress, bilateral blocks, live-match/observer profile locks, stale preference revisions and cached logout/account changes. Verify the owner reward barrier, reopening/reconnect and a repeated alarm without duplicate XP/unlocks.
- [ ] Send/retry a report, inspect only the owner's statuses, and review through an authorized staff session. Check unauthorized/stale sessions, account deletion, retention, and the existing support/appeal contact. Do not include private attachments in a public acceptance report.
- [ ] Test normal completion, forfeit and technical-abort behavior separately. Confirm results/review timing and cleanup; do not manufacture a pass through direct DO/XP edits.

Record each row as pass/fail/not-run with a reproducible trigger, device alias and sanitized observation. For the established performance gate, measure action ACK p95 ≤300 ms and safe audio transition ≤3 seconds only on a recorded network with RTT ≤150 ms. Report other networks separately. Use actual audible transition evidence for voice and an appropriate timing harness; the best-effort metrics cannot prove these targets alone. Any secret/audience leak or duplicate authoritative reward is a blocking defect. Preserve failures and rerun the affected matrix on the corrected frozen candidate.

## D3: human sessions on a fixed candidate

Recruit actual human players for every supported count 6–12. Freeze source, ruleset/protocol, room settings, artifact and Worker versions for each sample batch. Record the optional native build separately. Do not tune a running game or mix observations from different rule versions into one balance conclusion.

| Count | Mode | Required focus |
|---:|---|---|
| 6 | Classic | One Mafia, guaranteed investigator/doctor, first-game comprehension and elimination waiting. |
| 7 | Classic | Dedicated review: two Mafia and no supporting town role; first-night/first-day swings, coordinated votes and early endings. |
| 8 | Classic | One support role and clear ability/voice feedback across repeated role draws. |
| 9 | Shadow | Initial leader, night-two conversion and understanding a changed team. |
| 10 | Shadow | Two support roles and simultaneous protection/information/conversion. |
| 11 | Shadow | Three Mafia, masking/blocking and separated communications. |
| 12 | Shadow | Maximum capacity, three support roles, concurrent discussion and reconnect pressure. |

Plan an initial pilot of at least three completed human matches per count, and at least ten for seven players across two independent groups. These are planning minimums for finding problems, not statistical proof or a winning-rate release threshold. Expand the sample when outcomes, learning effects, missing role coverage or contradictory feedback remain unresolved; report the actual denominator, draws, forfeits, aborts and exclusions. Preserve seven-player results separately rather than hiding them in a 6–12 aggregate.

For each group, record anonymous experience mix, count/mode/settings, lesson/lab use, completed/aborted status, duration and waiting time after elimination. After the match, collect anonymous seat/role/final-faction outcomes, conversion/ability confusion, perceived fairness, ability to explain the win condition, and willingness to replay. Rotate hosts/players across subsequent matches through normal random assignment. Cover each specialty over repeated matches without changing online assignments or granting rewards manually.

Compare novice and returning groups, first-cycle outcomes at seven, team/role outcomes with explicit small-sample limits, technical failures and qualitative feedback. A disconnected session is operational evidence and must not silently become a clean balance loss/win. Use the existing authoritative result facts; the research notes do not write or correct XP. Keep any proposed distribution/timer change as a separate reviewed change with a new compatibility/drain decision and a new sample batch.

## Gate before E, ranking or production

- [ ] Frozen D local/integrated/browser/build checks are green, and the matched isolated deployment/schema/artifact receipt is reconciled.
- [ ] D2 has actual two-iPhone plus independent-browser results on the matching web candidate; any native claim has a matching updated signed build and physical native results. Missing TestFlight/native delivery remains explicit.
- [ ] D3 includes real 6–12-player samples, the dedicated seven-player review, missing-role coverage and a written assessment of fun, comprehension and unresolved balance concerns.
- [ ] Privacy/audience, authorization/deletion, duplicate-reward, serious lifecycle and required performance failures are fixed and reverified. Provider voice configuration/quota and actual media behavior have their own evidence.
- [ ] The owner reviews the evidence and records a separate decision to proceed to E/ranked expansion. Additive XP/profile implementation and automated checks do not establish competitive fairness.
- [ ] Any production decision separately satisfies preservation, migration, capacity, physical/native and human release gates. Keep the preview isolated until that decision; an uploaded build, zero pending migrations or a green CI run is not public-release acceptance.

Store sanitized acceptance and release receipts outside the public source. Include version/artifact references, counts, durations, pass/fail/not-run and cleanup results; exclude credentials, room codes, account/session IDs, private chat/audio and live secret-role captures. Keep operational/provider diagnostics under their existing restricted handling. Current missing physical/native/human evidence remains open work, not an implied waiver.
