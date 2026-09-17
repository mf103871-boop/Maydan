# Media and question audit — 2026-09-17

This review starts from upstream commit 60bfa46. It improves a bounded part of the bank and does not certify all questions or all assets as publication-ready. The parent audit owns application, audio-system, payment and deployment readiness.

## Implemented

- Replaced or refreshed **123 unique images**: silhouette 81, blur 17, guesscar/placefinder/reveal/tilepuzzle/zoom 5 each. Sources, authors, licenses and dimensions are retained in category records and media/_sources.json. Exact IDs and old/new source pages: [media-refresh-2026-09-17.json](media-refresh-2026-09-17.json).
- Visually inspected all 123 resulting images via contact sheets or individual views. Also scanned all 240 silhouette images for subject problems. This was not a visual inspection of all 2,605 media references, nor an auditory review of every sound.
- Fixed conspicuous wrong-subject selections such as landscape instead of sloth, unrelated buildings instead of objects, the drafting compass instead of a direction compass, a bank building instead of an ATM, and a sculpture instead of a megaphone. The final four subject repairs were silhouette-200-045, silhouette-800-011, silhouette-800-026, silhouette-1000-043; they now visibly show the requested tower, police vehicle, canoe and slide.
- Renamed silhouette to **صور غامضة**, preserving its ID and points. Its 217 opaque pictures now use shadow (details remain visible); 23 images with actual transparent pixels retain silhouette. Applying brightness zero to the previous opaque photographs would have made solid black rectangles. Parent supplies rendering support; an added regression test verifies real transparency for every remaining silhouette.
- Removed robotic رقم N wording from blur/silhouette. Used more specific prompts for the final ambiguous multi-object scenes.
- Corrected blur-200-037 to سرقاط, blur-600-045 to جيود بلوري, blur-800-044 to متوازي مختلف الارتفاع, and silhouette-600-035 to صنوبر. Added common alternate answer forms where applicable.
- Corrected the two spotdiff-800-023 Eiffel photograph credits from Public Domain to CC BY-SA 3.0 / Benh LIEU SONG. The object being public domain does not make the photograph public domain. Primary file page: https://commons.wikimedia.org/wiki/File:Tour_Eiffel_Wikimedia_Commons.jpg . Added license-normalization regression coverage so mixed object/photo metadata preserves attribution obligations.
- Raised controlled acquisition caps to image 256 KiB, audio 160 KiB, category 64 MiB. Future image attempts start at 1280 pixels with no enlargement; future audio attempts use longer clips at higher bitrates. Existing sound recordings were **not** replaced by this pass. Safety/host/license controls remain active.
- Added the read-only scripts/media-audit.mjs to expose missing files, low resolution, attribution review needs, duplicate hashes and opaque silhouette mistakes. Its output explicitly does not certify visual truth or licensing.

## Current measured inventory

Referenced media bytes: **61,153,918** (58.32 MiB), from 45,320,892 (43.22 MiB) before this pass; increase 15.10 MiB. This is the sum of referenced local files, not total application/download/bundle size. Shared files/references may be counted more than once.

| Pack | Questions | Local file references | MiB | References below 480px long edge |
| --- | ---: | ---: | ---: | ---: |
| blur | 240 | 240 | 5.80 | 132 |
| flags | 240 | 240 | 1.27 | 0 |
| guesscar | 238 | 238 | 6.92 | 45 |
| placefinder | 226 | 226 | 6.33 | 62 |
| reveal | 240 | 240 | 5.45 | 89 |
| silhouette | 240 | 240 | 12.86 | 22 |
| sound | 240 | 240 | 3.88 | 0 |
| spotdiff | 240 | 480 | 3.90 | 480 |
| tilepuzzle | 225 | 225 | 6.34 | 84 |
| zoom | 236 | 236 | 5.58 | 70 |

Latest audit: zero missing referenced files, zero opaque images using silhouette, **984** image references below a 480px long edge (including all 480 spotdiff image references). These are quality candidates, not proof each image is unusable. **150** author fields need a look; **34** of those are CC BY/BY-SA and should receive attribution priority. The other 116 include public-domain/CC0 sources where an anonymous author can be legitimate.

## Publication gaps that remain

The target is 48 questions per tier (240 per pack). These four packs remain structurally below that target; this pass did not fill them with arbitrary media:

| Pack | Current | Missing | Missing by tier |
| --- | ---: | ---: | --- |
| zoom | 236 | 4 | 400:2, 600:1, 1000:1 |
| guesscar | 238 | 2 | 1000:2 |
| placefinder | 226 | 14 | 200:5, 400:3, 600:1, 800:3, 1000:2 |
| tilepuzzle | 225 | 15 | 200:6, 400:1, 600:1, 800:1, 1000:6 |

Total **35 missing questions**. Passing schema/test checks does not establish editorial completeness. Some _sources.json records predate later bank rewrites and describe files no longer referenced; use the live question media record as the binding between question and asset, and reconcile obsolete source-index rows during a full provenance pass.

Remaining **editorial review candidates**, explicitly not confirmed incorrect answers:

| QID | Concern | Confidence / next action |
| --- | --- | --- |
| silhouette-800-010 | إطفائية: dusk staging scene gives a weak fire-truck clue | Medium; review on a phone at actual shadow brightness |
| silhouette-800-043 | مزارع: portrait in a conical hat, no visible farm activity | Medium; replace with agricultural activity if players cannot identify profession |
| silhouette-1000-018 | صحفي: conference portrait does not visually establish profession | Medium; source caption/identity alone is insufficient for a visual guessing question |
| silhouette-1000-036 | حقيبة: old Samsonite advertisement is visually cluttered | Medium; prefer a clear suitcase photo |
| silhouette-600-034 | غروب صبار: painted rock depicts the scene, rather than a landscape photograph | Medium; technically a depiction, stylistically inconsistent |
| silhouette-200-021 | خفاش: source matches but bat is small against a moon | High on visibility concern; reframe or find a closer image for easy tier |
| silhouette-600-024 | كأس بطولة: correct subject, source only 120×179 | High on low resolution; needs better real source, not upsampling |
| silhouette-1000-023 | ساعة رملية: source correct but small 250×250 icon | High on limited resolution/style consistency |
| blur-600-011 | مدمرة: source title Carbon Destroyer 1 may identify a civilian ship by name | Low; source/visual verification still required |
| blur-600-026 | عاصفة رملية: source relates to a Tabas anniversary event | Medium; verify actual image rather than deriving subject from the event caption |
| blur-600-022 | رافعة شوكية: source description relates to Tehran printing houses | Low; inspect actual asset for clear forklift rather than assuming mismatch |

Unreliable topic metadata remains in blur/silhouette (e.g. a lion marked رياضة), and existing verified:true flags are not proof of a fresh editorial review. Parent suppresses these topic-based hints; a future curated topic pass should fix the underlying labels.

## Difficulty request

There are 11,214 questions at 600/800/1000 across the latest bank. This media pass corrects misleading assets and simplifies image prompts, while retaining points. It does **not** claim to have individually rewritten all high-tier trivia questions or measured a 10% difficulty improvement. Parent owns the shared assistance implementation. A numerical 10% result requires a baseline and subsequent playtesting (correct-answer rate by question/tier and response time); timer changes alone do not satisfy a request for easier content.

## Verification and practical next work

- Relevant media/fetch/license/safety tests passed 24/24 against the final 123 image files, including real-transparency and license regression checks. Parent runs the combined tests, bank validation, build, browser media smoke and iOS preparation against the final files.
- Re-run: node scripts/media-audit.mjs (read only). Review its issue list rather than treating a successful exit as quality approval.
- Complete the 35 curated missing questions, review the 34 attribution cases, and sample every category on a small phone screen before release. Prioritize spotdiff higher-resolution original pairs; do not simply enlarge its 360px files.
- Listen through sound questions for clipping, silence, correct subject and answer ambiguity. New acquisition defaults do not improve the existing recordings automatically.
- For future media ingestion, require a human subject-answer check with a thumbnail before acceptance. Search-title similarity is the cause of many wrong-object selections; automated schema validity is insufficient.
