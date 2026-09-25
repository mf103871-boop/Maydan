'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const subjects = {
  general: ['كرة أرضية وعدسة ودماغ خزفي', 'One small terrestrial globe, one brass magnifying glass and one smooth white ceramic brain model, arranged as three clear objects.'],
  geo: ['كرة أرضية تضاريسية', 'One physical terrestrial globe with tactile continental relief, no borders, map labels or place names, on a small simple stand.'],
  capitals: ['مدينة مصغرة', 'One elegant miniature civic city block with three connected buildings of different heights, no recognizable real landmark, and a single small location pin in front.'],
  science: ['مجهر ودورق', 'One real laboratory microscope and one clear glass flask containing pale turquoise water.'],
  animals: ['أثر كف وريشة', 'One clean clay impression of a generic animal paw and one naturally curved feather, presented as natural history specimens.'],
  history: ['لفافة وساعة رملية', 'One rolled parchment tied with plain cord and one small bronze hourglass, no visible writing.'],
  food: ['قدر وملعقة', 'One small cream ceramic cooking pot with its lid slightly ajar and one wooden serving spoon, no identifiable plated dish.'],
  fruitsveg: ['فواكه وخضار في سلة', 'One small woven produce basket holding exactly one glossy red apple and one green leafy vegetable.'],
  sports: ['مضرب وكرة وميدالية', 'One wooden tennis racket, one plain tennis ball and one simple blank medal, arranged with clear separation.'],
  football: ['كرة وحذاء كرة قدم', 'One classic football beside one unbranded football boot, on a small clean patch of trimmed grass.'],
  worldcup: ['كرة ذهبية على قاعدة', 'One polished golden football mounted on a simple cup-like plinth, with a very small neutral stadium arc behind it; original trophy design.'],
  ucl: ['كأس فضي وملعب ليلي', 'One original silver trophy with two broad handles against a minimal dark blue stadium-light backdrop, no logos, stars pattern or engraved words.'],
  premier: ['كرة بنفسجية وتاج فضي', 'One deep purple football beside one small silver crown, with a narrow strip of lush football turf beneath.'],
  tech: ['حاسوب ورقاقة', 'One compact open unbranded laptop with a softly lit blank screen and one separate silicon computer chip.'],
  apps: ['هاتف وفقاعتا محادثة', 'One upright unbranded smartphone with a simple grid of blank colored app tiles, accompanied by two small physical speech-bubble tokens.'],
  brands: ['عبوة وبطاقة منتج', 'One immaculate blank product box, one plain cylindrical bottle and one hanging blank price tag; premium retail product photography.'],
  cars: ['مقود ومفتاح', 'One realistic unbranded car steering wheel and one simple modern car key on a clean tabletop.'],
  shopping: ['حقيبة ووشاح', 'One elegant unbranded shopping bag with one silk scarf draped over the edge and one small plain perfume bottle.'],
  arabic: ['قلم قصب وورقة', 'One traditional reed calligraphy pen beside one inkwell and one sheet with a single abstract flowing ink stroke, absolutely no letters or words.'],
  proverbs: ['مقعد حكايات وفنجان', 'One miniature wooden conversation bench and one small coffee cup, evoking shared oral wisdom without illustrating any proverb.'],
  dialects: ['ثلاث فقاعات حوار مادية', 'Three smooth physical speech-bubble objects in turquoise, violet and warm gold, facing each other in a conversational circle; no text or symbols.'],
  arabliterature: ['مخطوط مغلق وريشة', 'One closed deep violet clothbound manuscript with one feather quill and a small ink bottle, no spine text.'],
  books: ['ثلاثة كتب', 'Exactly three tactile unlettered hardcover novels stacked asymmetrically, one with a turquoise ribbon bookmark.'],
  quotes: ['ميكروفون وبطاقة كلام', 'One vintage tabletop microphone and one blank physical speech-bubble card leaning against its base.'],
  arabcelebs: ['كرسي وضوء مسرح', 'One empty elegant interview chair illuminated by one studio spotlight, with a small handheld microphone laid on the seat.'],
  youtubers: ['كاميرا وضوء دائري', 'One compact content-creator camera on a tabletop tripod in front of one ring light, no screens showing a person or interface.'],
  arabmusic: ['عود وميكروفون', 'One real oud and one modern vocal microphone, naturally proportioned, photographed as instruments rather than a cartoon icon.'],
  tarab: ['مذياع وأسطوانة', 'One tasteful vintage wooden radio and one black vinyl record, no labels or readable dial numbers.'],
  arabart: ['فرشاة ولوحة زخرفة', 'One artist brush beside one ceramic tile bearing an original turquoise geometric arabesque motif, with a tiny cup of paint.'],
  theater: ['ستارة وخشبة', 'One miniature theatre stage with parted deep purple velvet curtains and one empty wooden chair beneath a warm spotlight.'],
  ramadan: ['فانوس وهلال', 'One finely made brass Ramadan lantern and one simple crescent-shaped ornament, softly lit without generated lettering.'],
  islamiyat: ['قوس مسجد ومسبحة', 'One refined miniature mosque arch and one loosely coiled strand of prayer beads, photographed respectfully on clean ivory stone.'],
  quran: ['مصحف مغلق ورحل', 'One respectfully presented closed dark green Quran binding on a real carved wooden rehal stand; no readable generated scripture, words or pseudo-calligraphy.'],
  seerah: ['طريق صحراوي وقوس حجري', 'One tasteful physical miniature of an empty desert path leading through a simple stone gateway, with one date palm; no people and no attributed historical relic.'],
  prophets: ['لفافة ورمل', 'One closed parchment scroll on a subtle miniature sandy landscape with one distant mountain ridge; no people, faces, sacred depictions or story-specific miracle.'],
  arabseries: ['تلفاز وكنبة مصغرة', 'One compact television with a blank warm screen beside one miniature woven-fabric sofa, evoking Arabic evening drama viewing.'],
  ramadanseries: ['تلفاز وفانوس', 'One simple television with a blank violet screen beside one small brass Ramadan lantern.'],
  babalhara: ['باب حارة دمشقي', 'One miniature traditional Damascene wooden double doorway framed in alternating light and dark stone, with one modest wall lantern; no characters, insignia or plot-specific props.'],
  syriandrama: ['فناء شامي وكرسي', 'One miniature Syrian courtyard corner with patterned stonework, one wooden chair and one small jasmine pot; no identifiable filming location.'],
  egyptdrama: ['شرفة مصرية وكرسي', 'One miniature old Cairo-style apartment balcony with iron railing and one wooden chair, softly lit from a warm window; no real filming location.'],
  turkishdrama: ['نافذة وكأس شاي', 'One elegant small wooden window frame with a softly blurred waterfront atmosphere beyond, and one tulip-shaped Turkish tea glass.'],
  ertugrul: ['خيمة وأداة ترحال', 'One miniature historical nomadic tent with plain woven fabric and one rolled travelling blanket; no emblems, characters, weapons in action or story-specific insignia.'],
  foreignseries: ['جهاز عرض ومقعد', 'One compact modern film projector and one miniature cinema-style armchair, with a softly glowing blank projection area behind.'],
  breakingbad: ['قافلة ودورق فارغ', 'One small realistic beige recreational vehicle model and one empty laboratory flask, against a warm desert-toned studio background; no chemicals, characters, labels or plot reenactment.'],
  squidgame: ['باب ممر وردي ودرج', 'One physical miniature of a pastel pink corridor doorway with a short turquoise staircase, orderly and empty; no violence, costumes, numbers or challenge solution.'],
  movies: ['كاميرا وبكرة فيلم', 'One classic cinema camera and one metal film reel, clean black and warm brass materials.'],
  arabmovies: ['صندوق عرض سينمائي', 'One vintage portable film projector beside one small carved wooden cinema seat, warm amber light, no film posters.'],
  actors: ['كرسي ممثل وميكروفون', 'One empty director-style folding chair with a blank canvas back and one discreet boom microphone entering the scene; no people or names.'],
  anime: ['ورق رسوم وأقلام', 'One small fan of blank animation drawing sheets held by a peg bar and two colored pencils, with an original abstract ink swoosh rather than a recognizable character.'],
  naruto: ['سترة تدريب وعصابة محايدة', 'One folded orange-and-black ninja training jacket and one dark blue cloth headband with a blank matte metal plate; no village symbol, lettering, weapon or character face.'],
  onepiece: ['قبعة ومجسم سفينة', 'One natural woven straw hat and one small original wooden sailing ship model with plain cream sails, no skull flag or named character.'],
  dragonball: ['كرة كهرمانية وحزام تدريب', 'One translucent amber glass sphere with no stars or markings beside one neatly folded deep blue martial-arts belt, on warm orange cloth.'],
  aot: ['سور وباب معدني', 'One miniature tall weathered stone wall with a closed heavy gate and one rolled plain green cloak, no insignia, giants or scene reenactment.'],
  deathnote: ['دفتر أسود وريشة', 'One closed black unlettered notebook beside one simple black fountain pen and one pale feather, moody but clearly lit, no names, rules or character likeness.'],
  demonslayer: ['غمد وتكوين قماش', 'One safely sheathed Japanese-style sword beside one folded dark green patterned cloth, with one small wisteria sprig; no exact character costume, faces or blood.'],
  jujutsu: ['سترة داكنة وخيوط بنفسجية', 'One neatly folded dark navy high-collar school jacket with one small coil of violet cord; subtle atmospheric violet sidelight, no cursed body parts, character or symbols.'],
  hunterxhunter: ['حقيبة مغامرة وبوصلة', 'One compact green expedition backpack with one simple brass compass and one blank rectangular pass tucked under its strap; no letters, numbers or recognizable license design.'],
  spacetoon: ['كوكب وتلفاز صغير', 'One tactile miniature ringed planet hovering on a discreet stand beside one tiny retro television with a blank blue screen; no channel logo or cartoon character.'],
  cartoon: ['قلم وورقة حركة', 'One thick yellow drawing pencil, one curled sheet bearing an original non-character blue paint swoosh, and one small pink eraser.'],
  videogames: ['يد تحكم وشريط لعبة', 'One unbranded modern game controller beside one plain retro game cartridge, restrained turquoise and violet accents, no game logo.'],
  puzzles: ['قطعتا لغز خشبي', 'Two large interlocking wooden puzzle pieces hovering just apart on a tabletop, with one small smooth marble; no solved diagram or numbers.'],
  emoji: ['وجهان تعبيريّان ماديّان', 'Two polished yellow ceramic face tokens, one smiling and one surprised, beside one small empty speech-bubble token; simple familiar expressions, no encoded phrase.'],
  hidden: ['بطة خلف ورقتين', 'One small realistic yellow toy duck partly peeking from behind exactly two broad green leaves, an original cover composition unrelated to any search grid.'],
  completeproverb: ['شرائط ورق وفجوة', 'Three blank parchment strips arranged in one horizontal row with a conspicuous gap between them, with no words, letters or legible marks.'],
  beforeafter: ['ساعتان رمليتان', 'Two identical small hourglasses side by side, one with sand predominantly in its upper chamber and the other in its lower chamber; no dates or historical objects.'],
  commonbond: ['قطعتان وحبل مشترك', 'Two different small physical shapes, a wooden sphere and a ceramic cube, threaded together by one continuous turquoise cord.'],
  code: ['قفل وقرص شفرة مجرد', 'One small brass padlock and one mechanical cipher disk divided into blank segments with no letters, digits or decipherable sequence.'],
  hints: ['ثلاث بطاقات متدرجة', 'Three overlapping clue cards rising like steps, each with a simple uninformative embossed dot, and a soft pool of light revealing their edges; no text or recognizable target.'],
  flags: ['علمان خياليان', 'Two small fabric flags on tabletop poles using original turquoise, violet and warm gold geometric color blocks that match no real national flag.'],
  zoom: ['عدسة وتفصيل نسيج', 'One brass magnifying glass enlarging the weave of one neutral textured fabric patch, with crisp physically coherent magnification; no recognizable quiz object.'],
  blur: ['زجاج ضبابي وجسم مجرد', 'One small frosted glass panel with a clear circular patch in front of one simple turquoise ceramic form; show the shift from blur to clarity, not a recognizable quiz subject.'],
  reveal: ['تمثال تخيلي خلف بلاطات', 'One original anonymous sculptural head mostly concealed by a simple board of removable square ivory tiles, only a neutral cheek curve visible; no recognizable person or answer.'],
  silhouette: ['جسم مجرد ونصف ظل', 'One curved abstract ceramic object partly in a rich violet shadow, a thin rim of light revealing its outline and a few real surface details; not a known animal, landmark or quiz object.'],
  guesscar: ['سيارة عامة مغطاة جزئيًا', 'One original unbranded miniature sports coupe partly draped in ivory cloth, exposing one wheel and a smooth generic hood; no badge, identifiable production model or license plate.'],
  placefinder: ['خريطة ومؤشر موقع', 'One folded physical topographic map with invented terrain and no place names, and one turquoise location pin resting on it; no recognizable landmark.'],
  tilepuzzle: ['بلاطات صورة مجردة', 'Three thick square picture tiles arranged slightly out of alignment, containing fragments of an original abstract landscape of two color bands, without recognizable artwork.'],
  spotdiff: ['إطاران مع فرق زخرفي', 'Two matching small ivory frames containing the same simple blue ceramic vase, with one tiny gold dot ornament present in only one frame; original demonstration, not a production quiz image.'],
  sound: ['سماعات وموجة مادية', 'One pair of realistic over-ear headphones and one small sculptural turquoise sound-wave curve; no visible sound source or musical instrument to answer a question.'],
};
const common = 'Create one premium photorealistic editorial product photograph for an Arabic social trivia game category cover. Landscape 4:3 composition. Real believable materials and proportions; carefully crafted physical miniatures only where the subject requires architecture. Seamless warm ivory background (#FFF7E7), soft daylight from upper left, one restrained group accent color, gentle contact shadow, no busy scenery. One dominant subject with at most two supporting objects; large shapes remain legible at 150px wide. Center all important subject details in the middle 60%, leave generous breathing room and both top corners clear for UI badges. No text, letters, numbers, pseudo-writing, readable labels, watermarks, logos, framed app UI, pictograms, SVG-style graphics, emoji rendering, plastic cartoon gloss, collage, or unnecessary objects. Category title is added by the game UI. Use an original cover composition, never a screenshot, trivia question illustration or answer reveal.';
const groups = [
  [8,'معرفة وعالم','#087D89'],[13,'رياضة','#D7A12A'],[18,'تقنية وحياة','#159FAB'],
  [24,'لغة وأدب','#765080'],[30,'فن وموسيقى','#B67040'],[35,'معرفة دينية','#387C62'],
  [48,'دراما وسينما','#685079'],[60,'أنمي وكرتون وألعاب','#8A57AD'],[78,'ألغاز ووسائط','#159FAB'],
];
(async () => {
  const repo = 'C:/Users/user/Desktop/maydan';
  const { CATS } = await import(pathToFileURL(path.join(repo, 'src/data/categories/index.js')).href);
  if (CATS.length !== 78 || Object.keys(subjects).length !== 78) throw new Error('Expected exactly 78 cover briefs');
  const covers = CATS.map((category, index) => {
    const entry = subjects[category.id];
    if (!entry) throw new Error(`Missing brief: ${category.id}`);
    const [,group,accentColor] = groups.find(([last])=>index+1<=last);
    return { order:index+1, id:category.id, name:category.name, subject:entry[0], style:'product-mockup', group, accentColor, topics:[...new Set(category.qs.map(q=>q.topic).filter(Boolean))], path:`public/media/badeeha-covers/${category.id}.webp`, aspectRatio:'4:3', targetWidth:640, targetHeight:480, prompt:`${common}\nGroup accent: ${accentColor}, used sparingly without overriding natural object colors.\nSubject: ${entry[1]}`, status:'planned-not-generated' };
  });
  await fs.writeFile(path.join(__dirname, 'covers-plan.json'), JSON.stringify({version:1,createdAt:'2026-09-18',audience:'Arabic 16+',categoryCount:78,questionTarget:3120,scope:'All existing category names and all seasons; cover imagery only, no generated titles.',style:common,covers},null,2)+'\n','utf8');
  const rows = covers.map(c=>`| ${c.order} | \`${c.id}\` | ${c.name} | ${c.topics.slice(0,3).join('، ')} | ${c.subject} |`).join('\n');
  const auditPath=path.join(__dirname,'cover-audit.md');
  const audit=(await fs.readFile(auditPath,'utf8')).split('\n| # | المعرّف |')[0].replace('المنطقة الوسطى70%', 'المنطقة الوسطى60%');
  await fs.writeFile(auditPath, audit+'\n| # | المعرّف | الاسم الحالي المعتمد | أمثلة مواضيع فعلية | تكوين الغلاف |\n| --- | --- | --- | --- | --- |\n'+rows+'\n','utf8');
  console.log(`Prepared ${covers.length} original cover briefs; no images generated.`);
})().catch(error=>{console.error(error.message);process.exitCode=1});
