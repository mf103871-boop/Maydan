import { useMemo, useSyncExternalStore } from 'react';
import { getUiLocale, getLocaleStatus, subscribeLocale, translate, localeDirection, numberForLocale } from './core.js';

export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getUiLocale, () => 'ar');
  const localeStatus = useSyncExternalStore(subscribeLocale, getLocaleStatus, getLocaleStatus);
  return useMemo(() => ({ locale, localeStatus, dir: localeDirection(locale), t: (key, values) => translate(key, values, locale), number: (value, options) => numberForLocale(value, locale, options) }), [locale,localeStatus]);
}
