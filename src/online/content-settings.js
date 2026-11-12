import { contentVersionFor } from '../shared/content-locale.mjs';

// A newly chosen lobby language owns the whole identity pair. A settings draft
// saved in the other language must never smuggle its old version into this one.
export function contentSettings(value, contentLocale = 'ar') {
  return { ...value, contentLocale, contentVersion: contentVersionFor(contentLocale) };
}
