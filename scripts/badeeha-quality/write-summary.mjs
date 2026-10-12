import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {BANK_CONTENT_VERSION} from '../../src/games/badeeha/logic.js';
const dir='docs/bank/quality-2026-10-08';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const audit=await read(`${dir}/review-all.json`),media=await read(`${dir}/media-manifest.json`),game=await read('.cache/badeeha-quality/game-check/results.json');
if(game.version!==BANK_CONTENT_VERSION||game.errors.length||game.checks.some(c=>!c.ok))throw Error('Final game check is missing or stale');
await mkdir(`${dir}/validation`,{recursive:true});
await copyFile('.cache/badeeha-quality/game-check/results.json',`${dir}/validation/game-check.json`);
const decisions={keep:'إبقاء',improve:'تحسين',replace:'استبدال',retier:'تعديل شريحة النقاط'};
const changed=audit.cards.filter(r=>r.decision!=='keep').length;
const text=`# تجديد بديهة — 12 أكتوبر 2026

تمت مراجعة 3120 بطاقة في 78 حزمة؛ عُدّلت${changed} بطاقة مع الاحتفاظ بالباقي. بقيت أسماء الحزم وموضوعاتها، و 40 سؤالًا لكل حزمة وثمانية لكل شريحة من 200 إلى 1000.

| القرار | عدد البطاقات |
|---|---:|
${Object.entries(audit.summary.decisions).map(([k,v])=>`| ${decisions[k]} | ${v} |`).join('\n')}

## المحتوى والصور

سجل [كل القرارات](review-all.json) يضم النص والجواب والوسيط قبل التعديل وبعده وسبب القرار. شملت المراجعة الأسئلة النصية والألغاز والإيموجي والبطة المخفية والصوت، وإزالة القرائن النصية التي تجعل الصورة زائدة، وتوسيع البدائل الصحيحة. حُلّت مسائل العدد والمنطق بشكل مستقل واختُبرت الشفرات والترتيب وقواعد التلميح؛ الأدلة في [mechanics-proofs.json](mechanics-proofs.json).

جُددت الأغلفة 78 بأساليب وألوان مخصصة لكل موضوع، وفُحصت الصور 400 المرتبطة بالأسئلة البصرية 360. صور الأعلام والأشخاص والسيارات والمعالم 160 صارت مراجع مرخّصة، مع قصوص تراعي الهاتف وإزالة أسماء كانت تكشف الحل. وثّقت المراجعة المستقلة تغييرات النقاط والقصوص في [زووم والتمويه](independent-root-image-review.md)، و[الظلال والتركيب](shape-review.md)، و[صور الهوية](identity-images.md). في «اكتشف الفرق» استُبدلت 45 صورة بعد مراجعة الأزواج الأربعين؛ [سجل الفروق](spotdiff-review.md) و[فحص التفاصيل بعد الضغط](postcompression-review.json). أُعيد فحص قطع التركيب الأربعين بعد ترحيل معرّفاتها في [المراجعة النهائية](independent-jumble-final-review.json). مقاطع الصوت 40 بقيت مطابقة ببصمتها للملفات المعتمدة سابقًا؛ لم تُنسب إليها جلسة استماع بشرية جديدة.

توجد مقارنة الأغلفة المصورة في [المعاينة 1](preview/covers-1.jpg)، [2](preview/covers-2.jpg)، [3](preview/covers-3.jpg)، [4](preview/covers-4.jpg). تُنشأ المعاينة التفاعلية المحمولة بأمر \`node scripts/badeeha-quality/preview.mjs\` في \`release/badeeha-quality-preview/index.html\`؛ تعرض كل البطاقات والأغلفة قبل/بعد، والمؤثرات والصور المكشوفة والمصادر والصوت. هي أداة مراجعة، وليست بديلًا عن تجربة المباراة.

الأغلفة محفوظة في \`public/media/badeeha-covers/\`، وصور الأسئلة في مجلد حزمها تحت \`media/\`. استُخدمت أداة OpenAI image generation المدمجة، وخطط التوليد والنصوص النهائية في [cover-plan.json](cover-plan.json) و[question-art-plan.json](question-art-plan.json) و[blur-art-plan.json](blur-art-plan.json) و[extra-root-art-plan.json](extra-root-art-plan.json) و[shape-art-plan.json](shape-art-plan.json)، مع سجلات الصور الفردية. المصادر المرخّصة وتعديلاتها موثقة في بيانات كل وسيط. متغيرات الصور المرفوضة لا تُعدّ أصولًا معتمدة.

## الترحيل والحماية

نسخة البنك الجديدة \`${BANK_CONTENT_VERSION}\`. خُصصت${audit.summary.retired} هوية جديدة للأسئلة المستبدلة أو المعاد تصنيفها وتغييرات اللغز التي تستلزم ذلك، وسُجل تقاعد القديمة في السجل القائم. [خريطة المعرفات](qid-mapping.json) تحفظ الصلة القديمة/الجديدة. أُصلحت أداة التقاعد لتكتب حقل \`qids\` الذي يقرأه المدقق، مع ترحيل السجل القديم \`ids\`.

لا تتغير قواعد المباراة أو أنواع الأسئلة. الجلسة القديمة تعرض إشعار تحديث المحتوى الموجود، وتبقى الحسابات والنتائج والإعدادات محفوظة. بصمات كل غلاف وصورة نهائية في [media-manifest.json](media-manifest.json): ${media.covers} غلافًا و${media.questionImages} صورة سؤال. إعادة تجهيز iPhone مطلوبة من هذا الفرع لأن تحديث الويب لا يبدّل موارد التطبيق المثبّت.

## النسخة القابلة للتجربة والتحقق

اجتاز اختبار المتصفح بالحجم 390×844 عدد${game.checks.length} تحققًا في الأوضاع العائلي والتحدّي والخبراء، يشمل حدود النقاط والكشف والتلميحات والصوت وحفظ الجولة واستئنافها وتخزين الصور واللعب دون اتصال. [النتائج](validation/game-check.json) توثّق السيناريوهات؛ لقطات قبل الكشف وبعده محفوظة محليًا في \`.cache/badeeha-quality/game-check/\`. اجتازت الاختبارات الآلية 670 اختبارًا واختبارات التوقيع الخمسة، وفحص البنك بلا أخطاء، وفحص الشفرة بلا أخطاء مع 34 تحذيرًا قائمًا. طابقت موارد iPhone جميع الأسئلة والصور وبصمات التخزين المؤقت. [سجل التحقق المحلي](validation/local-checks.json) و[فحص الموارد](validation/prepared-iphone-resources.json) يوثّقان النتائج. اجتاز ملف iPhone الموقّع نفسه فحص الهوية والموارد والبصمات: [البناء الموقّع](validation/signed-build.json)، [موارده](validation/signed-iphone-resources.json). الإصدار **1.6 (9)** متاح في TestFlight لمجموعة الاختبار الداخلية الحالية، وحالته لدى Apple \`VALID / IN_BETA_TESTING\`؛ [حالة الإتاحة](validation/testflight.json).

المراجعة التحريرية شملت كل بطاقة، أما إعادة التحقق من المصادر الخارجية فتُسجّل بدرجاتها لكل بطاقة؛ لم يُدّعَ أن كل حقيقة موروثة أعيد بحثها خارجيًا. المعاينة المحمولة اجتازت [الفحص الكامل](validation/preview.json)، ولقطات اللعبة نفسها خضعت [لمراجعة بصرية](validation/game-visual-review.json). تقديرات الصعوبة تحريرية، ولا تثبت الاختبارات التقنية متعة الأسئلة أو نسب حلها. التحقق بمتصفح بحجم الهاتف وبناء iPhone لا يغني عن تجربة TestFlight على جهاز حقيقي قبل الإصدار العام.

اجتاز فحص بدء التشغيل والعمل دون اتصال **23 تحققًا** لجميع الصور النشطة الـ510، بما فيها موارد الألعاب الأخرى. وُضعت صورة نشطة في حالة فشل متعمد، ثم جرى التأكد من حفظ الـ509 الأخرى وإعادة تنزيل الصورة الناقصة وحدها؛ [النتائج](validation/startup-images.json). إصلاح الاختبار يستمد اسم الطرف الثاني من بيانات الحزمة الحالية، بدل اسم صورة متقاعدة.

## إعادة الإنتاج

أدوات التأليف المبنية على \`e912acf\` هي سجل لهذه الجولة، فلا تُشغّل بعد الترحيل لأنها تستخدم المعرفات القديمة. سكربت التكامل يمنع تكرار تطبيق الترحيل. للفحص: \`npm run bank:validate\`، \`npm test\`، \`npm run lint\`، \`npm run ios:prepare\`، ثم \`node scripts/badeeha-quality/game-check.mjs\`. يلزم Playwright ومتصفح Chromium لفحص اللعبة والمعاينة.
`;
await writeFile(`${dir}/README.md`,text);
console.log(JSON.stringify({changed,retired:audit.summary.retired,checks:game.checks.length}));
