> HISTORICAL CHECKPOINT. Latest owner-requested pause: 2026-09-23. Read `/CONTINUE_FROM_ANOTHER_ACCOUNT.md` and `checkpoint-2026-09-23.json` first; counts below are obsolete.

# Badeeha rebuild — paused by owner

User requested saving the work and continuing later. Stop content writing and image generation until asked to resume. This is a work-in-progress checkpoint, NOT a releasable bank. Do not deploy or merge it as complete.

## Scope
- Keep all 78 existing pack names; exactly 8 questions per tier 200/400/600/800/1000 (3120 total).
- Audience: Arabic youth and families 16+. All story spoilers permitted; TV/film packs focus on story events.
- Target correct rates: .80/.60/.40/.25/.15; editorial estimates, not measured. Binary before/after has a 50% guessing floor.
- Generate all visual questions and covers; truthful AI attribution, realistic recognizable people; use reusable/official audio, not pirated downloads. Optional music-pack question unanswered; arabmusic/tarab can stay text until audio sourcing is resolved.

## Saved state
- 44 packs currently have 40 questions with new IDs 901–908: actors, animals, anime, apps, arabic, arabmovies, arabseries, babalhara, beforeafter, brands, breakingbad, capitals, cars, code, commonbond, completeproverb, egyptdrama, emoji, ertugrul, food, football, foreignseries, fruitsveg, general, geo, hidden, hints, history, movies, naruto, premier, prophets, puzzles, quran, ramadan, ramadanseries, science, sports, squidgame, syriandrama, tech, turkishdrama, ucl, worldcup. Counts describe written content, not final validation.
- 67/78 generated covers installed; 24 generated question images installed (zoom tiers 200/400/600).
- Full inventory and partial provenance are adjacent JSON files. All images still require final UI/relevance review; cover anime is too abstract, dragonball needs the distinctive four-star ball, and onepiece should have the red hat band.
- Original generated PNGs remain in local outputs/badeeha-rebuild/art/originals; optimized assets are in Git.
- Authoring plans and scripts are copied into authoring-work. Scripts include this machine's absolute paths; adjust before running elsewhere. DO NOT rerun a builder over subsequently refined content blindly.

## Incomplete work and next steps
1. Resume remaining text packs listed in inventory. Current agent groups: experience had finished 14 drama packs and was doing naruto/onepiece/dragonball/aot/deathnote/demonslayer/jujutsu/hunterxhunter/spacetoon/cartoon/videogames; media_questions completed nine knowledge packs plus quran/prophets/ramadan and still owned islamiyat/seerah/arabcelebs/youtubers/arabmusic/tarab/arabart/theater; subscriptions completed sports5 plus apps/brands/cars and was editing arabic/puzzles, then shopping/proverbs/dialects/arabliterature/books/quotes. Use inventory as authoritative disk state.
2. Finish cover generation using covers-plan.json; skip all existing installed covers. Root generation cells were interrupted and are no longer available.
3. Finish 160-image object-media-plan.json (zoom/blur/silhouette/tilepuzzle). Only 24 zoom images installed. Review each image. Verify silhouette alpha is real, not a solid backdrop. Fix bad alias صواعد سقفية for هوابط كلسية (stalactites hang from ceiling). Add ورقة جنكة aliases. Adjust zoom origins so easy questions show a useful detail (toothbrush bristles etc.).
4. Plan/generate remaining flags40, recognizable people40 (reveal), cars40, landmarks40 (placefinder), and spotdiff40 pairs (=80 images), plus source/review 40 sound clips. These plans are not yet implemented. Existing old media sources may be used as reference, but final requested images should be newly generated. Spot-difference edits must show only the intended change, with reviewed coordinates.
5. Do NOT delete old media until every replacement is integrated. Compile generated-art.json and visual-evidence.md only with real provenance/review. New images are currently unreferenced by active media-pack JSON. Object plan has verified:false intentionally.
6. Root hidden/code/beforeafter passed focused checks. Hints/commonbond/completeproverb/emoji were just written and refined; final focused validation is still pending. refine-interactive.cjs removes descriptive source fields that the validator rejects, makes all hints stems distinct, fixes astrolabe source; verify it applied after all builders. Commonbond-1000-902 still needs proper primary support for all three legacy mobile OS; use a genuinely supporting source or choose another clear puzzle. Append emoji evidence to interactive-evidence.md.
7. Update bank-status from actual validated pack counts. Never mark unreviewed content done merely because count is40. Rebuild index and sources; full validators/tests/build/mobile+offline review only when bank is complete. No full final build has passed.
8. Preserve the SW navigation-response fix from main4dc4e03 and the earlier Fabraka rebuild. Payment/auth environment is outside this task; keep unchanged.

## Prior verification already performed
- hidden6, beforeafter3, code1 focused tests passed before this pause.
- Integration/persistence/provenance agent reported44 focused checks. Cover agent reported3 Node checks and15 browser fixture checks.
- Completed sports/drama/knowledge subsets had their own content checks. These results do not imply the unfinished whole bank is releasable.
- git diff --check passed when saving; JSON syntax is checked by inventory generation.
