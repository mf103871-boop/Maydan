import { buildOnce, fmtKB } from './lib.mjs';

const t0 = Date.now();
try {
  const r = await buildOnce({ minify: true });
  for (const w of r.warnings) console.warn('warning:', w.text);
  console.log(`built ${r.out}`);
  console.log(`v${r.version} · ${fmtKB(r.bytes)} (${fmtKB(r.gzip)} gzip) · ${Date.now() - t0}ms`);
  if (r.media && r.media.files) {
    const { fmtMB } = await import('./media.mjs');
    console.log(`وسائط: ${r.media.files} ملفًا · ${fmtMB(r.media.bytes)}`);
    for (const p of r.media.packs) console.log(`  ${p.id.padEnd(12)} ${String(p.refs).padStart(3)} مرجعًا · ${fmtMB(p.bytes)}${p.external ? ` · ${p.external} خارجي` : ''}`);
  }
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
