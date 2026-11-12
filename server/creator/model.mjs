import { fail } from '../room-model.mjs';

export const TIMEZONE = 'Asia/Amman';
export const HEARTBEAT_MS = 30_000;
export const ONLINE_MS = 90_000;
export const SAMPLE_MS = 60_000;
export const MAX_PRESENCE_ROWS = 20_000;
export const MAX_DAILY_USER_ROWS = 200_000;
export const GAMES = Object.freeze(['badeeha','beep','mamnoo','jabeen','fabraka','meenfina','ersomha','mafia']);
export const MODES = Object.freeze(['none','local','online']);
export const SCREENS = Object.freeze(['home','friends','store','profile','settings','creator','game-setup','game-lobby','game-playing','game-results']);
const ONLINE_GAMES = new Set(['badeeha','fabraka','meenfina','ersomha','mafia']);
const LOCAL_GAMES = new Set(['badeeha','beep','mamnoo','jabeen','fabraka','meenfina']);
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' });

export function presenceOf(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 3
      || Object.keys(body).some(key => !['game','mode','screen'].includes(key))) fail('INVALID',400);
  const {game,mode,screen} = body;
  if (!MODES.includes(mode) || !SCREENS.includes(screen) || game !== null && !GAMES.includes(game)) fail('INVALID',400);
  if (screen.startsWith('game-')) {
    if (mode === 'none' || !(mode === 'local' ? LOCAL_GAMES : ONLINE_GAMES).has(game)) fail('INVALID',400);
  } else if (game !== null || mode !== 'none') fail('INVALID',400);
  return {game,mode,screen};
}

export function localPeriod(now) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(now)).map(part => [part.type,part.value]));
  return {day:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour)};
}
export const addDays = (day, count) => new Date(Date.parse(day+'T12:00:00Z')+count*86400_000).toISOString().slice(0,10);
// Resolve each calendar boundary using the runtime time-zone database, not a
// hard-coded UTC offset. This also keeps account-created counters server-owned.
export function dayStart(day) {
  const target = Date.parse(day+'T00:00:00Z');
  let guess = target;
  for (let n=0;n<4;n++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part=>[part.type,part.value]));
    const wall = Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
    const delta = target-wall;
    if (!delta) return guess;
    guess += delta;
  }
  return guess;
}
export function creatorEnvironment(env) {
  let origin;
  try { origin = new URL(env.APP_ORIGIN).origin; } catch { return {id:'unknown',origin:null}; }
  if (origin === 'https://maydan-game.mf103871.workers.dev') return {id:'production',origin};
  if (origin === 'https://maydan-mafia-preview.mf103871.workers.dev') return {id:'preview',origin};
  if (['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) return {id:'local',origin};
  return {id:'unknown',origin:null};
}
