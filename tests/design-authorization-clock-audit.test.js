import test from "node:test";
import assert from "node:assert/strict";
import { createLocalD1 } from "../server/local-d1.mjs";
import { issueSession } from "../server/accounts/session.mjs";
import { saveDraft, draftOf } from "../server/design/db.mjs";
const doc = { schemaVersion: 1, registryVersion: 1, tokens: {}, screens: {}, assets: [] }, now = 19e11;
async function fixture(t) {
  const DB = createLocalD1(), env = { DB, DESIGN_EDITOR_USER_IDS: "editor" };
  t.after(() => DB.close());
  await DB.prepare("INSERT INTO users(id,name,created_at,updated_at)VALUES(?,?,?,?)").bind("editor", "synthetic", now, now).run();
  const session = await issueSession(env, "editor", "web", now);
  return { DB, env, session, actor: { userId: "editor", sessionId: session.id } };
}
for (const kind of ["expiry", "revocation"]) test(`Studio write cannot cross ${kind} deadline while waiting for D1`, async (t) => {
  const f = await fixture(t), deadline = now + 4;
  await f.DB.prepare(kind === "expiry" ? "UPDATE sessions SET expires_at=? WHERE id=?" : "UPDATE sessions SET revoked_at=? WHERE id=?").bind(deadline, f.session.id).run();
  f.DB.database.function("julianday", (value) => {
    assert.equal(value, "now");
    return 24405875e-1 + (deadline + 1) / 864e5;
  });
  await assert.rejects(saveDraft(f.env, f.actor, doc, 0, now), (e) => e.code === "CONFLICT");
  assert.equal((await draftOf(f.env)).revision, 0);
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM design_actions").first()).n, 0);
});
test("Studio scheduled grace remains usable strictly before its cutoff", async (t) => {
  const f = await fixture(t), deadline = now + 4;
  await f.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").bind(deadline, f.session.id).run();
  f.DB.database.function("julianday", (value) => {
    assert.equal(value, "now");
    return 24405875e-1 + (deadline - 1) / 864e5;
  });
  assert.equal((await saveDraft(f.env, f.actor, doc, 0, now)).revision, 1);
});
