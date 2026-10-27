# Mafia Maydan — noir preview

This changes the isolated Mafia experience, not the public Maydan release or the game rules. Mafia owns a charcoal/navy, muted teal and brass palette, compact phase timer, private illustrated role card, narrative events, persistent public player rail, and integrated voice controls. Maydan's home, other games and profiles keep their existing identity.

## Original artwork

- One transparent black-spy icon for Mafia entry and room cards.
- Twelve original role portraits: citizen, investigator, doctor, guard, observer, reporter, herald, analyst, Mafia member, masker, blocker and shadow leader.
- Six original scene illustrations: night, dawn, investigation, elimination, judgment and the end of a council.
- One quiet night-council environment texture. Elimination is symbolic and non-graphic.

The source PNGs and their provenance manifest are in `assets/mafia/noir-v1/`. Exact generation instructions are in `NOIR-ART-PROMPTS.json`. These are original Maydan illustrations generated for this preview; no Mafia42 character art, screenshots or sound files are shipped.

`node scripts/mafia-art.mjs` derives four WebP files, and `--check` verifies source/output hashes, dimensions and icon transparency. The runtime art totals 784,676 bytes. Imports use the existing hashed asset, service-worker and native-resource build paths. The PNG masters are not shipped in the game.

Atlas regions use measured cell boundaries. Scene containers crop a proportional inner image instead of stretching a scene. The role atlas is public artwork; it contains no match assignments. Only a server-authorized private view or final revealed recap chooses an assigned role portrait. Public seats do not render players' role portraits.

## Navigation and rooms

The initial Mafia entry tab is the live public directory. Players can create a public room, choose a private room explicitly, join a listed waiting room, use quick join, or enter an invitation code. Only this new Mafia creation UI defaults to public; the server's backward-compatible default remains private.

The directory refreshes while visible, rejects stale account responses, excludes blocked peers in both directions and sends public-card joins through the existing authoritative waiting-room fence. Authentication, occupancy, capabilities, account locks and host entitlements remain server responsibilities. A late create/join reply cannot navigate after the entry screen was closed or the account changed; pending credentials remain available for explicit recovery without repeating an unknown write.

## Interaction, voice and safety

The public player rail is horizontally scrollable and leaves room for actions. It is hidden while composing, including moving focus from the text field to Send. Private role content closes on privacy/account/role changes and remains inaccessible to other participants. Notes, evidence and chat keep their existing privacy and text filtering.

The mounted integrated Mafia voice panel owns controls only for its exact current call. Global floating controls remain the fallback if that panel is missing, hidden, inert or not ready. The change does not end a call, grant microphone access or change server channel permissions. Audio-resume controls remain available for blocked playback. Animation respects reduced-motion preferences.

Six short sound treatments reuse reviewed CC0 recordings through the existing audio lifecycle. They respect mute, user volume, active-call ducking and background handling. Automatic sounds depend on public phases, not secret roles, teams or investigative results. General Maydan music is suppressed inside Mafia with a lease that does not overwrite user preferences. See `NOIR-AUDIO.md` for sources, measurements and the audition command.

## Validation and release boundaries

Relevant checks include the full local suite, actual React responsive fixtures, actual workerd/D1 public-directory and admission tests, Studio semantic coverage, asset build/precache checks, native-resource preparation, and one bounded hosted public-lobby smoke using existing synthetic accounts. Hosted smoke must leave its own seats, preserve unrelated seats, and not start a paid/trial match or a call.

Release receipts record the exact source, isolated worker version and native build separately. A previous TestFlight build does not contain these new assets. Simulator success, browser fixtures and generated art are not physical-iPhone acceptance or evidence of fun/balance. Real iPhone calls, privacy transitions, keyboard/background behavior, and human sessions for both Mafia modes remain required before public release. The user's inability to test now does not waive those gates.

Do not merge this preview into `main`, publish production workers, change the public App Store listing, or treat a TestFlight upload as a public release.
