# PLACEFINDER portable handoff — stopped at user request

Checkpoint date: 2026-09-23. No further generation, research or content editing after STOP.

- 8 new images generated and installed as `media/placefinder/placefinder-200-901.webp` through `908.webp`.
- 901–906 were visually viewed and have specific review notes in their per-asset records. 907 (Statue of Liberty) and 908 (Sydney Opera House) completed during the cancelled generation call, were recovered and installed, and remain **pending visual review**. Do not mark them reviewed from their prompts.
- The active `src/data/categories/placefinder.json` remains the legacy 226-question pack. No new questions were integrated; the target remains 40, eight per tier. Preserve old media.
- `plan-first-eight.json` and `jobs/` contain the first eight complete candidate questions, precise primary sources and actual prompts. `primary-source-review.json` records source pages actually read and failed pages; source reading is not image approval.
- `outputs.json` maps every saved asset to its portable repo path, source generation hash, final asset hash and per-asset provenance/review record. The installed WebP files are the portable usable outputs. Raw PNG originals also remain in the current transient generated_images directory, but resumption does not depend on those absolute paths.
- `unstarted-candidates.json` records the tentative 32 remaining answers and regional topics. They are **not** finished or verified questions. Reassess difficulty and enforce no more than two of any topic per tier.
- Use consistent landmark-name answers, 901–908 IDs, unique stems and normalized answers, source URLs supporting identities, explicit AI disclosure/provenance. The six viewed outputs are educational illustrations, not documentary photographs; background and spacing are illustrative.
- Built-in image generation skill was read. Use one built-in call per asset, never CLI/API fallback without explicit user authorization. Existing installer: `node scripts/bank-install-generated.mjs JOB.json OUTPUT.png`; it creates per-asset records, resizes to 1280px longest edge and caps 256KB. Do not regenerate any of the eight existing assets merely to restore paths.
- Before adopting the first eight, visually inspect the two pending assets and reconsider any landmark-specific inaccuracies. Then finish the remaining 32, source/visual review, category JSON and review evidence; root owns shared status/index/commit/push.

SOUND was completed separately as a 40-question **unverified** draft. All 40 source/license pages and signal checks are recorded in `docs/bank/rebuild-2026-09-18/review-media-sound.json` and `.md`; all exact audio files remain pending human listening. Do not turn verified true without hearing them. The single attempted audio input returned `audio content omitted because you do not support audio input`.
