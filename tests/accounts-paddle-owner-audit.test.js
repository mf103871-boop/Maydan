import test from "node:test";
import assert from "node:assert/strict";
import { createLocalD1 } from "../server/local-d1.mjs";
import * as db from "../server/accounts/db.mjs";
import { routeAccounts } from "../server/accounts/router.mjs";
import { hmacHex } from "../server/accounts/jwt.mjs";
function fixture(t) {
  let providerCalls = 0;
  t.mock.method(globalThis, "fetch", () => {
    providerCalls++;
    throw Error("No live provider allowed");
  });
  const raw = createLocalD1(), env = { DB: raw, PADDLE_ENV: "sandbox", PADDLE_PRICE_MONTHLY: "pri_unit", PADDLE_WEBHOOK_SECRET: "unit-only-key", PADDLE_API_KEY: "unit-only-key" };
  t.after(() => raw.close());
  return { raw, env, get providerCalls() {
    return providerCalls;
  } };
}
async function hook(env, event) {
  const raw = JSON.stringify(event), ts = Math.floor(Date.now() / 1e3), url = new URL("https://unit.test/api/paddle/webhook");
  return routeAccounts(new Request(url, { method: "POST", headers: { "content-type": "application/json", "paddle-signature": `ts=${ts};h1=${await hmacHex(env.PADDLE_WEBHOOK_SECRET, `${ts}:${raw}`)}` }, body: raw }), env, url);
}
const activated = (userId) => ({ event_id: "evt_unit_owner", event_type: "subscription.activated", occurred_at: (/* @__PURE__ */ new Date()).toISOString(), data: { id: "sub_unit_owner", status: "active", custom_data: { userId }, items: [{ price: { id: "pri_unit" } }], current_billing_period: { ends_at: new Date(Date.now() + 864e5).toISOString() } } });
function deleteAfterRead(raw, env, userId, predicate) {
  let once = true;
  const wrap = (statement, sql) => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...args) => wrap(target.bind(...args), sql);
    if (key === "first") return async (...args) => {
      const value2 = await target.first(...args);
      if (once && predicate(sql)) {
        once = false;
        await db.deleteUser({ ...env, DB: raw }, userId);
      }
      return value2;
    };
    const value = target[key];
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return new Proxy(raw, { get(target, key) {
    if (key === "prepare") return (sql) => wrap(target.prepare(sql), sql);
    const value = target[key];
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
test("completed account deletion while a Paddle activation owner read awaits cannot resurrect the subscription", async (t) => {
  const f = fixture(t), user = await db.createUser(f.env);
  f.env.DB = deleteAfterRead(f.raw, f.env, user.id, (sql) => sql === "SELECT id, name, email, created_at FROM users WHERE id = ?");
  const response = await hook(f.env, activated(user.id));
  assert.equal(response.status, 202);
  assert.equal((await response.json()).ignored, "unknown-user");
  assert.equal(await db.userById(f.env, user.id), null);
  assert.equal(await db.subscriptionByExternal(f.env, "paddle", "sub_unit_owner"), null);
  assert.equal(f.providerCalls, 0);
});
test("completed deletion after a Paddle adjustment lookup cannot recreate a revoked financial row or call cancellation", async (t) => {
  const f = fixture(t), user = await db.createUser(f.env);
  await db.upsertSubscription(f.env, { source: "paddle", external_id: "sub_unit_owner", user_id: user.id, status: "active", until: Date.now() + 1e3, environment: "sandbox" });
  f.env.DB = deleteAfterRead(f.raw, f.env, user.id, (sql) => sql === "SELECT * FROM subscriptions WHERE source = ? AND external_id = ?");
  const response = await hook(f.env, { event_id: "evt_unit_refund", event_type: "adjustment.updated", occurred_at: (/* @__PURE__ */ new Date()).toISOString(), data: { action: "refund", status: "approved", type: "full", subscription_id: "sub_unit_owner" } });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).ignored, "unknown-user");
  assert.equal(await db.subscriptionByExternal(f.env, "paddle", "sub_unit_owner"), null);
});
test("Paddle financial updates remain allowed while deletion is pending or an existing account is suspended", async (t) => {
  const f = fixture(t), user = await db.createUser(f.env), now = Date.now();
  await f.raw.prepare("INSERT INTO account_deletions(user_id,attempt_id,created_at)VALUES(?,?,?)").bind(user.id, "unit-delete", now).run();
  await f.raw.prepare("INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at)VALUES(?,?,?,?,?)").bind(user.id, user.id, "unit", now, now).run();
  const response = await hook(f.env, activated(user.id));
  assert.equal(response.status, 200);
  assert.equal((await db.subscriptionByExternal(f.env, "paddle", "sub_unit_owner")).status, "active");
  assert.equal(f.providerCalls, 0);
});
