# REVEAL checkpoint — paused by user

Saved on 2026-09-23 for resumption from another account. Stop image generation and content authoring until the user requests resumption.

## Saved state

- 40 planned portraits across eight topics; one topic per tier, eight questions per tier.
- 23 newly generated portraits are preserved in `media/reveal/` with individual records under `docs/bank/rebuild-2026-09-18/generated-records/`. All paths in this checkpoint are relative to the repository root unless explicitly local to this folder.
- The old active `src/data/categories/reveal.json` (240 questions) is untouched. None of the new portraits is activated yet. Do not mark this pack done.
- `plan.json` contains all answers, aliases, subjects and prompts. `jobs/` contains 40 portable installer inputs. `source-output-mapping.json` links generator output identifiers to durable optimized assets and records. `references.json` records retrieved identity-source leads and explicit missing research. `inventory.json` lists installed assets and next IDs.

## Actual review performed

The 23 saved images were viewed at generation time and screened for centered complete faces, recognizable public-figure likeness, legibility and absence of names/logos. These are realistic painted illustrations, not documentary photos. Final direct source-portrait comparison was NOT completed and must not be reported as complete. Records intentionally remain `review.status: pending`. Biography/source search results were read for the linked identities; several remaining subjects still need factual sourcing. No source portrait was used as a generation input.

Ahmed Zewail's output includes his familiar moustache despite the draft prompt requesting clean shaven; review against his official portrait before acceptance. Rowan Atkinson's accepted answers currently include Mr Bean: decide whether the actor name alone or the role nickname is appropriate. Difficulty targets remain editorial and require review; some familiar figures may need swapping between tiers.

## Rejection and interrupted batch

The generation tool rejected the Lionel Messi request with `moderation_blocked/public-figure`. The slot `reveal-200-904` was changed to Pelé; the saved asset and final job are Pelé. Do not rephrase the rejected Messi prompt to evade that block.

At the user stop, the active eight-image batch was terminated. Already delivered acceptable outputs were installed: Ahmed Zewail, Gamal Abdel Nasser, Abdel Halim Hafez and Ahmed Helmy. Do not assume other in-flight requests completed; only the inventory establishes saved assets.

## Resume steps

1. Obtain an explicit user request to resume. Read `docs/bank/RUBRIC.md`, `docs/bank/SCHEMA.md` and imagegen skill.
2. Inspect installed assets and the pending source portrait comparisons. Do not regenerate saved files blindly.
3. Continue these 17 missing IDs: `reveal-600-904`, `reveal-600-908`, `reveal-800-902`, `reveal-800-903`, `reveal-800-904`, `reveal-800-905`, `reveal-800-906`, `reveal-800-907`, `reveal-800-908`, `reveal-1000-901`, `reveal-1000-902`, `reveal-1000-903`, `reveal-1000-904`, `reveal-1000-905`, `reveal-1000-906`, `reveal-1000-907`, `reveal-1000-908`.
4. Use one built-in image generation call per missing image; save through `node scripts/bank-install-generated.mjs <job.json> <output.png>`. Do not use CLI/API fallback without authorization.
5. Finish identity/likeness, aliases, tier and visual gameplay review. Build the new pack only when all 40 are ready: `type: image`, `effect: reveal`, IDs901–908, targets .8/.6/.4/.25/.15, truthful AI disclosure and per-asset provenance records. Keep old media until integration.
6. Run focused `bank:validate -- reveal`; the integrating agent handles shared counts/index/manifest and final UI checks.

No commit or push was performed by this subtask.
