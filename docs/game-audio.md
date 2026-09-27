# Maydan game audio

Maydan ships sixteen effect cues and four music tracks. Since 2026-09-27 (audio v3) they come from
two places, decided per file by a measured screening rather than by taste: **licensed libraries**
where a candidate beat the in-house sound on the rubric below, and **in-house synthesis**
(`scripts/audio/engine.mjs` + `voices.mjs`) everywhere else. Every shipped file has a provenance
record (`assets/audio/maydan-v3/provenance.json`, `music/provenance.json`) that says which, why, and
what was done to it; the About screen renders the credits from those records.

## What the best games taught us

The benchmarks (Jackbox's per-game palettes and short stingers over long loops, Kahoot's
countdown build, King's GDC 2024 talk on players who mute, Apple's WWDC17/19 sound-and-haptics
sessions, Material's sound guidance) reduce to rules the pipeline enforces or the screening scores:
quiet neutral taps and expressive "hero" cues only for score, reveal and round end; short
front-loaded cues with no leading silence (taps 30–150 ms, feedback 150–600 ms, hero 1–3 s); one
tonal family — everything sits on D, the music's key; positive cues rising and brighter, negative
ones shorter and lower but not harsh; high-passed for phone speakers with energy where they
reproduce it; mono-compatible; music around −18…−16 LUFS with −1.5 dBTP; music ducks under hero
cues; separate music and effects sliders; nothing that only works with sound on.

## Sources and licenses

| Source | License | What we use | Text |
| --- | --- | --- | --- |
| Dustyroom — Free Casual Game Sounds (24-bit WAV) | CC0 1.0 | pop, correct, wrong, buzzer, timeout, whoosh | `licenses/dustyroom-cc0.txt` |
| Mixkit sound effects (Envato) | Mixkit Sound Effects Free License (video games listed as a permitted use, no attribution; music from Mixkit excludes games and is not used) | explosion | `licenses/mixkit-sfx-free-license.txt` |
| Kenney (Interface, UI, Jingles, Digital, Impact) — OGG | CC0 1.0 | screened, none selected | `licenses/kenney-*-cc0.txt` |
| OpenGameArt — Kenney UI SFX set (16-bit WAV) | CC0 1.0 | screened, none selected | `licenses/opengameart-kenney-ui-sfx.txt` |
| Kevin MacLeod / incompetech.com (MP3 160–256 kb/s) | CC BY 4.0 (credit line required) | screened for music, none selected | `licenses/incompetech-attribution.txt` |

Unreachable from the build environment on 2026-09-27 and therefore not evaluated: Pixabay,
Freesound and Sonniss (HTTP 403) and the Free Music Archive (downloads need an account). They are
recorded in `sources.json` under `unavailable`; files from them can be registered later the same
way. Sounds from commercial games were style references only.

`assets/audio/maydan-v3/sources.json` is the registry: providers (name, URL, license, license
file, archive URL and SHA-256, `verified`, hosts allowed for download), 635 candidates (id,
provider, path or URL, title, roles, pinned SHA-256/bytes/retrieval date, or `unavailable`) and the
list above. `licenses/` holds every license text with its retrieval date and archive hashes.

## Pipeline

```
node scripts/audio/sources.mjs --fetch      # originals → .cache/audio-sources (git-ignored), verified against the pins
node scripts/audio/sources.mjs --pin        # first fetch: record sha256/bytes/retrieved in sources.json
node scripts/audio/sources.mjs --licenses   # rewrite licenses/*.txt from archives and pages
node scripts/audio/screen.mjs               # measure every candidate and the in-house masters → screening.json
node scripts/audio/build.mjs                # cues: masters, AAC, sample-bank.js, provenance.json
node scripts/audio/music.mjs                # tracks: masters, AAC, music-bank.js, music/provenance.json
node scripts/audio/credits.mjs              # src/shared/fx/audio-credits.js for the About screen
node scripts/audio/audition.mjs --out f.m4a [--ab <git-ref>]   # listening file with A/B of replaced cues
npm run audio:check                         # sources, both banks and credits verified (CI)
```

**Screening** (`screen.mjs`, `analysis.mjs`, `roles.mjs`): each candidate is converted to 48 kHz
stereo PCM24 and measured — effective length after trimming leading silence, onset sharpness,
end level, noise floor before the onset, crest, DC, clipping, spectral centroid and band shares,
flatness, mono compatibility, HPS pitch with confidence and contour, Krumhansl key and its
distance to D. Per role it scores fidelity (20: 24-bit lossless best; lossy fails hero roles),
envelope (20), phone spectrum (15), tonal fit (20: key distance to D, rising or falling contour
as the role demands, buzzer must sustain), cleanliness (15) and descriptive fit (10: pack purpose
and title). The in-house master is scored with the same function. A file is assigned to at most
one role, files whose titles name the role get +3, and a source replaces the in-house cue only
when it scores ≥ 70 and at least 5 points above it. Music candidates are scored on fidelity, seam
quality of a bar-exact loop with a one-beat crossfade, dynamics, spectrum, key distance to D and
palette/tempo fit for the slot. `screening.json` keeps every measurement and the decision.

**Preparation of a sourced cue** (`prepare.mjs`, chosen by `source: {…}` in `CUES`): soxr
conversion, optional rubberband pitch shift onto D (only for clearly pitched, key-confident cues,
≤ 3 semitones), leading-silence trim (−45 dBFS, 2 ms pre-roll), cut to the role's maximum length
or an explicit `trim`, 1 ms entry and role-default release fade, high-pass (120/80/40 Hz by role),
then the ordinary chain: fade, normalize −6, no reverb (samples carry their own tails), `master()`
to the cue's true-peak target with a 28 Hz high-pass, canonical 44-byte WAV header, AAC 160 kb/s.
The in-house `design()` stays in the table as the baseline. A sourced music track would take the
equivalent path in `music.mjs` (bar-exact loop with an equal-power crossfade, mastered as a double
and sliced, seam verified); no free track beat the in-house loops, so none ships.

**Files and caching**: encoded files are named after their content hash
(`public/audio/click-6fa408.m4a`, `public/audio/music/home-3d8a23.m4a`), `/audio/*` is cached
immutable for a year, the service worker takes the cue list from `sample-bank.js` at build time
(`renderServiceWorker` in `scripts/lib.mjs`) and never precaches music. Budgets in the tests: cues
< 640 KB together, music < 7 MB.

## Playback

`src/shared/fx/sound.js` maps the public cue names 1:1 to files (`fanfare → win`, `countdownGo →
start`, aliases `win`, `start`, `steal`, `open`, `tool`, `scoreUp`, `scoreDown`), fetches the
cues when the bus attaches, decodes on the first gesture, limits overlapping voices, suppresses
duplicates with per-cue cooldowns, ducks under Badeeha's question audio, stops voices on mute and
backgrounding and recovers after iOS interruptions. `sound.music` plays the loops on their own
gain behind the shared compressor (fetched on first request, decoded once per context, crossfades,
ducking under big cues, hidden-page suspend with resume, gesture-deferred start, finale sting that
hands over to the next track). Track selection: `meta.music` per game, `home` on setup screens and
every non-game route, `finale` on `matchOver()`. Settings: "الصوت" is the master switch,
"الموسيقى" and its slider control the loops.

## Verifying and re-curating

`npm test` covers the bus and the credits component, checks every shipped file against its
manifest and every manifest against the committed masters; CI runs `npm run audio:check`. To try a
new file: register it under `candidates` in `sources.json` (or add a provider with its license
text), `--pin`, `screen.mjs`, and if it wins, put its `source` spec into `CUES`/`TRACKS`, rebuild
and regenerate the credits. Phone listening remains the final judge; `audition.mjs --ab` builds a
before/after file for that.
