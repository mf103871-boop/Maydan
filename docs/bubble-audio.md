# Maydan bubble effects

The owner approved the third sound direction on 2026-09-25: soft cartoon pops and rubbery bubbles. The seven edited 48 kHz stereo PCM24 masters in `assets/audio/maydan-bubbles/` are the approved audition files, without re-encoding. `provenance.json` records the author, source hashes and editing process; the source license is included in full.

`node scripts/bubble-bank.mjs` embeds their interleaved PCM in `src/shared/fx/bubble-bank.js`. `--check` verifies reproducibility. The bank ships inside the game document, including its offline cache and iOS bundle. Playback needs no additional request or asynchronous codec decoding. Each sample is expanded once per audio context, only when used. Keeping the original 24-bit PCM preserves the approved sound and avoids browser codec differences.

The existing sound API and saved volume/mute preferences are unchanged. Clicks rotate among three approved variations. Correct, wrong, reveal and win use the approved edits; transitions, timer ticks, passes, timeout and anticipation use quieter arrangements of the same material. No oscillator or noise synthesis remains in the shared mixer. The standalone Badeeha fallback is unchanged; the shipped platform always supplies this shared sound API.

The mixer limits overlapping voices, suppresses duplicate cues, lowers effects during question audio, stops scheduled voices on mute/backgrounding, and supports gesture recovery after iOS audio interruption. Masters are balanced with at least 9.99 dB of measured peak headroom before the master volume. Physical iPhone listening still matters for judging device volume.

Original sample author: Romain Raynal — Modern UI Vol.1
https://romainraynal.gumroad.com/l/Modern-UI-Vol1

The included author terms allow using and modifying SFX within games and creative works. They prohibit standalone redistribution of the original unaltered library and AI training/generative pipeline use without separate permission. These are deterministic audio edits incorporated in Maydan, not a redistributed raw library or generated audio model output.
