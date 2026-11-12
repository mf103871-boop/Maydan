import { EN, englishUiReady, loadEnglishUi } from './en.js';

export const UI_LOCALES = Object.freeze(['ar', 'en']);
export const localeDirection = locale => locale === 'en' ? 'ltr' : 'rtl';
export function initialUiLocale(saved, deviceLanguage = 'ar') {
  if (saved && typeof saved === 'object') return saved.uiLocale === 'en' ? 'en' : 'ar';
  return /^en(?:-|$)/i.test(deviceLanguage) ? 'en' : 'ar';
}

let activeLocale = 'ar';
let localeRequest = 0;
let localeStatus = Object.freeze({loading:false,error:false,requested:'ar'});
const listeners = new Set();
const missing = new Set();
export const getUiLocale = () => activeLocale;
export const getLocaleStatus = () => localeStatus;
export const subscribeLocale = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function setUiLocale(locale) {
  const next = locale === 'en' ? 'en' : 'ar';
  const request = ++localeRequest;
  const status = (loading,error) => {
    if (localeStatus.loading === loading && localeStatus.error === error && localeStatus.requested === next) return;
    localeStatus = Object.freeze({loading,error,requested:next});
    listeners.forEach(listener => listener());
  };
  if (next === 'en' && !englishUiReady()) {
    status(true,false);
    return loadEnglishUi().then(() => {
      if (request !== localeRequest) return false;
      commitUiLocale(next); status(false,false); return true;
    }).catch(() => {
      if (request === localeRequest) status(false,true);
      return false;
    });
  }
  const statusChanged = localeStatus.loading || localeStatus.error || localeStatus.requested !== next;
  const localeChanged = activeLocale !== next;
  localeStatus = Object.freeze({loading:false,error:false,requested:next});
  commitUiLocale(next);
  if (!localeChanged && statusChanged) listeners.forEach(listener => listener());
  return Promise.resolve(true);
}
function commitUiLocale(next) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.documentElement.dir = localeDirection(next);
    const manifest = document.querySelector?.('link[rel="manifest"]');
    if (manifest) manifest.setAttribute('href', next === 'en' ? 'manifest.en.webmanifest' : 'manifest.webmanifest');
  }
  // Locale is the only value crossing this dedicated native presentation bridge.
  // Send on initialization too: the persisted native choice may differ from web storage.
  if (typeof window !== 'undefined') {
    try { window.webkit?.messageHandlers?.maydan?.postMessage({type:'setLocale',locale:next}); } catch { /* Older shells remain compatible. */ }
    try { window.MaydanLocale?.postMessage(JSON.stringify({type:'setLocale',locale:next})); } catch { /* Optional Android bridge. */ }
  }
  if (activeLocale === next) return;
  activeLocale = next;
  listeners.forEach(listener => listener());
}

// Only authored UI strings are passed here. Player messages and names are never translated.
export function translate(source, values = {}, locale = activeLocale) {
  if (typeof source !== 'string') return source;
  const key = source.trim();
  let output = source;
  if (locale === 'en') {
    const translated = EN[key];
    if (translated !== undefined) output = source.replace(key, translated);
    else if (/[\u0600-\u06ff]/u.test(key)) missing.add(key);
  }
  return output.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
export const tr = translate;
export const untranslatedUiKeys = () => [...missing].sort();
export const numberForLocale = (value, locale = activeLocale, options = {}) => new Intl.NumberFormat(locale === 'en' ? 'en' : 'ar-JO', options).format(Number(value) || 0);
export const GAME_NAMES_EN = Object.freeze({ badeeha: 'Badeeha', mafia: 'Mafia', ersomha: 'Draw It', beep: 'Beat the Beep', mamnoo: 'Forbidden', jabeen: 'Heads Up', fabraka: 'Fabraka', meenfina: 'Who Among Us?' });
export const gameName = (game, locale = activeLocale) => locale === 'en' ? GAME_NAMES_EN[game?.id] || game?.name || '' : game?.name || '';
