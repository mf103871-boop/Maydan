# Three audio replacement candidates

Prepared on 2026-09-25 after the user marked three prior clips unclear. These candidates have source/license and technical checks only. **No listening or identity approval is claimed.** The user must review each candidate by hearing it.

| ID | Intended answer | Duration | Bytes | Current status |
|---|---|---:|---:|---|
| sound-400-902 | أمواج البحر | 7.5s | 121252 | Pending human listening |
| sound-400-905 | عطاس | 1.25s | 20942 | Pending human listening |
| sound-800-908 | بولينغ | 2.62s | 43093 | Pending human listening |

## Sources and selection

### sound-400-902

- Creator/source: [Calm ocean waves — SamsterBirdies](https://freesound.org/people/SamsterBirdies/sounds/578524/)
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The creator page and license deed were actually opened.
- Author describes calm ocean waves crashing and fizzing water, recorded on Whidbey Island with Zoom H1n. A 7.5-second region with a strong central swell and lower-amplitude beginning/end was selected using signal-envelope analysis.
- Candidate question: ما الحركة المائية التي تسمعها على الشاطئ؟
- Limit: No listening performed. Wave identity, absence of distracting sounds, and perceived clarity still require human listening.

### sound-400-905

- Creator/source: [Sneezing.wav — edschaefer](https://freesound.org/people/edschaefer/sounds/464232/)
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The creator page and license deed were actually opened.
- Author labels it a recording of a sneezing person. Full short recording retained; transient compression and peak normalization improve the available average level without changing speed.
- Candidate question: ما الفعل البشري المسموع في هذا المقطع؟
- Limit: No listening performed. Author notes possible cartoon use; naturalness, absence of speech, and clarity are not confirmed until human listening.

### sound-800-908

- Creator/source: [Bowling.wav — Rehanjo](https://freesound.org/people/Rehanjo/sounds/593593/)
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The creator page and license deed were actually opened.
- Author explicitly describes a bowling ball hitting pins with a crash and scatter, recorded using Zoom H6/Rode NTG. The file contains variations; only the first event before the zero-signal gap is retained, including its decay. No old rolling recording is mixed in.
- Candidate question: ما الرياضة التي تسمع اصطدام كرتها بالقوارير؟
- Limit: No listening performed. The source supports collision with pins; a clear rolling lead-in is not claimed. Correct identification and clipping/processing artifacts must be checked by human listening.

## Reproducible evidence

- `replacement-candidates.json` records sources, licenses, exact input/output SHA256 hashes, edit ranges, FFmpeg filters, size, duration, peak, RMS and pending-listening status.
- `source-page-metadata.json` records source page HTTP status, preview URLs extracted from the page, and successful public-download metadata.
- `input-signal-analysis.json` records decoded signal envelopes; signal analysis is not listening.
- `inputs/` preserves the downloaded public HQ MP3 previews. Original WAV/FLAC files were not downloaded or claimed.
- All output files decode successfully as mono 44.1kHz 128kbps MP3, remain below 160KiB and 8 seconds, and have decoded peaks below 0dBFS. Metadata was removed.
- The waves retain a 7.5-second rise-and-fall envelope. The sneeze retains its full 1.25 seconds. The bowling file retains only the first impact and decay up to the silence gap at 2.62 seconds; it does not mix in the old rolling sound.
- Production category, production media, prior human review, and shared status were not edited while preparing these candidates.

All JSON/Markdown written by this preparation use UTF-8 and LF.
