// Release: production build, then the single-file artifact under release/ and,
// when zip is available, a source archive next to it.
import { copyFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { buildOnce, ROOT, fmtKB } from './lib.mjs';

const r = await buildOnce({ minify: true });
const dir = path.join(ROOT, 'release');
await mkdir(dir, { recursive: true });
const html = path.join(dir, `maydan-platform-${r.version}.html`);
await copyFile(r.out, html);
console.log(`release: ${html} · ${fmtKB(r.bytes)} (${fmtKB(r.gzip)} gzip)`);

try {
  const zip = path.join(dir, `maydan-platform-${r.version}-source.zip`);
  execFileSync('zip', ['-qr', zip, '.', '-x', 'node_modules/*', 'dist/*', 'release/*', '.git/*'], { cwd: ROOT });
  console.log(`source: ${zip}`);
} catch {
  console.log('source zip skipped (zip not available)');
}
