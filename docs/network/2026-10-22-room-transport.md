# Room transport audit — 22 October 2026

The current rooms remain suitable for the existing turn-based games and live
drawing. The changes below improve recovery, queue bounds, and avoid repeated
room processing. They do **not** certify the application as a movement-based
multiplayer engine, or claim measured latency on a physical iPhone.

## Existing architecture and preserved boundaries

- One SQLite Durable Object owns each room. Hibernating WebSockets deliver
  authenticated commands through a serial mutation queue.
- Private snapshots are filtered separately for each seat. Account-scoped
  Ersomha choices require a current account session in addition to the seat token.
- Drawing uses separate 80 ms batches and a durable delta journal. It does not
  write D1 or broadcast a full game state for each stroke.
- Scores, membership, word exposure/history, and drawing acknowledgments remain
  durable before being published. Uncertain game commands are never replayed.
- Drawing match/round/epoch checks, point limits, token buckets, and account lease
  fences are unchanged. No new wire protocol, endpoint, or migration is required.

## Fixed in this change

1. A foregrounded phone previously sent a ping without a short recovery timeout.
   A half-open TCP socket could wait for the ordinary 40–45 second liveness path.
   Foreground now probes once and replaces a silent connection after 3 seconds,
   without waiting for a close event from the suspended socket.
2. Returning connectivity bypasses an existing reconnect backoff. Repeated
   start/wake signals keep one controlling socket; late events from the old
   socket cannot change the replacement's state.
3. Reconnection to an already authenticated Ersomha room reads the current account
   bearer and includes it in the first authentication frame, saving one round trip.
   Initial/legacy room connections retain their original challenge behavior.
   The bearer is never placed in the URL or saved seat credentials.
4. The room client caps pending commands at 32 and buffered outgoing bytes at
   64 KiB. Congestion triggers state reconciliation instead of retaining an
   unlimited queue of old actions.
5. The server rejects non-text/over-4096-byte frames before entering its durable
   queue; queue admission is capped at 64 frames per socket and 256 per room.
   A flooding socket cannot retain unbounded frames while storage is blocked.
6. Between unchanged room state and the next deadline, ink batches skip repeated
   deep cloning/stringifying of the private room plan. Room replacement,
   rehydration, close events, and alarms re-evaluate state. Hint/deadline/lease and
   silent-peer expiry behavior remain covered by tests.

## Measurements and tests

The controlled benchmark runs real local workerd, SQLite Durable Objects, D1,
eight authenticated clients, and a WebSocket delay proxy. It includes the full
80 ms point batching delay. It does not simulate packet loss or measure rendered
frames, production geography, or LiveKit audio.

| Measurement | Before | After |
| --- | ---: | ---: |
| Injected network round trip | 120 ms | 120 ms |
| Remote delivery p50 | 222.16 ms | 219.66 ms |
| Remote delivery p95 | 234.61 ms | 229.11 ms |
| Remote deliveries | 420 / 420 | 420 / 420 |
| Weak 480 ms RTT: remote p95 | Not measured | 591.25 ms |
| Weak-network remote deliveries | Not measured | 420 / 420 |

The small normal-network timing difference may include scheduler variance; it is
not evidence of a large reduction in Internet ping. The deterministic gains are
bounded recovery and queue behavior, plus eliminating repeated room clones.

Evidence is retained in the task's `outputs/network27/rooms-*-latency.json` files,
with source and bundled-module hashes. `--worktree-benchmark` allows local
development measurements, explicitly marked `releaseAcceptanceEvidence=false`;
the default command continues to require a clean backend before release evidence.

Validation completed:

- 120 room/network/server tests: 119 passed, no failures, one existing shipped-page
  environment skip; includes actual workerd games with 2, 3, and 8 players.
- Added regression coverage for dead foreground sockets, stale close events,
  reconnect backoff, stale bearer prevention, duplicate connections, congestion,
  queue flood isolation, and timely hints after the unchanged-room optimization.
- A subsequent focused run includes the additional oversized-frame rejection
  test and passes. Physical iPhone and cross-country production measurements are
  still separate acceptance work.

## Foundation required for moving characters

Do not send 20–60 position updates per second through the existing game-action
path. Its conservative control rate limit and durable-per-action semantics are
intentional. Paid Workers capacity alone does not remove network RTT, TCP
head-of-line blocking, or a room object's single-threaded execution.

A separate, versioned movement engine should start with these **test budgets**,
to be validated after its mechanics and player count are defined:

- One authoritative simulation per room; clients send sequenced inputs, not
  trusted positions, scores, collision results, or inventory changes.
- Initial budget: 8 players, input updates at 20 Hz (160 inputs/second per room),
  compact snapshots at 10–20 Hz, no full game/history payload in each update.
- Local prediction plus server reconciliation and interpolation of remote
  snapshots. Render rate is independent from network update rate.
- Keep transient movement in memory; checkpoint essential simulation state at
  deliberate boundaries. Persist results and security-critical events, not
  every coordinate. Define reconnect/hibernation/authority handover before launch.
- Separate reliable control/results from replaceable movement updates. If
  measured TCP head-of-line blocking prevents the target experience, evaluate a
  dedicated authoritative WebRTC/UDP transport. Do not trust peer-published
  LiveKit coordinates for gameplay authority or bind game connectivity to a call.
- Per-player input/byte budgets, latest-state replacement under congestion,
  stale sequence rejection, and bounded snapshot recovery are required.
- Acceptance must include 2/8 players, real mobile devices and target regions,
  120/250/480 ms RTT, jitter/loss/reordering, network transitions, cheating inputs,
  and concurrent room load. Measure rendered motion and correction frequency,
  not only packet arrival time.

## Platform references reviewed

- [Cloudflare WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
  preserves sockets while resetting in-memory state on object reinitialization.
- [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
  describe per-object single-threading and a soft 1,000 requests/second limit;
  actual throughput depends on work per message.
- [Durable Object location](https://developers.cloudflare.com/durable-objects/reference/data-location/)
  states that location hints are best effort and apply only on first creation.
  Existing rooms are not relocated by adding a hint. The documented Middle East
  hint currently selects a nearby supported location, not a guaranteed local server.
- [LiveKit data packets](https://docs.livekit.io/transport/data/packets/)
  distinguish reliable and lossy delivery; even reliable packets are best effort
  during disconnects. They are not durable game-state storage.
