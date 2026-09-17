# مراجعة بنك حقائق فبركة — 18 سبتمبر 2026

استُبدل بنك الحقائق النصية القديم كاملًا بـ100 سؤال عربي جديد. يخص هذا السجل ملف `src/data/games/fabraka/questions.json` فقط؛ الصور وأسئلة الأصحاب لها ملفات وسجلات مستقلة.

## حصيلة النسخة

| البند | النتيجة |
| --- | --- |
| الحقائق الجديدة | 100 |
| المعرفات | `fab3-fact-001` إلى `fab3-fact-100` |
| المعرفات القديمة المحتفظ بها | 0؛ جميع `previousIds` فارغة |
| الفئات | 10، في كل فئة 10 حقائق |
| الإجابات الرقمية المجردة | 2 من 100 (2%) |
| الفراغات | فراغ واحد `___` لكل سؤال |
| المشتتات الاحتياطية | 4 لكل سؤال، إضافة إلى أكاذيب اللاعبين |
| صفحات المصادر المختلفة | 98 |
| تاريخ التوثيق المسجل | 2026-09-18 |

## منهج الاختيار والتوثيق

قرأت البنك السابق قبل الاختيار، واستبعدت حقائقه حتى عند إمكان صياغتها بطريقة أخرى؛ ومنها معلومات الأرقام الشائعة والاختراعات المتداولة التي كانت موجودة بالفعل. المعرفات الجديدة مستقلة وليست إعادة ترقيم للحقائق القديمة.

اختيرت الحقيقة أولًا ثم صيغت جملة عربية قصيرة ذات فراغ واحد وجواب يمكن إكمالها به. تجنبت الاعتماد على أسماء باحثين أو تواريخ دقيقة كإجابات، وقصرت الحفظ العددي على سؤالين. تسمح المواقف باختراع بدائل، مثل مادة حشو لعبة أو غرض غير متوقع في رحلة فضائية.

رجعت إلى مصادر المؤسسات القائمة على الأبحاث أو المجموعات أو المنتجات: جامعات، متاحف، حدائق كيو، NASA، NOAA، مؤسسات الحفظ، ومواقع المصنّعين فيما يخص تاريخ منتجاتهم. روابط `sourceUrl` تشير إلى الصفحات التي تؤيد تفاصيل السؤال، وليست صفحات بحث أو روابط مختلقة. بعض الصفحات المتحفية تعذر فتحها مباشرة عبر المتصفح البحثي، فاستُخدمت النصوص المفهرسة من الصفحة الرسمية نفسها عندما تضمنت الوصف الكافي؛ لا يعني تاريخ `verifiedAt` أن كل خادم أعاد استجابة HTTP ناجحة.

جميع الصياغات العربية إعادة كتابة موجزة، ولا تنقل المقالات أو الصور. حُفظ `sourceHint` مساويًا لعنوان المصدر للتوافق مع عرض المصدر السابق، مع إضافة الرابط والعنوان وتاريخ المراجعة حقولًا مستقلة. راجعت المشتتات تحريرياً لتكون مختلفة عن الإجابة ومرادفاتها، وأن توافق نوع الفراغ لغويًا.

لا يمثل التوثيق قياسًا لمتعة اللعب أو مستوى معرفة الجمهور. تبقى جلسات اللعب الفعلية الوسيلة المناسبة لضبط السهولة وتنوع الأكاذيب.

## حدود الدقة التي حافظت عليها

- `004`: دحرجة النحل للكرات سلوك تجريبي يطابق معايير الدراسة؛ لم يُحوّل إلى ادعاء عن مشاعره.
- `008`: تغير لون الطبقة العاكسة داخل عين الرنة، لا تغير لون القزحية الظاهر.
- `013`: المقصود ورقتا ويلويتشيا الدائمتان، وقد تتشققان إلى شرائط كثيرة.
- `015` و`017`: الخداع والتغذي من الفضلات خصائص لأنواع محددة، وليست لكل الأوركيد أو كل النباتات الإبريقية.
- `021`: سمكة الببغاء أحد مصادر رمل بعض الشواطئ؛ ليست مصدر كل الرمال.
- `028` و`029` و`030`: الصياغة مقيدة ببعض الأنواع ولا تعمم على جميع السرطانات أو أسماك اللؤلؤ أو نجوم البحر.
- `031`: مجسمات جونو بتصميم ليغو لكنها صنعت من الألمنيوم، ولم يُذكر أنها بلاستيكية.
- `032`: البذور دارت حول القمر ثم زرعت على الأرض؛ لا ادعاء أن الأشجار نبتت على القمر.
- `034`: وصف رائحة غبار القمر حصل داخل المقصورة، لا بشم الفراغ الخارجي.
- `036`: الحديث عن البحيرات الصغيرة الشمالية التي قاسها كاسيني، لا أن كل سوائل تيتان مادة نقية واحدة.
- `050`: لم تُعامل التفاصيل الشعبية المتباينة عن لحظة إلهام واقيات الأذن على أنها حقيقة مثبتة.
- `060`: قصة كاندي لاند تاريخ لعبة نشأت في المستشفى، وليست توصية أو ادعاءً طبيًا.
- `064`: وظيفة الأوشبتي منسوبة صراحة إلى معتقد المصريين القدماء.
- `066`: زينة الفستان أغطية أجنحة الخنافس اللامعة.
- `070`: الشكل ذو 12 وجهًا موثق؛ الوظيفة الأثرية لا تزال مجهولة/مختلفًا عليها.
- `077`: حصاد السباغيتي مقلب BBC معلن، وليس ظاهرة حقيقية.
- `079`: كاتشب الفطر مرتبط بوصفة موثقة، دون اختزال تاريخ جميع أنواع الكاتشب.
- `085`: لا نغمات متعمدة من المؤدي؛ تبقى أصوات المكان مسموعة.
- `092`: اللون مقيد بعام الافتتاح 1889، وليس أول طبقة طلاء في التصنيع.
- `095`: شلالات الدم محلول ملحي غني بالحديد؛ لم يُختزل الوصف إلى دم أو طحالب أو ادعاء عن نوع بلورات بعينه.

## توزيع الفئات

| الفئة | المعرفات | العدد |
| --- | --- | --- |
| حيل الحيوانات | fab3-fact-001 — fab3-fact-010 | 10 |
| عجائب النباتات | fab3-fact-011 — fab3-fact-020 | 10 |
| أسرار البحر | fab3-fact-021 — fab3-fact-030 | 10 |
| غرائب الفضاء | fab3-fact-031 — fab3-fact-040 | 10 |
| اختراعات غير متوقعة | fab3-fact-041 — fab3-fact-050 | 10 |
| عالم الألعاب | fab3-fact-051 — fab3-fact-060 | 10 |
| قصص المتاحف | fab3-fact-061 — fab3-fact-070 | 10 |
| طعام ومائدة | fab3-fact-071 — fab3-fact-080 | 10 |
| فنون وحكايات | fab3-fact-081 — fab3-fact-090 | 10 |
| طرائف الأماكن | fab3-fact-091 — fab3-fact-100 | 10 |

## فهرس الحقائق والمراجع

المراجع هنا هي ذاتها الموجودة داخل كل سؤال. استخدام نفس صفحة كيو مرتين يعود إلى حقيقتين مستقلتين عن الكاكاو (مكان الأزهار واستخدام البذور عملة)، وحقيقتين مستقلتين عن التوابل (البسباسة والقرفة).

| المعرف | الإجابة | المصدر |
| --- | --- | --- |
| fab3-fact-001 | مكعبات | [Studying Wombats' Cubic Poop](https://qbios.gatech.edu/node/312) |
| fab3-fact-002 | الأزرق | [Satin Bowerbird](https://australian.museum/learn/animals/birds/satin-bowerbird/) |
| fab3-fact-003 | الحديد | [Beaver](https://nationalzoo.si.edu/animals/beaver) |
| fab3-fact-004 | كرات خشبية | [First-ever study shows bumble bees ‘play’](https://www.qmul.ac.uk/news/latest-news/2022/se/first-ever-study-shows-bumble-bees-play.html) |
| fab3-fact-005 | ثمار البلوط | [Acorn Woodpecker Overview](https://www.allaboutbirds.org/guide/Acorn_Woodpecker/overview) |
| fab3-fact-006 | درب التبانة | [How do dung beetles' diets keep the world clean?](https://www.nhm.ac.uk/discover/how-dung-beetles-keep-the-world-clean.html) |
| fab3-fact-007 | النظارات الشمسية | [Meerkat](https://nationalzoo.si.edu/animals/meerkat) |
| fab3-fact-008 | الأزرق | [Opinion: How reindeer eyes transform in winter to give them twilight vision](https://www.ucl.ac.uk/news/2022/jul/opinion-how-reindeer-eyes-transform-winter-give-them-twilight-vision) |
| fab3-fact-009 | كهربائية | [Platypus](https://australian.museum/learn/animals/mammals/platypus/) |
| fab3-fact-010 | حليب الحوصلة | [Practical Tips for Anyone Currently Raising Nine Flamingo Chicks at the Same Time](https://www.nationalzoo.si.edu/animals/news/practical-tips-anyone-currently-raising-nine-flamingo-chicks-same-time) |
| fab3-fact-011 | لحم متعفن | [Titan arum](https://www.kew.org/plants/titan-arum) |
| fab3-fact-012 | تطوي أوراقها | [Mimosa L. — Plants of the World Online](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A30001613-2/general-information) |
| fab3-fact-013 | 2 | [Welwitschia mirabilis](https://www.kew.org/plants/welwitschia-mirabilis) |
| fab3-fact-014 | سائل مضغوط | [Squirting cucumber](https://www.kew.org/plants/squirting-cucumber) |
| fab3-fact-015 | أنثى نحلة | [Sneaky orchids and their pollination tricks](https://www.kew.org/read-and-watch/orchid-pollination-tricks) |
| fab3-fact-016 | الجذع | [Cacao tree](https://www.kew.org/plants/cacao-tree) |
| fab3-fact-017 | فضلاتها | [In Pictures: Poo-loving plants](https://www.kew.org/read-and-watch/poo-plants) |
| fab3-fact-018 | مكنسة كهربائية | [Dive into aquatic life](https://www.kew.org/read-and-watch/dive-into-aquatic-plant-life) |
| fab3-fact-019 | نبات آخر | [Rafflesia arnoldi](https://www.kew.org/plants/rafflesia-arnoldi) |
| fab3-fact-020 | رائحة أزهارها | [Chocolate vine](https://www.kew.org/plants/chocolate-vine) |
| fab3-fact-021 | رمل أبيض | [How does sand form?](https://oceanservice.noaa.gov/facts/sand.html) |
| fab3-fact-022 | الهيموغلوبين | [The Arctic and The Antarctic](https://ocean.si.edu/ecosystems/poles/arctic-and-antarctic) |
| fab3-fact-023 | ذراعيه الأماميتين | [Sea otter](https://www.montereybayaquarium.org/animals-the-ocean/animals-a-to-z/sea-otter) |
| fab3-fact-024 | تعطس | [5 facts that make the marine iguana a master of adaptation](https://galapagosconservation.org.uk/marine-iguana-facts/) |
| fab3-fact-025 | أجسامها | [Happy Crabby Holidays](https://ocean.si.edu/ocean-life/invertebrates/happy-crabby-holidays) |
| fab3-fact-026 | نفثة ماء | [How This Fish Sharp Shoots Its Prey with Spit](https://www.si.edu/object/how-fish-sharp-shoots-its-prey-spit%3Ayt_A_yscU47ES0) |
| fab3-fact-027 | البخار | [Behold the Mantis Shrimp](https://www.si.edu/collections/snapshot/behold-mantis-shrimp) |
| fab3-fact-028 | البكتيريا | [The Deep Sea](https://ocean.si.edu/ecosystems/deep-sea/deep-sea) |
| fab3-fact-029 | خيار البحر | [Pearlfish from a Sea Cucumber](https://ocean.si.edu/ocean-life/fish/pearlfish-sea-cucumber) |
| fab3-fact-030 | معدتها | [Echinoderms: Sea Stars, Urchins, Sand Dollars, and Relatives](https://ocean.si.edu/ocean-life/invertebrates/sea-stars-urchins-and-relatives) |
| fab3-fact-031 | ليغو | [LEGO Figurines Aboard Juno](https://science.nasa.gov/photojournal/lego-figurines-aboard-juno/) |
| fab3-fact-032 | بذورها | [Moon Trees](https://www.nasa.gov/history/moon-trees/) |
| fab3-fact-033 | هارمونيكا | [Harmonica, Gemini 6](https://airandspace.si.edu/collection-objects/harmonica-gemini-6/nasm_A19670148000) |
| fab3-fact-034 | البارود | [Digging In: When Rovers Get Dirt on Mars - S4E11](https://www.nasa.gov/podcasts/on-a-mission/digging-in-when-rovers-get-dirt-on-mars-s4e11/) |
| fab3-fact-035 | فتات متطاير | [Food for Spaceflight — Educator Section](https://www.nasa.gov/wp-content/uploads/2012/02/146852main_food_for_spaceflight_educator.pdf) |
| fab3-fact-036 | الميثان | [Cassini Reveals Surprises with Titan’s Lakes](https://science.nasa.gov/missions/cassini/cassini-reveals-surprises-with-titans-lakes/) |
| fab3-fact-037 | ريشة | [The Apollo 15 Hammer-Feather Drop](https://science.nasa.gov/resource/the-apollo-15-hammer-feather-drop/) |
| fab3-fact-038 | أسطوانة مطلية بالذهب | [Golden Record Overview](https://science.nasa.gov/mission/voyager/voyager-golden-record-overview/) |
| fab3-fact-039 | الغولف | [Apollo 14 Demonstrated Spaceflight Challenges Are Solvable](https://www.nasa.gov/history/apollo-14-demonstrated-spaceflight-challenges-are-solvable/) |
| fab3-fact-040 | الإسبريسو | [Food on the International Space Station](https://www.nasa.gov/history/space-station-20th-food-on-iss/) |
| fab3-fact-041 | ورق الجدران | [Play-Doh](https://www.museumofplay.org/toys/play-doh/) |
| fab3-fact-042 | سلينكي | [Slinky](https://www.museumofplay.org/toys/slinky/) |
| fab3-fact-043 | مسدس ماء | [Meet Lonnie Johnson, the Man Behind the Super Soaker](https://invention.si.edu/invention-stories/meet-lonnie-johnson-man-behind-super-soaker) |
| fab3-fact-044 | غسل الصحون | [Josephine Garis Cochran](https://www.invent.org/inductees/josephine-garis-cochran) |
| fab3-fact-045 | دفتر ابنها المدرسي | [1908 — An ingenious invention](https://www.melitta-group.com/en/unternehmen/unsere-geschichte/1908) |
| fab3-fact-046 | ماسحة الزجاج | [Mary Anderson: The Unheralded Inventor of the Windshield Wiper](https://www.invent.org/blog/inventors/mary-anderson-windshield-wipers) |
| fab3-fact-047 | رقائق القصدير | [(ENG) Tinfoil Phonographs (310)](https://www.nps.gov/media/video/view.htm?id=B9DCD826-E87F-4798-87EE-10111AA0BF81) |
| fab3-fact-048 | خيط تنظيف الأسنان | [The Straight Truth About the Flexible Drinking Straw](https://invention.si.edu/invention-stories/straight-truth-about-flexible-drinking-straw) |
| fab3-fact-049 | قاع مسطح | [Margaret E. Knight](https://www.invent.org/inductees/margaret-e-knight) |
| fab3-fact-050 | الأذنان | [Chester Greenwood & Earmuffs](https://www.maine.gov/sos/maineatlas/explore-the-atlas/chester-greenwood-earmuffs) |
| fab3-fact-051 | أوراق لعب | [Revisit Nintendo’s roots with Hanafuda](https://www.nintendo.com/en-gb/News/2021/August/Revisit-Nintendo-s-roots-with-Hanafuda-2019412.html) |
| fab3-fact-052 | تفاوت الثروة | [Monopoly](https://www.museumofplay.org/toys/monopoly/) |
| fab3-fact-053 | مسحوق الألمنيوم | [Etch A Sketch](https://www.museumofplay.org/toys/etch-a-sketch/) |
| fab3-fact-054 | الزلازل | [Lincoln Logs](https://www.museumofplay.org/toys/lincoln-logs/) |
| fab3-fact-055 | حبة بطاطا حقيقية | [Why Stop at Potatoes?](https://www.museumofplay.org/blog/why-stop-at-potatoes/) |
| fab3-fact-056 | الأكل | [Pac-Man](https://www.museumofplay.org/games/pac-man/) |
| fab3-fact-057 | شراب الذرة | [Magic Slate, Stretch Armstrong, and Toys that Make You Go Hmmm…](https://www.museumofplay.org/blog/magic-slate-stretch-armstrong-and-toys-that-make-you-go-hmmm/) |
| fab3-fact-058 | عازف بيانو | [Clue](https://www.museumofplay.org/toys/clue/) |
| fab3-fact-059 | مصابيح كهربائية | [Easy-Bake Oven](https://www.museumofplay.org/toys/easy-bake-oven/) |
| fab3-fact-060 | المستشفى | [Play is the Best Medicine](https://www.museumofplay.org/blog/play-is-the-best-medicine/) |
| fab3-fact-061 | النحاس | [29 things you (probably) didn't know about the British Museum](https://www.britishmuseum.org/blog/29-things-you-probably-didnt-know-about-british-museum) |
| fab3-fact-062 | درعه | [Redisplay of the Lewis chess pieces allows them to be seen in full for the first time](https://media.nms.ac.uk/news/redisplay-of-the-lewis-chess-pieces-allows-them-to-be-seen-in-full-for-the-first-time) |
| fab3-fact-063 | سلسلة | [Chained Library](https://www.herefordcathedral.org/chained-library) |
| fab3-fact-064 | أعمال الزراعة | [shabti — British Museum, EA65206](https://www.britishmuseum.org/collection/object/Y_EA65206) |
| fab3-fact-065 | ملابس داخلية | [writing-tablet — British Museum, 1980,0303.35](https://www.britishmuseum.org/collection/object/H_1980-0303-35) |
| fab3-fact-066 | أغطية أجنحة الخنافس | [Fashion highlights in our collections](https://www.nationaltrust.org.uk/discover/history/art-collections/revealing-the-national-trusts-fashion-treasures) |
| fab3-fact-067 | يمر الضوء خلاله | [Large print guide — Room 41: Sutton Hoo and Europe](https://www.britishmuseum.org/sites/default/files/2021-05/large_print_guide_room_41.pdf) |
| fab3-fact-068 | أرنب رابض | [Helmet in the Shape of a Crouching Rabbit](https://www.metmuseum.org/art/collection/search/22098) |
| fab3-fact-069 | تماسيح صغيرة محنطة | [animal mummy — British Museum, EA38562](https://www.britishmuseum.org/collection/object/Y_EA38562) |
| fab3-fact-070 | 12 | [The mysterious dodecahedra of the Roman Empire](https://www.english-heritage.org.uk/visit/places/corbridge-roman-town-hadrians-wall/dodecahedron-exhibition/) |
| fab3-fact-071 | جوزة الطيب | [A spice sensation in oils at the Marianne North Gallery](https://www.kew.org/read-and-watch/marianne-north-gallery-a-spice-sensation) |
| fab3-fact-072 | لحاء شجرة | [A spice sensation in oils at the Marianne North Gallery](https://www.kew.org/read-and-watch/marianne-north-gallery-a-spice-sensation) |
| fab3-fact-073 | براعم أزهار | [Capparaceae Juss. — Plants of the World Online](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A30001562-2/general-information) |
| fab3-fact-074 | نقود | [Cacao tree](https://www.kew.org/plants/cacao-tree) |
| fab3-fact-075 | ثمار نبات واحد | [Christmas spice makes all things nice](https://www.kew.org/read-and-watch/christmas-spices) |
| fab3-fact-076 | التمبورا | [Our Founder — NISSIN FOODS GROUP](https://www.nissin.com/en_jp/about/founder/) |
| fab3-fact-077 | السباغيتي | [Italian Food in Britain — BBC](https://downloads.bbc.co.uk/china/assets/pdf/bbc_italian_food_in_britain.pdf) |
| fab3-fact-078 | شطيرة لحم بقري مملح | [Contraband Corned Beef and the Early Days of Space Biology: the Gemini III Mission](https://www.nasa.gov/centers-and-facilities/ames/contraband-corned-beef-and-the-early-days-of-space-biology-the-gemini-iii-mission/) |
| fab3-fact-079 | الفطر | [Is Mrs Beeton Relevant to Modern Families?](https://www.english-heritage.org.uk/visit/inspire-me/blog/blog-posts/is-mrs-beeton-relevant-to-modern-families/) |
| fab3-fact-080 | العلكة | [Manilkara zapota (L.) P.Royen — Plants of the World Online](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A152641-2/general-information) |
| fab3-fact-081 | دراجة هوائية | [Pablo Picasso. Bull’s Head. 1942](https://www.moma.org/audio/playlist/19/412) |
| fab3-fact-082 | صندوق كرتون | [Time Capsules](https://www.warhol.org/time-capsules/) |
| fab3-fact-083 | المقص | [Henri Matisse: The Cut-Outs](https://www.moma.org/interactives/exhibitions/2014/matisse/the-cut-outs.html) |
| fab3-fact-084 | محو الرسم | [Robert Rauschenberg, Erased de Kooning Drawing, 1953](https://www.sfmoma.org/artwork/98.298/) |
| fab3-fact-085 | يمتنع عن العزف | [There Will Never Be Silence: Scoring John Cage’s 4′33″](https://www.moma.org/calendar/exhibitions/1386) |
| fab3-fact-086 | ليس غليونًا | [The Treachery of Images (This is Not a Pipe)](https://collections.lacma.org/object/31931) |
| fab3-fact-087 | آلة كاتبة | [The Typewriter by Leroy Anderson](https://www.leroyanderson.com/news-about-leroy-anderson.php) |
| fab3-fact-088 | الفرو | [Meret Oppenheim. Object. Paris, 1936](https://www.moma.org/collection/works/80997) |
| fab3-fact-089 | مبولة | [Marcel Duchamp, Fountain, 1917/1964](https://www.sfmoma.org/artwork/98.291) |
| fab3-fact-090 | الكركند | [Lobster Telephone](https://www.nationalgalleries.org/art-and-artists/166050/lobster-telephone?page=0) |
| fab3-fact-091 | تحت الماء | [Post Cards: Under Water Postcards](https://vanuatupost.vu/index.php/component/virtuemart/post-cards/under-water-postcards-detail) |
| fab3-fact-092 | بنيًا مائلًا إلى الأحمر | [Painting and color of the Eiffel Tower](https://www.toureiffel.paris/en/the-monument/painting-eiffel-tower) |
| fab3-fact-093 | بذور المحاصيل | [Purpose, operations and organisation](https://www.seedvault.no/about/purpose-operations-and-organisation/) |
| fab3-fact-094 | تتفرع كالأشجار | [Sagrada Família columns: the geometry, mechanics and materials of a stone forest](https://blog.sagradafamilia.org/en/columns-sagrada-familia-geometry-mechanics-materials-stone-forest/) |
| fab3-fact-095 | الحديد | [Science on the Ice: The United States Antarctic Program](https://www.nsf.gov/geo/opp/documents/NSF%20Science%20on%20the%20Ice_fifth_edition.pdf) |
| fab3-fact-096 | يرقات ذباب | [Clifden area: Places to go in Southland](https://www.doc.govt.nz/parks-and-recreation/places-to-go/southland/places/clifden-area/?tab-id=Caving) |
| fab3-fact-097 | الحمم | [History of Giant's Causeway](https://www.nationaltrust.org.uk/visit/northern-ireland/giants-causeway/history-of-giants-causeway) |
| fab3-fact-098 | كربونات الكالسيوم | [Hierapolis-Pamukkale](https://whc.unesco.org/en/list/485) |
| fab3-fact-099 | مرآة | [A Salt Bath in Bolivia](https://science.nasa.gov/earth/earth-observatory/a-salt-bath-in-bolivia-149502/) |
| fab3-fact-100 | مجداف واحد | [Venezia, gondole — Bollettino Ufficiale Regione Veneto 5/2009, p. 1](https://bur.regione.veneto.it/BurvServices/pubblica/stampapdfburv.aspx?date=16/01/2009&num=5#page=1) |

## التحقق المنفذ في هذه المهمة

تحققت بنيويًا من عدد السجلات، وتسلسل المعرفات، وعدد الفئات، ووجود فراغ واحد، وطول الإجابة، وأربعة مشتتات مختلفة، وعدم تطابق المشتتات مع الإجابة أو مرادفاتها بعد تطبيع العربية. هذا فحص سلامة بيانات، وليس نتيجة اختبار للواجهة أو الخادم؛ اختبارات الدمج يديرها مسار التنفيذ الرئيسي.

لم تتغير ضمن هذه المهمة أي وسائط أو ملفات تشغيل أو اختبارات. ولم يحصل نشر أو دفع إلى GitHub.

## المراجعة النهائية المحدودة

قورنت الحقائق المئة دلاليًا مع الأسئلة الـ154 الموجودة في نسخة HEAD السابقة، لا مع المعرفات وحدها. لم تظهر إعادة لحقيقة قديمة بصياغة جديدة. يوجد تقاطع في بعض الكائنات والأغراض مع اختلاف المعلومة المقصودة: حليب الفلامنغو مقابل سبب لونه الوردي، أسطوانة فوياجر مقابل كونه أبعد مسبار، تمثال ليغو في جونو مقابل أصل اسم ليغو، استعمال الآلة الكاتبة في الأوركسترا مقابل ترتيب QWERTY، وعصارة شجرة العلكة مقابل أول منتج مسح بالباركود. كذلك لا تتكرر قصة عجينة تنظيف ورق الجدران مع قصة غلاف الفقاعات الذي صُمم ورقَ جدران؛ المنتج والغرض مختلفان.

أُعيدت مقابلة الأسئلة 008 و017 و036 و052 و058 و070 و085 و089 و092 و100 مع صفحات مصادرها الرسمية. دعمت المصادر الوقائع مع القيود المذكورة أعلاه. خُصص السؤال 100 بقوارب الغندول بدل تسمية القوارب الفينيسية العامة. وأعيدت صياغة 085 حول تعليمات المقطوعة، مع مشتتات موسيقية تخالف تلك التعليمات بدل سلوكيات عرض عارضة غير موثقة مثل فتح العينين أو خلع القفازين. بقيت دلالة غياب النغمات المقصودة مع وجود أصوات المحيط واضحة.

نُقحت مرادفات قليلة لتكون طبيعية وأقل التباسًا، مثل «آذان» و«ثمار نوع واحد من النباتات» و«ماكينة كتابة». أضيفت صيغ شائعة للفضلات وعدم المساواة في الثروة، ولم يتغير عدد الحقائق أو الفئات أو الإجابات الرقمية. لم تُشغل اختبارات تطبيق أو وسائط ضمن هذه المراجعة.

### تحسين رابطَي المصدر 079 و100

نُقل رابط 079 من نطاق production إلى الموقع العام لـEnglish Heritage مع بقاء السؤال كما هو. استُبدل رابط الأسئلة الشائعة القديم لبلدية البندقية، الذي تعذر الوصول المباشر إليه، بمصدر حكومي أولي متاح: العدد 5 لسنة 2009 من النشرة الرسمية لإقليم فينيتو، الصفحة الأولى، تحت عنوان «Venezia, gondole». يوضح النص مباشرة أن عدم التناظر يعاكس دفع المجداف الوحيد. المصدر أرشيفي وليس تقريرًا حديث النشر؛ وقد أمكن فتح ملفه وقراءة الفقرة مباشرة في هذه المراجعة. تغير إسناد الشرح إلى الإقليم ليتوافق مع الرابط الجديد، دون تغيير حقيقة السؤال أو إجابته.
