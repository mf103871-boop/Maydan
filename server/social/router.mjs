import { json, readJson, errorResponse } from '../protocol.mjs';
import { requireSession, withRotation } from '../accounts/session.mjs';
import { fail } from '../room-model.mjs';
import * as db from './db.mjs';
import { clientIdOf, pagination, publicProfile, sequenceOf, textOf, userId } from './model.mjs';
import { notifyUsers } from './realtime.mjs';

export const isSocialPath = (path) => path === '/api/social' || path.startsWith('/api/social/');
async function notify(env, ids, event = { type: 'refresh' }) {
  // A disconnected realtime service cannot roll back an already committed write.
  try { await notifyUsers(env, [...new Set(ids)], event); } catch { /* next refresh recovers */ }
}
export async function deleteSocialUser(env, id) {
  const peers = await db.deleteSocialUser(env, id);
  await notify(env, [id, ...peers]);
}

export async function routeSocial(request, env, url = new URL(request.url), charge) {
  if (!isSocialPath(url.pathname)) return null;
  if (!env.DB) fail('NOT_FOUND', 404);
  if (charge) await charge(request.method === 'GET' ? 'socialRead' : 'socialWrite');
  const auth = await requireSession(env, request);
  try {
    const response = await dispatch(request, env, url, auth.user.id, Date.now());
    return withRotation(response, auth.rotated);
  } catch (error) {
    return withRotation(errorResponse(error), auth.rotated);
  }
}
async function dispatch(request, env, url, id, now) {
  const method = request.method;
  const path = url.pathname.slice('/api/social'.length);
  const profile = await db.ensureProfile(env, id, now);
  if (method !== 'GET') await db.chargeUser(env, id, 'write', now);
  if (path === '/me' && method === 'GET') return json({ user: publicProfile(profile) });
  if (path === '/search' && method === 'GET') {
    const query = String(url.searchParams.get('q') || '').normalize('NFKC').trim();
    if (Array.from(query).length < 2 || Array.from(query).length > 80) fail('INVALID', 400);
    return json({ users: await db.searchUsers(env, id, query) });
  }
  if (path === '/friends' && method === 'GET') return json({ friends: await db.friendsOf(env, id, now) });
  if (path === '/requests' && method === 'GET') return json(await db.requestsOf(env, id));
  if (path === '/requests' && method === 'POST') {
    const otherId = userId((await readJson(request)).userId);
    const friendRequest = await db.requestFriend(env, id, otherId, now);
    await notify(env, [id, otherId]);
    return json({ request: friendRequest });
  }
  const accept = /^\/requests\/([a-zA-Z0-9_-]+)\/accept$/.exec(path);
  if (accept && method === 'POST') {
    const result = await db.acceptRequest(env, id, accept[1], now);
    await notify(env, [id, result.otherId]);
    return json({ conversationId: result.conversationId });
  }
  const reject = /^\/requests\/([a-zA-Z0-9_-]+)\/reject$/.exec(path);
  const cancel = /^\/requests\/([a-zA-Z0-9_-]+)$/.exec(path);
  if ((reject && method === 'POST') || (cancel && method === 'DELETE')) {
    const otherId = await db.dismissRequest(env, id, (reject || cancel)[1], !!cancel);
    await notify(env, [id, otherId]);
    return json({ ok: true });
  }
  const friend = /^\/friends\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (friend && method === 'DELETE') {
    const otherId = userId(friend[1]);
    await db.removeFriend(env, id, otherId);
    await notify(env, [id, otherId]);
    return json({ ok: true });
  }
  if (path === '/blocks' && method === 'GET') return json({ users: await db.blocksOf(env, id) });
  if (path === '/blocks' && method === 'POST') {
    const otherId = userId((await readJson(request)).userId);
    await db.blockUser(env, id, otherId, now);
    await notify(env, [id, otherId]);
    return json({ ok: true });
  }
  const unblock = /^\/blocks\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (unblock && method === 'DELETE') {
    const otherId = userId(unblock[1]);
    await db.unblockUser(env, id, otherId);
    await notify(env, [id, otherId]);
    return json({ ok: true });
  }
  if (path === '/reports' && method === 'POST') {
    const body = await readJson(request, 10_240);
    await db.reportUser(env, id, userId(body.userId), body.messageSeq == null ? null : sequenceOf(body.messageSeq), textOf(body.reason, 1000), now);
    await notify(env, [id]);
    return json({ ok: true });
  }
  if (path === '/conversations' && method === 'GET') return json({ conversations: await db.conversationsOf(env, id, now) });
  const messages = /^\/conversations\/([a-zA-Z0-9_-]+)\/messages$/.exec(path);
  if (messages && method === 'GET') return json(await db.messagesOf(env, id, messages[1], pagination(url.searchParams)));
  if (messages && method === 'POST') {
    const body = await readJson(request, 20_480);
    const result = await db.sendMessage(env, id, messages[1], textOf(body.text), clientIdOf(body.clientId), now);
    await notify(env, [id, result.otherId], { type: 'message', conversationId: result.message.conversationId, messageSeq: result.message.seq });
    return json({ message: result.message });
  }
  const message = /^\/messages\/([0-9]+)$/.exec(path);
  if (message && method === 'GET') {
    const found = await db.messageForUser(env, id, sequenceOf(message[1]));
    if (!found) fail('NOT_FOUND', 404);
    return json({ message: found });
  }
  if (message && (method === 'PATCH' || method === 'DELETE')) {
    const text = method === 'DELETE' ? null : textOf((await readJson(request, 20_480)).text);
    const result = await db.changeMessage(env, id, sequenceOf(message[1]), text, now);
    await notify(env, [id, result.otherId], { type: 'message', conversationId: result.message.conversationId, messageSeq: result.message.seq });
    return json({ message: result.message });
  }
  const read = /^\/conversations\/([a-zA-Z0-9_-]+)\/read$/.exec(path);
  if (read && method === 'POST') {
    const seq = sequenceOf((await readJson(request)).seq, true);
    const result = await db.markRead(env, id, read[1], seq, now);
    await notify(env, [id, result.otherId]);
    return json({ readSeq: result.readSeq });
  }
  fail('NOT_FOUND', 404);
}
