# مراجعة حزمة الأعلام — مسودة مصادر متوقفة

التاريخ: 2026-09-08.

## النتيجة وحدودها

- جُلبت **7 صور فعلية فقط** بصيغة WebP، مع **7 سجلات إسناد كاملة** في `media/flags/_sources.json`.
- الصور السبع روجعت بصريًا: اليابان، السعودية، مصر، الإمارات، الكويت، قطر، البحرين.
- مجموع أحجامها **23,948 بايت**، وأطول ضلع لكل منها 640 بكسل. كل صورة دون 30KB، وكل التراخيص المسجلة `Public Domain`.
- **لم يُنشأ ملف `src/data/categories/flags.json`**؛ لا توجد حزمة قابلة للعب ولا صور مفقودة محالة من الأسئلة.
- لم يُعدَّل `index.js` أو `bank-status.json`، ولم تُعلّم الفئة مكتملة.
- الجدول أدناه **خطة تحريرية من 240 مرشحًا**، لا 240 سؤالًا متحققًا منه. مواضيعها ودرجاتها تقدير أولي يحتاج مراجعة قبل الإدراج، ولم توضع `verified: true` على أي مرشح غير مكتمل.

## فحص القدرة والمسار المستخدم

نجح فحص كومنز للقراءة فقط عبر الأمر المقدم في المستودع:

```sh
node scripts/media-fetch.mjs flags "Flag of Japan" image --from "File:Flag of Japan.svg" --source commons --list --json
```

ثم نجح التنزيل والمعالجة عبر الأمر نفسه، مع `--qid` بدل `--list`. حُفظت الصور وأصول الإسناد بواسطة السكربت الأصلي دون تعديله. لم تُنشأ أعلام اصطناعية، ولم تُستخدم إيموجيات أو عناوين بعيدة بديلًا عن الملفات.

## سبب التوقف الدقيق

أثناء الإيقاف المتعمد للجلسة التسلسلية رقم `51455`، استعدادًا لتغيير تنظيم الدفعات، أعادت أداة الجلسة هذا التشخيص عند إرسال Ctrl-C:

> write_stdin failed: Unified exec process failed: network approval was cancelled before a decision was returned

لم يكن هناك رد HTTP بالمنع من كومنز قبل ذلك؛ هذا التشخيص ظهر في عملية إلغاء الجلسة نفسها. ومع ذلك، عومل إلغاء الموافقة كشرط توقف: **لم تُستأنف أي عمليات تنزيل بعده، ولم يُستخدم مسار شبكة بديل أو بيانات اعتماد مختلفة**. أظهر الفحص المحلي بعد الإلغاء عدم بقاء عملية تنزيل نشطة، ووجود الصور السبع مع سجلاتها كاملة.

## استئناف آمن لاحقًا

1. يلزم السماح باستئناف عملية التنزيل قبل إجراء أي جلب جديد.
2. راجع كل اسم ملف مرشح وترخيصه في المصدر نفسه؛ الرابط المقترح وحده ليس تحققًا من وجود الملف أو رخصته.
3. حافظ على المعرّفات والملفات السبعة المكتملة. المعرّفات الأخرى في الجدول مقترحة ولم تُنشر كأسئلة.
4. استخدم `media-fetch.mjs` كما هو لتحويل الصور وتسجيل الإسناد، مع تجنب الكتابة المتزامنة غير المنسّقة على `_sources.json`. أي تنظيم متوازٍ يجب أن يحفظ كل إيصال `--json` ويطابقه مع السجل النهائي.
5. راجع الصورة الفعلية، وحداثة الراية، ووضوح هوية الدولة أو الإقليم، ودقة المؤلف والعنوان، والميزانية؛ ثم فقط أنشئ السؤال وإسناده ووسمه `verified: true`.
6. لا تنقل أسماء دول قليلة الشهرة إلى درجات سهلة لملء العدد. نسب المعرفة في الدليل تحتاج تحكيمًا بشريًا، وهذه المسودة ليست دليلًا على بلوغها.
7. لا تنشر حزمة جزئية بوسائط مفقودة. استكمل 48 سؤالًا صالحًا لكل شريحة، ثم نفّذ تحقق البنك والاختبارات والبناء.

المراجع التنظيمية: [RUBRIC.md](RUBRIC.md)، [SCHEMA.md](SCHEMA.md)، [media/README.md](../../media/README.md).

## خطة المواضيع الأولية

تسعة مواضيع تصميمية فعلية: الأشرطة الأفقية، الأشرطة العمودية، النجوم، الأهلة، الصلبان، الدروع والتيجان، الشعارات والرموز، النباتات والحيوانات، الأشكال الهندسية. يُسند العلم إلى أبرز سمة مقصودة في السؤال؛ وجود سمات أخرى طبيعي. لا تُعد هذه الموازنة العددية بديلًا عن مراجعة الصعوبة.

| الشريحة | المرشحون | أكبر موضوع في الشريحة | الملفات المتاحة |
| --- | ---: | ---: | ---: |
| 200 | 48 | 9 | 7 |
| 400 | 48 | 12 | 0 |
| 600 | 48 | 10 | 0 |
| 800 | 48 | 12 | 0 |
| 1000 | 48 | 12 | 0 |

## قائمة الاستئناف

`محفوظ` يعني أن الصورة موجودة محليًا مع إيصال مصدر، وليس أن حزمة الأسئلة أُقفلت. `مرشح غير مجلوب` يعني أنه لا يجوز عرضه في اللعبة أو الادعاء بالتحقق من ترخيصه. أسماء الملفات وروابطها للمرشحين الباقين مقترحة وقد تحتاج تصحيح اسم أو اتباع تحويلة كومنز.

| المعرّف المقترح | الإجابة المقترحة | الموضوع الأولي | ملف كومنز | الحالة |
| --- | --- | --- | --- | --- |
| `flags-200-001` | اليابان | أشكال هندسية | [Japan](https://commons.wikimedia.org/wiki/File:Flag_of_Japan.svg) | محفوظ |
| `flags-200-002` | السعودية | شعارات ورموز | [Saudi Arabia](https://commons.wikimedia.org/wiki/File:Flag_of_Saudi_Arabia.svg) | محفوظ |
| `flags-200-003` | مصر | نباتات وحيوانات | [Egypt](https://commons.wikimedia.org/wiki/File:Flag_of_Egypt.svg) | محفوظ |
| `flags-200-004` | الإمارات | أشكال هندسية | [United Arab Emirates](https://commons.wikimedia.org/wiki/File:Flag_of_the_United_Arab_Emirates.svg) | محفوظ |
| `flags-200-005` | الكويت | أشكال هندسية | [Kuwait](https://commons.wikimedia.org/wiki/File:Flag_of_Kuwait.svg) | محفوظ |
| `flags-200-006` | قطر | أشكال هندسية | [Qatar](https://commons.wikimedia.org/wiki/File:Flag_of_Qatar.svg) | محفوظ |
| `flags-200-007` | البحرين | أشكال هندسية | [Bahrain](https://commons.wikimedia.org/wiki/File:Flag_of_Bahrain.svg) | محفوظ |
| `flags-200-008` | عمان | شعارات ورموز | [Oman](https://commons.wikimedia.org/wiki/File:Flag%20of%20Oman.svg) | مرشح غير مجلوب |
| `flags-200-009` | العراق | شعارات ورموز | [Iraq](https://commons.wikimedia.org/wiki/File:Flag%20of%20Iraq.svg) | مرشح غير مجلوب |
| `flags-200-010` | الأردن | نجوم | [Jordan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Jordan.svg) | مرشح غير مجلوب |
| `flags-200-011` | فلسطين | أشكال هندسية | [Palestine](https://commons.wikimedia.org/wiki/File:Flag%20of%20Palestine.svg) | مرشح غير مجلوب |
| `flags-200-012` | لبنان | نباتات وحيوانات | [Lebanon](https://commons.wikimedia.org/wiki/File:Flag%20of%20Lebanon.svg) | مرشح غير مجلوب |
| `flags-200-013` | سوريا | نجوم | [Syria](https://commons.wikimedia.org/wiki/File:Flag%20of%20Syria.svg) | مرشح غير مجلوب |
| `flags-200-014` | اليمن | أشرطة أفقية | [Yemen](https://commons.wikimedia.org/wiki/File:Flag%20of%20Yemen.svg) | مرشح غير مجلوب |
| `flags-200-015` | تونس | أهلة | [Tunisia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Tunisia.svg) | مرشح غير مجلوب |
| `flags-200-016` | الجزائر | أهلة | [Algeria](https://commons.wikimedia.org/wiki/File:Flag%20of%20Algeria.svg) | مرشح غير مجلوب |
| `flags-200-017` | المغرب | نجوم | [Morocco](https://commons.wikimedia.org/wiki/File:Flag%20of%20Morocco.svg) | مرشح غير مجلوب |
| `flags-200-018` | ليبيا | أهلة | [Libya](https://commons.wikimedia.org/wiki/File:Flag%20of%20Libya.svg) | مرشح غير مجلوب |
| `flags-200-019` | السودان | أشكال هندسية | [Sudan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Sudan.svg) | مرشح غير مجلوب |
| `flags-200-020` | تركيا | أهلة | [Turkey](https://commons.wikimedia.org/wiki/File:Flag%20of%20Turkey.svg) | مرشح غير مجلوب |
| `flags-200-021` | الولايات المتحدة | نجوم | [United States](https://commons.wikimedia.org/wiki/File:Flag%20of%20United%20States.svg) | مرشح غير مجلوب |
| `flags-200-022` | المملكة المتحدة | صلبان | [United Kingdom](https://commons.wikimedia.org/wiki/File:Flag%20of%20United%20Kingdom.svg) | مرشح غير مجلوب |
| `flags-200-023` | فرنسا | أشرطة عمودية | [France](https://commons.wikimedia.org/wiki/File:Flag%20of%20France.svg) | مرشح غير مجلوب |
| `flags-200-024` | ألمانيا | أشرطة أفقية | [Germany](https://commons.wikimedia.org/wiki/File:Flag%20of%20Germany.svg) | مرشح غير مجلوب |
| `flags-200-025` | إيطاليا | أشرطة عمودية | [Italy](https://commons.wikimedia.org/wiki/File:Flag%20of%20Italy.svg) | مرشح غير مجلوب |
| `flags-200-026` | إسبانيا | دروع وتيجان | [Spain](https://commons.wikimedia.org/wiki/File:Flag%20of%20Spain.svg) | مرشح غير مجلوب |
| `flags-200-027` | البرتغال | دروع وتيجان | [Portugal](https://commons.wikimedia.org/wiki/File:Flag%20of%20Portugal.svg) | مرشح غير مجلوب |
| `flags-200-028` | هولندا | أشرطة أفقية | [Netherlands](https://commons.wikimedia.org/wiki/File:Flag%20of%20Netherlands.svg) | مرشح غير مجلوب |
| `flags-200-029` | روسيا | أشرطة أفقية | [Russia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Russia.svg) | مرشح غير مجلوب |
| `flags-200-030` | أوكرانيا | أشرطة أفقية | [Ukraine](https://commons.wikimedia.org/wiki/File:Flag%20of%20Ukraine.svg) | مرشح غير مجلوب |
| `flags-200-031` | الصين | نجوم | [China](https://commons.wikimedia.org/wiki/File:Flag%20of%20China.svg) | مرشح غير مجلوب |
| `flags-200-032` | الهند | شعارات ورموز | [India](https://commons.wikimedia.org/wiki/File:Flag%20of%20India.svg) | مرشح غير مجلوب |
| `flags-200-033` | باكستان | أهلة | [Pakistan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Pakistan.svg) | مرشح غير مجلوب |
| `flags-200-034` | بنغلاديش | أشكال هندسية | [Bangladesh](https://commons.wikimedia.org/wiki/File:Flag%20of%20Bangladesh.svg) | مرشح غير مجلوب |
| `flags-200-035` | إيران | شعارات ورموز | [Iran](https://commons.wikimedia.org/wiki/File:Flag%20of%20Iran.svg) | مرشح غير مجلوب |
| `flags-200-036` | البرازيل | نجوم | [Brazil](https://commons.wikimedia.org/wiki/File:Flag%20of%20Brazil.svg) | مرشح غير مجلوب |
| `flags-200-037` | الأرجنتين | شعارات ورموز | [Argentina](https://commons.wikimedia.org/wiki/File:Flag%20of%20Argentina.svg) | مرشح غير مجلوب |
| `flags-200-038` | كندا | نباتات وحيوانات | [Canada](https://commons.wikimedia.org/wiki/File:Flag%20of%20Canada.svg) | مرشح غير مجلوب |
| `flags-200-039` | أستراليا | نجوم | [Australia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Australia.svg) | مرشح غير مجلوب |
| `flags-200-040` | نيوزيلندا | نجوم | [New Zealand](https://commons.wikimedia.org/wiki/File:Flag%20of%20New%20Zealand.svg) | مرشح غير مجلوب |
| `flags-200-041` | جنوب أفريقيا | أشكال هندسية | [South Africa](https://commons.wikimedia.org/wiki/File:Flag%20of%20South%20Africa.svg) | مرشح غير مجلوب |
| `flags-200-042` | كوريا الجنوبية | شعارات ورموز | [South Korea](https://commons.wikimedia.org/wiki/File:Flag%20of%20South%20Korea.svg) | مرشح غير مجلوب |
| `flags-200-043` | نيجيريا | أشرطة عمودية | [Nigeria](https://commons.wikimedia.org/wiki/File:Flag%20of%20Nigeria.svg) | مرشح غير مجلوب |
| `flags-200-044` | السنغال | نجوم | [Senegal](https://commons.wikimedia.org/wiki/File:Flag%20of%20Senegal.svg) | مرشح غير مجلوب |
| `flags-200-045` | سويسرا | صلبان | [Switzerland](https://commons.wikimedia.org/wiki/File:Flag%20of%20Switzerland.svg) | مرشح غير مجلوب |
| `flags-200-046` | اليونان | صلبان | [Greece](https://commons.wikimedia.org/wiki/File:Flag%20of%20Greece.svg) | مرشح غير مجلوب |
| `flags-200-047` | السويد | صلبان | [Sweden](https://commons.wikimedia.org/wiki/File:Flag%20of%20Sweden.svg) | مرشح غير مجلوب |
| `flags-200-048` | الدنمارك | صلبان | [Denmark](https://commons.wikimedia.org/wiki/File:Flag%20of%20Denmark.svg) | مرشح غير مجلوب |
| `flags-400-001` | النرويج | صلبان | [Norway](https://commons.wikimedia.org/wiki/File:Flag%20of%20Norway.svg) | مرشح غير مجلوب |
| `flags-400-002` | فنلندا | صلبان | [Finland](https://commons.wikimedia.org/wiki/File:Flag%20of%20Finland.svg) | مرشح غير مجلوب |
| `flags-400-003` | آيسلندا | صلبان | [Iceland](https://commons.wikimedia.org/wiki/File:Flag%20of%20Iceland.svg) | مرشح غير مجلوب |
| `flags-400-004` | أيرلندا | أشرطة عمودية | [Ireland](https://commons.wikimedia.org/wiki/File:Flag%20of%20Ireland.svg) | مرشح غير مجلوب |
| `flags-400-005` | بلجيكا | أشرطة عمودية | [Belgium](https://commons.wikimedia.org/wiki/File:Flag%20of%20Belgium.svg) | مرشح غير مجلوب |
| `flags-400-006` | النمسا | أشرطة أفقية | [Austria](https://commons.wikimedia.org/wiki/File:Flag%20of%20Austria.svg) | مرشح غير مجلوب |
| `flags-400-007` | بولندا | أشرطة أفقية | [Poland](https://commons.wikimedia.org/wiki/File:Flag%20of%20Poland.svg) | مرشح غير مجلوب |
| `flags-400-008` | التشيك | أشكال هندسية | [Czech Republic](https://commons.wikimedia.org/wiki/File:Flag%20of%20Czech%20Republic.svg) | مرشح غير مجلوب |
| `flags-400-009` | المجر | أشرطة أفقية | [Hungary](https://commons.wikimedia.org/wiki/File:Flag%20of%20Hungary.svg) | مرشح غير مجلوب |
| `flags-400-010` | رومانيا | أشرطة عمودية | [Romania](https://commons.wikimedia.org/wiki/File:Flag%20of%20Romania.svg) | مرشح غير مجلوب |
| `flags-400-011` | بلغاريا | أشرطة أفقية | [Bulgaria](https://commons.wikimedia.org/wiki/File:Flag%20of%20Bulgaria.svg) | مرشح غير مجلوب |
| `flags-400-012` | المكسيك | نباتات وحيوانات | [Mexico](https://commons.wikimedia.org/wiki/File:Flag%20of%20Mexico.svg) | مرشح غير مجلوب |
| `flags-400-013` | كولومبيا | أشرطة أفقية | [Colombia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Colombia.svg) | مرشح غير مجلوب |
| `flags-400-014` | تشيلي | نجوم | [Chile](https://commons.wikimedia.org/wiki/File:Flag%20of%20Chile.svg) | مرشح غير مجلوب |
| `flags-400-015` | بيرو | أشرطة عمودية | [Peru](https://commons.wikimedia.org/wiki/File:Flag%20of%20Peru.svg) | مرشح غير مجلوب |
| `flags-400-016` | فنزويلا | نجوم | [Venezuela](https://commons.wikimedia.org/wiki/File:Flag%20of%20Venezuela.svg) | مرشح غير مجلوب |
| `flags-400-017` | أوروغواي | شعارات ورموز | [Uruguay](https://commons.wikimedia.org/wiki/File:Flag%20of%20Uruguay.svg) | مرشح غير مجلوب |
| `flags-400-018` | الإكوادور | دروع وتيجان | [Ecuador](https://commons.wikimedia.org/wiki/File:Flag%20of%20Ecuador.svg) | مرشح غير مجلوب |
| `flags-400-019` | كرواتيا | دروع وتيجان | [Croatia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Croatia.svg) | مرشح غير مجلوب |
| `flags-400-020` | صربيا | دروع وتيجان | [Serbia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Serbia.svg) | مرشح غير مجلوب |
| `flags-400-021` | البوسنة والهرسك | نجوم | [Bosnia and Herzegovina](https://commons.wikimedia.org/wiki/File:Flag%20of%20Bosnia%20and%20Herzegovina.svg) | مرشح غير مجلوب |
| `flags-400-022` | ألبانيا | نباتات وحيوانات | [Albania](https://commons.wikimedia.org/wiki/File:Flag%20of%20Albania.svg) | مرشح غير مجلوب |
| `flags-400-023` | إندونيسيا | أشرطة أفقية | [Indonesia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Indonesia.svg) | مرشح غير مجلوب |
| `flags-400-024` | ماليزيا | أهلة | [Malaysia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Malaysia.svg) | مرشح غير مجلوب |
| `flags-400-025` | سنغافورة | أهلة | [Singapore](https://commons.wikimedia.org/wiki/File:Flag%20of%20Singapore.svg) | مرشح غير مجلوب |
| `flags-400-026` | تايلاند | أشرطة أفقية | [Thailand](https://commons.wikimedia.org/wiki/File:Flag%20of%20Thailand.svg) | مرشح غير مجلوب |
| `flags-400-027` | فيتنام | نجوم | [Vietnam](https://commons.wikimedia.org/wiki/File:Flag%20of%20Vietnam.svg) | مرشح غير مجلوب |
| `flags-400-028` | الفلبين | نجوم | [Philippines](https://commons.wikimedia.org/wiki/File:Flag%20of%20Philippines.svg) | مرشح غير مجلوب |
| `flags-400-029` | نيبال | أشكال هندسية | [Nepal](https://commons.wikimedia.org/wiki/File:Flag%20of%20Nepal.svg) | مرشح غير مجلوب |
| `flags-400-030` | سريلانكا | نباتات وحيوانات | [Sri Lanka](https://commons.wikimedia.org/wiki/File:Flag%20of%20Sri%20Lanka.svg) | مرشح غير مجلوب |
| `flags-400-031` | جامايكا | صلبان | [Jamaica](https://commons.wikimedia.org/wiki/File:Flag%20of%20Jamaica.svg) | مرشح غير مجلوب |
| `flags-400-032` | كوبا | نجوم | [Cuba](https://commons.wikimedia.org/wiki/File:Flag%20of%20Cuba.svg) | مرشح غير مجلوب |
| `flags-400-033` | كوستاريكا | أشرطة أفقية | [Costa Rica](https://commons.wikimedia.org/wiki/File:Flag%20of%20Costa%20Rica.svg) | مرشح غير مجلوب |
| `flags-400-034` | كينيا | دروع وتيجان | [Kenya](https://commons.wikimedia.org/wiki/File:Flag%20of%20Kenya.svg) | مرشح غير مجلوب |
| `flags-400-035` | غانا | نجوم | [Ghana](https://commons.wikimedia.org/wiki/File:Flag%20of%20Ghana.svg) | مرشح غير مجلوب |
| `flags-400-036` | الكاميرون | نجوم | [Cameroon](https://commons.wikimedia.org/wiki/File:Flag%20of%20Cameroon.svg) | مرشح غير مجلوب |
| `flags-400-037` | إثيوبيا | نجوم | [Ethiopia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Ethiopia.svg) | مرشح غير مجلوب |
| `flags-400-038` | الصومال | نجوم | [Somalia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Somalia.svg) | مرشح غير مجلوب |
| `flags-400-039` | موريتانيا | أهلة | [Mauritania](https://commons.wikimedia.org/wiki/File:Flag%20of%20Mauritania.svg) | مرشح غير مجلوب |
| `flags-400-040` | هايتي | دروع وتيجان | [Haiti](https://commons.wikimedia.org/wiki/File:Flag%20of%20Haiti.svg) | مرشح غير مجلوب |
| `flags-400-041` | جمهورية الدومينيكان | صلبان | [Dominican Republic](https://commons.wikimedia.org/wiki/File:Flag%20of%20Dominican%20Republic.svg) | مرشح غير مجلوب |
| `flags-400-042` | بورتوريكو | نجوم | [Puerto Rico](https://commons.wikimedia.org/wiki/File:Flag%20of%20Puerto%20Rico.svg) | مرشح غير مجلوب |
| `flags-400-043` | ويلز | نباتات وحيوانات | [Wales](https://commons.wikimedia.org/wiki/File:Flag%20of%20Wales.svg) | مرشح غير مجلوب |
| `flags-400-044` | اسكتلندا | صلبان | [Scotland](https://commons.wikimedia.org/wiki/File:Flag%20of%20Scotland.svg) | مرشح غير مجلوب |
| `flags-400-045` | إنجلترا | صلبان | [England](https://commons.wikimedia.org/wiki/File:Flag%20of%20England.svg) | مرشح غير مجلوب |
| `flags-400-046` | الاتحاد الأوروبي | نجوم | [Europe](https://commons.wikimedia.org/wiki/File:Flag%20of%20Europe.svg) | مرشح غير مجلوب |
| `flags-400-047` | هونغ كونغ | نباتات وحيوانات | [Hong Kong](https://commons.wikimedia.org/wiki/File:Flag%20of%20Hong%20Kong.svg) | مرشح غير مجلوب |
| `flags-400-048` | كازاخستان | شعارات ورموز | [Kazakhstan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Kazakhstan.svg) | مرشح غير مجلوب |
| `flags-600-001` | أذربيجان | أهلة | [Azerbaijan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Azerbaijan.svg) | مرشح غير مجلوب |
| `flags-600-002` | أوزبكستان | أهلة | [Uzbekistan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Uzbekistan.svg) | مرشح غير مجلوب |
| `flags-600-003` | تركمانستان | أهلة | [Turkmenistan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Turkmenistan.svg) | مرشح غير مجلوب |
| `flags-600-004` | طاجيكستان | دروع وتيجان | [Tajikistan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Tajikistan.svg) | مرشح غير مجلوب |
| `flags-600-005` | قيرغيزستان | شعارات ورموز | [Kyrgyzstan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Kyrgyzstan.svg) | مرشح غير مجلوب |
| `flags-600-006` | منغوليا | شعارات ورموز | [Mongolia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Mongolia.svg) | مرشح غير مجلوب |
| `flags-600-007` | كمبوديا | شعارات ورموز | [Cambodia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Cambodia.svg) | مرشح غير مجلوب |
| `flags-600-008` | لاوس | أشكال هندسية | [Laos](https://commons.wikimedia.org/wiki/File:Flag%20of%20Laos.svg) | مرشح غير مجلوب |
| `flags-600-009` | ميانمار | نجوم | [Myanmar](https://commons.wikimedia.org/wiki/File:Flag%20of%20Myanmar.svg) | مرشح غير مجلوب |
| `flags-600-010` | بروناي | شعارات ورموز | [Brunei](https://commons.wikimedia.org/wiki/File:Flag%20of%20Brunei.svg) | مرشح غير مجلوب |
| `flags-600-011` | تيمور الشرقية | نجوم | [East Timor](https://commons.wikimedia.org/wiki/File:Flag%20of%20East%20Timor.svg) | مرشح غير مجلوب |
| `flags-600-012` | المالديف | أهلة | [Maldives](https://commons.wikimedia.org/wiki/File:Flag%20of%20Maldives.svg) | مرشح غير مجلوب |
| `flags-600-013` | بوتان | نباتات وحيوانات | [Bhutan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Bhutan.svg) | مرشح غير مجلوب |
| `flags-600-014` | سيشل | أشكال هندسية | [Seychelles](https://commons.wikimedia.org/wiki/File:Flag%20of%20Seychelles.svg) | مرشح غير مجلوب |
| `flags-600-015` | موريشيوس | أشرطة أفقية | [Mauritius](https://commons.wikimedia.org/wiki/File:Flag%20of%20Mauritius.svg) | مرشح غير مجلوب |
| `flags-600-016` | مدغشقر | أشكال هندسية | [Madagascar](https://commons.wikimedia.org/wiki/File:Flag%20of%20Madagascar.svg) | مرشح غير مجلوب |
| `flags-600-017` | موزمبيق | شعارات ورموز | [Mozambique](https://commons.wikimedia.org/wiki/File:Flag%20of%20Mozambique.svg) | مرشح غير مجلوب |
| `flags-600-018` | زامبيا | نباتات وحيوانات | [Zambia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Zambia.svg) | مرشح غير مجلوب |
| `flags-600-019` | زيمبابوي | نباتات وحيوانات | [Zimbabwe](https://commons.wikimedia.org/wiki/File:Flag%20of%20Zimbabwe.svg) | مرشح غير مجلوب |
| `flags-600-020` | أوغندا | نباتات وحيوانات | [Uganda](https://commons.wikimedia.org/wiki/File:Flag%20of%20Uganda.svg) | مرشح غير مجلوب |
| `flags-600-021` | رواندا | شعارات ورموز | [Rwanda](https://commons.wikimedia.org/wiki/File:Flag%20of%20Rwanda.svg) | مرشح غير مجلوب |
| `flags-600-022` | بوروندي | نجوم | [Burundi](https://commons.wikimedia.org/wiki/File:Flag%20of%20Burundi.svg) | مرشح غير مجلوب |
| `flags-600-023` | جمهورية الكونغو الديمقراطية | نجوم | [Democratic Republic of the Congo](https://commons.wikimedia.org/wiki/File:Flag%20of%20Democratic%20Republic%20of%20the%20Congo.svg) | مرشح غير مجلوب |
| `flags-600-024` | جمهورية الكونغو | أشكال هندسية | [Republic of the Congo](https://commons.wikimedia.org/wiki/File:Flag%20of%20Republic%20of%20the%20Congo.svg) | مرشح غير مجلوب |
| `flags-600-025` | بوتسوانا | أشرطة أفقية | [Botswana](https://commons.wikimedia.org/wiki/File:Flag%20of%20Botswana.svg) | مرشح غير مجلوب |
| `flags-600-026` | ناميبيا | شعارات ورموز | [Namibia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Namibia.svg) | مرشح غير مجلوب |
| `flags-600-027` | أنغولا | شعارات ورموز | [Angola](https://commons.wikimedia.org/wiki/File:Flag%20of%20Angola.svg) | مرشح غير مجلوب |
| `flags-600-028` | مالطا | صلبان | [Malta](https://commons.wikimedia.org/wiki/File:Flag%20of%20Malta.svg) | مرشح غير مجلوب |
| `flags-600-029` | إستونيا | أشرطة أفقية | [Estonia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Estonia.svg) | مرشح غير مجلوب |
| `flags-600-030` | لاتفيا | أشرطة أفقية | [Latvia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Latvia.svg) | مرشح غير مجلوب |
| `flags-600-031` | ليتوانيا | أشرطة أفقية | [Lithuania](https://commons.wikimedia.org/wiki/File:Flag%20of%20Lithuania.svg) | مرشح غير مجلوب |
| `flags-600-032` | قبرص | نباتات وحيوانات | [Cyprus](https://commons.wikimedia.org/wiki/File:Flag%20of%20Cyprus.svg) | مرشح غير مجلوب |
| `flags-600-033` | مقدونيا الشمالية | شعارات ورموز | [North Macedonia](https://commons.wikimedia.org/wiki/File:Flag%20of%20North%20Macedonia.svg) | مرشح غير مجلوب |
| `flags-600-034` | الجبل الأسود | دروع وتيجان | [Montenegro](https://commons.wikimedia.org/wiki/File:Flag%20of%20Montenegro.svg) | مرشح غير مجلوب |
| `flags-600-035` | سلوفينيا | دروع وتيجان | [Slovenia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Slovenia.svg) | مرشح غير مجلوب |
| `flags-600-036` | سلوفاكيا | دروع وتيجان | [Slovakia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Slovakia.svg) | مرشح غير مجلوب |
| `flags-600-037` | أندورا | دروع وتيجان | [Andorra](https://commons.wikimedia.org/wiki/File:Flag%20of%20Andorra.svg) | مرشح غير مجلوب |
| `flags-600-038` | سان مارينو | دروع وتيجان | [San Marino](https://commons.wikimedia.org/wiki/File:Flag%20of%20San%20Marino.svg) | مرشح غير مجلوب |
| `flags-600-039` | الفاتيكان | شعارات ورموز | [Vatican City](https://commons.wikimedia.org/wiki/File:Flag%20of%20Vatican%20City.svg) | مرشح غير مجلوب |
| `flags-600-040` | الغابون | أشرطة أفقية | [Gabon](https://commons.wikimedia.org/wiki/File:Flag%20of%20Gabon.svg) | مرشح غير مجلوب |
| `flags-600-041` | غينيا | أشرطة عمودية | [Guinea](https://commons.wikimedia.org/wiki/File:Flag%20of%20Guinea.svg) | مرشح غير مجلوب |
| `flags-600-042` | مالي | أشرطة عمودية | [Mali](https://commons.wikimedia.org/wiki/File:Flag%20of%20Mali.svg) | مرشح غير مجلوب |
| `flags-600-043` | النيجر | أشكال هندسية | [Niger](https://commons.wikimedia.org/wiki/File:Flag%20of%20Niger.svg) | مرشح غير مجلوب |
| `flags-600-044` | بنين | أشكال هندسية | [Benin](https://commons.wikimedia.org/wiki/File:Flag%20of%20Benin.svg) | مرشح غير مجلوب |
| `flags-600-045` | توغو | نجوم | [Togo](https://commons.wikimedia.org/wiki/File:Flag%20of%20Togo.svg) | مرشح غير مجلوب |
| `flags-600-046` | غينيا بيساو | نجوم | [Guinea-Bissau](https://commons.wikimedia.org/wiki/File:Flag%20of%20Guinea-Bissau.svg) | مرشح غير مجلوب |
| `flags-600-047` | بوركينا فاسو | نجوم | [Burkina Faso](https://commons.wikimedia.org/wiki/File:Flag%20of%20Burkina%20Faso.svg) | مرشح غير مجلوب |
| `flags-600-048` | جيبوتي | نجوم | [Djibouti](https://commons.wikimedia.org/wiki/File:Flag%20of%20Djibouti.svg) | مرشح غير مجلوب |
| `flags-800-001` | بليز | دروع وتيجان | [Belize](https://commons.wikimedia.org/wiki/File:Flag%20of%20Belize.svg) | مرشح غير مجلوب |
| `flags-800-002` | بوليفيا | دروع وتيجان | [Bolivia (state)](https://commons.wikimedia.org/wiki/File:Flag%20of%20Bolivia%20(state).svg) | مرشح غير مجلوب |
| `flags-800-003` | غيانا | أشكال هندسية | [Guyana](https://commons.wikimedia.org/wiki/File:Flag%20of%20Guyana.svg) | مرشح غير مجلوب |
| `flags-800-004` | سورينام | نجوم | [Suriname](https://commons.wikimedia.org/wiki/File:Flag%20of%20Suriname.svg) | مرشح غير مجلوب |
| `flags-800-005` | غرينادا | نباتات وحيوانات | [Grenada](https://commons.wikimedia.org/wiki/File:Flag%20of%20Grenada.svg) | مرشح غير مجلوب |
| `flags-800-006` | دومينيكا | نباتات وحيوانات | [Dominica](https://commons.wikimedia.org/wiki/File:Flag%20of%20Dominica.svg) | مرشح غير مجلوب |
| `flags-800-007` | سانت لوسيا | أشكال هندسية | [Saint Lucia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Saint%20Lucia.svg) | مرشح غير مجلوب |
| `flags-800-008` | سانت فينسنت والغرينادين | أشكال هندسية | [Saint Vincent and the Grenadines](https://commons.wikimedia.org/wiki/File:Flag%20of%20Saint%20Vincent%20and%20the%20Grenadines.svg) | مرشح غير مجلوب |
| `flags-800-009` | أنتيغوا وباربودا | شعارات ورموز | [Antigua and Barbuda](https://commons.wikimedia.org/wiki/File:Flag%20of%20Antigua%20and%20Barbuda.svg) | مرشح غير مجلوب |
| `flags-800-010` | سانت كيتس ونيفيس | نجوم | [Saint Kitts and Nevis](https://commons.wikimedia.org/wiki/File:Flag%20of%20Saint%20Kitts%20and%20Nevis.svg) | مرشح غير مجلوب |
| `flags-800-011` | الباهاما | أشكال هندسية | [Bahamas](https://commons.wikimedia.org/wiki/File:Flag%20of%20Bahamas.svg) | مرشح غير مجلوب |
| `flags-800-012` | ترينيداد وتوباغو | أشكال هندسية | [Trinidad and Tobago](https://commons.wikimedia.org/wiki/File:Flag%20of%20Trinidad%20and%20Tobago.svg) | مرشح غير مجلوب |
| `flags-800-013` | بربادوس | شعارات ورموز | [Barbados](https://commons.wikimedia.org/wiki/File:Flag%20of%20Barbados.svg) | مرشح غير مجلوب |
| `flags-800-014` | نيكاراغوا | دروع وتيجان | [Nicaragua](https://commons.wikimedia.org/wiki/File:Flag%20of%20Nicaragua.svg) | مرشح غير مجلوب |
| `flags-800-015` | هندوراس | نجوم | [Honduras](https://commons.wikimedia.org/wiki/File:Flag%20of%20Honduras.svg) | مرشح غير مجلوب |
| `flags-800-016` | السلفادور | دروع وتيجان | [El Salvador](https://commons.wikimedia.org/wiki/File:Flag%20of%20El%20Salvador.svg) | مرشح غير مجلوب |
| `flags-800-017` | غواتيمالا | نباتات وحيوانات | [Guatemala](https://commons.wikimedia.org/wiki/File:Flag%20of%20Guatemala.svg) | مرشح غير مجلوب |
| `flags-800-018` | بنما | نجوم | [Panama](https://commons.wikimedia.org/wiki/File:Flag%20of%20Panama.svg) | مرشح غير مجلوب |
| `flags-800-019` | الرأس الأخضر | نجوم | [Cape Verde](https://commons.wikimedia.org/wiki/File:Flag%20of%20Cape%20Verde.svg) | مرشح غير مجلوب |
| `flags-800-020` | ساو تومي وبرينسيب | نجوم | [São Tomé and Príncipe](https://commons.wikimedia.org/wiki/File:Flag%20of%20S%C3%A3o%20Tom%C3%A9%20and%20Pr%C3%ADncipe.svg) | مرشح غير مجلوب |
| `flags-800-021` | غينيا الاستوائية | دروع وتيجان | [Equatorial Guinea](https://commons.wikimedia.org/wiki/File:Flag%20of%20Equatorial%20Guinea.svg) | مرشح غير مجلوب |
| `flags-800-022` | جزر القمر | أهلة | [Comoros](https://commons.wikimedia.org/wiki/File:Flag%20of%20Comoros.svg) | مرشح غير مجلوب |
| `flags-800-023` | غامبيا | أشرطة أفقية | [Gambia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Gambia.svg) | مرشح غير مجلوب |
| `flags-800-024` | جمهورية أفريقيا الوسطى | نجوم | [Central African Republic](https://commons.wikimedia.org/wiki/File:Flag%20of%20Central%20African%20Republic.svg) | مرشح غير مجلوب |
| `flags-800-025` | إريتريا | نباتات وحيوانات | [Eritrea](https://commons.wikimedia.org/wiki/File:Flag%20of%20Eritrea.svg) | مرشح غير مجلوب |
| `flags-800-026` | مالاوي | شعارات ورموز | [Malawi](https://commons.wikimedia.org/wiki/File:Flag%20of%20Malawi.svg) | مرشح غير مجلوب |
| `flags-800-027` | ساموا | نجوم | [Samoa](https://commons.wikimedia.org/wiki/File:Flag%20of%20Samoa.svg) | مرشح غير مجلوب |
| `flags-800-028` | تونغا | صلبان | [Tonga](https://commons.wikimedia.org/wiki/File:Flag%20of%20Tonga.svg) | مرشح غير مجلوب |
| `flags-800-029` | فيجي | دروع وتيجان | [Fiji](https://commons.wikimedia.org/wiki/File:Flag%20of%20Fiji.svg) | مرشح غير مجلوب |
| `flags-800-030` | فانواتو | أشكال هندسية | [Vanuatu](https://commons.wikimedia.org/wiki/File:Flag%20of%20Vanuatu.svg) | مرشح غير مجلوب |
| `flags-800-031` | جزر سليمان | نجوم | [Solomon Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20Solomon%20Islands.svg) | مرشح غير مجلوب |
| `flags-800-032` | بابوا غينيا الجديدة | نباتات وحيوانات | [Papua New Guinea](https://commons.wikimedia.org/wiki/File:Flag%20of%20Papua%20New%20Guinea.svg) | مرشح غير مجلوب |
| `flags-800-033` | كيريباتي | نباتات وحيوانات | [Kiribati](https://commons.wikimedia.org/wiki/File:Flag%20of%20Kiribati.svg) | مرشح غير مجلوب |
| `flags-800-034` | توفالو | نجوم | [Tuvalu](https://commons.wikimedia.org/wiki/File:Flag%20of%20Tuvalu.svg) | مرشح غير مجلوب |
| `flags-800-035` | ناورو | نجوم | [Nauru](https://commons.wikimedia.org/wiki/File:Flag%20of%20Nauru.svg) | مرشح غير مجلوب |
| `flags-800-036` | بالاو | أشكال هندسية | [Palau](https://commons.wikimedia.org/wiki/File:Flag%20of%20Palau.svg) | مرشح غير مجلوب |
| `flags-800-037` | جزر مارشال | أشكال هندسية | [Marshall Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20Marshall%20Islands.svg) | مرشح غير مجلوب |
| `flags-800-038` | ميكرونيسيا | نجوم | [Federated States of Micronesia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Federated%20States%20of%20Micronesia.svg) | مرشح غير مجلوب |
| `flags-800-039` | غرينلاند | أشكال هندسية | [Greenland](https://commons.wikimedia.org/wiki/File:Flag%20of%20Greenland.svg) | مرشح غير مجلوب |
| `flags-800-040` | جزر فارو | صلبان | [Faroe Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20Faroe%20Islands.svg) | مرشح غير مجلوب |
| `flags-800-041` | جزيرة مان | شعارات ورموز | [Isle of Man](https://commons.wikimedia.org/wiki/File:Flag%20of%20Isle%20of%20Man.svg) | مرشح غير مجلوب |
| `flags-800-042` | جيرزي | صلبان | [Jersey](https://commons.wikimedia.org/wiki/File:Flag%20of%20Jersey.svg) | مرشح غير مجلوب |
| `flags-800-043` | غيرنزي | صلبان | [Guernsey](https://commons.wikimedia.org/wiki/File:Flag%20of%20Guernsey.svg) | مرشح غير مجلوب |
| `flags-800-044` | برمودا | دروع وتيجان | [Bermuda](https://commons.wikimedia.org/wiki/File:Flag%20of%20Bermuda.svg) | مرشح غير مجلوب |
| `flags-800-045` | جبل طارق | شعارات ورموز | [Gibraltar](https://commons.wikimedia.org/wiki/File:Flag%20of%20Gibraltar.svg) | مرشح غير مجلوب |
| `flags-800-046` | جزر فوكلاند | نباتات وحيوانات | [Falkland Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20Falkland%20Islands.svg) | مرشح غير مجلوب |
| `flags-800-047` | سيراليون | أشرطة أفقية | [Sierra Leone](https://commons.wikimedia.org/wiki/File:Flag%20of%20Sierra%20Leone.svg) | مرشح غير مجلوب |
| `flags-800-048` | إسواتيني | دروع وتيجان | [Eswatini](https://commons.wikimedia.org/wiki/File:Flag%20of%20Eswatini.svg) | مرشح غير مجلوب |
| `flags-1000-001` | جزر آلاند | صلبان | [Åland](https://commons.wikimedia.org/wiki/File:Flag%20of%20%C3%85land.svg) | مرشح غير مجلوب |
| `flags-1000-002` | أروبا | نجوم | [Aruba](https://commons.wikimedia.org/wiki/File:Flag%20of%20Aruba.svg) | مرشح غير مجلوب |
| `flags-1000-003` | كوراساو | نجوم | [Curaçao](https://commons.wikimedia.org/wiki/File:Flag%20of%20Cura%C3%A7ao.svg) | مرشح غير مجلوب |
| `flags-1000-004` | جزر كايمان | دروع وتيجان | [Cayman Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20Cayman%20Islands.svg) | مرشح غير مجلوب |
| `flags-1000-005` | جزر العذراء البريطانية | دروع وتيجان | [British Virgin Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20British%20Virgin%20Islands.svg) | مرشح غير مجلوب |
| `flags-1000-006` | جزر العذراء الأمريكية | نباتات وحيوانات | [United States Virgin Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20United%20States%20Virgin%20Islands.svg) | مرشح غير مجلوب |
| `flags-1000-007` | جزر توركس وكايكوس | دروع وتيجان | [Turks and Caicos Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20Turks%20and%20Caicos%20Islands.svg) | مرشح غير مجلوب |
| `flags-1000-008` | مونتسرات | دروع وتيجان | [Montserrat](https://commons.wikimedia.org/wiki/File:Flag%20of%20Montserrat.svg) | مرشح غير مجلوب |
| `flags-1000-009` | أنغويلا | نباتات وحيوانات | [Anguilla](https://commons.wikimedia.org/wiki/File:Flag%20of%20Anguilla.svg) | مرشح غير مجلوب |
| `flags-1000-010` | سانت هيلينا | نباتات وحيوانات | [Saint Helena](https://commons.wikimedia.org/wiki/File:Flag%20of%20Saint%20Helena.svg) | مرشح غير مجلوب |
| `flags-1000-011` | جزيرة أسينشين | نباتات وحيوانات | [Ascension Island](https://commons.wikimedia.org/wiki/File:Flag%20of%20Ascension%20Island.svg) | مرشح غير مجلوب |
| `flags-1000-012` | تريستان دا كونا | دروع وتيجان | [Tristan da Cunha](https://commons.wikimedia.org/wiki/File:Flag%20of%20Tristan%20da%20Cunha.svg) | مرشح غير مجلوب |
| `flags-1000-013` | جزر بيتكيرن | دروع وتيجان | [Pitcairn Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20Pitcairn%20Islands.svg) | مرشح غير مجلوب |
| `flags-1000-014` | توكيلاو | أشكال هندسية | [Tokelau](https://commons.wikimedia.org/wiki/File:Flag%20of%20Tokelau.svg) | مرشح غير مجلوب |
| `flags-1000-015` | واليس وفوتونا | صلبان | [Wallis and Futuna](https://commons.wikimedia.org/wiki/File:Flag%20of%20Wallis%20and%20Futuna.svg) | مرشح غير مجلوب |
| `flags-1000-016` | بولينيزيا الفرنسية | شعارات ورموز | [French Polynesia](https://commons.wikimedia.org/wiki/File:Flag%20of%20French%20Polynesia.svg) | مرشح غير مجلوب |
| `flags-1000-017` | جزيرة الكريسماس | نباتات وحيوانات | [Christmas Island](https://commons.wikimedia.org/wiki/File:Flag%20of%20Christmas%20Island.svg) | مرشح غير مجلوب |
| `flags-1000-018` | جزر كوكوس | أهلة | [Cocos (Keeling) Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20Cocos%20(Keeling)%20Islands.svg) | مرشح غير مجلوب |
| `flags-1000-019` | جزيرة نورفولك | نباتات وحيوانات | [Norfolk Island](https://commons.wikimedia.org/wiki/File:Flag%20of%20Norfolk%20Island.svg) | مرشح غير مجلوب |
| `flags-1000-020` | غوام | نباتات وحيوانات | [Guam](https://commons.wikimedia.org/wiki/File:Flag%20of%20Guam.svg) | مرشح غير مجلوب |
| `flags-1000-021` | جزر ماريانا الشمالية | نجوم | [Northern Mariana Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20Northern%20Mariana%20Islands.svg) | مرشح غير مجلوب |
| `flags-1000-022` | بونير | نجوم | [Bonaire](https://commons.wikimedia.org/wiki/File:Flag%20of%20Bonaire.svg) | مرشح غير مجلوب |
| `flags-1000-023` | سينت أوستاتيوس | نجوم | [Sint Eustatius](https://commons.wikimedia.org/wiki/File:Flag%20of%20Sint%20Eustatius.svg) | مرشح غير مجلوب |
| `flags-1000-024` | سابا | نجوم | [Saba](https://commons.wikimedia.org/wiki/File:Flag%20of%20Saba.svg) | مرشح غير مجلوب |
| `flags-1000-025` | سينت مارتن | دروع وتيجان | [Sint Maarten](https://commons.wikimedia.org/wiki/File:Flag%20of%20Sint%20Maarten.svg) | مرشح غير مجلوب |
| `flags-1000-026` | سان بيير وميكلون | دروع وتيجان | [Saint Pierre and Miquelon](https://commons.wikimedia.org/wiki/File:Flag%20of%20Saint%20Pierre%20and%20Miquelon.svg) | مرشح غير مجلوب |
| `flags-1000-027` | جورجيا الجنوبية وساندويتش الجنوبية | دروع وتيجان | [South Georgia and the South Sandwich Islands](https://commons.wikimedia.org/wiki/File:Flag%20of%20South%20Georgia%20and%20the%20South%20Sandwich%20Islands.svg) | مرشح غير مجلوب |
| `flags-1000-028` | ساموا الأمريكية | نباتات وحيوانات | [American Samoa](https://commons.wikimedia.org/wiki/File:Flag%20of%20American%20Samoa.svg) | مرشح غير مجلوب |
| `flags-1000-029` | كيبيك | صلبان | [Quebec](https://commons.wikimedia.org/wiki/File:Flag%20of%20Quebec.svg) | مرشح غير مجلوب |
| `flags-1000-030` | نونافوت | شعارات ورموز | [Nunavut](https://commons.wikimedia.org/wiki/File:Flag%20of%20Nunavut.svg) | مرشح غير مجلوب |
| `flags-1000-031` | يوكون | نباتات وحيوانات | [Yukon](https://commons.wikimedia.org/wiki/File:Flag%20of%20Yukon.svg) | مرشح غير مجلوب |
| `flags-1000-032` | كولومبيا البريطانية | شعارات ورموز | [British Columbia](https://commons.wikimedia.org/wiki/File:Flag%20of%20British%20Columbia.svg) | مرشح غير مجلوب |
| `flags-1000-033` | أونتاريو | دروع وتيجان | [Ontario](https://commons.wikimedia.org/wiki/File:Flag%20of%20Ontario.svg) | مرشح غير مجلوب |
| `flags-1000-034` | نوفا سكوشا | صلبان | [Nova Scotia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Nova%20Scotia.svg) | مرشح غير مجلوب |
| `flags-1000-035` | نيو برونزويك | دروع وتيجان | [New Brunswick](https://commons.wikimedia.org/wiki/File:Flag%20of%20New%20Brunswick.svg) | مرشح غير مجلوب |
| `flags-1000-036` | ساسكاتشوان | نباتات وحيوانات | [Saskatchewan](https://commons.wikimedia.org/wiki/File:Flag%20of%20Saskatchewan.svg) | مرشح غير مجلوب |
| `flags-1000-037` | نيوفاوندلاند ولابرادور | أشكال هندسية | [Newfoundland and Labrador](https://commons.wikimedia.org/wiki/File:Flag%20of%20Newfoundland%20and%20Labrador.svg) | مرشح غير مجلوب |
| `flags-1000-038` | ألبرتا | دروع وتيجان | [Alberta](https://commons.wikimedia.org/wiki/File:Flag%20of%20Alberta.svg) | مرشح غير مجلوب |
| `flags-1000-039` | بريتاني | شعارات ورموز | [Brittany](https://commons.wikimedia.org/wiki/File:Flag%20of%20Brittany.svg) | مرشح غير مجلوب |
| `flags-1000-040` | كورسيكا | شعارات ورموز | [Corsica](https://commons.wikimedia.org/wiki/File:Flag%20of%20Corsica.svg) | مرشح غير مجلوب |
| `flags-1000-041` | سردينيا | صلبان | [Sardinia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Sardinia.svg) | مرشح غير مجلوب |
| `flags-1000-042` | صقلية | شعارات ورموز | [Sicily](https://commons.wikimedia.org/wiki/File:Flag%20of%20Sicily.svg) | مرشح غير مجلوب |
| `flags-1000-043` | كتالونيا | أشرطة أفقية | [Catalonia](https://commons.wikimedia.org/wiki/File:Flag%20of%20Catalonia.svg) | مرشح غير مجلوب |
| `flags-1000-044` | إقليم الباسك | صلبان | [Basque Country](https://commons.wikimedia.org/wiki/File:Flag%20of%20Basque%20Country.svg) | مرشح غير مجلوب |
| `flags-1000-045` | بافاريا | أشكال هندسية | [Bavaria (lozengy)](https://commons.wikimedia.org/wiki/File:Flag%20of%20Bavaria%20(lozengy).svg) | مرشح غير مجلوب |
| `flags-1000-046` | أمستردام | شعارات ورموز | [Amsterdam](https://commons.wikimedia.org/wiki/File:Flag%20of%20Amsterdam.svg) | مرشح غير مجلوب |
| `flags-1000-047` | فريزلاند | نباتات وحيوانات | [Friesland](https://commons.wikimedia.org/wiki/File:Flag%20of%20Friesland.svg) | مرشح غير مجلوب |
| `flags-1000-048` | خرونينغن | صلبان | [Groningen (province)](https://commons.wikimedia.org/wiki/File:Flag%20of%20Groningen%20(province).svg) | مرشح غير مجلوب |

## ملاحظات تحتاج مراجعة عند الاستئناف

- علم الاتحاد الأوروبي مشترك بصريًا مع علم مجلس أوروبا؛ يلزم طلب الاتحاد تحديدًا بصياغة قصيرة لا تكشف الإجابة.
- المجموعة تتدرج من دول معروفة إلى أقاليم ومقاطعات ورايات محلية. لا توصف جميع الإجابات بأنها «دول».
- لا يُكتفى باسم المصدر لإثبات حداثة العلم أو كونه رسميًا؛ بعض الرايات المحلية شائعة وغير رسمية.
- وصفي `title` و`author` الخامّين في سجل الكويت يحتويان نصًا موروثًا من قالب كومنز؛ يُحفظ الإيصال كما جُلب، وتُراجع بيانات النسبة على صفحة المصدر قبل إنشاء الإسناد المعروض للمستخدم. لا يوجد ترخيص نسب إلزامي في الملفات السبعة، لكن الدقة التحريرية تظل مطلوبة.
- مسودة الجلب والمؤقتات خارج المستودع ليست لازمة لاستعادة العمل: الجدول وهذه الإيصالات هما نقطة الاستئناف المحفوظة.

## التحقق المحلي النهائي

- فحصت رؤوس الملفات الفعلية وقراءة `sharp.metadata()`: **7 ملفات WebP سليمة، 7 بصمات SHA-256 مختلفة، 7 إيصالات، صفر أخطاء**.
- طابقت أحجام الملفات وأبعادها مع الإيصالات، وتأكدت من الحقول الإلزامية، ومضيف المصدر، والترخيص المقبول، وميزانية كل صورة والفئة، وعدم وجود صورة بلا سجل.
- `npm run bank:validate -- flags` خرج بالرمز 0. **هذا لا يعني اكتمال الحزمة**: ملف الفئة غير موجود وحالتها لم تُغيّر، فلا يفحص الأمر 240 سؤالًا.
- `git diff --check -- src/data/categories/flags.json media/flags docs/bank/review-flags-new.md` خرج بالرمز 0.
- لم تُشغّل اختبارات أو بناء البنك كله في هذه الحزمة المتوقفة، كي لا تُنسب نتائج عمل الفئات المتزامن إليها.
