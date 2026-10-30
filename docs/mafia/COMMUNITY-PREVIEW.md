# Mafia community preview

Implemented 2026-10-30 (Asia/Amman). Batch F is an isolated, free preview. The user explicitly requested implementation without new tests; no automated, hosted, physical-device or human-balance result is claimed by this document. Use the external release receipt for the actual deployed revision. Production configuration remains outside this delivery.

## Seasonal cosmetics

The free `preview-2026-10-30` track runs from 2026-10-30 00:00 to 2026-12-25 00:00 Asia/Amman, using a half-open server timestamp interval. Twenty processed, public, live, qualified participation receipts within that window unlock `noir.avatar`. Imported history, private matches, forfeits, training and observers do not qualify. The claim remains available after the window because the receipts are permanent. There is no paid track, purchase request, additional game power or automatic subscription.

The server inserts the code-owned `mafia_preview_season` achievement and its existing `mafia_cosmetic_grants` license atomically. Existing inventory/entitlement resolution accepts that license without Plus. Retries do not duplicate either row and do not reactivate a revoked license. Closing or deleting 30-day history does not change qualification. The catalog also defines `mafia_ranked_preview_season` for the competitive season's distinct, server-owned close policy; normal progression cannot award these special metrics.

## Clubs use groups

`mafia_clubs.group_id` references the existing social group. Membership, owner/admin roles, invitations, blocks, chat and closure continue to use the existing Lamma authorities. The community panel does not create a second social graph. An owner/admin may set a moderated short motto with a revision check. Former members and members of closed groups lose access.

An account explicitly credits its processed public qualified receipts to one club. A receipt must finish after both the current membership's join timestamp and the club's creation. The permanent `(user_id,match_key)` credit key prevents contributing the same result to several clubs. A call credits at most 500 new receipts, in chronological order; a later call can continue. Imported or private receipts do not count.

The mission requires twenty credited participations among current, live members and at least three from the claimant. The reward is the existing `noir.roomTheme` license, issued through the same achievement/inventory transaction. Leaving and rejoining starts a new membership boundary and does not import old credits into the current counter. Removing a member reduces the displayed current-member total; licenses earned while eligible remain permanent. There are no purchased guild points or gameplay decks.

## Limited tournaments

A group owner/admin can schedule up to three open events. Each starts at least fifteen minutes in the future and at most seven days ahead. Creation has a group-scoped idempotency key and content hash; retries with different content conflict. Each player registers their own seat. There are eight seats; a manager freezes eight current members before the scheduled start. Registration changes cannot alter a frozen roster.

The only template is three eight-player classic matches, ruleset 1, private and text only. Participants arrange the actual friends room after the scheduled start, with the same eight accounts and those exact settings. This is a limited club event, separate from solo matchmaking and its rating. The current one-room preview ceiling still applies.

A manager chooses a completed match from their own authenticated history. No endpoint accepts a winner, points, role or rating from the client. The server requires a delayed authoritative history record and eight matching processed live progression receipts with one digest and no forfeit. It checks the exact frozen account set, recorded settings, ruleset, start after both lock and scheduled time, and a recent retained archive. A match can belong to one tournament only. A private match that exceeded the daily XP cap can still qualify as a completed round: tournament recognition does not manufacture XP.

Acceptance of a round and its points commits in one D1 transaction. Wins earn three points, draws one and other completed outcomes zero. Missing/deleted accounts, changed membership, absent history, unsupported settings or an incomplete roster prevent acceptance. Account deletion cancels an open event containing that participant. Group administrators can cancel an event when its roster becomes unavailable.

After three accepted rounds, a manager closes the event. The close and permanent per-player place/point snapshot commit atomically; equal point totals share a place. Repeating close returns the existing result without another award. The reward is visible recognition in the club's event standings, with no cash, extra cosmetic license, global rank or game power. This avoids inventing a financial prize or a calibrated tournament ladder. Current members can review recorded rounds and standings. Appeals use the existing support email with tournament/match references; there is no automatic adjudication or promised resolution time.

## Authorization and lifecycle

Community routes use `requireSession(...,{rotate:false})`, rate limits, a live account/session SQL predicate and existing match/media/observer activity locks. Competitive queue claims reuse those locks. Every read projection checks mutable membership and activity in the same SQL snapshot; every write repeats its permission predicate inside the transaction. Private tournament rosters contain account IDs only for authorized current group members. Display names come from current group members in the final protected tournament SQL projection; the panel creates no profile graph or public member search. These are friends-event rosters, separate from competitive anonymous-seat data.

The modal fences all requests by owner, token epoch, request generation and foreground state. Hiding the page covers the panel and aborts transport; restoring visibility reloads under the current identity. Returned data is memory only. The panel scrolls within the viewport and wraps identifiers.

`mafiaCommunityDeleteStatements` removes the account's credits, registration, points and recognition, clears tournament creator references, and cancels an open frozen event that contains the account. It must be included in the account deletion transaction before deleting the user. Other participants' closed recognition is retained. Group closure removes access without erasing other people's completed achievement licenses.

## Integration

- Apply `0024_mafia_community.sql` only to the reviewed preview database, after competitive migration 0023.
- Enable `MAFIA_COMMUNITY_ENABLED=1` in preview only. The flag defaults off elsewhere.
- Route `/api/mafia/community...` through `routeMafiaCommunity` before Mafia's legacy route allowlist rejects it.
- Mount `MafiaCommunity` from the Mafia lobby only when the server advertises the capability.
- Archived result summaries must carry public `startedAt` and `settings.capacity`, `settings.visibility`, `settings.voiceMode`. Older summaries without this evidence cannot become tournament rounds.
- Keep external source/build/deployment receipts separate from the earlier A–D test evidence. A compiled artifact does not prove the new behavior, balance or physical-device safety.
