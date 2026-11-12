import { createStorage } from './storage.js';
import { normalizeContentIdentity } from '../content-locale.mjs';

// Keep legacy Arabic settings, progress and history exactly where older clients
// wrote them. English uses an independent versioned history and recovery slot.
export function contentStorage(gameId, identity, backend) {
  const { contentLocale, contentVersion } = normalizeContentIdentity(identity);
  return createStorage(contentLocale === 'ar' ? gameId : `maydan:${gameId}:${contentLocale}:${contentVersion}:`, backend);
}

// Earlier games used both numbers and bank-version strings in contentVersion.
// Preserve that game schema independently of the new language pack version.
const isPackVersion = value => value === 'legacy-ar' || value === 'new-en';
export function stampContentIdentity(snapshot, identity) {
  const content = normalizeContentIdentity(identity);
  return snapshot?.contentVersion !== undefined && !isPackVersion(snapshot.contentVersion)
    ? { ...snapshot, contentLocale:content.contentLocale, contentPackVersion:content.contentVersion }
    : { ...snapshot, ...content };
}

export function readSavedContentIdentity(snapshot = {}) {
  const contentLocale = snapshot.contentLocale ?? snapshot.settings?.contentLocale ?? snapshot.profileSession?.contentLocale;
  const contentVersion = snapshot.contentPackVersion
    ?? (isPackVersion(snapshot.contentVersion) ? snapshot.contentVersion : undefined)
    ?? (isPackVersion(snapshot.settings?.contentVersion) ? snapshot.settings.contentVersion : undefined)
    ?? snapshot.profileSession?.contentVersion;
  return normalizeContentIdentity({ contentLocale, contentVersion });
}
