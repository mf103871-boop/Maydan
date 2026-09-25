# Cars checkpoint — completed locally, 25 September 2026

The user resumed work after the 23 September pause. This pack is now integrated and reviewed: 40 questions, 8 per tier, 9 balanced topics. The authoritative plan is ../../cars-generation-plan.json and the installed category is src/data/categories/guesscar.json. Do not rerun the old plan generator over the refined plan.

18 images retained from 23 September, 22 missing images generated on 25 September. Two new outputs were corrected through built-in image editing: Huayra side script removed and KR200 misleading badge replaced. Every final asset has exact prompt/date/dimensions/hash in ../../generated-records/guesscar-*.json; the two edits retain their original history. No old media was removed.

All 40 questions have unique Arabic visual descriptions and reviewed answer variants. Verification covers broad model-family identity. No question asks for trim/year, and such fidelity is not certified. E-Class has been rechecked at family level. All39 retained local reference photos were compared; LEAF uses Nissan's design gallery. All40 source pages were opened during the prior review, except KR200 only had an indexed title then. KR200's full Louwman Museum page was successfully opened on 25 September, resolving that gap.

Actual UI QA: 486/486, 40/40 questions, 320/390px, reveal/hide, lightbox before/after, no visible/alt/title/filename answer leaks, all40 decode and AI disclosure. All40 paired stages viewed; two full mobile pairs also viewed. Tested category SHA256: 7a1cd3fd4d4f947d19af7831914c121f0efe5464b64b2d10a44ea2bf81c3eec9.

Portable evidence: ../../qa-2026-09-25/guesscar/runtime.json and associated images. Final review: ../../review-guesscar-final.json and .md. Re-run from repo root with: node docs/bank/rebuild-2026-09-18/checkpoint/cars-resume/guesscar-ui-qa.mjs OUT_DIRECTORY. Dependencies: existing repo node_modules with playwright, esbuild and sharp; installed Chrome or CHROMIUM_PATH. No production services needed.

Pack-specific work is complete. Root still owns shared bank-status counts/status, generated-art manifest, index and aggregate handoff. Focused validation had only five stale bank-status tier counts when this task finished. No commit, push or deployment.
