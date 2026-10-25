import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { CATS } from '../../src/data/categories/index.js';

export const REVIEW = 'docs/bank/quality-2026-10-08';
// One intentional composition per pack: the old single studio template is retired.
const directions = {
 general: ['editorial cut-paper collage', 'midnight blue, coral, golden yellow', 'An open circular portal joining an observatory, a tiny earth and branching human curiosity paths; layered paper, asymmetrical diagonal composition.'],
 geo: ['aerial landscape photography', 'deep ocean blue, jade green, terracotta', 'A broad river meanders between lush mountains into the ocean; oblique aerial view, morning mist, dramatic real landforms.'],
 capitals: ['architectural editorial illustration', 'indigo, warm amber, pale sky', 'A lively imaginary capital city seen across a river, domes and contemporary towers, atmospheric dusk and lit windows, no single real landmark.'],
 science: ['scientific editorial art', 'electric cyan, cobalt, luminous yellow', 'A prism splitting a beam of light above a deep blue laboratory workbench, precise glass refraction and an elegant orbital arc in the background.'],
 animals: ['wildlife photography', 'forest green, russet, soft golden light', 'A curious red fox in a fern forest, three-quarter environmental portrait, sunbeams and natural depth, no studio background.'],
 history: ['antique engraving with selective color', 'copper, burgundy, parchment', 'An ancient city gate and a winding route through layered centuries, engraved architectural detail with copper sun, no lettering or invented inscriptions.'],
 food: ['natural food photography', 'tomato red, olive green, charcoal', 'Overhead view of a freshly prepared colorful Mediterranean sharing table, one dominant earthenware dish, herbs and textured dark stone.'],
 fruitsveg: ['botanical watercolor', 'leaf green, blood orange, sky blue', 'Fresh produce growing in a sunlit garden bed, a cut pomegranate in foreground and leaves curving across the scene, painted paper texture.'],
 sports: ['dynamic editorial illustration', 'vermillion, cobalt, white', 'A running track curves through a stadium with a runner silhouette in motion, bold speed diagonals and cropped sporting equipment, human proportions correct.'],
 football: ['sports photography', 'pitch green, floodlight white, deep navy', 'A football on wet grass in the foreground beneath dramatic stadium floodlights, low camera viewpoint, distant goal and authentic turf.'],
 worldcup: ['celebratory painted poster art', 'gold, ultramarine, emerald', 'A football lifted into stadium light by several hands, worldwide celebration conveyed by colored ribbons, original trophy-free composition.'],
 ucl: ['cinematic sports scene', 'midnight navy, silver, icy blue', 'A silver original two-handled trophy silhouette at the edge of a luminous night stadium tunnel, dramatic converging lights, no official logos.'],
 premier: ['bold screen-print illustration', 'violet, lime green, black', 'Football boots and a rolling ball crossing an English-style rainy pitch, energetic low diagonal perspective and halftone texture.'],
 tech: ['precise isometric technical illustration', 'cyan, navy, mint', 'A small imaginary data city built from a computer chip, elegant illuminated pathways and layered translucent architecture, restrained clean geometry.'],
 apps: ['playful flat editorial illustration', 'coral, turquoise, royal blue', 'Several floating unbranded mobile windows and a phone in a bright spatial composition, abstract icons without lettering, rounded graphic geometry.'],
 brands: ['fashion editorial photography', 'black, crimson, brushed silver', 'An elegant shop window with an unbranded sculptural bottle, folded fabric and a box, hard sidelight and glossy reflections, no legible marks.'],
 cars: ['automotive editorial illustration', 'racing red, steel blue, asphalt grey', 'A generic classic sports car taking a sweeping mountain-road curve, three-quarter rear view, dynamic perspective, original unbranded design.'],
 shopping: ['paper-cut fashion illustration', 'magenta, peach, petrol blue', 'A bustling stylized market arcade with hanging fabrics and a shopping bag in foreground, layered cut-paper depth and rich textiles.'],
 arabic: ['expressive ink and paper illustration', 'deep burgundy, cream paper, copper', 'An angled reed pen drawing a single broad abstract ink flourish across textured paper, ink pooling naturally, no readable letters.'],
 proverbs: ['warm narrative watercolor', 'sienna, sage green, sunset gold', 'An inviting courtyard with empty woven chairs in a conversational circle beneath an old tree, suggestion of oral storytelling, no specific proverb scene.'],
 dialects: ['layered graphic illustration', 'teal, orange, plum', 'Three differently textured abstract speech shapes interweave like a flowing conversation over an urban map-like composition, no text or flags.'],
 arabliterature: ['woodcut editorial illustration', 'ink black, burnt orange, parchment', 'A manuscript opens into a richly patterned imaginary old city under a crescent moon, visible page texture, no words.'],
 books: ['cozy cinematic photography', 'forest green, amber, walnut brown', 'A reading nook beside a rain-covered window, a few blank-spined books and an open book seen from behind its pages, intimate light, no readable text.'],
 quotes: ['minimal conceptual illustration', 'cobalt, warm white, vermillion', 'An oversized pair of original curved quotation-like abstract shapes framing a beam of light, strong editorial composition, no actual words.'],
 arabcelebs: ['editorial portrait silhouettes', 'burgundy, gold, midnight blue', 'Several anonymous elegant human profiles against stage lights, adult proportions and distinct silhouettes, no identifiable celebrity face.'],
 youtubers: ['contemporary editorial illustration', 'tangerine, aqua, charcoal', 'A creator desk seen from a bold overhead angle with camera, ring light, headphones and blank monitor, lively purposeful composition, no platform logos.'],
 arabmusic: ['concert photography', 'wine red, brass gold, deep black', 'Close-up of an oud being played on a dark intimate stage, accurate strings and hands, amber rim light and distant blurred musicians.'],
 tarab: ['painterly vintage stage scene', 'indigo, amber, muted rose', 'A classic standing microphone beside an empty ornate concert chair, velvet curtain and atmospheric light, evocative mid-century Arabic music hall.'],
 arabart: ['expressive mixed-media painting', 'cobalt, coral, ochre', 'A vibrant original abstract canvas being painted with broad brush strokes, close texture and art studio light, no imitation of a named artwork.'],
 theater: ['dramatic theatrical photography', 'scarlet, black, warm gold', 'A partly opened crimson stage curtain reveals an empty spotlight circle and a wooden stage, sweeping composition and theatrical depth.'],
 ramadan: ['nighttime architectural illustration', 'indigo, lantern amber, turquoise', 'A peaceful neighborhood courtyard at blue hour with a glowing hanging lantern and arched doorways, no people or sacred text.'],
 islamiyat: ['geometric architectural illustration', 'emerald, sandstone, gold', 'Sunlight streams across a quiet Islamic geometric arcade, intricate but legible architectural rhythm, no calligraphy or human figures.'],
 quran: ['respectful still-life photography', 'deep green, warm gold, walnut', 'A closed unlettered dark-green book on a carved wooden stand in soft window light, dignified simple composition, no readable writing.'],
 seerah: ['historical landscape watercolor', 'sand gold, date-palm green, dawn blue', 'An empty historic Arabian desert route toward a distant mud-brick oasis settlement, peaceful dawn, no people, no invented sacred-site details.'],
 prophets: ['symbolic landscape painting', 'deep blue, golden light, earth brown', 'A mountain path opening toward a luminous distant horizon beyond water and desert, dignified abstract journey, no human or prophet depictions.'],
 arabseries: ['cinematic neighborhood scene', 'amber, teal shadows, clay red', 'A warmly lit fictional Arab neighborhood alley with patterned balconies and an open doorway, nighttime dramatic atmosphere, no actual series set.'],
 ramadanseries: ['cinematic interior scene', 'plum, golden amber, dark teal', 'A fictional family sitting room ready for evening viewing, a softly glowing blank television and lantern, layered human-scale environment with no people.'],
 babalhara: ['hand-painted historic street scene', 'stone beige, olive, deep turquoise', 'An evocative old Damascene-style courtyard gate with a brass knocker and climbing jasmine, watercolor light, original architecture.'],
 syriandrama: ['cinematic architectural photograph style', 'blue-grey, warm amber, walnut', 'Rain on a fictional old stone courtyard with an ornate wooden balcony, warm light from one window, emotionally rich empty scene.'],
 egyptdrama: ['gouache city illustration', 'terracotta, aqua, cream', 'A lively fictional Cairo-style street corner with balconies and laundry catching afternoon light, bold painterly textures, no text or logos.'],
 turkishdrama: ['cinematic waterfront scene', 'petrol blue, burgundy, warm pearl', 'An elegant fictional waterside mansion seen through rain on a window at dusk, dramatic depth and romantic color contrast, no identifiable filming location.'],
 ertugrul: ['historical adventure painting', 'pine green, leather brown, silver', 'A safely sheathed historical sword and worn leather shield near a nomadic tent at forest edge, dramatic dawn, no people or emblems.'],
 foreignseries: ['cinematic editorial illustration', 'electric blue, amber, deep violet', 'A rain-soaked fictional city crossroads viewed from a rooftop, luminous blank windows and a distant mysterious silhouette, restrained suspense.'],
 breakingbad: ['cinematic desert landscape', 'ochre, turquoise sky, deep olive', 'A distant generic recreational vehicle on an empty New Mexico-like desert road with long afternoon shadows and vast sky, no drugs or show logos.'],
 squidgame: ['graphic suspense illustration', 'pink, mint, charcoal', 'An impossible geometric staircase maze inside a colorful empty building, dramatic shadows and playful tension, no copied characters or logos.'],
 movies: ['cinematic photography', 'deep blue, projector gold, black', 'Light from a vintage film projector crosses a dark theater above empty seats, strong light beam diagonal and glowing dust motes.'],
 arabmovies: ['painted cinema poster style', 'burgundy, turquoise, warm gold', 'An old neighborhood cinema facade at twilight with blank poster frames and a luminous entrance, original hand-painted atmosphere, no letters.'],
 actors: ['backstage editorial photography', 'black, copper, muted cobalt', 'An empty actor dressing-room chair reflected in a mirror with warm bulbs, hanging jacket at frame edge, intimate cinematic composition, no faces.'],
 anime: ['original cel-shaded animation illustration', 'sky cyan, scarlet, golden yellow', 'A windswept hill above an imaginative colorful city, a small anonymous adventurer seen from behind, bold hand-drawn linework and dramatic clouds.'],
 naruto: ['original ink-and-cel illustration', 'orange, forest green, midnight blue', 'A forest training path with a safely stored throwing-tool pouch and a swirling leaf in foreground, energetic ink movement, no franchise marks or exact characters.'],
 onepiece: ['adventure watercolor animation', 'ocean turquoise, golden sand, coral', 'An original small pirate sailing ship navigating radiant islands, exaggerated playful waves, broad panorama, no exact franchise emblems.'],
 dragonball: ['energetic cel-shaded illustration', 'sunset orange, royal blue, lemon yellow', 'A rocky training plateau beneath dramatic streaked clouds and a glowing abstract energy arc, original martial-arts adventure environment, no exact characters.'],
 aot: ['dramatic ink-wash illustration', 'slate blue, forest green, warm grey', 'A colossal fictional fortified wall towers over tiny rooftops under storm clouds, epic perspective, no giants or graphic violence.'],
 deathnote: ['moody graphic illustration', 'black, crimson, cold white', 'A plain closed black notebook on a rain-lit windowsill with a red apple nearby, stark asymmetrical composition, no lettering or identifiable props from source artwork.'],
 demonslayer: ['original cel-shaded night landscape', 'wisteria violet, forest green, silver', 'A moonlit path through wisteria and bamboo with a safely sheathed sword in foreground, clean expressive illustration and drifting petals.'],
 jujutsu: ['original graphic action illustration', 'purple, cyan, black', 'An empty urban alley filled with abstract violet energy ribbons, bold perspective, no characters or symbols.'],
 hunterxhunter: ['adventure gouache illustration', 'leaf green, coral, gold', 'An original explorer compass and backpack at a forest trail branching toward distant mountains, vibrant hand-painted adventure scene.'],
 spacetoon: ['nostalgic 2D space illustration', 'cobalt, tangerine, star yellow', 'A friendly imaginary small spaceship arcs between colorful planets and stars, hand-painted television-animation warmth, no brand logo or characters.'],
 cartoon: ['playful hand-drawn illustration', 'turquoise, cherry red, sunny yellow', 'An original whimsical cartoon neighborhood with elastic curved rooftops and a winding street, clean bold outlines and lively scale.'],
 videogames: ['stylized game-world illustration', 'electric purple, lime, cobalt', 'A game controller in the foreground opens into a layered original platforming world, crisp graphic shapes, no interface text or recognizable game assets.'],
 puzzles: ['surreal editorial illustration', 'cobalt, coral, pale yellow', 'An elegant impossible-looking but coherent arrangement of interlocking wooden pathways and a single key, perspective puzzle atmosphere without a specific solvable card.'],
 emoji: ['playful sculptural paper collage', 'tangerine, violet, aqua', 'Original expressive round paper faces and abstract thought shapes interact across a bold diagonal composition, no existing emoji font rendering.'],
 hidden: ['detailed narrative illustration', 'pond green, duck gold, soft blue', 'A lush pond with reeds, rounded leaves and a small friendly duck partly hidden among them, readable cover composition, not a reused question grid.'],
 completeproverb: ['folk-inspired editorial illustration', 'terracotta, indigo, cream', 'A patterned storytelling rug whose woven motif continues into an unfinished corner, a visual metaphor for completing a story, no specific proverb or text.'],
 beforeafter: ['conceptual split-light illustration', 'dawn coral, midnight blue, gold', 'One winding pathway transitions from sunrise to starry night across a single coherent landscape, symbolic passage of time, no clocks with legible numbers.'],
 commonbond: ['clean conceptual paper illustration', 'mint, coral, dark blue', 'Three differently shaped paper islands connect to a single central bridge knot, abstract shared connection, no actual question answers.'],
 code: ['technical ink illustration', 'charcoal, emerald, brass', 'An original mechanical cipher wheel with abstract unlettered marks and interlocking gears under slanting light, no readable code or digits.'],
 hints: ['editorial detective scene', 'petrol blue, amber, brick red', 'A magnifying glass casts a circular light across three subtle footprints on a textured path, mysterious but inviting, no written clues.'],
 flags: ['editorial textile collage', 'navy, red, white, azure, yellow', 'Faithful Japanese white flag with one red circle, Swiss red square with upright white cross, and Ukrainian blue-over-yellow flag cloths around a stylized globe; no people or monuments.'],
 zoom: ['macro photography', 'charcoal, copper, forest green', 'An extreme macro of beautiful leaf veins and a curving magnifier rim, tactile natural detail, off-center composition, no complete identifiable question subject.'],
 blur: ['cinematic environmental photography', 'dark teal, amber, soft coral', 'A rain-speckled glass pane partly obscures a luminous street scene, one sharp droplet in foreground, atmospheric focus contrast, no question subject.'],
 reveal: ['editorial layered-paper portrait', 'burgundy, navy, soft peach', 'An anonymous fictional adult face partly concealed by sliding colorful paper panels, artful portrait with clear expression, not a real question identity.'],
 silhouette: ['layered paper-cut shadow illustration', 'night blue, silver, violet', 'Overlapping abstract sculptural silhouettes project intriguing shadows on a deep blue wall, one crescent of light, no reuse of a question object.'],
 guesscar: ['automotive photography', 'steel blue, racing red, asphalt', 'An anonymous original performance-car front corner emerging from a mountain tunnel, dramatic side light, no logo or identifiable real model.'],
 placefinder: ['architectural travel illustration', 'sandstone, sky blue, burnt orange', 'A winding path through an imaginary richly detailed hilltop town and a small map pin shape, warm travel-poster composition, not a real answer landmark.'],
 tilepuzzle: ['rich gouache illustration', 'olive green, coral, cream', 'A painted landscape breaks into a few floating rectangular puzzle tiles that align into a vibrant valley, clear large shapes, no real question image.'],
 spotdiff: ['isometric narrative illustration', 'turquoise, yellow, coral', 'Two playful miniature rooms side by side with a small deliberate decorative difference, original cover-only scene, lively coherent colors.'],
 sound: ['expressive editorial illustration', 'ultramarine, orange, gold', 'A brass gramophone horn releases abstract colorful sound ribbons into a night-blue atmosphere, tactile painterly texture, no notation or lettering.'],
};

await mkdir(`${REVIEW}/art-records`, { recursive: true });
await mkdir('.cache/badeeha-quality/before-covers', { recursive: true });
const covers = [];
for (const cat of CATS) {
  const direction = directions[cat.id];
  if (!direction) throw new Error(`Missing intentional direction: ${cat.id}`);
  const [style, palette, scene] = direction;
  const file = `public/media/badeeha-covers/${cat.id}.webp`;
  const before = `.cache/badeeha-quality/before-covers/${cat.id}.webp`;
  try { await readFile(before); } catch { await copyFile(file, before); }
  covers.push({ id: cat.id, name: cat.name, style, palette, scene, file,
    prompt: `Create ONE finished premium category-cover image for the Arabic social knowledge game Maydan, category '${cat.name}'. Landscape 4:3 artwork.\nMedium: ${style}.\nIntentional palette: ${palette}.\nScene: ${scene}\nMake this a distinctive complete environment or illustration, not an isolated object on an ivory studio background. Sophisticated, inviting art for ages 16+, strong readable composition at 160px width. Keep key features within the central 70% and leave the upper corners relatively quiet for game badges. Full-bleed image, no decorative border, no text, no typography, no watermark, no UI, no logos. Do not make a multi-image grid or contact sheet. The category name is rendered separately by the app.`,
    status: 'planned', target: { width: 640, height: 480, format: 'webp', maxBytes: 262144 } });
}
const file = path.join(REVIEW, 'cover-plan.json');
await writeFile(file, `${JSON.stringify({ version: 1, date: '2026-10-08', baselineCommit: 'e912acf', covers }, null, 2)}\n`);
console.log(`Prepared ${covers.length} distinct cover directions: ${file}`);
