// PRIVATE SERVER CONTENT. Never import from src/, a public manifest or an asset
// generator. New English concepts retain stable IDs; editorial review is still
// required before public release. Each selected category/tier supports 16 turns.
const rows = {
  animals: [
    'cat|dog|fish|bird|horse|cow|sheep|pig|duck|rabbit|lion|elephant|giraffe|snake|turtle|butterfly',
    'penguin|kangaroo|octopus|crocodile|dolphin|hedgehog|peacock|rhinoceros|jellyfish|flamingo|seahorse|chameleon|gorilla|walrus|squirrel|crab',
    'hermit crab|praying mantis|hammerhead shark|flying squirrel|sea urchin|anteater|platypus|swordfish|narwhal|armadillo|porcupine|woodpecker|toucan|stingray|orangutan|leaf insect',
  ],
  nature: [
    'sun|moon|star|cloud|rain|snow|tree|flower|leaf|mountain|river|rainbow|island|beach|volcano|cactus',
    'waterfall|tornado|lightning|iceberg|cave|coral reef|sand dune|pine cone|sunflower|mushroom|palm tree|snowflake|lily pad|waves|tree stump|hurricane',
    'solar eclipse|northern lights|geyser|stalactite|whirlpool|glacier|meteor shower|rock arch|mangrove|tidal pool|venus flytrap|fossil|avalanche|earthquake|double rainbow|river delta',
  ],
  food: [
    'apple|banana|orange|pear|grapes|watermelon|strawberry|carrot|pizza|hamburger|ice cream|bread|egg|cheese|cake|cookie',
    'pineapple|broccoli|croissant|pancakes|spaghetti|popcorn|taco|sushi|pretzel|sandwich|hot dog|cherries|pumpkin|avocado|coconut|cupcake',
    'artichoke|asparagus|dragon fruit|pomegranate|cinnamon roll|gingerbread house|stuffed pepper|fortune cookie|banana split|poached egg|candy apple|spring roll|waffle cone|cheese grater|chocolate fountain|fried calamari',
  ],
  home: [
    'chair|table|bed|door|window|lamp|sofa|clock|mirror|pillow|bathtub|toilet|key|spoon|fork|cup',
    'refrigerator|washing machine|vacuum cleaner|bookshelf|rocking chair|toaster|teapot|blender|watering can|broom|dustpan|coat hanger|chest of drawers|doorbell|fireplace|iron',
    'can opener|corkscrew|nutcracker|measuring tape|clothes peg|mousetrap|stapler|sewing machine|ironing board|dishwasher|radiator|attic ladder|ceiling fan|rolling pin|sink strainer|door knocker',
  ],
  places: [
    'house|school|hospital|castle|bridge|farm|zoo|park|shop|library|airport|tent|church|mosque|stadium|swimming pool',
    'lighthouse|windmill|train station|playground|cinema|bakery|fire station|harbor|treehouse|gas station|museum|aquarium|circus|skyscraper|market stall|campground',
    'observatory|greenhouse|amphitheater|water tower|drawbridge|subway station|roller coaster|ferris wheel|dam|quarry|maze|ski resort|space station|oil rig|covered bridge|construction site',
  ],
  jobs: [
    'doctor|teacher|chef|farmer|firefighter|police officer|dentist|singer|painter|dancer|pilot|astronaut|nurse|builder|photographer|hairdresser',
    'gardener|mechanic|plumber|carpenter|baker|librarian|lifeguard|mail carrier|fisherman|magician|vet|scientist|judge|bus driver|tailor|waiter',
    'archaeologist|conductor|beekeeper|puppeteer|glassblower|blacksmith|tightrope walker|scuba instructor|surgeon|window cleaner|chimney sweep|news reporter|lumberjack|juggler|dog groomer|potter',
  ],
  sports: [
    'football|basketball|tennis|swimming|running|cycling|skiing|boxing|bowling|golf|surfing|skating|baseball|volleyball|archery|table tennis',
    'ice hockey|badminton|fencing|horse riding|weightlifting|rock climbing|gymnastics|diving|sailing|snowboarding|wrestling|rugby|kayaking|javelin throw|high jump|hurdles',
    'pole vault|curling|synchronized swimming|water polo|bobsleigh|triple jump|discus throw|hammer throw|trampoline|windsurfing|kitesurfing|ski jumping|speed skating|long jump|sumo wrestling|relay race',
  ],
  transport: [
    'car|bus|train|plane|boat|bicycle|motorcycle|helicopter|truck|ambulance|fire engine|taxi|rocket|scooter|sailboat|tractor',
    'hot air balloon|submarine|tram|cable car|forklift|bulldozer|cement mixer|garbage truck|snowmobile|skateboard|wheelchair|rowboat|canoe|van|double decker bus|pickup truck',
    'hovercraft|rickshaw|horse carriage|steam locomotive|unicycle|tandem bicycle|segway|snowplow|amphibious vehicle|monorail|freight train|space shuttle|car ferry|rescue helicopter|tow truck|airport shuttle',
  ],
  technology: [
    'phone|computer|television|camera|headphones|keyboard|mouse|printer|radio|battery|light bulb|robot|microphone|speaker|tablet|remote control',
    'game controller|smartwatch|satellite dish|solar panel|drone|projector|USB stick|electric plug|charging cable|walkie talkie|webcam|barcode scanner|joystick|calculator|alarm clock|telescope',
    '3D printer|virtual reality headset|robotic arm|circuit board|fiber optic cable|microscope|wind turbine|server rack|motion sensor|fingerprint scanner|dashcam|portable charger|record player|typewriter|floppy disk|traffic camera',
  ],
  actions: [
    'jumping|sleeping|eating|drinking|crying|laughing|waving|clapping|reading|writing|cooking|drawing|singing|dancing|kicking|throwing',
    'brushing teeth|washing hands|tying shoelaces|flying a kite|blowing bubbles|planting a tree|walking a dog|skipping rope|catching a ball|washing dishes|making a bed|opening a present|building a snowman|rowing a boat|sweeping the floor|taking a photograph',
    'juggling three balls|balancing on one foot|threading a needle|folding a paper plane|changing a tire|milking a cow|carving a pumpkin|blowing out candles|sharpening a pencil|wrapping a gift|peeling an orange|hanging laundry|shuffling cards|squeezing a lemon|hammering a nail|rolling out dough',
  ],
  situations: [
    'birthday party|picnic|wedding|camping|fishing trip|rainy day|snowball fight|traffic jam|football match|school lesson|family dinner|beach holiday|shopping trip|movie night|bedtime|boat race',
    'missing the bus|getting a haircut|waiting in line|losing a tooth|breaking an umbrella|spilling a drink|finding a treasure|getting a flat tire|winning a trophy|walking in the rain|meeting a friend|feeding the ducks|moving house|building a sandcastle|visiting the dentist|learning to ride a bicycle',
    'escaping from a maze|rescuing a cat from a tree|getting stuck in an elevator|forgetting an umbrella|burning the toast|losing a suitcase|camping in a storm|chasing a runaway hat|getting locked out|stepping on wet paint|walking a tightrope|landing on the moon|discovering a dinosaur bone|crossing a rope bridge|repairing a leaking roof|watching a meteor shower',
  ],
  expressions: [
    'broken heart|thumbs up|thumbs down|happy face|sad face|angry face|surprised face|peace sign|fingers crossed|high five|heart of gold|time flies|big smile|sweet dreams|cold feet|rain or shine',
    'a piece of cake|raining cats and dogs|on top of the world|walking on air|a fish out of water|butterflies in the stomach|the early bird|a couch potato|a helping hand|light at the end of the tunnel|head in the clouds|a bright idea|a storm in a teacup|a needle in a haystack|a heart of stone|a night owl',
    'the elephant in the room|a wolf in sheep clothing|two peas in a pod|burning the candle at both ends|a rolling stone|the tip of the iceberg|a bull in a china shop|a drop in the ocean|putting all eggs in one basket|a bird in the hand|the ball is in your court|the apple of my eye|a skeleton in the closet|when pigs fly|a bridge too far|a silver lining',
  ],
};
const aliases = {
  football: ['soccer'], 'table tennis': ['ping pong', 'ping-pong'], plane: ['airplane', 'aeroplane'],
  'fire engine': ['fire truck'], 'gas station': ['petrol station'], 'trash can': ['rubbish bin'],
  'garbage truck': ['rubbish truck'], 'mail carrier': ['postman', 'postal worker'],
  'cotton candy': ['candy floss'], 'french fries': ['fries'], 'hot dog': ['hotdog'],
  television: ['TV'], refrigerator: ['fridge'], 'USB stick': ['flash drive'],
  'virtual reality headset': ['VR headset'], vet: ['veterinarian'],
  'double decker bus': ['double-decker bus'], '3D printer': ['three dimensional printer'],
  'a wolf in sheep clothing': ["a wolf in sheep's clothing", "wolf in sheep's clothing"],
};
export const ENGLISH_ERSOMHA_BANK = Object.freeze(Object.entries(rows).flatMap(([category, tiers]) =>
  tiers.flatMap((raw, tier) => raw.split('|').map((answer, index) => {
    const id = `ers-en-${category}-${tier + 1}-${String(index + 1).padStart(2, '0')}`;
    return Object.freeze({ id, conceptId: id, familyId: id, answer, aliases: Object.freeze(aliases[answer] || []),
      category, difficulty: ['easy', 'medium', 'hard'][tier], contentLocale: 'en',
      review: Object.freeze({ language: 'pending', drawability: 'pending', independent: 'pending' }) });
  }))));
