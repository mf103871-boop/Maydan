// A local roster is not an account roster. We record only that this account
// hosted a naturally completed session, never a local player's score or win.
const PREFIX = 'session:';
// A mounted game and the account-wide reconnect handler share the same queue.
const completing = new Set();
const RETRYABLE = new Set(['NETWORK', 'OFFLINE', 'INTERNAL', 'SOCIAL_UNAVAILABLE', 'PROFILES_UNAVAILABLE', 'STALE', 'AUTH_REQUIRED', 'AUTH_EXPIRED']);

export class LocalSessionRecorder {
  constructor({ storage, beginSession, completeSession, owner = null }) {
    Object.assign(this, { storage, beginSession, completeSession, owner });
    this.current = null; this.inflight = completing;
  }
  updateOwner(owner) {
    if (owner === this.owner) return;
    if (this.current && !this.current.completed) this.storage.remove(PREFIX + this.current.key);
    this.current = null; this.owner = owner;
  }
  marker() {
    const run = this.current;
    return run ? { version: 1, key: run.key, ownerUserId: run.ownerUserId } : null;
  }
  start(game) {
    const run = { key: crypto.randomUUID(), ownerUserId: this.owner, game, sessionId: null, completed: false };
    this.current = run;
    if (!run.ownerUserId) return null;
    // Save a local marker before network I/O, so a saved game can resume only
    // its own acknowledged start. Failed starts are never recreated at finish.
    this.storage.set(PREFIX + run.key, run);
    run.starting = Promise.resolve().then(async () => {
      if (this.current !== run || this.owner !== run.ownerUserId) return;
      const result = await this.beginSession(game);
      const sessionId = typeof result === 'string' ? result : result?.sessionId;
      if (this.current !== run || this.owner !== run.ownerUserId || !sessionId) return;
      run.sessionId = sessionId;
      this.persist(run);
      if (run.completed) await this.flush();
    }).catch(() => {});
    return this.marker();
  }
  resume(marker, game) {
    this.current = null;
    if (!marker || marker.version !== 1 || marker.ownerUserId !== this.owner || !this.owner) return;
    const saved = this.storage.get(PREFIX + marker.key);
    if (!saved || saved.ownerUserId !== this.owner || saved.game !== game || !saved.sessionId || saved.completed) return;
    this.current = { ...saved };
  }
  persist(run) {
    const { key, ownerUserId, game, sessionId, completed } = run;
    this.storage.set(PREFIX + key, { key, ownerUserId, game, sessionId, completed });
  }
  complete(completed) {
    const run = this.current;
    if (!run || run.completed || !completed || !run.ownerUserId || run.ownerUserId !== this.owner) return;
    run.completed = true;
    this.persist(run);
    if (run.sessionId) this.flush().catch(() => {});
  }
  async flush() {
    const owner = this.owner;
    if (!owner) return;
    for (const key of this.storage.keys().filter((key) => key.startsWith(PREFIX))) {
      if (this.owner !== owner) return;
      const saved = this.storage.get(key);
      if (!saved?.completed || !saved.sessionId || saved.ownerUserId !== owner || this.inflight.has(key)) continue;
      this.inflight.add(key);
      try {
        const result = await this.completeSession(saved.sessionId);
        if (result && this.owner === owner) this.storage.remove(key);
      } catch (error) {
        // A short/invalid session is a final rejection. Waiting and retrying it
        // later must not turn an ineligible game into an earned achievement.
        if (this.owner === owner && !RETRYABLE.has(error?.code)) this.storage.remove(key);
      } finally { this.inflight.delete(key); }
    }
  }
  stop() { this.current = null; }
}
