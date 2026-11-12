import { normalizeContentIdentity } from '../shared/content-locale.mjs';

// Match the local Badeeha slots without moving or clearing any Arabic record.
export function badeehaContentStorage(identity, storage = typeof localStorage === 'undefined' ? null : localStorage) {
  const { contentLocale, contentVersion } = normalizeContentIdentity(identity);
  if (!storage || contentLocale === 'ar') return storage;
  const key = value => `${value}:${contentLocale}:${contentVersion}`;
  return { getItem: value => storage.getItem(key(value)), setItem: (value, data) => storage.setItem(key(value), data) };
}
