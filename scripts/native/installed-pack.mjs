import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const installedPackName = 'native-game-pack.json';

// Generated only in an app's final asset directory, after native exclusions
// and private additions. The public web build never receives this inventory.
export async function writeInstalledPack(directory, { ios = false } = {}) {
  const files = [];
  async function visit(folder, prefix) {
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const file = prefix + entry.name;
      if (file === installedPackName) continue;
      const absolute = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, file + '/');
      } else {
        if (!entry.isFile()) throw new Error('Unexpected entry in native game assets: ' + file);
        const contents = await readFile(absolute);
        files.push({ file, bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') });
      }
    }
  }
  await visit(directory, '');
  if (!files.some(entry => entry.file === 'index.html')) throw new Error('Native game entry is missing');
  let totalBytes = 0;
  const groups = [];
  // The iOS verifier streams one file at a time and runs off the main actor.
  // Larger groups reduce WebKit message hops without loading a group into RAM.
  const maxFiles = ios ? 120 : 40;
  const maxBytes = (ios ? 6 : 4) * 1024 * 1024;
  let groupBytes = 0;
  for (const entry of files) {
    if (!groups.length || groups.at(-1).length >= maxFiles || groupBytes + entry.bytes > maxBytes) {
      groups.push([]);
      groupBytes = 0;
    }
    groups.at(-1).push(entry);
    groupBytes += entry.bytes;
    totalBytes += entry.bytes;
  }
  const manifest = { schema: 1, totalBytes, totalFiles: files.length, groups };
  await writeFile(path.join(directory, installedPackName), JSON.stringify(manifest));
  return manifest;
}
