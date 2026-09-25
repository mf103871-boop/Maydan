# Independent reveal-wrapper regression — 2026-09-25

No actionable defect found in the App.js / styles.css diff. Final execution passed **52 / 52 checks** on three actual gameplay questions, selected normally from the complete unchanged bank. No category override, deck replacement, source edit, bank edit, fixture edit, stage, or commit was performed. Only a local mock account was used.

The new React.Fragment introduces no DOM wrapper. It leaves the existing image stage intact and places the reveal-only tile button alongside it, so the absolute tile overlay remains confined to the stage. The margin rule applies only to that tile button.

| Pack | Actual question | Effect | Checks |
|---|---|---|---:|
| blur | blur-200-906 | blur | 16 / 16 |
| silhouette | silhouette-200-907 | silhouette | 16 / 16 |
| flags | flags-200-903 | none | 16 / 16 |

The remaining four checks verify completion of all three samples, absence of browser errors, absence of missing local assets, and unchanged SHA-256 values for the two source files and three category files. Full hashes are in results.json.

Each sample exercised initial display, answer reveal, original-image enlargement, answer hiding, and answer re-showing. At both 390px and 320px mobile widths the image fits, the answer action does not overlap the image, and its center accepts pointer input. Before reveal and after hiding, aliases and answer text are absent and image alt remains generic. Blur / silhouette prevent premature enlargement; flags allow it without exposing the answer. No reveal tile button or overlay appears in these other effects.

I viewed the three contact sheets, covering all nine before / revealed / hidden screenshots. The image, answer, controls and masking are correct in the sampled states. Chrome ran headless with reduced motion. This is targeted regression evidence for three branches; it does not claim another all40 run or replace the separate reveal pack QA.

Artifacts: [results](results.json), [blur states](contact-blur.png), [silhouette states](contact-silhouette.png), [flags states](contact-flags.png), original screenshots under screens/, and replay.mjs. Run replay.mjs from the Maydan repo directory with installed dependencies and Chrome.

Preliminary harness correction: the first run expected removal of the hidden-answer container, but the application deliberately retains a masked placeholder. The corrected final assertion checks that placeholder plus absent aliases; no application or bank change was required. The preliminary results remain in the separate sibling directory reveal-wrapper-regression-2026-09-25.

Executed at: 2026-09-25T03:51:37.903Z
App.js SHA-256: `942f30dff7d47b312946e8a45bb7468008ab6092d7a72c217b171dea0668c1ca`
styles.css SHA-256: `b86e44ad3a5ac1eb5d319c37b359983c3d035c274c49e97fb0508db3fa3b6b13`
