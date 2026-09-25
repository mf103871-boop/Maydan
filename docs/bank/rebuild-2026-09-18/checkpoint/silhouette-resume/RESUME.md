# Silhouette resume state — 2026-09-25

The user resumed work on 25 September. This supersedes the interrupted 23 September checklist; Git retains that historical version. The current `src/data/categories/silhouette.json` is now the rebuilt 40-question pack, not the old 240-question pack. Do not rerun old plan builders over the edited questions.

## Integrated work

- Forty generated transparent WebPs and questions are installed: eight per tier 200/400/600/800/1000, eight topics, and IDs 901–908 within each tier.
- All eight tier-1000 assets were generated, installed and visually reviewed on 25 September: platypus, sextant, eyelash curler, steam locomotive, ginkgo leaf, starfruit, balalaika and kerosene stove. Their actual dates and prompts are in the individual generation records.
- Four existing candidates were corrected: cactus `silhouette-200-905`, saxophone `silhouette-200-907`, rocking chair `silhouette-200-908`, and monstera leaf `silhouette-800-905`. These IDs no longer represent the rejected checkpoint candidates.
- Independent visual/identity review and real alpha checks cover all 40 current assets. Their actual transparent background, subject bounds, file sizes and SHA-256 values are recorded. An RGBA label alone was not treated as evidence of transparency. The corrected images retain suitable padding and the intended distinguishing features.
- Old media were preserved. Current optimized WebPs and their provenance records suffice for continuation; there is no dependency on a previous account's scratch originals.

Read [review-silhouette-final.json](../../review-silhouette-final.json) and its [readable review](../../review-silhouette-final.md) for current per-question evidence and approval scope. Whole-bank continuation uses [checkpoint-2026-09-25.json](../checkpoint-2026-09-25.json) and [validation-2026-09-25.json](../../validation-2026-09-25.json), maintained by the main editor.

## Runtime verification at this handoff

The final full-pack UI replay passed **486/486 checks** after the two Arabic prompt corrections below. All 40 questions received actual gameplay and visual review. The tested category file SHA-256 is `109c9eb446071f059c5eb6e788c5cc0e71a18889fabdd67c29155988706e089a`. The corrected prompts do not contain an accepted answer alias:

- `silhouette-400-904` asks about the depicted water vehicle; it no longer supplies the accepted generic answer `قارب` in its prompt.
- `silhouette-1000-908` asks about the old cooking device; it no longer supplies the accepted generic answer `موقد` in its prompt.

The final replay is complete and recorded in the final review and validation files. Focused flags/silhouette validation reports **zero errors**. Whole-bank validation reports **5,709 errors**, all in the seven unfinished packs; there are zero placeholders and all 198 manifest asset hashes matched. Identity/alpha review, full gameplay verification and source correctness remain separately documented; the mere existence of forty files does not substitute for them.

## Editorial and provenance decisions

The questions use genuine AI disclosure and per-asset records, not invented external photography licenses. Corrected/new media carry their actual 25 September dates; retained media preserve their earlier dates. The approved question structure keeps `type: image` and `effect: silhouette`, with neutral media titles and filenames.

Answers and aliases were reviewed for what is recognizable: the boat accepts a generic boat answer without claiming visible speed; pepper does not require inferring its heat; the watering can is named `إبريق ري`; the sextant is `السدس` with nautical aliases. Ginkgo includes Arabic variants and English. Ginger has the reviewed aromatic-spice clue to avoid relying on an ambiguous branching outline. Fine mechanical calibration, exact botanical cultivar, manufacturer identity and measured player difficulty are not certified.

`assets.json` and `working-mapping.json` originate from the partial 23 September checkpoint and may still describe missing or rejected candidates. Use the current pack, individual `generated-records/silhouette-*.json` and final review as authoritative. The `jobs/` files retain the actual generation instructions and current metadata where updated; do not infer a pending generation solely from the old inventory.

## What to do next

The final UI replay and focused validation are complete; read their stored evidence before making any later change. No tier-1000 generation or old three-image correction remains outstanding from the historical checklist. Investigate only concrete newly reported failures.

The next content pack is `blur`, using its [existing partial assets and resume files](../blur-resume/). Across the bank retain all 78 names and ordering, 40 questions per pack and eight per tier, precise unretired IDs, question/answer word limits, topic quotas and genuine provenance. Preserve old assets, do not weaken checks, and do not change game rules to fit content. The remaining six legacy image packs and unlistened sound pack still prevent a ready release; no automatic merge or deployment.
