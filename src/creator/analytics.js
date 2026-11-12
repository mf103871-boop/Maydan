import { GAME_LABELS, SCREEN_LABELS } from './copy.js';

export const REFRESH_MS = 15_000;
export const STALE_MS = 45_000;
export const TIMEZONE = 'Asia/Amman';
const MODES = new Set(['none', 'local', 'online']);
const ENVIRONMENTS = new Set(['production', 'preview', 'local', 'unknown']);
const count = value => Number.isSafeInteger(value) && value >= 0;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const fail = () => { throw Object.assign(new Error('Invalid creator analytics'), { code: 'INVALID_ANALYTICS' }); };

// Reject incomplete responses instead of turning missing data into invented zeroes.
export function validateAnalytics(data) {
  if (!data || data.schemaVersion !== 1 || data.timezone !== TIMEZONE || !iso(data.updatedAt) ||
    !(data.metricsStartedAt === null || iso(data.metricsStartedAt)) || !ENVIRONMENTS.has(data.environment?.id) ||
    !['collecting', 'not-started', 'limited'].includes(data.collection?.status) ||
    data.collection.onlineWindowSeconds !== 90 || data.collection.peakSampleSeconds !== 60) fail();
  for (const key of ['onlinePlayers', 'todayPlayers', 'todayPeakOnline', 'activeGames', 'registeredAccountsTotal', 'registeredAccountsToday']) {
    if (!count(data.summary?.[key])) fail();
  }
  if (!Array.isArray(data.byGame) || data.byGame.length > 24 || !data.byGame.every(row => Object.hasOwn(GAME_LABELS.en, row.game) && MODES.has(row.mode) && count(row.count))) fail();
  if (!Array.isArray(data.byMode) || data.byMode.length > 3 || !data.byMode.every(row => MODES.has(row.mode) && count(row.count))) fail();
  if (!Array.isArray(data.byScreen) || data.byScreen.length > 10 || !data.byScreen.every(row => Object.hasOwn(SCREEN_LABELS.en, row.screen) && count(row.count))) fail();
  for (const key of ['hourly', 'daily']) {
    if (!Array.isArray(data[key]) || data[key].length > (key === 'hourly' ? 168 : 7)) fail();
    for (const row of data[key]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !count(row.uniquePlayers) || !count(row.peakOnline) || typeof row.tracked !== 'boolean' ||
        (key === 'hourly' && (!Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23))) fail();
    }
  }
  return data;
}

export function reportingDay(isoTime) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(isoTime));
  const value = key => parts.find(part => part.type === key).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

// Fixed destinations only. Never forward a session, origin or API response URL.
export function otherEnvironmentUrl(environment) {
  if (environment === 'production') return 'https://maydan-mafia-preview.mf103871.workers.dev/#/creator';
  if (environment === 'preview') return 'https://maydan-game.mf103871.workers.dev/#/creator';
  return null;
}
