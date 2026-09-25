# Retired question ID coverage audit — 2026-09-23

## Result

No additions were needed. The existing registry already covers all **16,556 distinct IDs** removed from the 69 rebuilt categories across the available original and checkpoint revisions. All **2,760 current IDs** are outside the retired set. The registry was preserved byte-for-byte, including existing ranges and references.

- Current scope: 69 categories × 40 questions, including the integrated `zoom` pack.
- Current suffixes: 901–908 for each of the five tiers.
- Existing registry: 707 ranges, 16 explicit IDs, 22,085 distinct expanded IDs.
- Missing retired IDs: 0.
- Newly added ranges or explicit IDs: 0.
- Current IDs incorrectly covered by retirement: 0.

## Compared revisions

The actual JSON question IDs were read from each Git revision with `git show <revision>:src/data/categories/<category>.json` and compared as sets against the current pack. An ID was considered removed only if it existed in that historical JSON and is absent from the current pack. Ranges were expanded with the same zero-padded three-digit format used by `readRetiredQids` in `scripts/bank.mjs`.

| Revision | Purpose | Removed IDs versus current packs |
|---|---|---:|
| `4dc4e03641ffd955192c1f0060ed555e185e567f` | Original pre-rebuild base recorded in checkpoint inventory | 16,556 |
| `54e4e8ba8fda069d4287fd71efa328a21ddc8475` | Paused checkpoint: 44 packs already rebuilt | 5,996 |
| `5dc662f` | Resumed checkpoint: 59 packs already rebuilt | 2,396 |

The union is 16,556, not the sum of the rows, because historical revisions share IDs. Nine unfinished media packs are outside this 69-pack audit; their pre-existing retirement entries were left intact.

## Per-category coverage

The original-base column establishes retirement coverage for the 44 packs already rebuilt at the paused checkpoint as well as later batches. Every removed ID in every column is present in the unchanged registry.

| Category | Removed from original base | Removed from paused checkpoint | Removed from resumed checkpoint | Missing |
|---|---:|---:|---:|---:|
| `actors` | 240 | 0 | 0 | 0 |
| `animals` | 240 | 0 | 0 | 0 |
| `anime` | 240 | 0 | 0 | 0 |
| `aot` | 240 | 240 | 0 | 0 |
| `apps` | 240 | 0 | 0 | 0 |
| `arabart` | 240 | 240 | 240 | 0 |
| `arabcelebs` | 240 | 240 | 240 | 0 |
| `arabic` | 240 | 0 | 0 | 0 |
| `arabliterature` | 240 | 240 | 0 | 0 |
| `arabmovies` | 240 | 0 | 0 | 0 |
| `arabmusic` | 240 | 240 | 0 | 0 |
| `arabseries` | 240 | 0 | 0 | 0 |
| `babalhara` | 240 | 0 | 0 | 0 |
| `beforeafter` | 240 | 0 | 0 | 0 |
| `books` | 240 | 240 | 0 | 0 |
| `brands` | 240 | 0 | 0 | 0 |
| `breakingbad` | 240 | 0 | 0 | 0 |
| `capitals` | 240 | 0 | 0 | 0 |
| `cars` | 240 | 0 | 0 | 0 |
| `cartoon` | 240 | 240 | 240 | 0 |
| `code` | 240 | 0 | 0 | 0 |
| `commonbond` | 240 | 0 | 0 | 0 |
| `completeproverb` | 240 | 0 | 0 | 0 |
| `deathnote` | 240 | 240 | 0 | 0 |
| `demonslayer` | 240 | 240 | 0 | 0 |
| `dialects` | 240 | 240 | 240 | 0 |
| `dragonball` | 240 | 240 | 0 | 0 |
| `egyptdrama` | 240 | 0 | 0 | 0 |
| `emoji` | 240 | 0 | 0 | 0 |
| `ertugrul` | 240 | 0 | 0 | 0 |
| `food` | 240 | 0 | 0 | 0 |
| `football` | 240 | 0 | 0 | 0 |
| `foreignseries` | 240 | 0 | 0 | 0 |
| `fruitsveg` | 240 | 0 | 0 | 0 |
| `general` | 240 | 0 | 0 | 0 |
| `geo` | 240 | 0 | 0 | 0 |
| `hidden` | 240 | 0 | 0 | 0 |
| `hints` | 240 | 0 | 0 | 0 |
| `history` | 240 | 0 | 0 | 0 |
| `hunterxhunter` | 240 | 240 | 0 | 0 |
| `islamiyat` | 240 | 240 | 0 | 0 |
| `jujutsu` | 240 | 240 | 0 | 0 |
| `movies` | 240 | 0 | 0 | 0 |
| `naruto` | 240 | 0 | 0 | 0 |
| `onepiece` | 240 | 240 | 0 | 0 |
| `premier` | 240 | 0 | 0 | 0 |
| `prophets` | 240 | 0 | 0 | 0 |
| `proverbs` | 240 | 240 | 0 | 0 |
| `puzzles` | 240 | 0 | 0 | 0 |
| `quotes` | 240 | 240 | 240 | 0 |
| `quran` | 240 | 0 | 0 | 0 |
| `ramadan` | 240 | 0 | 0 | 0 |
| `ramadanseries` | 240 | 0 | 0 | 0 |
| `science` | 240 | 0 | 0 | 0 |
| `seerah` | 240 | 240 | 0 | 0 |
| `shopping` | 240 | 240 | 240 | 0 |
| `spacetoon` | 240 | 240 | 0 | 0 |
| `sports` | 240 | 0 | 0 | 0 |
| `squidgame` | 240 | 0 | 0 | 0 |
| `syriandrama` | 240 | 0 | 0 | 0 |
| `tarab` | 240 | 240 | 0 | 0 |
| `tech` | 240 | 0 | 0 | 0 |
| `theater` | 240 | 240 | 240 | 0 |
| `turkishdrama` | 240 | 0 | 0 | 0 |
| `ucl` | 240 | 0 | 0 | 0 |
| `videogames` | 240 | 240 | 240 | 0 |
| `worldcup` | 240 | 0 | 0 | 0 |
| `youtubers` | 240 | 240 | 240 | 0 |
| `zoom` | 236 | 236 | 236 | 0 |

## Integrity check

The current registry is byte-identical to `54e4e8:docs/bank/retired-qids.json`. Its SHA-256 is:

`f17c79694171945f74fdf2a347dfb46ad824eb5d09aad0958061d2ff474e5b25`

No registry rewrite, commit, or push was performed in this audit.
