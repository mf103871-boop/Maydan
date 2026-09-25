# Spotdiff40 runtime and visual review — 2026-09-25

Passed **1089/1089** checks, **40/40** actual questions at both **390×844** and **320×844**, **80/80** decoded images, and **80** visible AI disclosure rows in About. No browser errors or missing assets.

All **30 final contact sheets** were actually inspected, covering all 40 pairs before/after at both widths. Each pair has one intended meaningful difference. Both markers correctly locate that difference; no coordinate changes are required. All original stage and full-page screenshots are retained. See [runtime-review.json](runtime-review.json) for per-question observations, image hashes, coordinates, and evidence paths; [results.json](results.json) preserves every automated assertion and measured image/marker box.

The category SHA-256 is `922d2f552b64f158837561ec48589f19ecf70d85ce77ed559c940e6e67aa69ae`. App.js and styles.css hashes are recorded in both reports. The tested renderer includes the saved reveal UI fix, but this report validates spotdiff only. Pack, renderer and all 80 media files remained unchanged through the final run and were rechecked while packaging.

The 390px layout shows two small images side by side; at 320px the images stack and become larger. Some 800/1000 targets are intentionally small. The ladybug marker (1000-903) is correctly centered but has modest contrast on its red shell. The sticky-note color change (800-902) is prominent for its tier. Difficulty targets are editorial estimates, not measured success rates. Fine generated texture drift is allowed by the one-meaningful-difference criterion; this is not a pixel-identity claim.

This was an isolated local headless Chrome test with a synthetic account/entitlement and deterministic test-only deck selection. It did not access or validate paid production accounts, billing, deployment, or production services.

## Reproduce

From a checkout with its Node dependencies installed and Chrome available:

```text
node docs/bank/rebuild-2026-09-18/qa-2026-09-25/spotdiff/spotdiff-ui-qa.mjs
```

The portable harness derives the repository path from its location. Optional `MAYDAN_ROOT` overrides it; `CHROMIUM_PATH` overrides the default Windows Chrome executable. It uses repository Playwright, esbuild, and sharp. An optional first argument selects an output directory; the default is `rerun/` beside this file, preserving the reviewed evidence. The packaging copy changes only path resolution/imports from the executed scratch harness and was syntax checked; gameplay logic is identical.

The first attempt's JSON is retained as `initial-results-before-capture-fix.json` for traceability. Its 320px element screenshot capture could scroll under the sticky header. The final harness centers the stage, verifies full visibility below the header, and captures all evidence anew; final results/PNG files belong to the corrected 1089-check run. No application edit was required for that capture artifact.
