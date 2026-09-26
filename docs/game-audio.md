# Maydan game audio

Since 2026-09-26 every sound in Maydan is composed and synthesized inside the repository: sixteen
effect cues and four music tracks, all rendered by `scripts/audio/` from code, with no third-party
samples, sample libraries or generative audio models. The previous Dustyroom / Chequered Ink
masters and their licenses were removed with this change.

## One palette

Everything is tuned to D so cues and music never clash: the cues use wooden and glass voices
(kalimba, marimba, bells, glass, a small frame drum, a breathy ney and a synthetic oud), and the
music is written on D in the nahawand scale for the menus and calm games and hijaz for the timed
games. The engine (`scripts/audio/engine.mjs`) is pure Node DSP — band-limited oscillators, FM,
additive partials, filtered noise, Karplus–Strong strings, chorus and delay, synthesized impulse
responses — and calls `ffmpeg-static` only for convolution reverb (`afir`), EBU R128 / true-peak
metering and the final limiter and AAC encode. Renders are deterministic: the same seed and code
give the same bytes.

## Effect cues

| cue id | plays for | room |
| --- | --- | --- |
| `click`, `pop` | taps, toggles, score up | small room |
| `tick`, `tickFast` | timer, last seconds | dry |
| `countdown`, `start` | 3-2-1, go | room / hall |
| `correct`, `wrong` | answers, steals, score down | room |
| `buzzer`, `timeout` | wrong buzz, time over | hall |
| `whoosh`, `reveal` | screen open, tools | room |
| `win`, `drumroll`, `explosion` | fanfare, anticipation, boom | hall |
| `pass` | pass / skip | room |

`node scripts/audio/build.mjs` renders the 48 kHz stereo PCM24 masters into
`assets/audio/maydan-v2/`, masters each to its true-peak target (−3 dBTP for the big cues, lower
for ticks) with 28 Hz high-pass and a limiter, encodes AAC 160 kb/s (bit-exact) into
`public/audio/`, and writes `src/shared/fx/sample-bank.js` (URL, frames, encoded SHA-256 and
master SHA-256 per cue) plus `provenance.json`. `--check` verifies files against the manifest and
the manifest against the masters; `--only <id>` rebuilds one cue. The sixteen files total about
340 KB, are precached by the service worker with the shell and bundled in the iOS `www/`.

The public names in `api.sound.play(name)` are unchanged; `src/shared/fx/sound.js` maps each of
them to exactly one file (`fanfare → win`, `countdownGo → start`, aliases `win`, `start`, `steal`,
`open`, `tool`, `scoreUp`, `scoreDown`). The bus fetches the files as soon as it attaches, decodes
them on the first gesture, limits overlapping voices, suppresses duplicate cues with per-cue
cooldowns, ducks during Badeeha's question audio, stops voices on mute and backgrounding, and
recovers the context after iOS interruptions.

## Music

`node scripts/audio/music.mjs` renders four tracks into `assets/audio/maydan-v2/music/` and
`public/audio/music/` (AAC 192 kb/s) with the manifest `src/shared/fx/music-bank.js`:

| track | tempo | where | loudness |
| --- | --- | --- | --- |
| `home` | 72 BPM nahawand, pads, oud, kalimba, frame drum, shaker, ney | menus, the online lobby and rooms, game setup screens | −19 LUFS |
| `calm` | 66 BPM nahawand, no drums | Badeeha and Fabraka matches | −21 LUFS |
| `tense` | 96 BPM hijaz, drum ostinato, oud, marimba | Beep, Mamnoo and Jabeen matches | −18 LUFS |
| `finale` | 6.5 s sting | the end of every match | −16 LUFS |

The loops are seamless by construction: each is composed as a cycle, rendered twice, sent through
the hall reverb and the master chain as a whole, and only then is the second cycle cut out, so its
first sample already carries the tails of the previous bar. A game names its track in `meta.js`
(`music: 'calm' | 'home' | 'tense'`); `Play.jsx` plays `home` on the setup screen and the game's
track once the match starts (again after "play again"), and `matchOver()` plays the `finale`
sting with `home` returning after it for the results screen. All other routes play `home`.

Playback rules in `sound.js` (`sound.music`): tracks are fetched on first request (never
precached; about 1–1.4 MB each) and decoded once per context, keeping the last three decoded;
the loop runs on its own gain behind the shared compressor, so the effects volume, cue cooldowns
and `sound.stop()` on route changes do not touch it; a request made before the browser unlocks
audio waits for the next gesture; tracks crossfade (0.8 s out, 1.4 s in); big cues (`fanfare`,
`explosion`, `drumroll`, `start`, `reveal`, `timeout`, `buzzer`) duck the music for their own
length and question audio ducks it to a quarter; a hidden page mutes and suspends the context and
the loop resumes from where it was on return; the sting fades the loop out, blocks new tracks
while it sounds, and is dropped if it arrives more than 2.5 s late.

Settings: "الصوت" is the master switch for effects and music together; "الموسيقى" and its own
slider (default 50 %) control the loops (`musicOn`, `musicVolume` in the platform settings).

## Verifying

`npm test` covers the bus (`tests/audio-lifecycle.test.js`, including the music layer) and checks
every shipped file against its manifest and every manifest against the committed masters; CI also
runs `node scripts/audio/build.mjs --check && node scripts/audio/music.mjs --check`. Rebuilding
after a design change rewrites the masters, the encoded files, both manifests and the provenance
files together; commit them together. Physical phone listening remains the judge of subjective
loudness and balance between the music and the cues.
