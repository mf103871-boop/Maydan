import test from "node:test";
import assert from "node:assert/strict";
import { createLocalD1 } from "../server/local-d1.mjs";
import { routeAccounts } from "../server/accounts/router.mjs";
function bodyStream(total, chunk = 1024) {
  let produced = 0, cancelled = false;
  const stream = new ReadableStream({ pull(c) {
    if (produced >= total) {
      c.close();
      return;
    }
    const n = Math.min(chunk, total - produced);
    c.enqueue(new Uint8Array(n).fill(120));
    produced += n;
  }, cancel() {
    cancelled = true;
  } });
  return { stream, get produced() {
    return produced;
  }, get cancelled() {
    return cancelled;
  } };
}
for (const [endpoint, limit, type] of [["/api/auth/apple/callback", 32768, "application/x-www-form-urlencoded"], ["/api/paddle/webhook", 262144, "application/json"]]) for (const declared of [null, "1"]) test(`${endpoint} cancels oversized streamed body with ${declared === null ? "missing" : "understated"} Content-Length before buffering it all`, async (t) => {
  const database = createLocalD1();
  t.after(() => database.close());
  const src = bodyStream(2 * 1024 * 1024), headers = { "content-type": type, ...declared === null ? {} : { "content-length": declared } }, url = new URL("https://unit.test" + endpoint), request = new Request(url, { method: "POST", body: src.stream, headers, duplex: "half" });
  await assert.rejects(routeAccounts(request, { PADDLE_ENV: "sandbox", DB: database }, url), (e) => e.code === "INVALID");
  assert.equal(src.cancelled, true);
  assert.ok(src.produced <= limit + 2048, `read ${src.produced} for limit ${limit}`);
});
test("small Apple callback form keeps the existing state validation result", async (t) => {
  const database = createLocalD1();
  t.after(() => database.close());
  const url = new URL("https://unit.test/api/auth/apple/callback");
  await assert.rejects(routeAccounts(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "state=invalid" }), { SESSION_SECRET: "unit-only-secret", DB: database }, url), (e) => e.code === "STATE");
});
