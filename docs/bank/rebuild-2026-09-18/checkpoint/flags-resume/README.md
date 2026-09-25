# Flags resume checkpoint — 2026-09-23

Stopped immediately at user request. No further research, generation, or question writing was done. The in-flight final generation batch had already completed; its outputs were installed as pending review.

## State

- Existing src/data/categories/flags.json remains the old 240-question pack. No new forty-question pack has been written.
- Forty distinct new AI WebP assets are installed at media/flags/flags-{tier}-{901..908}.webp.
- Forty per-asset prompt/provenance records are in docs/bank/rebuild-2026-09-18/generated-records/. All review statuses remain pending.
- asset-mapping.json provides portable repository paths, original generated basenames, prompts, and record locations.
- plan-and-sources.json contains the precise forty-country mapping, ten geographic topics, tier assignments, source URLs, actual retrieval modes, remaining evidence gaps, and caveats.
- Installed assets, records, and this checkpoint suffice to resume from a repository checkout; no previous /workspace path is required. Original high-resolution scratch PNGs are not required to use the installed WebPs.
- No new bank validation was run because the question pack was not rewritten.

## Generation and review limits

All images were generated individually with the built-in OpenAI image generation tool. No manual SVG, synthetic flag drawing, or API fallback was used. The install script only resized/compressed generated raster outputs. Old assets were retained.

Initial prompts saying “no surrounding background” caused some flag field colors to become transparent. The affected first tier was re-generated. Exact affected candidate IDs: flags-200-901 through flags-200-907; flags-200-908 was the opaque Bangladesh output. Flags-200-904 (China) and flags-200-906 (Germany) initially looked plausible but a later alpha-channel audit found transparency; both were regenerated again during the tier-800 batch and the final installed files passed alpha <250 fraction = 0.0. The working prompt explicitly says completely OPAQUE, every pixel opaque, including white.

A further all-forty alpha and size audit remains recommended at resume. Previously checked final assets through tier 800 were opaque; the final eight were installed at checkpoint without a new alpha audit. Do not approve files solely because the generation preview looks correct.

Preliminary visual checks found the correct recognizable structures and star counts, including Canada eleven-point maple leaf, Nauru twelve-point star, Samoa four larger plus one smaller star, SVG three separate V-arranged diamonds. The last two output previews (Suriname and Guyana) show correct basic layouts but slight shading/texture despite the flat prompt. All files need final visual acceptance.

Known geometry approximations requiring deliberate acceptance or regeneration: Japan red disc about 63% rather than specified 60% height; Kuwait trapezoid about 26.7% rather than 25% width; Togo canton approximately 549x583 rather than precisely square; Samoa canton about 52.6% rather than 50% height. Some flag color fields show mild tone variation. No claim of pixel-exact official construction is justified.

## Remaining work

1. Read RUBRIC, SCHEMA and the rebuild checkpoint; inspect actual forty images and pending records. If exact geometry is required, regenerate the specific failures with official references using only the built-in image tool. Never silently flatten alpha or redraw symbols.
2. Resolve Solomon Islands primary-source gap; verify all entries marked indexed-only/recheck-extract in plan-and-sources.json. Open official reference images for precise emblem/geometry checks. Do not mark verified based on a search lead or failed request.
3. Write forty unique natural Arabic identification questions, eight each for tiers 200/400/600/800/1000 with IDs 901–908, difficulty targets .8/.6/.4/.25/.15. Use the ten topic groups in the plan, maximum two per tier. Avoid near-identical canned text; question <=22 words and answer <=6 words.
4. Romania question must explicitly mention Europe to avoid Chad ambiguity. Use جمهورية الكونغو for Congo-Brazzaville; ساموا is not American Samoa. Keep country aliases precise, with unique normalized answers.
5. Attach installed WebPs with truthful AI disclosure and provenance from the individual records (actual creation date 2026-09-23), not a public-domain or CC license. Preserve old media. Set verified true only after precise factual source review.
6. Write review-flags.json/md with honest per-question evidence and limitations; update each asset record only after final visual acceptance.
7. Run npm run bank:validate -- flags and address substantive issues; shared counts/index updates belong to root. Do not publish without the required user authorization.

Difficulty is an editorial estimate, not player-tested. Do not report this pack complete: generated assets are saved, but the source review and question rebuild remain unfinished.
