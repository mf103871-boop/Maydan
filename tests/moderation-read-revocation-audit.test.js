import test from "node:test";
import assert from "node:assert/strict";
import { createLocalD1 } from "../server/local-d1.mjs";
import { createUser, revokeSession } from "../server/accounts/db.mjs";
import { issueSession } from "../server/accounts/session.mjs";
import { routeModeration } from "../server/moderation/router.mjs";
async function fixture(t, change) {
  const DB = createLocalD1(), env = { DB }, mod = await createUser(env), sender = await createUser(env), session = await issueSession(env, mod.id);
  env.MODERATOR_USER_IDS = mod.id;
  t.after(() => DB.close());
  const now = Date.now();
  await DB.prepare("INSERT INTO social_reports(id,reporter_id,reported_id,reason,created_at)VALUES(?,?,?,?,?)").bind("report-a", mod.id, sender.id, "abuse", now).run();
  await DB.prepare("INSERT INTO social_attachments(id,user_id,scope,conversation_id,client_id,object_key,mime_type,duration_ms,byte_length,content_hash,created_at,ready_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind("attachment-a", sender.id, "direct", "conversation-a", "client-a", "voice/a", "audio/mp4", 1e3, 16, "unit-hash", now, now).run();
  await DB.prepare("INSERT INTO social_report_attachments(report_id,attachment_id)VALUES(?,?)").bind("report-a", "attachment-a").run();
  let cancelled = false;
  env.SOCIAL_AUDIO = { async get() {
    await change({ DB, env, mod, session });
    return { body: new ReadableStream({ start(c) {
      c.enqueue(new Uint8Array(16));
    }, cancel() {
      cancelled = true;
    } }) };
  } };
  const url = new URL("https://unit.test/api/moderation/reports/report-a/audio"), request = new Request(url, { headers: { authorization: "Bearer " + session.token } });
  return { response: await routeModeration(request, env, url), get cancelled() {
    return cancelled;
  } };
}
test("revoked moderator session cannot receive private report audio after delayed R2 lookup", async (t) => {
  const f = await fixture(t, async ({ env, session }) => revokeSession(env, session.id, Date.now() - 1));
  assert.equal(f.response.status, 401);
  assert.equal(f.cancelled, true);
});
test("expired moderator session cannot receive report audio after delayed R2 lookup", async (t) => {
  const f = await fixture(t, async ({ DB, session }) => DB.prepare("UPDATE sessions SET expires_at=? WHERE id=?").bind(Date.now() - 1, session.id).run());
  assert.equal(f.response.status, 401);
  assert.equal(f.cancelled, true);
});
test("unchanged moderator can still stream report audio", async (t) => {
  const f = await fixture(t, async () => {
  });
  assert.equal(f.response.status, 200);
  assert.equal(f.response.headers.get("cache-control"), "private, no-store");
  await f.response.body.cancel();
});
