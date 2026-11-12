// Content identity is shared by clients and authoritative rooms. UI language is
// deliberately independent: everyone in a match sees the same content pack.
export const CONTENT_LOCALES = Object.freeze(['ar', 'en']);
export const CONTENT_VERSIONS = Object.freeze({ ar: 'legacy-ar', en: 'new-en' });
export const LOCALIZED_CONTENT_CAPABILITY = 1;

export function normalizeContentLocale(value = 'ar') {
  if (!CONTENT_LOCALES.includes(value)) throw new TypeError('CONTENT_LOCALE');
  return value;
}
export function contentVersionFor(locale = 'ar') {
  return CONTENT_VERSIONS[normalizeContentLocale(locale)];
}
export function normalizeContentIdentity(value = {}) {
  const contentLocale = normalizeContentLocale(value.contentLocale);
  const contentVersion = value.contentVersion ?? contentVersionFor(contentLocale);
  if (contentVersion !== contentVersionFor(contentLocale)) throw new TypeError('CONTENT_VERSION');
  return { contentLocale, contentVersion };
}
export function supportsContentIdentity(capabilities, value = {}) {
  const { contentLocale } = normalizeContentIdentity(value);
  return contentLocale === 'ar' || capabilities?.localizedContent === LOCALIZED_CONTENT_CAPABILITY;
}
