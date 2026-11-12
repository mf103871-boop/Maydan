// Direction B review with real local APIs and ephemeral test accounts.
// Uses the existing loopback-only UI/Plus laboratories; never reads provider secrets.
import { startPlusPreview } from './plus-preview.mjs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const app = await startPlusPreview({port:Number(process.env.UI_REVIEW_PORT || 4192),apiPort:Number(process.env.UI_REVIEW_API_PORT || 8792),assetRoot:path.join(ROOT,'.cache/studio-preview')});
app.backend.env.ACCOUNT_PROGRESSION_ENABLED = '1';
console.log(`[studio] ${app.url.replace('plus-lab/','')} — isolated accounts, progression and test entitlements. No real payment or provider voice.`);
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await app.close();process.exit(0);});
