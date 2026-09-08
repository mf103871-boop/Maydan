// بنك أسئلة «بَديهة» — يُولَّده `npm run bank:sort` من ملفات هذا المجلد؛ لا يُحرَّر يدويًا.
// الترتيب هو ترتيب الفئات في شاشة الاختيار (حقل order في bank-status.json).
// صيغة الحزمة وأنواع الأسئلة في docs/bank/SCHEMA.md.

import pack_general from './general.json' with { type: 'json' };
import pack_geo from './geo.json' with { type: 'json' };
import pack_capitals from './capitals.json' with { type: 'json' };
import pack_science from './science.json' with { type: 'json' };
import pack_animals from './animals.json' with { type: 'json' };
import pack_history from './history.json' with { type: 'json' };
import pack_food from './food.json' with { type: 'json' };
import pack_fruitsveg from './fruitsveg.json' with { type: 'json' };
import pack_sports from './sports.json' with { type: 'json' };
import pack_football from './football.json' with { type: 'json' };
import pack_worldcup from './worldcup.json' with { type: 'json' };
import pack_tech from './tech.json' with { type: 'json' };
import pack_apps from './apps.json' with { type: 'json' };
import pack_brands from './brands.json' with { type: 'json' };
import pack_cars from './cars.json' with { type: 'json' };
import pack_shopping from './shopping.json' with { type: 'json' };
import pack_arabic from './arabic.json' with { type: 'json' };
import pack_proverbs from './proverbs.json' with { type: 'json' };
import pack_dialects from './dialects.json' with { type: 'json' };
import pack_arabliterature from './arabliterature.json' with { type: 'json' };
import pack_books from './books.json' with { type: 'json' };
import pack_arabmusic from './arabmusic.json' with { type: 'json' };
import pack_theater from './theater.json' with { type: 'json' };
import pack_quran from './quran.json' with { type: 'json' };
import pack_movies from './movies.json' with { type: 'json' };
import pack_actors from './actors.json' with { type: 'json' };
import pack_anime from './anime.json' with { type: 'json' };
import pack_naruto from './naruto.json' with { type: 'json' };
import pack_onepiece from './onepiece.json' with { type: 'json' };
import pack_dragonball from './dragonball.json' with { type: 'json' };
import pack_videogames from './videogames.json' with { type: 'json' };
import pack_puzzles from './puzzles.json' with { type: 'json' };
import pack_hidden from './hidden.json' with { type: 'json' };
import pack_beforeafter from './beforeafter.json' with { type: 'json' };
import pack_commonbond from './commonbond.json' with { type: 'json' };

export const CATS = [pack_general, pack_geo, pack_capitals, pack_science, pack_animals, pack_history, pack_food, pack_fruitsveg, pack_sports, pack_football, pack_worldcup, pack_tech, pack_apps, pack_brands, pack_cars, pack_shopping, pack_arabic, pack_proverbs, pack_dialects, pack_arabliterature, pack_books, pack_arabmusic, pack_theater, pack_quran, pack_movies, pack_actors, pack_anime, pack_naruto, pack_onepiece, pack_dragonball, pack_videogames, pack_puzzles, pack_hidden, pack_beforeafter, pack_commonbond];

export const CATEGORY_IDS = CATS.map((category) => category.id);
export const TOTAL_QUESTIONS = CATS.reduce((sum, category) => sum + category.qs.length, 0);
