import { buildOnce, fmtKB } from './lib.mjs';

const t0 = Date.now();
try {
  const r = await buildOnce({ minify: true });
  for (const w of r.warnings) console.warn('warning:', w.text);
  console.log(`built ${r.out}`);
  console.log(`v${r.version} · ${fmtKB(r.bytes)} (${fmtKB(r.gzip)} gzip) · ${Date.now() - t0}ms`);
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
