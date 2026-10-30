# Complete Mafia A–G and isolated audio integration — 30 October 2026

## Scope and source identity

Review branch: `codex/mafia-audio-integrated-20261030`.

This is a full two-parent integration of the Mafia branch, not a cherry-pick of its last commit:

- Audio/Maydan parent: `b0d9555077b5533642fec2662097ac11c34c497c`.
- Frozen Mafia A–G parent: `2be507853006ca59d3c43890c5ad36118c48f666`.
- Common base: `8e18a43fe0c6f21708235af882e348ef12caf256`.
- Observed GitHub main: `7b131387e423b3c4394bcf326613f45aed75c3e8`, verified as an ancestor of the audio parent.

The integrated source covers the directory/protocol registry, progress and private results, lessons/reviews/reporting, eight-seat ranked matchmaking and season settlement, future rating-policy calibration, clubs/tournaments/free rewards, and the optional private-room tracker ruleset. Default ruleset remains 1; experimental ruleset 2 does not grant XP, mastery, public wins or Rank.

No production deployment, remote migration, new TestFlight upload or paid CI was performed. A read-only Cloudflare check found a main-only production build trigger and no triggers for the rooms or Mafia preview Workers. The review branch does not match that deployment trigger.

## Resolved merge conflicts

- `scripts/lib.mjs`: retain audio materialization, private-asset exclusion and cache filtering alongside lossless media-map compression. CSS whitespace compression preserves embedded strings and URLs.
- `src/social/SocialHost.jsx`: retain guarded/deduplicated audio notifications while applying current Mafia communication restrictions and immediate privacy shielding.

## Defects found and corrected during integration

- Ranked room startup lacked the current match/phase envelope and failed with a stale-action error after all eight players were allocated. It now supplies the authoritative identifiers; real local WebSocket clients start and reconnect successfully.
- A future-season policy bind could race the season start while its write was pending. Its transactional guard now includes the database clock. Current `preview-elo-1` behavior is unchanged; 1,000 rating-parity cases cover that compatibility.
- Tournament submission now requires the organizer's own authorized match history and a consistent eight-player receipt set. Leaving/rejoining cannot revive a frozen prior membership. Membership races, atomic rollback and account deletion are covered in real local workerd/D1 and behavioral tests.
- Ranked UI operations fence account/token/dialog ownership. Unknown join/cancel outcomes are tracked independently of the last displayed queue. Serialized coordinator status must establish absence, exact-revision cancellation or assignment before privacy is released. Detached cleanup cannot keep heartbeating an orphan queue indefinitely.
- Call return, teardown, game entry and connection completion fence identity, authorization generation and call intent across awaits. Stale work cannot send the old game/group request using a new account, release a newer call or create a ghost connection. The unchanged account can still return to its squad call, initially muted. The optional captured stop-request context remains compatible with existing voice-session callers.
- Secret cards/reports/tutorial coaching and call controls are covered synchronously on `pagehide`, including when `document.hidden` has not yet changed. Returning preserves the canonical match and requires explicit microphone intent. A freshly fetched Mafia lock also shields cached social content before passive effects run.
- Acceptance-evidence validation rejects duplicate/inconsistent samples, invalid rules/Worker identifiers and mismatched native/Safari hardware. Its reads remain bounded. Synthetic fixtures never become authenticated physical-device/provider/human acceptance.
- Stale tests were corrected to the exact new registry, preview seed, achievement tuples and six-course tracker tutorial. Existing permission, free/Plus and unsupported-client assertions were preserved.

## Packaging and retained audio identity

The startup HTML cap remains **3,407,872 bytes**. Build-only catalog and media-map compression retain every source field, alias, media path and six-hex fingerprint. Legacy map formats remain readable.

- Production native resources: **3,403,118-byte** HTML, production API origin, **zero private audio files**.
- Isolated preview native resources: **3,403,219-byte** HTML, exact Mafia preview origin, **34/34 audio file hashes verified**.
- Source audio catalog SHA-256 remains `405e2e631bafe99e7076a13fc868eb296565fce877a7c1c96998e444f64d31d0`.
- Encrypted pack and its manifest/receipt remain unchanged. Plain audio remains ignored by Git. Listening approval is still pending; license/private-candidate metadata was not promoted to public approval.
- All 25 migration sources remain unchanged in Git relative to the frozen handoff. Five working-tree copies have Windows CRLF only; normalized contents match the supplied hashes. No remote database was migrated; hosted preview migration 0025 remains unapplied.

## Final validation

| Check | Result |
|---|---|
| Complete `npm test` on frozen runtime/test sources | **1,952 passed, 0 failed, 0 skipped**, about 381 seconds |
| Python release-helper unit tests | **68 run, OK; 2 Windows-inapplicable checks skipped** |
| ESLint | **0 errors, 20 warnings**; 19 pre-existing plus one reviewed community cleanup-ref warning |
| Worker packaging | Passed |
| Preview Wrangler deployment dry-run | Passed; no publication |
| Production and private-preview `ios:prepare` | Passed with origin, size and private-file checks |
| Actual Settings/audio modal | Both engines passed with real AAC, 24 auditions, interruption/close/account cleanup and no automatic foreground replay |
| Real ranked component browser regressions | **35/35**, Chromium and WebKit |
| Actual provider/client/session call regressions | **46/46**, transport simulated; expanded social subset **109/109** |
| Tracker/privacy/compatibility lane | **94/94**; full six-course browser flow passed in both engines |
| Independent replay | Both original unknown-admission and cross-account call-return failures now reject stale work and preserve the current owner |

The complete suite includes actual local room WebSockets, complete 6–12-player matches, real local workerd/D1 transaction checks, browser components and explicit network/media stand-ins where documented. These counts overlap focused subsets and must not be added together.

Local evidence is kept outside the public repository at `outputs/maydan-mafia-audio-integration-20261030/` in the receiving workspace: `final-full-suite.log`, `final-lint.log`, `final-python-tests.log`, `final-worker-build.log`, `final-worker-dryrun.log`, both `native-resources-*.json`, `final-audio-modal-e2e.log`, `cloudflare-build-trigger-read.json`, and `independent-audit.md`. Detailed tracker/call evidence and reproduction commands are in [TRACKER-INTEGRATION-TESTS-20261030.md](TRACKER-INTEGRATION-TESTS-20261030.md).

## Outstanding release gates

This code integration does not authenticate D2 physical-device, D3 human/balance or provider-capacity evidence. They remain pending: two real iPhones plus an independent browser for three-faction secret voice isolation, twelve-seat/background/headset/network behavior, controlled latency/quota checks, and human teaching/balance sessions. Ruleset 2 remains experimental.

Any later hosted preview deployment must account for unapplied migration 0025 and preserve the live private bank/assets/support/settings. No release authorization is implied by this report. Existing TestFlight 1.9 (36) belongs to the audio parent; it does not contain this new merge.
