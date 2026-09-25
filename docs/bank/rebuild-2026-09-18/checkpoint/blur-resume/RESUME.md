# BLUR handoff — paused 2026-09-23

User requested a stop and repository checkpoint for continuation from another account. No further generation or content authoring was performed after the stop. Run commands from the repository root. All necessary plans and helper paths below are repository-relative; no temporary directory is required.

## Current state

- 24 optimized WebP assets installed in `media/blur/`, IDs 200/400/600 × 901–908, with 24 individual generation records.
- 16 assets (200 and 400 tiers) passed individual sharp-image review and paired static blurred previews. Their portable jobs have `verified: true` and actual generation dates.
- 8 assets (600 tier) remain `verified: false` and records remain review pending. Sharp images were viewed; exact notes are in `status.json`. The final archery and aurora replacements still need fresh blurred previews.
- 16 assets (800 and 1000 tiers) have not been generated. Start at `blur-800-901`; all exact IDs and states are in `status.json`.
- `src/data/categories/blur.json` remains the original 240-question pack. Do not replace it until all 40 new questions/assets are ready and reviewed.

## Portable inputs

`jobs/` contains all 40 authoritative current jobs, including revised subjects and the latest archery edit prompt. `remaining-job-plan.json` consolidates these jobs at this checkpoint. The earlier shared object-media plan is stale for the revised 600 subjects. Prefer these individual jobs. `../../review-blur-generated.json` contains the 16 completed reviews. Individual installed records are under `../../generated-records/` relative to this directory (use repository paths in status/jobs to avoid ambiguity).

`rejected-generation-records/` preserves the initial archery and bamboo provenance. The current corresponding records link to these archives. Rejected images are not current gameplay assets.

## Resume tasks

1. Read the current rubric/schema and imagegen skill. Generate all new images only with the built-in image-generation tool, one call per asset. No API or CLI fallback. For edits, inspect the existing image and supply its local reference path.
2. Regenerate 600 previews: `node docs/bank/rebuild-2026-09-18/checkpoint/blur-resume/scripts/static-preview.mjs 600`. The saved 600 sheets explicitly labeled STALE contain old archery/bamboo. View both fresh sheets and each installed sharp image as needed. Mark passed only after actual review. The portable `scripts/review-batch.py` accepts a JSON mapping from qid to actual sharp-image review note on stdin; only use after both reviews are done.
3. Generate/install eight 800 assets, then eight 1000 assets, using each `jobs/ID.json` with `node scripts/bank-install-generated.mjs JOB_JSON OUTPUT_PNG`. Keep each optimized image at most 256 KiB and 1280 px edge. Preserve prior provenance before any replacement.
4. Individually inspect every sharp asset and paired static blurred previews. Browser QA is blocked: Chromium was unavailable and its download failed. Do not retry the blocked browser installation. Current previews approximate renderer Gaussian blur 16 px at tiers 200/400 and 14.4 px at 600+, saturation 1.3, at 320×240 and 491×368. Label this as approximate, not browser validation. Difficulty targets are editorial estimates, not measured success rates.
5. Carefully check bagpipe geometry, funicular incline, and hammer-throw wire/ball. Remove duplicate primary alias from `blur-1000-908` (هوابط كلسية); the incorrect ceiling-stalagmite alias has already been removed.
6. After all 40 are genuinely ready: merge the question objects from current individual jobs into the category, retain type=image/effect=blur, 8 per tier and 8 topics, local review source URLs, actual generation dates, and per-asset provenance paths. Finish JSON/Markdown review, run the per-pack validator and resolve substantive errors. Shared counts/index/status/manifest are root-owned integration work.

No commits or pushes were made by this agent. Old category media remains untouched.
