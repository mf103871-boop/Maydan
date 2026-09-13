import { startLocalServer } from '../server/local.mjs';
const port = Number(process.env.ROOMS_PORT || 8787);
const app = await startLocalServer({ port, origins: process.env.ALLOWED_ORIGINS });
console.log(`Maydan room server: ${app.url}`);
console.log('Local, in-memory test server. Use a deployed Cloudflare Worker for phones over the internet.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
