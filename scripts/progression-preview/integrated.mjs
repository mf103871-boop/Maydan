// Local integration with the actual account/profile endpoints and their
// migrations. Each launch gets an in-memory D1 substitute with no player data.
import { startIntegratedPreview } from '../integrated-preview/server.mjs';
import { onlineRewardPlan } from '../../server/account-progression.mjs';
import { patchProfile, recordOnlineResult } from '../../server/profiles/db.mjs';

const app = await startIntegratedPreview({ port: 4195, apiPort: 8805 });
try {
  const env = app.backend.env;
  env.ACCOUNT_PROGRESSION_ENABLED = '1';
  const veteran = await app.actor(0);
  const userId = veteran.me.user.id;
  const now = Date.now();
  // Synthetic old results have no progression plan and cannot earn new XP.
  for (let index = 0; index < 25; index++) {
    await recordOnlineResult(env, { userId, eventId: 'online:' + crypto.randomUUID(),
      game: 'badeeha', won: true, draw: false, finishedAt: now - 60_000 - index });
  }
  await patchProfile(env, userId, { selectedTitle: 'legend', featuredBadges: ['twenty-five-wins', 'five-wins', 'first-win'] });
  // One real settlement for this isolated persona, using the live rules.
  await recordOnlineResult(env, { userId, eventId: 'online:' + crypto.randomUUID(), game: 'ersomha',
    won: false, draw: false, finishedAt: now - 1000,
    progressionPlan: onlineRewardPlan({ game: 'ersomha', rounds: 5, settings: { mode: 'competitive' } }) });
  await app.actor(1);
  console.log(`[progression · local only] ${app.url}`);
} catch (error) {
  await app.close();
  throw error;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
