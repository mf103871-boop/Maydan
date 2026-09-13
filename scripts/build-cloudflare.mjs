import { buildOnce, fmtKB } from './lib.mjs';
// This build follows its own deployed host: no account-specific URL in source.
process.env.MAYDAN_ROOMS_URL = 'same-origin';
const result = await buildOnce();
console.log(`Cloudflare full game: ${result.out}`);
console.log(`v${result.version} · ${fmtKB(result.bytes)} · room API on the same origin`);
