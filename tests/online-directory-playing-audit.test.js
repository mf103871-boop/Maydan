import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { startLocalServer } from "../server/local.mjs";
import { createUser } from "../server/accounts/db.mjs";
import { issueSession } from "../server/accounts/session.mjs";
import { newCredentials, RoomClient } from "../src/online/client.js";
import { ROOM_CAPABILITIES } from "../src/online/shared.js";
const origin = "http://localhost:3000";
class BrowserSocket extends WebSocket {
  constructor(url) {
    super(url, { origin });
  }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let n = 0; n < 400; n++) {
    if (fn()) return;
    await pause(10);
  }
  assert.fail("Expected real room state");
}
test("running Ersomha directory disables new admission while the authoritative room still rejects late joins", async (t) => {
  const app = await startLocalServer({ port: 0, vars: { ONLINE_PUBLIC_DIRECTORY_ENABLED: "1" } });
  t.after(() => app.close());
  const users = [];
  for (let n = 0; n < 3; n++) {
    const user = await createUser(app.env), session = await issueSession(app.env, user.id);
    users.push({ ...user, token: session.token });
  }
  const seats = ["drawer", "guesser", "late"].map((name) => ({ ...newCredentials(), name, avatar: 0, capabilities: ROOM_CAPABILITIES }));
  async function api(path, user, body) {
    const r = await fetch(app.url + path, { method: body ? "POST" : "GET", headers: { origin, authorization: "Bearer " + user.token, ...body ? { "content-type": "application/json" } : {} }, ...body ? { body: JSON.stringify(body) } : {} });
    return { status: r.status, value: await r.json() };
  }
  const created = await api("/api/rooms", users[0], { ...seats[0], game: "ersomha", settings: { cycles: 1, difficulty: "easy", categories: [] }, directory: { visibility: "public", name: "اختبار الرسم" } });
  assert.equal(created.status, 201);
  const code = created.value.code;
  assert.equal((await api(`/api/rooms/${code}/join`, users[1], seats[1])).status, 200);
  const clients = seats.slice(0, 2).map((seat, i) => {
    const c = new RoomClient({ server: app.url, code, session: seat, getAccountAuthorization: () => `Bearer ${users[i].token}`, WebSocketImpl: BrowserSocket });
    t.after(() => c.stop());
    c.start();
    return c;
  });
  await until(() => clients.every((c) => c.state?.members.every((m) => m.connected)));
  const waiting = await api("/api/online/rooms/public?game=ersomha", users[2]);
  assert.equal(waiting.value.rooms[0].joinable, true);
  await clients[1].command("ready", { ready: true });
  await clients[0].command("start");
  await until(() => clients[0].state?.phase === "select");
  const direct = await api(`/api/rooms/${code}/join`, users[2], { ...seats[2], game: "ersomha", directoryJoin: true });
  assert.equal(direct.status, 409);
  assert.equal(direct.value.error, "STARTED");
  const page = await api("/api/online/rooms/public?game=ersomha", users[2]), row = page.value.rooms[0];
  assert.equal(row.status, "playing");
  assert.equal(row.full, false);
  assert.equal(row.players, 2);
  assert.equal(row.joinable, false);
  assert.equal(app.rooms.get(code).instance.room.members.length, 2);
});
