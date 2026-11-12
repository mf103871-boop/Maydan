import { tr, numberForLocale, getUiLocale } from '../shared/i18n/core.js';
import { errorText as roomErrorText } from './shared.js';

// Browser-only presentation. Wire contracts and the server retain their authored values.
export const arabicNumber = value => numberForLocale(value);
export const errorText = error => tr(roomErrorText(error));
export const uiDirection = () => getUiLocale() === 'en' ? 'ltr' : 'rtl';
export const uiDateLocale = () => getUiLocale() === 'en' ? 'en' : 'ar-JO';
// Use only for static, developer-authored catalogs such as Mafia role guides.
// Never pass player profiles, messages, room titles, or game answer objects here.
export function localizeAuthored(value) {
  if (typeof value === 'string') return tr(value);
  if (Array.isArray(value)) return value.map(localizeAuthored);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,localizeAuthored(item)]));
  return value;
}
