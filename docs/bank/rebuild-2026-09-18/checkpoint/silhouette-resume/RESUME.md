# Silhouette generation checkpoint — user stopped work, 2026-09-23

The user requested saving progress for continuation from another account. No
further generation or content authoring should be inferred from this checkpoint.
The previous `src/data/categories/silhouette.json` remains unchanged. This is a
partial asset checkpoint, **not a completed or published 40-question pack**.

## Completed work

- 32 assets were generated with the built-in image generation tool, one call per
  asset. They cover every ID 901–908 in tiers 200, 400, 600 and 800.
- All 32 outputs were visually inspected. 29 match their intended subjects;
  three are preserved as rejected references requiring regeneration below.
- Every stored WebP was installed by `scripts/bank-install-generated.mjs` from
  its job using `requireAlpha: true`. Numeric alpha measurements are in
  `assets.json` and each generation record. Actual alpha=0 pixels, alpha=255
  pixels, partial alpha, near-opaque pixels and bounds are recorded; an RGBA
  metadata flag alone was not treated as proof of transparency.
- The generator commonly made subject pixels alpha 251–253; the background is
  genuinely alpha 0. Original transparency was preserved without substituting a
  painted background. All files obey the installer's 256 KiB / 1280-pixel limits.
- Saved assets are in `media/silhouette/`. Their exact prompts and SHA-256 values
  are in `docs/bank/rebuild-2026-09-18/generated-records/silhouette-*.json`.
  No old assets were deleted. Large transient PNG originals are not necessary to
  resume: each inspected result is preserved as its optimized WebP.

## Portable handoff files

- `assets.json`: installed asset, record and job paths, answer, status, alpha
  statistics and checksum.
- `jobs/`: all 40 generation jobs with exact prompts and draft question metadata.
- `working-mapping.json`: all 40 jobs joined to their installed asset paths or
  null. Paths refer to repository contents; there is no dependency on `/tmp` or
  the previous account's scratch directory.

## Regenerate these three assets

| ID | Answer | Reason |
| --- | --- | --- |
| silhouette-200-905 | صبار | Plant base touches lower image edge; generate complete outline with transparent padding. |
| silhouette-200-908 | كرسي هزاز | Top and rocker edges touch image boundaries; generate complete outline with padding. |
| silhouette-800-905 | مونستيرا | Petiole appears attached opposite the correct heart-shaped base; correct the leaf anatomy. |

These existing files are **references only**, marked `needs-regeneration` in
their records. Use the built-in tool for correction, inspect the existing image
before any edit, and retain actual transparent alpha. Replace via the installer
only after reviewing the new output; `--replace` is required for an existing ID.

## Not yet generated / accepted

Tier 1000 was interrupted by the user's stop request. No completed output from
that call was returned or mapped, so these eight are all pending:

| ID | Draft answer |
| --- | --- |
| silhouette-1000-901 | خلد الماء |
| silhouette-1000-902 | سدس |
| silhouette-1000-903 | مكبس رموش |
| silhouette-1000-904 | قاطرة بخارية |
| silhouette-1000-905 | ورقة جنكة |
| silhouette-1000-906 | فاكهة النجمة |
| silhouette-1000-907 | بالالايكا |
| silhouette-1000-908 | بابور كاز |

Resume with eight pending generations plus three corrections, using one built-in
call per asset, never silently switching to an API or CLI generator. Check for
any existing new output before rerunning a job. Read the imagegen skill first.

## Remaining integration and QA

1. Finish and inspect the 11 pending/correction outputs, including actual alpha
   distributions and geometry. Update generation dates to their actual dates.
2. Review all draft Arabic answers and aliases; add suitable جنكة / جينكو /
   Ginkgo variants. The stalactite correction in the shared object plan concerns
   another pack, not a silhouette item.
3. Test every asset with the real renderer: black silhouette before reveal,
   full-color image after reveal, recognizable outline, no opaque rectangle or
   invisible thin feature. This gameplay pass is **not yet done** for any asset.
4. Create final per-question review MD/JSON. Draft jobs currently point to
   `docs/bank/rebuild-2026-09-18/review-silhouette-final.json`; create it or replace
   the draft sourceUrl with the actual final review path. No descriptive `source`
   field should be reintroduced.
5. Only after all 40 are ready, replace the pack with 8 questions per tier,
   8 topics, IDs 901–908, difficulty targets .8/.6/.4/.25/.15, verified only after
   actual review, and per-asset provenance records. Preserve pack name/icon.
6. Run the focused bank validator; the main editor handles shared status,
   retired IDs, provenance manifest consolidation and index/build integration.
   Do not mark the pack complete based on the presence of 40 image files alone.

Difficulty values remain editorial targets, not measured player success rates.
