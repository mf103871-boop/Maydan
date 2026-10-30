import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createLocalD1 } from "../server/local-d1.mjs";
import * as db from "../server/accounts/db.mjs";
import * as apple from "../server/accounts/apple.mjs";
import { appleChain } from "./helpers-apple.js";
import { PRODUCTS } from "../src/shared/account/config.js";
const response = (x) => new Response(JSON.stringify(x), { headers: { "content-type": "application/json" } });
function fixture(t) {
  const chain = appleChain(), raw = createLocalD1(), now = Date.now(), pem = generateKeyPairSync("ec", { namedCurve: "P-256", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey, env = { DB: raw, APPLE_ROOT_CA_SHA256: chain.rootSha256, APPLE_IAP_PRIVATE_KEY: pem, APPLE_IAP_KEY_ID: "unit", APPLE_IAP_ISSUER_ID: "unit", APPLE_BUNDLE_ID: "unit.maydan", APPLE_STORE_API_URL: "https://unit-apple.test" };
  t.after(() => raw.close());
  const info = (extra) => ({ bundleId: env.APPLE_BUNDLE_ID, productId: PRODUCTS.monthly, originalTransactionId: "unit-original", expiresDate: now + 864e5, environment: "Sandbox", signedDate: now, ...extra });
  return { chain, raw, now, env, info };
}
test("signed purchase hint for A is rejected for B before provider lookup even when latest legacy status has no account token", async (t) => {
  const f = fixture(t), a = await db.createUser(f.env), b = await db.createUser(f.env);
  let lookups = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /^https:\/\/unit-apple\.test\//);
    lookups++;
    return response({ data: [{ lastTransactions: [{ originalTransactionId: "unit-original", status: 1, signedTransactionInfo: f.chain.sign(f.info()) }] }] });
  });
  await assert.rejects(apple.bindTransaction(f.env, b, f.chain.sign(f.info({ appAccountToken: a.id })), f.now), /ALREADY_LINKED/);
  assert.equal(lookups, 0);
  assert.equal(await db.subscriptionByExternal(f.env, "apple", "unit-original"), null);
});
test("truly tokenless legacy restore retains the existing first-claim policy and cannot be rebound afterward", async (t) => {
  const f = fixture(t), a = await db.createUser(f.env), b = await db.createUser(f.env);
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /^https:\/\/unit-apple\.test\//);
    return response({ data: [{ lastTransactions: [{ originalTransactionId: "unit-original", status: 1, signedTransactionInfo: f.chain.sign(f.info()) }] }] });
  });
  const jws = f.chain.sign(f.info());
  await apple.bindTransaction(f.env, a, jws, f.now);
  await assert.rejects(apple.bindTransaction(f.env, b, jws, f.now), /ALREADY_LINKED/);
  assert.equal((await db.subscriptionByExternal(f.env, "apple", "unit-original")).user_id, a.id);
});
function firstReadBarrier(raw) {
  let arrivals = 0, release;
  const wait = new Promise((r) => {
    release = r;
  });
  const wrap = (statement, sql) => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...args) => wrap(target.bind(...args), sql);
    if (key === "first") return async (...args) => {
      const result = await target.first(...args);
      if (sql === "SELECT * FROM subscriptions WHERE source = ? AND external_id = ?" && result === null && arrivals < 2) {
        arrivals++;
        if (arrivals === 2) release();
        await wait;
      }
      return result;
    };
    const v = target[key];
    return typeof v === "function" ? v.bind(target) : v;
  } });
  return new Proxy(raw, { get(target, key) {
    if (key === "prepare") return (sql) => wrap(target.prepare(sql), sql);
    const v = target[key];
    return typeof v === "function" ? v.bind(target) : v;
  } });
}
test("two concurrent signed legacy first claims produce one real owner and reject the losing claim instead of false success", async (t) => {
  const f = fixture(t), a = await db.createUser(f.env), b = await db.createUser(f.env);
  f.env.DB = firstReadBarrier(f.raw);
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /^https:\/\/unit-apple\.test\//);
    return response({ data: [{ lastTransactions: [{ originalTransactionId: "unit-original", status: 1, signedTransactionInfo: f.chain.sign(f.info()) }] }] });
  });
  const jws = f.chain.sign(f.info()), users = [a, b], out = await Promise.allSettled(users.map((user) => apple.bindTransaction(f.env, user, jws, f.now)));
  assert.equal(out.filter((x) => x.status === "fulfilled").length, 1);
  const lost = out.find((x) => x.status === "rejected");
  assert.match(lost.reason.message, /ALREADY_LINKED/);
  const saved = await db.subscriptionByExternal(f.env, "apple", "unit-original");
  assert.equal(saved.user_id, users[out.findIndex((x) => x.status === "fulfilled")].id);
});
test("deletion during Apple provider lookup cannot resurrect an account subscription or acknowledge success", async (t) => {
  const f = fixture(t), user = await db.createUser(f.env), info = f.info({ appAccountToken: user.id });
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /^https:\/\/unit-apple\.test\//);
    await db.deleteUser(f.env, user.id);
    return response({ data: [{ lastTransactions: [{ originalTransactionId: "unit-original", status: 1, signedTransactionInfo: f.chain.sign(info) }] }] });
  });
  await assert.rejects(apple.bindTransaction(f.env, user, f.chain.sign(info), f.now), (e) => e.code === "AUTH_EXPIRED");
  assert.equal(await db.userById(f.env, user.id), null);
  assert.equal(await db.subscriptionByExternal(f.env, "apple", "unit-original"), null);
});
test("Apple webhook also ignores an owner deleted during provider lookup without recreating entitlement rows", async (t) => {
  const f = fixture(t), user = await db.createUser(f.env), info = f.info({ appAccountToken: user.id });
  t.mock.method(globalThis, "fetch", async () => {
    await db.deleteUser(f.env, user.id);
    return response({ data: [{ lastTransactions: [{ originalTransactionId: "unit-original", status: 1, signedTransactionInfo: f.chain.sign(info) }] }] });
  });
  const answer = await apple.handleNotification(f.env, f.chain.sign({ notificationUUID: "unit-delete-notification", data: { signedTransactionInfo: f.chain.sign(info) } }), f.now);
  assert.equal(answer.status, 202);
  assert.equal((await answer.json()).ignored, "unknown-transaction");
  assert.equal(await db.subscriptionByExternal(f.env, "apple", "unit-original"), null);
});
test("a deletion reservation prevents subscription writes but does not erase the previous financial record", async (t) => {
  const f = fixture(t), user = await db.createUser(f.env);
  await db.upsertSubscription(f.env, { source: "apple", external_id: "unit-original", user_id: user.id, until: 100, status: "active", occurred_at: f.now - 1 });
  await f.raw.prepare("INSERT INTO account_deletions(user_id,attempt_id,created_at)VALUES(?,?,?)").bind(user.id, "unit-delete", f.now).run();
  const saved = await db.upsertSubscription(f.env, { source: "apple", external_id: "unit-original", user_id: user.id, until: 200, status: "active", occurred_at: f.now }, { requireLiveOwner: true });
  assert.equal(saved, null);
  assert.equal((await db.subscriptionByExternal(f.env, "apple", "unit-original")).until, 100);
});
