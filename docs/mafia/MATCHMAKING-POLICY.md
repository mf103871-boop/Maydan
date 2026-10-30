# Skill-aware Mafia matchmaking

Implemented on 2026-10-30 (Asia/Amman). Policy identifier: `skill-window-1`.
This is source implementation for isolated preview. It is not a measured wait,
capacity, fairness or test result. The receiving Maydan chat must integrate and
test this candidate before considering deployment.

## Candidate window and fairness

The existing account-owned queue and fixed classic eight-seat game remain in
use. The server reads the oldest 64 eligible live queue reservations in the
current season, joining only that season's authoritative ratings. New players
use its initial rating of 1000; no client rating input is accepted.

Candidates are considered as anchors in waiting-time order, with user ID only
as a deterministic tie breaker. For each anchor, companions are ordered by
distance from that anchor's rating, then waiting time and the tie breaker. The
first compatible group found for an older anchor takes precedence over a newer
anchor's group. An incompatible or isolated anchor does not prevent other
people from playing. The candidate horizon is bounded, so this is not a promise
that every account across an unbounded queue participates in every search.

The group's maximum rating spread starts at 150 points. It expands by 300 every
30 seconds of the anchor's continuous wait, capped at 3000, the full current
rating domain, after five minutes. A heartbeat preserves `joined_at`; cancelling
and rejoining starts a new wait. Returning after a reservation actually expires
also starts a new wait. The game is not forced to start at five minutes: eight
compatible, authorized players and the existing room capacity are still needed.

Compatibility always includes bilateral blocks. Expanding the skill window
never bypasses a block, suspension, deleted account, session authorization,
cooldown, tutorial/comprehension requirement, or ten public qualified receipts.
The immutable default ruleset is still 1 and parties are not admitted.

The bounded backtracking search visits at most 512 candidate extensions for
each anchor and 16384 extensions for the entire dispatch. This prevents a dense
block graph from consuming unbounded worker CPU. It can miss a valid group in
a pathological graph after that bound; later queue changes or a revised policy
can resolve it. There is no claim that this computes an optimal clique or a
globally minimal skill spread. The limits and the widening schedule are explicit
preview product choices awaiting operational review.

## Atomic assignment

Skill selection is a read, not permission to start. Immediately before recording
the match, the guarded D1 batch rechecks all eight exact queue revisions, seat
credentials, account sessions, live accounts and queue leases. It also compares
the ratings and game counts used for selection, repeats current eligibility,
cooldown and all activity conflicts, verifies the season is open and the ranked
room slot is free, and rereads bilateral blocks. A failed condition rolls back
the entire batch. Each queue update separately compares its revision. Match
creation and recovery keep the existing journal/Room object path.

Ratings are not modified by matchmaking, and this policy does not replace the
season's rating model. Running matches and frozen season results retain their
existing semantics. The queue status exposes only public policy metadata and
the requesting account's current widening window, never candidate identities,
ratings, block relationships, selected team factions or rejected-group reasons.

## Integration and checks for the receiving chat

- Build the Worker with the new `mafia-matchmaking.mjs` import.
- Cover exact-skill groups, widening boundaries, oldest viable anchor priority,
  multiple compatible groups, bilateral blocks, expired reservations, candidate
  horizon and bounded search determinism.
- Exercise deletion, session revocation, cooldown changes, new blocks, changed
  rating and activity acquisition between selection and assignment. Verify the
  guard rolls back the match journal, queue transfer and leases together.
- Exercise real eight-client assignment, lost create reply and reconnect. A
  synthetic session does not establish human balance or provider capacity.

No new migration or resource is required for this matching policy. No tests,
builds or deployment were executed by the implementing subagent.
