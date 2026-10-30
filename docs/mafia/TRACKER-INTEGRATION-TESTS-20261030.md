# Tracker and audio/privacy integration — local evidence, 30 October 2026

This report covers the local merge of the A–G Mafia implementation (`2be5078`) with the private audio candidate implementation (`b0d9555077b5533642fec2662097ac11c34c497c`). Tests ran in the managed `codex/mafia-audio-integrated-20261030` worktree. They do not establish acceptance on a physical iPhone, a live voice provider, or a public deployment.

No remote deployment, TestFlight dispatch, account/secret mutation, invitation, or paid CI operation formed part of this integration check. Local servers used synthetic accounts and local D1. Browser fixtures denied all network requests. `WRANGLER_WRITE_LOGS=false` was set for the local server checks.

## Product defects reproduced and corrected

1. **An account-wide Mafia reservation could leave private social content visible before a parent effect ran.** The actual `SocialHost` displayed a synthetic friend/message while `social.mafiaCommunicationLocked` was already true but the global interruption store had not yet received the parent's passive effect. `SocialHost` now combines both signals synchronously. The same current signal also invalidates an already queued notification sound. The owned current Mafia call retains its disconnect path; a call belonging to another account never receives controls.
2. **`pagehide` could leave a revealed role in the actual game DOM while `document.hidden` was still false.** The new regression failed in both Chromium and WebKit before the fix: one role remained mounted and no privacy cover appeared. `Mafia.jsx` now shares a synchronous `visibilitychange`/`pagehide`/`pageshow` privacy hook between the match view and its sound wrapper. Only ephemeral private tabs/dialogs are reset when covering. Returning requires an explicit role reveal or reopening the private clues tab. Canonical role, charges, reports and match state remain intact; no game, microphone, disconnect, or transport command is triggered by the lifecycle events. The private specialty-session wrapper uses the same hook so its explanatory coach cannot remain visible outside the covered inner game.
3. **An old return/teardown could send an authenticated request using the next account.** Independent review reproduced this in `LammaProvider`; the expanded regression uses the actual provider, `LammaClient`, and `MafiaVoiceSession`, replacing only unrelated social data and the media transport. In both browser engines, account A's deferred game stop previously produced two POSTs under account B: the old game leave and A's group restore. A delayed social disconnect also sent A's old call leave under B. Entering game voice had the same stale leave chain, and token rotation while media connection completed could leave a stale active-call surface. All were reproduced before their final fences.

The call fix captures owner, client/auth epochs, authorization and call intent before awaiting. It rechecks these before requests, media connection, and cleanup. `MafiaVoiceSession.stop` takes an optional captured request context before its await; existing callers retain the original default. Newer account/session/call work owns its own cleanup: an old result cannot release an idempotently reused current call. Only an exact still-owned stale transport attempt is closed locally after an authorization change. A successful explicit return joins muted and leaves microphone activation to the user.

The actual game browser fixture additionally checks its current-call controls: they stop claiming to be visible while covered, return with disconnect enabled, and retain the phase-enforced microphone lock after restoration. The separate actual `CallControls` browser test covers its floating, dialog and inline surfaces, with unchanged position and no lifecycle-triggered audio actions.

## Tracker rules and compatibility checked

`tests/mafia-tracker-integration.test.js` adds fourteen tests against the actual shared authoritative rules, the local result/review/progression implementations, and the real specialty adapter. No tracker rules were changed to make these tests pass.

- Numeric ruleset 1 remains the default, keeps its original twelve-role catalog, and remains usable by old clients. Experimental ruleset 2 requires explicit numeric capability support and private rooms of at least eight seats. Unsupported ruleset 3 and string representations remain rejected.
- Real distributions for every supported tracker room size, over sixteen seeds each, preserve the faction counts and existing shuffle while replacing exactly one support role with tracker.
- Selections can be changed or cancelled before close; exactly two accepted uses are available. Blocking still consumes the accepted charge, does not provide destinations, and does not reveal its cause.
- Only accepted, unblocked outgoing selections are reported. Incoming protection and passive survival are not activity. A doctor, a quiet investigator, a passive citizen/guard, both analyst targets, masking, recruitment, reporting an eliminated player, and a Mafia member's own attack selection are covered.
- Destinations are deduplicated and sorted by public seat. Their report contains no action type, faction, success flag, investigation result, or recruitment outcome. Comparing every other player's complete projection while changing only the tracker's target produces identical snapshots.
- Killing the observed actor preserves already accepted selections; killing the tracker prevents delivery. Recruiting a tracker preserves its original role and remaining charges. Persistence preserves choices/resources and never exposes live replay.
- Version 2 results produce delayed owner-only anonymous reviews with numeric destination seats. The checks reject duplicate settlement and foreign access. They produce no XP/mastery/ranked receipt or generic public win/stat row. Forged progression and ranked settlement remain rejected.
- The complete tracker lesson restores every checkpoint and runs with traps on fetch, WebSocket and real timers. Its stored journal contains decisions, not role maps, reports, tokens, chat, seed, or microphone data. The separate blocked example intentionally starts a teaching checkpoint with a fresh two-charge tracker; it does not recharge a live match.

`tests/mafia-ruleset-runtime.test.js` now also tests real local HTTP and WebSocket boundaries: an old client is rejected before v2 seat creation/private-state delivery, whereas the same capabilities continue to create and join ordinary v1 rooms. An initial attempt at this additional test failed the CORS fixture because its preview origin was not in the fixture's `ALLOWED_ORIGINS`; correcting that test configuration produced the intended boundary proof without changing product code.

## Tutorial compatibility corrected

The existing specialty tests assumed there were five courses and routed any unknown course to abstention. Adding tracker made the browser helper wait for a nomination step that tracker never has. The helper now explicitly plays the real tracker trace, quiet-target and blocked-result steps; it checks all six courses and the tracker's v2 saved record. Unknown future courses fail explicitly. No timeout was increased.

The adapter helper also avoids eagerly dereferencing a nonexistent guard in the tracker cast. The v1/v2 registry and malformed-review tests now recognize supported v2 and reject unsupported v3, while retaining the v1 defaults and strict type checks.

## Independent audio and merge audit

The merged `PlatformApp.jsx` retains the stable home-music scene owner and release behavior. `Online.jsx` retains Mafia ambience ownership, account mismatch fencing, the voice bridge, and separate cleanup; no new media connection is created by ordinary navigation. The authoritative server's existing privacy preparation revokes applicable social media even for text-only Mafia. No server change was necessary for these findings.

The lossless catalog packaging module and its `scripts/lib.mjs` plugin preserve all exported metadata, aliases, recursive freezing, byte hashes and provenance. The actual esbuild test checks the transformation and size saving. No HTML limit was increased, no source audio/manifest bytes were rewritten, and no previously unapproved candidate became generally active. The root integration task owns the final complete private-build/UI check.

## Executed local results

| Check | Result |
|---|---|
| Focused integration: tracker, audio/privacy, ruleset policy/runtime, reviews, specialty adapter, actual CallDock browser, complete fixed tutorial, tutorial review and catalog packaging | **94/94 pass**, zero skip/fail |
| Actual six-course specialty browser flow, Chromium and WebKit, including private coach/role `pagehide` coverage, retries, RTL, owned saves, zero transport | **Pass**, about 26.5 seconds |
| Final actual SocialHost + game role/report/call-control browser lane, Chromium and WebKit | **8/8 pass**, zero skip/fail |
| Actual provider/client/session call races: fourteen scenarios in each browser engine, plus sixteen existing voice-session tests | **46/46 pass**, zero skip/fail |
| Final focused social regression: provider races, session, client, authorization/device/member races, actual CallDock and audio/privacy browsers | **109/109 pass**, zero skip/fail |
| ESLint on all source/test files changed by this audit | **Pass** |
| Before-fix actual game `pagehide` lane, Chromium and WebKit | **Failed as expected**, then passed with the product fix |

For the focused command, set `MAFIA_AUDIO_PRIVACY_BROWSER=1`, `MAFIA_DOCK_BROWSER_TEST=1`, and `WRANGLER_WRITE_LOGS=false`, then run `node --test --test-concurrency=2` with these files:

```text
tests/mafia-tracker-integration.test.js
tests/audio-mafia-privacy-integration.test.js
tests/mafia-ruleset-policy.test.js
tests/mafia-ruleset-runtime.test.js
tests/mafia-review.test.js
tests/mafia-specialty.test.js
tests/mafia-call-privacy.test.js
tests/mafia-tutorial.test.js
tests/mafia-tutorial-review.test.js
tests/audio-catalog-packaging.test.js
```

Run `node --test tests/mafia-specialty-browser.test.js` separately for the full browser course flow. Local evidence is under `C:/Users/user/Documents/Codex/2026-10-01/new-chat/outputs/mafia-audio-integration-20261030/release_state30/`: `audio-before-fix.log`, `pagehide-before-fix.log`, `focused-final.log`, `specialty-browser.log`, `ruleset-runtime.log`, `pagehide-final-controls.log`, `catalog-packaging.log`, and `lint-final.log`.

The call-race lane is `node --test tests/lamma-provider-return-races.test.js tests/mafia-voice-session.test.js`. Evidence in the same directory: `return-races-before-fix-secure.log`, `return-races-complete-before-final-fences.log`, `return-races-final.log`, `return-races-social-regression.log`, and `return-races-lint.log`. Its intercepted HTTPS fixture provides the browser secure context needed for the real client's UUID generation; it makes no real network requests. The scenarios cover account switching, the render/effect gap, same-owner token rotation during stop/API response/connection, explicit end/leave cancellation, a newer social call, a newer game join, an idempotently reused response, old teardown, preservation of the next session's previous-call state, and the unchanged owner's successful muted return.

The root task performs the final full-suite/build reconciliation after these changes. Actual iPhone lifecycle/audio, three-party secret voice isolation, twelve-seat provider behavior, controlled-network latency and human/tutorial balance remain pending. This report does not replace those launch gates.

## Files changed by this audit

Product: `src/social/SocialHost.jsx`, `src/online/Mafia.jsx`, `src/games/mafia/tutorial/MafiaTutorial.jsx`, `src/social/LammaProvider.jsx`, and the narrow default-compatible stop request context in `src/social/mafia-voice-session.js`.

New tests: `tests/mafia-tracker-integration.test.js`, `tests/audio-mafia-privacy-integration.test.js`, and `tests/lamma-provider-return-races.test.js`.

Updated compatibility/browser helpers: `tests/mafia-ruleset-policy.test.js`, `tests/mafia-ruleset-runtime.test.js`, `tests/mafia-review.test.js`, `tests/mafia-specialty.test.js`, and `tests/mafia-specialty-browser.test.js`.

No shared rules/model, room/router/worker, native code, source audio, or release/deployment helper was changed by this audit.
