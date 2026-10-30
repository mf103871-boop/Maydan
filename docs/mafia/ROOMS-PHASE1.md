# Mafia rooms — phase 1

This increment implements the shared Arabic room community and compact room UI. The interactive bot tutorial is deliberately a separate, later delivery. The existing twelve roles, free gameplay, real Plus entitlements and isolated preview environment remain in place.

## Entry and communication

- The Mafia home card opens the room directory. Public waiting, full, playing and finished rooms are discoverable, with mode/status/voice filters and cursor pagination. Private codes remain supported.
- Creation defaults to a public Classic room with eight seats and optional voice. A filtered name, mode, capacity, visibility and `voiceMode: optional | off` are explicit settings. `community: ar` is one shared community, without IP-based country exclusions.
- Lobby text and opt-in voice use the same compact layout as the match. Microphone permission follows an explicit unmute; joining audio starts muted. Changing match settings resets readiness. The host starts only with the required connected and ready participants.
- A text-only match does not allocate provider rooms or need LiveKit credentials. Actual previously issued audio credentials still require secure revocation. Match privacy leases are independent of media capacity. The preview's one-room voice quota is shared by lobby and match audio; no plan upgrade is performed.
- Existing side-conversation/profile privacy guards also apply while lobby voice is joined. Leaving that voice session restores access. This conservative restriction is separate from the always-available permitted Mafia text channel.

## Discovery and observers

- `GET /api/rooms/public` adds filtered pagination and public state/voice labels. Authenticated invalidation frames trigger a new block-filtered read; visible-page polling remains a fallback. The feed contains no game secrets.
- Quick join reserves only a waiting player seat; the authoritative room rechecks capacity, blocks, protocol and settings. It never creates another room on the joiner's behalf.
- Observer admission is separate from player seats, capped at sixteen. The server delays the complete public projection by thirty seconds: phase/time, alive cards, nomination, public text/events and final reveal. There is no observer voice or message path to active players.
- Persistent observer state survives hibernation/reconnection and retains completed match buffers across a restart. Seat promotion is explicit and requires the delayed ending, a current lobby and available capacity. It never reuses another player's secret role.
- The displayed promotion offer and revision come from the delayed state; the promotion request separately rechecks the live lobby and may return an opaque wait/conflict. Live directory/history reads and directory subscriptions are unavailable to an active observer. Mafia results and public profile statistics publish through durable outboxes only after the same thirty-second delay.
- Observer and Mafia player ownership are mutually exclusive across devices. New authenticated online room creation/join is denied while observing. Existing non-Mafia sockets are **not centrally evicted** when watching begins: those games do not share a global active-account registry. Offline/local play is unchanged. This phase therefore does not claim forced exclusion from every previously connected game, and adds no per-stroke database checks to drawing traffic.
- Delayed state is stored transactionally in UTF-8 chunks of at most 128 KiB, with four completed-match buffers. An abnormal observer backlog resynchronizes to a new fully delayed checkpoint; it does not shorten the delay or abort the live match.
- The new client capability is Mafia protocol 2. Existing protocol-1 room state stays readable by compatible clients until completion; unsupported clients are rejected before receiving a new seat.

## Visual behavior

- A compact phase/timer header, a flexible event/chat surface, and a stable four-column card dock replace the long stack of panels. Invitation/QR, room options and secondary controls open on demand.
- Targets are selected before a separate confirmation. Touch targets remain at least 44px and writing fields at least 16px. Keyboard focus temporarily reduces the dock, and landscape moves it beside the activity surface.
- Public art is chosen from authorized event types, never hidden roles. Elimination uses an empty unmarked chair; only the owner or an authorized final reveal can select a role portrait.
- Original wide scene and neutral card-back masters live in `assets/mafia/rooms-v2/`. `scripts/mafia-room-art.mjs` only resizes/encodes them. Prompts are retained in `ROOM-ART-PROMPTS.json`; generated assets use the same hashed/offline/native pipeline as the existing art.

## Evidence and release boundary

Local rule/socket/browser tests, hosted preview/provider checks, signed CI and TestFlight are separate acceptance layers. They do not prove physical-iPhone behavior, human balance or controlled-network latency. Phase 1 must be delivered as its own TestFlight build before the bot tutorial begins. Production deployment, the minimum-version policy and public Store submission are outside this preview delivery.
