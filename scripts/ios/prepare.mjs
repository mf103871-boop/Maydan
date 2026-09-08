import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildOnce, ROOT, DIST } from '../lib.mjs';

// Build from this checkout on every invocation; never ship a stale copied bank.
const build = await buildOnce({ minify: true });
const destination = path.join(ROOT, 'ios/Maydan/www');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(DIST, destination, { recursive: true });

async function verifyDirectory(source, target) {
  let count = 0;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) count += await verifyDirectory(from, to);
    else {
      const [expected, actual] = await Promise.all([readFile(from), readFile(to)]);
      if (!expected.equals(actual)) throw new Error(`iOS resource differs: ${entry.name}`);
      count += 1;
    }
  }
  return count;
}

const files = await verifyDirectory(DIST, destination);
const hash = createHash('sha256').update(await readFile(path.join(destination, 'index.html'))).digest('hex');
console.log(`iOS resources ready: ${files} files; ${build.buildId}; HTML SHA-256 ${hash}`);
