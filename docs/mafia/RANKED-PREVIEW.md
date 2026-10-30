# Mafia ranked preview implementation

Updated 2026-10-30, Asia/Amman. Batch E is implemented as an explicitly experimental preview. The user asked to continue without tests; no new test execution, human balance sample, physical-device result or production acceptance is claimed for this implementation. Existing A–D evidence does not validate E.

## Environment and policy

`MAFIA_RANKED_ENABLED=1` is effective only when `APP_ORIGIN` is the exact isolated Mafia preview origin. Other origins fail closed. Ordinary rooms retain their existing rules. Ranked games use ruleset 1, protocol 2, classic eight-player composition, private visibility, plain temporary seat names and text only. There is no party joining, host settings/start/restart/kick/appearance authority, spectator admission or cosmetic reaction selection. Each assigned match generates new seat identifiers on the server; queue credentials are never exposed to peers. The same token secret authenticates the newly issued seat, and the authorized owner alone receives the mapping.

The seeded experimental season is `preview-2026-01`, 2026-10-30 through 2026-12-25 UTC. Ruleset, `preview-elo-1` and reward policy 1 are fixed in the season row. This is a no-sale experiment. The six names of rating bands and numeric cutoffs are provisional product configuration, not calibrated evidence of skill or fairness. No automated next season or production season is created.

Eligibility requires a live non-suspended account, completion of the ruleset-1 tutorial or the short server-checked comprehension alternative, and ten permanent processed public participation receipts. Legacy imports, training and forfeits do not count. No XP, win or rating supplied by a client is accepted.

## Queue and recovery

The queue coordinator is a named object in the existing `Room` namespace. It serializes queue operations, journals a match in D1, transfers all eight reservations in one guarded D1 batch, and asks the destination Room object to create all seats and start using the authoritative engine. A failed invariant rolls back the batch. No new Cloudflare namespace or binding is introduced.

Queue activity reuses the existing `mafia_match_leases` account key. Its two-minute lease conflicts atomically with ordinary seats, observers, media and other matches. An active social call also blocks queue admission; the reverse call path checks the match lease. Queue cancellation compares a server-created revision as well as the seat reference, so an old cancellation cannot remove a later queue instance. A successful heartbeat renews the current owner/session reservation. Leaving the queue dialog cancels before closing. Account/token epochs and abort signals fence stale UI responses.

On assignment, the client stores the server seat and existing secret using the normal owner-scoped room storage before opening the room. A second device can inspect its account's status but cannot invent the first device's seat secret. Existing account authentication remains required for WebSocket reconnection. The ordinary 90-second reconnect grace begins for real sockets after automatic start; an HTTP queue request does not pretend to be a connected WebSocket.

A lost create response is retried against the same journaled room/key. A private Room status endpoint distinguishes an active match, pending durable result, incomplete lobby and genuinely missing state. Failed incomplete lobbies are explicitly closed before reservations are released. A missing state is not inferred from a transient provider error. At most one experimental ranked room is admitted at a time; this is configured policy rather than a measured capacity guarantee.

The local social communication lock covers queue admission and waiting. Existing social state refreshes expose only a lock boolean to the account's other devices; they do not reveal its room, role, target or queue peers. Existing notifications and social UI are suppressed during the lock. These controls cannot prevent people from communicating outside Maydan.

## Rating and settlement

The actual match-level model uses the two faction means, an equal prior for the fixed template and a common experience coefficient: 32 if any participant is still in the first ten matches, otherwise 16. It calculates one integer team transfer and divides it across the six town seats and two Mafia seats with deterministic remainder allocation. Ordinary transfers conserve the total before the rating floor/ceiling. A forfeiter additionally receives at least a 16-point loss; that explicit penalty can reduce the population total. Rating starts at 1000 and remains in 0–3000. Ten settled games complete placement. There is no inactivity decay or separate per-role rating in this experiment.

This equal faction prior still requires human calibration; the implementation does not assert that the classic template currently gives equal chances. Speech length, MVP votes, Plus, cosmetics and XP are absent from the model. Natural elimination preserves the normal result. A voluntary or expired-grace forfeit gets a fixed 15-minute queue cooldown. Technical aborts do not issue rating results; a text-only match that normally completes is a real result.

The existing durable room result outbox now consumes archive, progression and ranked settlement before its durable acknowledgement. Ranked settlement observes the same END+30-second boundary. A frozen digest, per-match ownership token, per-user unique receipt and compare-and-set ratings are committed in one D1 batch. A duplicate identical result is harmless; a conflicting digest or stale rating fails without a partial award and remains retryable. Account deletion removes its own rating, queue, receipts, comprehension and season snapshot rows; a delayed event cannot recreate deleted account data. Other still-live participants keep their own outcome.

## Season close

Only configured moderators can close the season after its end. The command first enters `closing`, stops fresh assignment, and waits until creating/playing matches are drained. It then atomically records `closed`, immutable snapshot placements and the earned reward in the existing achievement/inventory tables. The Mafia ranked dialog exposes this action to moderators. Repeating a close does not award twice. Closed boards use recorded snapshot placements, including gaps left by account deletion, instead of silently reranking the remaining people.

Ten settled competitive games qualify for `mafia_ranked_preview_season`, granting the existing `sahra.frame` through `mafia_achievement`. The grant carries no gameplay strength and follows the existing entitlement/revocation/account-deletion rules. History retention does not erase these receipts or awards. Moderation corrections would need an explicit separately reviewed compensation operation; there is no silent history recomputation API.

## Routes and schema

- `GET /api/mafia/ranked`: own season, eligibility, placement and queue status.
- `POST /api/mafia/ranked/understanding`: alternative comprehension answers.
- `POST /api/mafia/ranked/queue/join`, `/status`, `/cancel`: authenticated serialized mutations.
- `GET /api/mafia/ranked/leaderboard`: anonymous board; blocked during live activity and rechecked before delivery.
- `POST /api/mafia/ranked/season/close`: moderator-only close of the supplied season ID.

`0023_mafia_ranked_preview.sql` creates the season, queue, understanding, match journal, rating, receipt, snapshot and transactional assertion tables. Apply schema only to the isolated preview before deploying its Worker. The normal migration manifest must record these exact bytes. A successful build or migration alone does not establish that queue assembly, fairness, iPhone behavior or operational capacity has been tested.
