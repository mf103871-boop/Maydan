import { SocialHub } from "../server/social/realtime.mjs";
import { routeAccounts } from "../server/accounts/router.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalD1 } from "../server/local-d1.mjs";
import * as db from "../server/accounts/db.mjs";
import { issueSession, readSession, ROTATE_AFTER, ROTATE_GRACE } from "../server/accounts/session.mjs";
const request = (token) => new Request("https://unit.test/api/me", { headers: { authorization: "Bearer " + token } });
async function fixture(t) {
  const raw = createLocalD1(), env = { DB: raw }, now = Date.now(), user = await db.createUser(env), session = await issueSession(env, user.id, "web", now - 2 * ROTATE_AFTER);
  t.after(() => raw.close());
  return { raw, env, now, user, session };
}
function beforeInsert(raw, action) {
  let armed = true;
  return new Proxy(raw, { get(target, key) {
    if (key === "prepare") return (sql) => {
      if (armed && /^INSERT INTO sessions\b/.test(sql)) {
        armed = false;
        action();
      }
      return target.prepare(sql);
    };
    const v = target[key];
    return typeof v === "function" ? v.bind(target) : v;
  } });
}
test("revoking the presented session during rotation cannot be overwritten or mint a surviving replacement", async (t) => {
  const f = await fixture(t);
  f.env.DB = beforeInsert(f.raw, () => f.raw.database.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").run(f.now, f.session.id));
  await assert.rejects(readSession(f.env, request(f.session.token), { now: f.now }), /AUTH_EXPIRED/);
  assert.equal((await f.raw.prepare("SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL").first()).n, 0);
  assert.equal((await db.sessionById(f.env, f.session.id)).revoked_at, f.now);
});
test("a fresh revocation during a delayed rotation cannot pass the losing fallback's older request clock", async (t) => {
  const f = await fixture(t);
  let reached, release;
  const ready = new Promise((resolve) => { reached = resolve; }), gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  f.env.DB = new Proxy(f.raw, { get(target, key) {
    if (key === "batch") return async (statements) => { reached(); await gate; return target.batch(statements); };
    const value = target[key];
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const pending = readSession(f.env, request(f.session.token), { now: f.now });
  await ready;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const revokedAt = Date.now();
  assert.ok(revokedAt > f.now);
  await db.revokeSession({ DB: f.raw }, f.session.id, revokedAt);
  release();
  await assert.rejects(pending, /AUTH_EXPIRED/);
  assert.equal((await f.raw.prepare("SELECT COUNT(*) AS n FROM sessions").first()).n, 1);
  assert.equal((await db.sessionById(f.env, f.session.id)).revoked_at, revokedAt);
});
test("account-wide revocation during rotation cannot leave the newly generated token active", async (t) => {
  const f = await fixture(t);
  f.env.DB = beforeInsert(f.raw, () => f.raw.database.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").run(f.now, f.user.id));
  await assert.rejects(readSession(f.env, request(f.session.token), { now: f.now }), /AUTH_EXPIRED/);
  assert.equal((await f.raw.prepare("SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL").first()).n, 0);
});
test("a scheduled revocation stays authoritative and cannot be extended by rotating a still-valid session", async (t) => {
  const f = await fixture(t), cutoff = f.now + 1e3;
  await db.revokeSession(f.env, f.session.id, cutoff);
  const result = await readSession(f.env, request(f.session.token), { now: f.now });
  assert.equal(result.rotated, null);
  assert.equal((await db.sessionById(f.env, f.session.id)).revoked_at, cutoff);
  await assert.rejects(readSession(f.env, request(f.session.token), { now: cutoff }), /AUTH_EXPIRED/);
});
test("normal rotation keeps the grace period but concurrent requests issue exactly one replacement", async (t) => {
  const f = await fixture(t), results = await Promise.all([readSession(f.env, request(f.session.token), { now: f.now }), readSession(f.env, request(f.session.token), { now: f.now })]);
  const rotated = results.map((x) => x.rotated).filter(Boolean);
  assert.equal(rotated.length, 1);
  const old = await db.sessionById(f.env, f.session.id);
  assert.equal(old.replaced_by, rotated[0].id);
  assert.equal(old.revoked_at, f.now + ROTATE_GRACE);
  assert.equal((await f.raw.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?").bind(f.user.id).first()).n, 2);
  assert.equal((await readSession(f.env, request(rotated[0].token), { now: f.now + 1 })).user.id, f.user.id);
});
test("session expiry at the actual D1 write clock prevents minting a long-lived replacement", async (t) => {
  const f = await fixture(t), deadline = f.now + 4;
  await f.raw.prepare("UPDATE sessions SET expires_at=? WHERE id=?").bind(deadline, f.session.id).run();
  f.raw.database.function("julianday", (value) => {
    assert.equal(value, "now");
    return 24405875e-1 + (deadline + 1) / 864e5;
  });
  await assert.rejects(readSession(f.env, request(f.session.token), { now: f.now }), /AUTH_EXPIRED/);
  assert.equal((await f.raw.prepare("SELECT COUNT(*) AS n FROM sessions").first()).n, 1);
});
test("an account entering deletion during rotation cannot gain a replacement row", async (t) => {
  const f = await fixture(t);
  f.env.DB = beforeInsert(f.raw, () => f.raw.database.prepare("INSERT INTO account_deletions(user_id,attempt_id,created_at)VALUES(?,?,?)").run(f.user.id, "synthetic-attempt", f.now));
  await assert.rejects(readSession(f.env, request(f.session.token), { now: f.now }), /AUTH_EXPIRED/);
  assert.equal((await f.raw.prepare("SELECT COUNT(*) AS n FROM sessions").first()).n, 1);
});
test("a failed retirement statement rolls back the replacement insert atomically", async (t) => {
  const f = await fixture(t);
  const wrap = (statement) => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...args) => wrap(target.bind(...args));
    if (key === "runSync") return () => {
      throw Error("unit retirement failure");
    };
    const value = target[key];
    return typeof value === "function" ? value.bind(target) : value;
  } });
  f.env.DB = new Proxy(f.raw, { get(target, key) {
    if (key === "prepare") return (sql) => /^UPDATE sessions AS s SET revoked_at/.test(sql) ? wrap(target.prepare(sql)) : target.prepare(sql);
    const value = target[key];
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(readSession(f.env, request(f.session.token), { now: f.now }), /unit retirement failure/);
  assert.equal((await f.raw.prepare("SELECT COUNT(*) AS n FROM sessions").first()).n, 1);
  const old = await db.sessionById(f.env, f.session.id);
  assert.equal(old.replaced_by, null);
  assert.equal(old.revoked_at, null);
});
test("crossing the expiry boundary between atomic batch statements does not orphan an inserted replacement", async (t) => {
  const f = await fixture(t), deadline = f.now + 4;
  await f.raw.prepare("UPDATE sessions SET expires_at=? WHERE id=?").bind(deadline, f.session.id).run();
  let clockReads = 0;
  f.raw.database.function("julianday", (value) => {
    assert.equal(value, "now");
    return 24405875e-1 + (clockReads++ === 0 ? deadline - 1 : deadline + 1) / 864e5;
  });
  const result = await readSession(f.env, request(f.session.token), { now: f.now });
  assert.ok(result.rotated);
  assert.equal((await db.sessionById(f.env, f.session.id)).replaced_by, result.rotated.id);
  assert.equal((await f.raw.prepare("SELECT COUNT(*) AS n FROM sessions").first()).n, 2);
});
test("explicit replacement-scope signout revokes its retiring token and replacement, preserving other devices", async (t) => {
  const f = await fixture(t), rotation = await readSession(f.env, request(f.session.token), { now: f.now }), other = await issueSession(f.env, f.user.id, "ios", f.now);
  const url = new URL("https://unit.test/api/auth/signout"), response = await routeAccounts(new Request(url, { method: "POST", headers: { authorization: "Bearer " + f.session.token, "content-type": "application/json" }, body: JSON.stringify({ revokeReplacements: true }) }), f.env, url);
  assert.equal(response.status, 204);
  await assert.rejects(readSession(f.env, request(rotation.rotated.token), { now: Date.now() + 1 }), /AUTH_EXPIRED/);
  assert.equal((await readSession(f.env, request(other.token), { now: Date.now() + 1 })).user.id, f.user.id);
});
for (const [label, body] of [["no body", undefined], ["empty transport", ""], ["empty JSON", {}], ["explicit false", { revokeReplacements: false }]]) test(`legacy exact-session signout (${label}) leaves an adopted successor and other devices valid`, async (t) => {
  const f = await fixture(t), rotation = await readSession(f.env, request(f.session.token), { now: f.now }), other = await issueSession(f.env, f.user.id, "ios", f.now);
  await readSession(f.env, request(rotation.rotated.token), { now: f.now + 1 });
  const url = new URL("https://unit.test/api/auth/signout"), headers = { authorization: "Bearer " + f.session.token };
  if (body !== undefined && body !== "") headers["content-type"] = "application/json";
  const response = await routeAccounts(new Request(url, { method: "POST", headers, body: body === undefined || body === "" ? body : JSON.stringify(body) }), f.env, url);
  assert.equal(response.status, 204);
  await assert.rejects(readSession(f.env, request(f.session.token), { now: Date.now() + 1 }), /AUTH_EXPIRED/);
  for (const session of [rotation.rotated, other]) assert.equal((await readSession(f.env, request(session.token), { now: Date.now() + 1 })).user.id, f.user.id);
});
test("invalid or oversized replacement scopes reject without revoking either bearer", async (t) => {
  const f = await fixture(t), rotation = await readSession(f.env, request(f.session.token), { now: f.now });
  const url = new URL("https://unit.test/api/auth/signout");
  for (const [body, status] of [
    [JSON.stringify({ revokeReplacements: "true" }), 400],
    [JSON.stringify({ revokeReplacements: 1 }), 400],
    [JSON.stringify({ revokeReplacements: null }), 400],
    [JSON.stringify({ revokeReplacements: {} }), 400],
    [JSON.stringify({ revokeReplacements: [] }), 400],
    ["{", 400],
    [JSON.stringify({ revokeReplacements: true, padding: "x".repeat(1024) }), 413],
  ]) {
    await assert.rejects(routeAccounts(new Request(url, { method: "POST", headers: { authorization: "Bearer " + f.session.token, "content-type": "application/json" }, body }), f.env, url), (error) => error.code === "INVALID" && error.status === status);
    for (const session of [f.session, rotation.rotated]) assert.equal((await readSession(f.env, request(session.token), { now: Date.now() + 1, rotate: false })).user.id, f.user.id);
  }
});
test("low-level exact revocation retains its existing cutoff and cannot revoke a linked successor", async (t) => {
  const f = await fixture(t), rotation = await readSession(f.env, request(f.session.token), { now: f.now });
  await db.revokeSession(f.env, f.session.id, f.now);
  await db.revokeSession(f.env, f.session.id, f.now + 1000);
  assert.equal((await db.sessionById(f.env, f.session.id)).revoked_at, f.now);
  assert.equal((await readSession(f.env, request(rotation.rotated.token), { now: f.now + 1001 })).user.id, f.user.id);
});
test("sign-out notification closes a revoked replacement social socket without closing another device", async (t) => {
  const f = await fixture(t), rotation = await readSession(f.env, request(f.session.token), { now: f.now }), other = await issueSession(f.env, f.user.id, "ios", f.now);
  await db.revokeSessionChain(f.env, f.session.id, f.now + 1);
  const sockets = [], stored = { userId: f.user.id, lastActiveAt: f.now, tickets: {}, typingAt: 0, typingCount: 0, onlineBroadcast: true, presenceWrittenAt: Date.now() };
  const ctx = { storage: { async get() {
    return structuredClone(stored);
  }, async put() {
  }, async setAlarm() {
  }, async deleteAlarm() {
  } }, getWebSockets: () => sockets, blockConcurrencyWhile: (fn) => fn(), waitUntil() {
  } };
  const add = (sessionId) => {
    const ws = { readyState: 1, data: { sessionId, seenAt: Date.now(), validUntil: Date.now() + 6e4 }, deserializeAttachment() {
      return structuredClone(this.data);
    }, serializeAttachment(value) {
      this.data = structuredClone(value);
    }, close(code) {
      this.readyState = 3;
      this.code = code;
    }, send() {
    } };
    sockets.push(ws);
    return ws;
  };
  const retired = add(rotation.rotated.id), unrelated = add(other.id), hub = new SocialHub(ctx, f.env);
  await hub.ready;
  await hub.fetch(new Request("https://social.internal/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: f.user.id, event: { type: "session_revoked", sessionId: f.session.id } }) }));
  assert.equal(retired.readyState, 3);
  assert.equal(unrelated.readyState, 1);
});
