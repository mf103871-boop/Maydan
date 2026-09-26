# Maydan approved game effects

The owner selected option A of the free licensed audition on 2026-09-25 and requested stronger clicks. The six 48 kHz stereo PCM24 masters in `assets/audio/maydan-casual/` contain that choice. Correct, wrong, reveal, start and win are byte-identical to the audition masters. Tap is the same waveform with +6 dB gain: approximately -4.54 dBTP, with no clipping, pitch changes or added layers. `provenance.json` records the original files, audition hashes, master hashes, gain and signal measurements.

`node scripts/audio-bank.mjs` encodes the masters to AAC (96 kb/s, bit-exact so a rebuild yields identical bytes) in `public/audio/` and writes the manifest `src/shared/fx/sample-bank.js` (URL, frames, encoded SHA-256 and master SHA-256 per cue); `--check` verifies both. The six files total about 97 KB. They are precached by the service worker with the shell and bundled in the iOS `www/`, fetched as soon as the sound bus attaches and decoded with `decodeAudioData` on the first gesture; a cue requested before decoding completes plays only if it is still within 400 ms. Until 2026-09-26 the bank was embedded as raw PCM24 base64 inside the document (2.8 MB, half of `index.html`). Chequered Ink's source files are PCM16; the PCM24 masters preserve the preview conversion but do not imply added original detail.

The existing public sound names and saved volume/mute preferences are retained. Click and pop use the stronger tap. Correct, wrong, reveal and win use their selected masters. Start/countdownGo now play the selected brass opening instead of reusing correct. Timer ticks, countdowns and anticipation use quieter versions of tap so the click boost does not make repeating timers dominant. No oscillator/noise synthesis is used by the shared mixer. The standalone Badeeha fallback remains separate; the platform supplies this shared sound API.

The existing mixer limits overlapping voices, suppresses duplicate cues, ducks during question audio, stops scheduled voices on mute/backgrounding, and supports gesture recovery after iOS interruptions. The selected musical masters have at least 2.3 dBTP of headroom before the shared volume/overlap compressor. Physical phone listening remains necessary to judge subjective loudness.

Authors and terms:
- Dustyroom — https://dustyroom.com/free-casual-game-sounds/ — CC0, confirmed by the license PDF in the original archive.
- Chequered Ink — https://ci.itch.io/400-sounds-pack — permission for all uses including commercial, except selling or redistributing the unaltered assets as your own assets. The creator's public Dropbox source has no separate license file; the official page's permission is retained in `licenses/Chequered-Ink-terms.txt`.

Both creators are credited in the About screen. Only the selected game masters ship; neither the full source libraries nor the rejected audition directions are included. WOW Sound is not used. No generative audio model processed these samples.
