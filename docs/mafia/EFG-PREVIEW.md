# Remaining Mafia Maydan phases: implemented preview

Updated 2026-10-30 (Asia/Amman). The owner explicitly requested implementation of all remaining phases without tests. E/F/G therefore proceed as experimental preview implementation. The earlier D2 physical-device and D3 human-balance acceptance has not been completed, waived into a passing result, or inferred from compilation. Production activation remains outside this work.

Follow-up on the same date: the owner requested completion of the remaining engineering and handoff to the existing Maydan chat for integration and tests. That handoff adds actual skill-aware matchmaking, reproducible faction-prior calibration and immutable future-season policy binding, and an external acceptance evidence evaluator. Its current source is a local handoff candidate until the receiving chat integrates, tests and records a separate release receipt. The prior hosted receipt still identifies the prior deployed source; it does not prove these follow-up files are deployed or tested.

The actual candidate commit, compiled artifact hashes, migration ledger and hosted Worker version belong in the external `Maydan-Mafia-All-Phases-Preview-Receipt.json`. Earlier 1715-test evidence belongs to source `d014becd248d683e8c626947215e0cfe64c5e249`; it does not cover these new changes. No new automated tests, browser gameplay sessions, physical-device sessions or human balance sessions are run for E/F/G. Compilation and deployment artifact correspondence are separate operational evidence.

## E: competitive preview

- Individual queue, fixed eight-seat classic ruleset 1, text only. The server assigns new anonymous match seat IDs and temporary seat names; room cosmetics and host settings are suppressed. Normal roles, timers, voting and reconnection remain authoritative in the existing Room object.
- Account activity is reserved in the existing match lease table before queue admission. Room/observer admission and social call writes check conflicting activity inside their database writes. The queue requires ten qualified public match receipts plus the existing completed tutorial or an alternative comprehension check. Suspension, deletion, live session authorization and bilateral blocks still apply.
- A single Room namespace coordinator serializes queue operations, journals assignments and retries creation through the authoritative match object. Queue status and cancellation use the owner's identity and session. Assignment credentials never expose the account mapping to other players.
- A versioned experimental rating model uses the fixed team template and team rating expectations. Normal matches transfer an integer rating budget between the two teams despite unequal team sizes. Forfeit penalties and rating bounds have explicit exceptions. Ten competitive results are placement matches; subsequent band names and numeric boundaries are provisional product choices, without calibration evidence.
- The existing delayed durable result outbox settles rating receipts once. Technical aborts do not manufacture a ranking result. A completed result stays pending until its settlement succeeds. Season closure drains matches, freezes a permanent snapshot and grants one cosmetic license through existing achievements and entitlements.

See `RANKED-PREVIEW.md` for the exact queue, rating, season and recovery policies. This cannot prevent communication outside Maydan or establish competitive fairness without actual acceptance work.

The follow-up queue policy is described in `MATCHMAKING-POLICY.md`. `RATING-CALIBRATION.md` defines the evidence-derived future model; the active experimental season retains its original model. `ACCEPTANCE-EVIDENCE.md` defines the operator evidence contract. Missing human observations, physical hardware and actual voice quota remain missing evidence, not values that code can synthesize.

## F: free cosmetics, clubs and limited tournaments

- The cosmetic season is free. Twenty qualified public participations during its explicit window unlock the existing Noir avatar. It changes appearance only and uses the existing earned inventory.
- A current social group may opt into a club identity. Its existing owner/admin/member authority, invitations and chat remain the membership source. The participation mission needs twenty eligible current-member credits and at least three credits from the claimant; a match can support only one club for that account.
- Limited club tournaments fix eight current members and three private classic, text-only, ruleset-1 rounds. The organizer selects a completed match from their authorized history. The server matches the frozen roster, settings, start time and authoritative processed result receipts. Users cannot submit a winner or a rating.
- Closing fixes standings and club recognition, without cash or transferable power. Existing support contact handles disputes. Leaving, revocation, account deletion and group closure are enforced through the existing group authority; frozen participant loss cancels an open tournament.

See `COMMUNITY-PREVIEW.md` for dates, eligibility, accounting and operating details.

## G: tracker, optional ruleset 2

The base catalog remains twelve roles under ruleset 1. A private room may opt into experimental ruleset 2 with at least eight participants. It replaces one town support role with a tracker who has two night tracking charges. The tracker learns accepted, unblocked outgoing destinations without the action type, faction or success. Blocking spends the selected charge; conversion retains the role; a tracker killed during settlement does not receive a private report. The role guide, action selection, private report, final reveal, delayed review and local specialty lesson use the same engine.

Experimental rooms award no XP, mastery, general win statistics or competitive rating. Their own delayed match history remains available. The ruleset is fixed for the lifetime of the room. The local lesson is available at `#/tutorial/mafia?lab=tracker`; its local decision journal has no online rewards. Exact interactions are in `tracker-ruleset.json`.

## Packaging and preview isolation

`wrangler.mafia-preview.jsonc` alone enables the three additional experiment flags. Every server experiment also checks the exact preview origin. Production configuration, database IDs, bucket, object namespaces, cron schedules, subscription policy and native releases are not changed.

The media hash map is encoded using common prefixes of adjacent sorted paths and decoded synchronously once in the client. Every file keeps its original content hash and URL behavior, with no new network dependency. The single-document HTML budget remains 3.25 MiB; it is not raised to accommodate the new UI.

Schema migrations `0023_mafia_ranked_preview.sql` and `0024_mafia_community.sql` are additive and must precede the new Worker. Existing schema/data is preserved. The preview continues to support saved ruleset-1 matches. Disabling new ranked or tracker admission does not authorize changing the interpretation of an already running room. The rollback target and actual live resources are recorded with the deployment receipt.
