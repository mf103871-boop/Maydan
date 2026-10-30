// Synthetic people, real local HTTP/WS room APIs. Never fake directory responses.
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { RoomClient } from '../../src/online/client.js';
import { GAME_PROTOCOLS, ROOM_CAPABILITIES } from '../../src/online/shared.js';
import { CATS } from '../../src/data/categories/index.js';
import Logic from '../../src/games/badeeha/logic.js';

const credentials = () => ({ id: randomBytes(16).toString('hex'), token: randomBytes(32).toString('hex') });
function badeehaSettings() {
  const categories = CATS.slice(0, 6).map(item => item.id), mode = 'standard', roundSize = 20;
  const deck = Logic.buildDeck(CATS, categories, {}, Logic.MODES[mode].tiers, roundSize);
  return { mode, roundSize, timer: 60, categories, deck: Object.fromEntries(Object.entries(deck).map(([id, qs]) => [id, qs.map(q => ({ qid: q.qid, p: q.p }))])) };
}
export function createLocalPreviewRooms(backend, origin) {
  const records = new Map(), clients = [];
  let pending, seeded = false;
  async function post(path, body, actor) {
    const response = await fetch(backend.url + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', authorization: `Bearer ${actor.session.token}` }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(Error(data.error || 'LOCAL_ROOM'), { code: data.error });
    return data;
  }
  async function connect(code, seat, actor) {
    let client;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Local socket timed out')), 12000);
      class LocalSocket extends WebSocket { constructor(url) { super(url, { origin }); } }
      client = new RoomClient({ server: backend.url, code, session: seat, WebSocketImpl: LocalSocket, getAccountAuthorization: () => `Bearer ${actor.session.token}`,
        onState: () => { clearTimeout(timer); resolve(); }, onError: code => { clearTimeout(timer); reject(Object.assign(Error(code), { code })); } });
      clients.push(client); client.start();
    });
    return client;
  }
  async function create(game, name, visibility, actorAt, count, actorOf) {
    const actors = [];
    for (let n = 0; n < count; n++) actors.push(await actorOf(actorAt + n));
    const seats = actors.map(credentials);
    const settings = game === 'mafia' ? { mode: 'classic', capacity: 8, visibility, roomName: name, voiceMode: 'off' }
      : game === 'ersomha' ? { difficulty: 'easy', drawSeconds: 60, cycles: 1, categories: [] }
        : game === 'badeeha' ? badeehaSettings() : undefined;
    const room = await post('/api/rooms', { ...seats[0], name: actors[0].me.user?.name?.slice(0, 20) || 'مضيف تجريبي', avatar: 0,
      game, protocol: GAME_PROTOCOLS[game], capabilities: ROOM_CAPABILITIES, rounds: 5,
      ...(settings ? { settings } : {}), ...(game !== 'mafia' ? { directory: { visibility, name } } : {}) }, actors[0]);
    const bots = [await connect(room.code, seats[0], actors[0])];
    for (let n = 1; n < count; n++) {
      await post(`/api/rooms/${room.code}/join`, { ...seats[n], name: actors[n].me.user?.name?.slice(0, 20) || `لاعب تجريبي ${n}`, avatar: n % 4, capabilities: ROOM_CAPABILITIES }, actors[n]);
      bots.push(await connect(room.code, seats[n], actors[n]));
    }
    const info = { game, code: room.code, name, visibility, count, localOnly: true, transport: 'real-local-http-and-websocket' };
    records.set(room.code, { ...info, bots });
    return info;
  }
  return {
    async seed(actorOf) {
      if (seeded) return { rooms: [...records.values()].map(({ bots: _bots, ...row }) => row), localOnly: true, alreadySeeded: true };
      if (pending) return pending;
      pending = (async () => {
        const rooms = [];
        for (const [game, name, count, actorAt] of [['mafia', 'مجلس تجريبي · نصي', 6, 8], ['badeeha', 'تحدّي الفرق المحلي', 2, 14], ['ersomha', 'رسمة وسالفة', 2, 16], ['fabraka', 'مين يقنعنا؟', 2, 18], ['meenfina', 'جمعة الأصحاب', 3, 20]]) {
          if (![...records.values()].some(row => row.game === game && row.visibility === 'public')) rooms.push(await create(game, name, 'public', actorAt, count, actorOf));
        }
        if (![...records.values()].some(row => row.visibility === 'private')) rooms.push(await create('meenfina', 'غرفة خاصة لا تظهر في الدليل', 'private', 23, 1, actorOf));
        seeded = true;
        return { rooms: [...records.values()].map(({ bots: _bots, ...row }) => row), localOnly: true, note: 'حسابات اختبار افتراضية داخل غرف حقيقية على الخادم المحلي؛ لا اتصال بمزوّد صوت.' };
      })().finally(() => { pending = null; });
      return pending;
    },
    async action({ code, action }) {
      const record = records.get(String(code));
      if (!record || !['ready', 'start'].includes(action)) throw Error('Only seeded local rooms may be controlled');
      if (action === 'ready') await Promise.all(record.bots.map(bot => bot.command('ready', { ready: true })));
      else await record.bots[0].command('start');
      return { ok: true, localOnly: true, code, action };
    },
    close() { for (const client of clients) client.stop(); },
  };
}
