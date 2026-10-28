import { newCredentials, deviceId, post, readSaved, save } from '../online/client.js';
import { ROOM_CAPABILITIES, ERSOMHA_DEFAULT_SETTINGS, ONLINE_GAMES } from '../online/shared.js';

const stale = () => Object.assign(new Error('تغيّر الحساب. افتح المحادثة مجددًا.'), { code: 'STALE' });
export const socialJoinFallbackKey = (owner, code) => `socialJoinFallback:${owner}:${code}`;
const roomProfile = (account, previous) => ({
  name: Array.from((account.user?.name?.normalize('NFKC').trim().replace(/\s+/g, ' ') || 'لاعب ميدان')).slice(0, 20).join(''),
  avatar: Number.isInteger(previous?.avatar) && previous.avatar >= 0 && previous.avatar < 4 ? previous.avatar : 0,
});

// Call only after the invitation endpoint has authorized its acceptance.
// Every uncertain retry retains the same seat credentials, scoped to the account.
export async function joinSocialGameRoom({ account, roomCode, isCurrent = () => true, server,
  joinRoom = post, read = readSaved, store = save, credentials = newCredentials }) {
  const owner = account.user?.id;
  const assertCurrent = () => { if (!owner || !isCurrent()) throw stale(); };
  assertCurrent();
  if (!/^\d{6}$/.test(roomCode || '')) throw Object.assign(new Error('رابط الغرفة غير صالح.'), { code: 'INVALID' });
  const key = `pendingSocialJoin:${owner}:${roomCode}`;
  const session = read(server, key) || (read(server, `roomOwner:${roomCode}`) === owner && read(server, roomCode)) || credentials();
  const profile = roomProfile(account, read(server, 'profile'));
  store(server, key, session);
  try {
    const result = await joinRoom(server, `/api/rooms/${roomCode}/join`, { ...session, ...profile, capabilities: ROOM_CAPABILITIES }, { headers: account.authHeaders() });
    assertCurrent();
    if (result?.code !== roomCode) throw Object.assign(new Error('تعذّر تأكيد الدخول للغرفة. حاول مجددًا.'), { code: 'NETWORK' });
    const stored = store(server, roomCode, session);
    store(server, `roomOwner:${roomCode}`, owner); store(server, 'persistence', stored);
    store(server, 'profile', profile); store(server, 'lastRoom', roomCode);
    store(server, key, null); store(server, socialJoinFallbackKey(owner, roomCode), null);
    return { code: roomCode, joined: true, stored };
  } catch (error) {
    assertCurrent();
    // A duplicate/unsupported display name needs a human choice. The existing
    // entry form keeps the same credentials and explains exactly what to change.
    if (['NAME', 'NAME_TAKEN', 'CONTENT_REJECTED', 'ACCOUNT_IN_ROOM'].includes(error.code)) {
      store(server, socialJoinFallbackKey(owner, roomCode), { ...profile, session, error: error.code });
      return { code: roomCode, joined: false, error: error.code };
    }
    throw error;
  }
}

// A failed invitation must reuse the room, including when its create response
// was lost. Credentials are saved before HTTP, scoped to the account and chat.
export function createSocialGameLauncher({ account, target, isCurrent = () => true,
  server, createRoom = post, read = readSaved, store = save,
  credentials = newCredentials, getDeviceId = deviceId }) {
  const owner = account.user?.id;
  let room = null;
  let pending = null;
  const assertCurrent = () => { if (!owner || !isCurrent()) throw stale(); };
  return {
    get room() { return room; },
    launch(game, sendInvite, { settings } = {}) {
      if (pending) return pending;
      const task = (async () => {
        assertCurrent();
        if (!Object.hasOwn(ONLINE_GAMES, game)) throw Object.assign(new Error('اختر لعبة متاحة.'), { code: 'INVALID' });
        if (!room) {
          // Badeeha's round is dealt by the caller on the host's phone (six categories and question IDs).
          if (game === 'badeeha' && !settings?.deck) throw Object.assign(new Error('اختر ست فئات لبَديهة.'), { code: 'INVALID' });
          const key = `pendingSocialCreate:${owner}:${target.targetType}:${target.targetId}:${game}`;
          const session = read(server, key) || credentials();
          store(server, key, session);
          const previous = read(server, 'profile');
          const { name, avatar } = roomProfile(account, previous);
          const result = await createRoom(server, '/api/rooms', { ...session, name, avatar, game,
            deviceId: getDeviceId(), rounds: 5, capabilities: ROOM_CAPABILITIES,
            ...(game === 'mafia' ? { settings: settings || { mode:'classic', capacity:8, visibility:'private' } } : {}),
            ...(game === 'badeeha' ? { settings } : {}),
            ...(game === 'ersomha' ? { settings: { ...ERSOMHA_DEFAULT_SETTINGS } } : {}),
            ...(game === 'fabraka' ? { settings: { mode: 'classic', rounds: 3, style: 'curious', categories: [], writeSeconds: 30, discussionSeconds: 15, funnyVote: true, finalDouble: false } } : {}) },
          { headers: account.authHeaders() });
          assertCurrent();
          if (!/^\d{6}$/.test(result?.code || '')) throw Object.assign(new Error('تعذّر تجهيز الغرفة. حاول مجددًا.'), { code: 'NETWORK' });
          const stored = store(server, result.code, session);
          store(server, `roomOwner:${result.code}`, owner);
          store(server, 'persistence', stored);
          store(server, 'profile', { name, avatar });
          store(server, 'lastRoom', result.code);
          room = { code: result.code, game, stored, pendingKey: key };
        }
        await sendInvite({ ...target, roomCode: room.code });
        assertCurrent();
        store(server, room.pendingKey, null);
        return room;
      })();
      pending = task;
      task.finally(() => { if (pending === task) pending = null; }).catch(() => {});
      return task;
    },
  };
}
