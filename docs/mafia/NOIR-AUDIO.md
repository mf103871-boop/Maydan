# Mafia noir sound treatment

This is a restrained sound-effects treatment of the existing approved recordings, not a generated voice/music pack and not audio copied from Mafia42. The application reuses its already bundled AAC samples through the shared Web Audio mixer. No new decoder, music stream, native audio owner, download or external service is introduced.

| Cue | Use | Recording and treatment | Offline duration | Measured true peak |
|---|---|---|---:|---:|
| `mafiaSelect` | Controls / nomination begins | Physical button, gain 0.50, rate 0.82 | 0.182s | -11.6 dBTP |
| `mafiaRole` | Explicit role-card reveal | Physical button, gain 0.60, rate 0.70 | 0.213s | -10.0 dBTP |
| `mafiaNight` | Night begins | Three clock taps at 0, 0.38, 0.76s, gain 0.42, rate 0.70 | 0.973s | -10.9 dBTP |
| `mafiaDawn` | Dawn begins | Desk bell, gain 0.36, rate 0.88 | 1.624s | -17.5 dBTP |
| `mafiaVerdict` | Judgment voting opens | Wooden thud, gain 0.50, rate 0.82 | 0.338s | -13.4 dBTP |
| `mafiaFinal` | Public match ending | Desk bell, gain 0.35, rate 0.72 | 1.985s | -17.7 dBTP |

Measurements are an offline ffmpeg resampling export at 48kHz stereo PCM24, before the player's volume, compressor and active-call attenuation. The browser's own resampling can differ slightly. These measurements prove bounded levels/duration, not subjective listening quality or physical-phone audio behavior.

## Provenance

All four source recordings have the reviewed **CC0 1.0** license and hashes in `assets/audio/maydan-v3/provenance.json`; the archived license record is `assets/audio/maydan-v3/licenses/freesound-reviewed-cc0.txt`. The existing originals remain unchanged:

- Physical button: [Button Click — DeWildAshDev](https://freesound.org/people/DeWildAshDev/sounds/858919/).
- Clock: `tick` source from the reviewed “Tick Tock Clock 01” recording.
- Desk bell: `correct` source from the reviewed “220516 desk bell rings” recording.
- Wood: `wrong` source from the reviewed “Wooden Thud (Mono)” recording.

The exact source links/authors/hashes and numerical transformations are copied into the audition measurement output. Runtime recipes live in `src/games/mafia/audio.js`; there is no generated speech and no waveform synthesis in these cues. The underlying `correct` bell is played through `mafiaDawn`/`mafiaFinal`, so it cannot trigger the optional spoken-answer comments.

## Lifecycle and confidentiality

- Only the public match/phase ID chooses an automatic cue. Role, faction, target, private reports, protected deaths and victory affiliation cannot choose or alter a sound.
- Initial/reconnected snapshots are silent. Repeated snapshots do not repeat cues; hidden, waiting and Studio-preview states consume transitions silently.
- A phase-generation guard rejects audio that finishes loading after the phase changed, backgrounding or component disposal. Only Mafia voices are stopped on Mafia teardown; unrelated interface effects remain owned by their callers.
- Master mute, effects volume, active-call ducking, interruptions and native background handling remain on the existing shared bus. Native mute/permission behavior is not changed.
- A lease suppresses the cheerful general music while Mafia entry/lobby/match is open, without modifying music settings or the desired route track. Nested owners cannot release one another's lease. Leaving Mafia resumes music only if the user's setting permits it.

## Reproduce the audition

`node scripts/audio/mafia-noir-audition.mjs` writes six WAVs, an AAC listening reel and `measurements.json` under `.cache/mafia-noir-audio/`. Order: select, role, night, dawn, verdict, finale. Each item has 1.1s of silence after it. This export is for listening/inspection; the application renders the same recipe from the existing bank.

Validation: 7 new behavior tests cover privacy, deduplication, stale/background cancellation, source licenses/levels, music leases, shared-cue isolation and native lifecycle/mute/ducking. The 53 pre-existing audio, selected-audio and native lifecycle checks still pass. Physical iPhone listening, calls, lock/unlock and headphone behavior remain required acceptance.
