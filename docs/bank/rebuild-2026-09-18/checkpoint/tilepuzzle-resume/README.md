# Tilepuzzle handoff — stopped at user request, 2026-09-23

32 of 40 planned images have been generated. **31 are installed** under `media/tilepuzzle/`; one pan-flute candidate is preserved only under this checkpoint's `candidates/`. All 31 generated records remain `review.status: pending`. The live `src/data/categories/tilepuzzle.json` is unchanged at **225 old questions**. Existing old media is preserved. No new question has been marked verified.

## Resume data

- `status.json`: counts, next IDs and outstanding revisions.
- `jobs/`: all 40 portable generation jobs, including the corrected Roman-theatre prompt.
- `source-output-map.json`: every generated image mapped to its repository-relative installed/candidate path and original generation basename. No absolute scratch source path is required to continue.
- `review-notes.json`: actual per-image observations; these are preliminary subject reviews, not complete gameplay verification.
- `remaining-plan.json`: the 8 never-generated 1000-tier jobs, IDs `tilepuzzle-1000-901` through `tilepuzzle-1000-908`.
- Installed asset provenance/prompt/hash/dimensions remain in `docs/bank/rebuild-2026-09-18/generated-records/tilepuzzle-*.json` with actual creation date.

## Required revisions before verification

1. `tilepuzzle-400-907`: widen harp framing to include the upper decorative finial with margin. Existing installed WebP is an available edit reference.
2. `tilepuzzle-600-904`: widen excavator framing to include the upper boom pivot with margin. Existing installed WebP is an available edit reference.
3. `tilepuzzle-800-907`: pan flute candidate has open tube ends along the staggered lower edge while the aligned upper ends appear closed. Correct to an aligned open mouth edge and graduated closed lower ends; inspect the candidate first. It is **not installed** and has no generated record yet. Its original prompt and generation basename are in the checkpoint.

## Pending editorial decisions

- Pottery-wheel `400-908`: the pot also dominates the picture. Ask for the tool beneath the clay (for example: ما الأداة التي يظهر عليها الطين في الصورة المبعثرة؟), so a pot answer is not equally valid.
- Geyser `600-906`: remove overly broad aliases ينـبوع حار / سخان أرضي; retain precise geyser equivalents after checking terminology.
- Add useful Arabic spelling/common-name aliases across the final pack, without accepting different objects.
- The Roman-theatre prompt was corrected before generation from an amphitheatre to semicircular seating facing a straight stage; this is a generic illustration, not evidence of a particular real site.
- Harp/rare instrument and nature terminology, final 40-card static shuffle review, question schema/tier/topic checks, and per-asset review records remain unfinished.

## Integration requirements

Read `docs/bank/RUBRIC.md`, `docs/bank/SCHEMA.md` and the parent checkpoint first. Use the built-in image-generation tool (one call per asset; separate targeted revisions as needed), not an API/CLI fallback. Inspect every final image before setting `verified: true`. Install with `node scripts/bank-install-generated.mjs JOB.json OUTPUT.png`; use `--replace` only for the two known installed framing revisions. Files must be at most 1280 pixels per edge and 256 KiB.

The game shuffles the **whole original image** into 4 columns × 3 rows through `type: image`, `effect: jumble`, with fixed qid-derived permutation. Do not bake tile cuts, labels or jigsaw outlines into source assets. After all 40 are reviewed, preserve pack metadata and replace only its `qs`: 8 per tier 200/400/600/800/1000, IDs 901–908, editorial difficulty targets .8/.6/.4/.25/.15. Those targets are not measured success rates. Use neutral media titles and local review/provenance paths; remove inherited old descriptive/Commons metadata from the new questions. Keep old media files.

No shared bank status, category index, manifest, commit, push, or deployment was performed by this worker.

## Portable UI work

`ui/check-ui.cjs` compiles the actual app and game in memory, validates all 78 covers, then prepares mobile cover and 40-card zoom interactions. `ui/review-crops.cjs` reconstructs the exact static CSS-origin zoom crops. Both locate the repository relative to their own location, or accept `MAYDAN_REPO`; output goes to a temporary review directory or `MAYDAN_UI_OUT`.

Run from any directory:

```sh
node docs/bank/rebuild-2026-09-18/checkpoint/tilepuzzle-resume/ui/check-ui.cjs --compile-only
CHROMIUM_PATH=/absolute/path/to/chrome node docs/bank/rebuild-2026-09-18/checkpoint/tilepuzzle-resume/ui/check-ui.cjs
node docs/bank/rebuild-2026-09-18/checkpoint/tilepuzzle-resume/ui/review-crops.cjs
```

Browser QA was **blocked, not passed**: no local Chromium exists, and a normal Playwright download failed with an HTML response instead of a ZIP and cancelled network approval. No cloud browser/network workaround was used. The 79 static cover/compilation assertions passed; all 40 zoom static crops were reviewed. Actual results are in `docs/bank/rebuild-2026-09-18/ui-review-2026-09-23.md`. Archived JSON evidence is under `ui/`; the runtime failure file is historical, not a successful UI test.
