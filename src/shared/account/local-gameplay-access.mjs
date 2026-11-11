import { badeehaFreeSelection, gameplayOffer, ticketPolicyEnabled } from './gameplay-policy.mjs';

// Local games carry their own saved board. The server is authoritative for
// account trial/ticket claims; this journal prevents an interrupted response
// from consuming a second claim on an ordinary client. It is not DRM for a
// modified/offline application with its own bundled question bank.
export class LocalGameplayAccess {
  constructor({ game, storage, getAccount, start, uuid = () => crypto.randomUUID() }) {
    Object.assign(this, { game, storage, getAccount, start, uuid });
    this.current = null; this.running = null; this.epoch = 0;
  }
  owner() { const account = this.getAccount(); return account.signedIn ? account.user?.id : 'guest'; }
  enabled() { return ticketPolicyEnabled(this.getAccount().gameplayPolicy); }
  snapshot() { return this.current ? { ...this.current } : null; }
  activate() {
    if (!this.current?.matchId) return;
    const key = `pending:${this.current.owner}`;
    if (this.storage.get(key)?.matchId === this.current.matchId) this.storage.remove(key);
  }
  clear() { this.epoch++; this.current = null; this.running = null; }
  complete() {
    if (this.current?.matchId) {
      const key = `match:${this.current.matchId}`;
      this.storage.set(key, { ...this.current, completed: true });
      const pendingKey = `pending:${this.current.owner}`;
      if (this.storage.get(pendingKey)?.matchId === this.current.matchId) this.storage.remove(pendingKey);
    }
    this.current = null;
  }
  async authorize(options = {}) {
    if (this.running) return this.running;
    const epoch = this.epoch;
    this.running = this.prepare(options, epoch).finally(() => { if (epoch === this.epoch) this.running = null; });
    return this.running;
  }
  async prepare({ categories, resume } = {}, epoch) {
    const account = this.getAccount(), owner = this.owner();
    const valid = () => epoch === this.epoch && this.owner() === owner;
    if (!this.enabled()) { this.current = null; return { ready: true }; }
    const offer = gameplayOffer(this.game, 'local');
    if (!offer) return { ready: false, reason: 'unavailable' };
    const restored = resume?.profileSession?.gameplayAccess;
    const savedOwner = restored?.owner || resume?.profileSession?.ownerUserId;
    if (savedOwner && savedOwner !== owner) return { ready: false, reason: 'account' };
    if (this.game === 'badeeha' && badeehaFreeSelection(categories)) {
      this.current = { version: 1, owner, offer: offer.id, source: 'free-packs' };
      return { ready: true };
    }
    if (resume && !restored) {
      // Preserve matches saved by a previous free build. New matches always
      // carry a journal marker; resuming never silently spends another ticket.
      this.current = { version: 1, owner, offer: offer.id, source: 'legacy' };
      return { ready: true };
    }
    if (restored && (restored.owner !== owner || restored.offer !== offer.id || restored.version !== 1)) {
      return { ready: false, reason: 'account' };
    }
    if (restored?.source === 'legacy' || restored?.source === 'free-packs') {
      this.current = { ...restored }; return { ready: true };
    }
    if (restored?.matchId) {
      const recorded = this.storage.get(`match:${restored.matchId}`);
      if (recorded?.completed) return { ready: false, reason: 'completed' };
      if (recorded?.owner === owner && recorded.offer === offer.id &&
          ['trial','ticket','plus','guest-trial'].includes(recorded.source) && recorded.source === restored.source) {
        // The whole locally saved match was already acknowledged. Keep it
        // playable offline, including when Plus expires mid-match.
        this.current = { ...recorded }; return { ready: true };
      }
    }
    if (owner === 'guest') {
      if (account.gameAccess(this.game) !== 'trial') return { ready: false, reason: 'signin' };
      const grant = { version: 1, owner, offer: offer.id, source: 'guest-trial', matchId: this.uuid() };
      if (!this.storage.set(`match:${grant.matchId}`, grant)) return { ready: false, reason: 'storage' };
      this.current = grant; account.markTrial(this.game); return { ready: true };
    }
    const pendingKey = `pending:${owner}`;
    const pending = this.storage.get(pendingKey);
    const matchId = restored?.matchId || pending?.matchId || this.uuid();
    if (restored && this.storage.get(`match:${matchId}`)?.completed) return { ready: false, reason: 'completed' };
    const checkpoint = { version: 1, owner, offer: offer.id, matchId };
    if (!this.storage.persistent || !this.storage.set(pendingKey, checkpoint)) return { ready: false, reason: 'storage' };
    try {
      const claim = await this.start(account, matchId, offer.id);
      if (!valid()) return { ready: false, reason: 'account' };
      if (claim.state !== 'committed' || claim.matchId !== matchId) return { ready: false, reason: 'pending' };
      const grant = { ...checkpoint, source: claim.source };
      if (!this.storage.set(`match:${matchId}`, grant)) return { ready: false, reason: 'storage' };
      this.current = grant;
      if (claim.source === 'trial') account.markTrial(this.game);
      void account.refresh?.();
      return { ready: true };
    } catch (error) {
      // Keep the exact ID even after a timeout or a definite denial: an earned
      // ticket or Plus can start that same unplayed board when the player retries.
      return { ready: false, reason: valid() ? error?.code === 'REWARDED_REQUIRED' ? 'required' : 'pending' : 'account' };
    }
  }
}
