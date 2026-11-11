import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUser, upsertSubscription } from '../../server/accounts/db.mjs';
import { issueSession, me } from '../../server/accounts/session.mjs';
import { rewardedGroup } from '../../server/rewarded/attempts.mjs';
import { rewardedOffer } from '../../server/rewarded/ledger.mjs';
import { routeLocalReward } from '../../server/rewarded/local-simulator.mjs';
import { buildOnce } from '../lib.mjs';
import { startUIReview } from '../ui-preview.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const audiences = { A: 'مجموعة A', B: 'مجموعة B', plus: 'بلس تجريبي' };
const events = new Set(['offer', 'accept', 'no-fill', 'impression', 'start', 'finish']);

export async function startRewardedPreview({ port = 4198, apiPort = 8808, native = false } = {}) {
  const tempRoot = await realpath(tmpdir());
  const assetRoot = await mkdtemp(path.join(tempRoot, 'maydan-rewarded-web-'));
  async function removeAssets() {
    const resolved = await realpath(assetRoot);
    if (resolved === assetRoot && path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('maydan-rewarded-web-')) {
      await rm(resolved, { recursive: true, force: true });
    }
  }
  const { out } = await buildOnce({ version: '1.9', includeStudio: false, rewardedPreview: true, rewardedSimulation: !native, roomsUrl: 'same-origin', outdir: assetRoot })
    .catch(async error => { await removeAssets(); throw error; });
  const document = await readFile(out, 'utf8');
  const page = native ? document : document.replace('</body>', '<script src="/__rewarded_lab__/controls.js" defer></script></body>');
  const controls = await readFile(path.join(directory, 'controls.js'));
  const actors = new Map();
  const metricCounts = new Map();
  async function persona(env, group) {
    if (!Object.hasOwn(audiences, group)) throw new Error('Invalid group');
    if (!actors.has(group)) {
      const creation = (async () => {
        let user;
        for (let i = 0; i < 32; i++) {
          const candidate = await createUser(env, { name: audiences[group] });
          if (group === 'plus' || await rewardedGroup(candidate.id) === group) { user = candidate; break; }
        }
        if (!user) throw new Error('Could not provision local cohort');
        if (group === 'plus') await upsertSubscription(env, { user_id: user.id, source: 'dev',
          external_id: 'rewarded-local-plus', product: 'plus.monthly', status: 'active', until: Date.now() + 86_400_000 });
        return user;
      })();
      actors.set(group, creation);
      creation.catch(() => actors.delete(group));
    }
    const user = await actors.get(group);
    const session = await issueSession(env, user.id, native ? 'ios' : 'web');
    return { token: session.token, me: await me(env, user) };
  }
  const review = await startUIReview({ port, apiPort, build: false, watchSource: false, assetRoot,
    rewardedMode: native ? 'native' : 'simulation',
    async requestHook({ req, res, url, backend, bodyOf, json, origins }) {
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(page);
        return true;
      }
      if (!url.pathname.startsWith('/__rewarded_lab__/')) return false;
      if (url.pathname === '/__rewarded_lab__/controls.js' && req.method === 'GET' && !native) {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        res.end(controls); return true;
      }
      if (req.method === 'GET' && url.pathname === '/__rewarded_lab__/metrics' && !native) {
        const rows = await backend.env.DB.prepare("SELECT offer, COUNT(*) AS confirmed FROM rewarded_attempts WHERE environment='local' AND state='verified' GROUP BY offer").all();
        json(res, { simulation: true, ui: Object.fromEntries(metricCounts), authority: rows.results }); return true;
      }
      if (req.method !== 'POST' || req.headers.origin !== origins[0]) {
        json(res, { error: 'LOCAL_ONLY' }, 403); return true;
      }
      const body = await bodyOf(req);
      if (url.pathname === '/__rewarded_lab__/actor') {
        json(res, await persona(backend.env, body.group));
      } else if (url.pathname === '/__rewarded_lab__/ads' && !native && typeof body.enabled === 'boolean') {
        backend.env.REWARDED_ADS_ENABLED = body.enabled ? '1' : '0';
        json(res, { enabled: body.enabled });
      } else if (url.pathname === '/__rewarded_lab__/metric' && !native && rewardedOffer(body.offer) && events.has(body.event)) {
        const name = `${body.offer}:${body.event}`;
        metricCounts.set(name, (metricCounts.get(name) || 0) + 1);
        json(res, { accepted: true });
      } else if (url.pathname === '/__rewarded_lab__/complete' && !native) {
        const headers = new Headers({ origin: origins[0], 'content-type': 'application/json' });
        if (typeof req.headers.authorization === 'string') headers.set('authorization', req.headers.authorization);
        const response = await routeLocalReward(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }), backend.env);
        json(res, await response.json(), response.status);
      } else json(res, { error: 'NOT_FOUND' }, 404);
      return true;
    },
  }).catch(async error => { await removeAssets(); throw error; });
  return { ...review, url: `http://127.0.0.1:${port}/#/game/badeeha?mode=local`,
    async close() { try { await review.close(); } finally { await removeAssets(); } } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startRewardedPreview({ native: process.argv.includes('--native'), port: Number(process.env.REWARDED_PREVIEW_PORT || 4198),
    apiPort: Number(process.env.REWARDED_PREVIEW_API_PORT || 8808) });
  console.log(`[rewarded] ${app.url} · loopback only`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
