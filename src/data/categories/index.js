// بنك أسئلة «بَديهة» — 43 فئة. كل فئة ملف مستقل؛ الترتيب هنا هو ترتيب العرض.
// لا تُعدَّل هذه الملفات يدويًا إلا لإضافة أسئلة؛ الاختبارات تفرض الحد الأدنى لكل فئة.
import geo from './geo.json';
import caps from './caps.json';
import sci from './sci.json';
import body from './body.json';
import animals from './animals.json';
import foot from './foot.json';
import sports from './sports.json';
import hist from './hist.json';
import islam from './islam.json';
import food from './food.json';
import tech from './tech.json';
import games from './games.json';
import lang from './lang.json';
import space from './space.json';
import film from './film.json';
import math from './math.json';
import arab from './arab.json';
import invent from './invent.json';
import cars from './cars.json';
import nature from './nature.json';
import flags from './flags.json';
import lit from './lit.json';
import money from './money.json';
import art from './art.json';
import zoom from './zoom.json';
import pic from './pic.json';
import emoji from './emoji.json';
import order from './order.json';
import closest from './closest.json';
import odd from './odd.json';
import flag from './flag.json';
import sound from './sound.json';
import bab from './bab.json';
import syrdrama from './syrdrama.json';
import ertugrul from './ertugrul.json';
import anime from './anime.json';
import kitchen from './kitchen.json';
import social from './social.json';
import logos from './logos.json';
import jordan from './jordan.json';
import egyart from './egyart.json';
import focus from './focus.json';
import focuspic from './focuspic.json';

export const CATS = [
  geo,
  caps,
  sci,
  body,
  animals,
  foot,
  sports,
  hist,
  islam,
  food,
  tech,
  games,
  lang,
  space,
  film,
  math,
  arab,
  invent,
  cars,
  nature,
  flags,
  lit,
  money,
  art,
  zoom,
  pic,
  emoji,
  order,
  closest,
  odd,
  flag,
  sound,
  bab,
  syrdrama,
  ertugrul,
  anime,
  kitchen,
  social,
  logos,
  jordan,
  egyart,
  focus,
  focuspic,
];

export const CATEGORY_IDS = CATS.map((category) => category.id);
export const TOTAL_QUESTIONS = CATS.reduce((sum, category) => sum + category.qs.length, 0);
