// Cache en mémoire avec durée de vie (TTL).
//
// - Une entrée "fraîche" est renvoyée sans appeler Last.fm.
// - Si deux visiteurs demandent la même clé en même temps, ils partagent
//   la même promesse : un seul appel part vers Last.fm.
// - Une entrée expirée est gardée : si Last.fm tombe, on peut encore
//   renvoyer ces anciennes données (marquées "stale").

export class TtlCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entries = new Map(); // key -> { value, storedAt }
    this.inFlight = new Map(); // key -> Promise
  }

  getFresh(key) {
    const entry = this.entries.get(key);
    if (entry && Date.now() - entry.storedAt < this.ttlMs) return entry;
    return null;
  }

  getStale(key) {
    return this.entries.get(key) ?? null;
  }

  set(key, value) {
    this.entries.set(key, { value, storedAt: Date.now() });
  }

  // Renvoie { value, status } avec status = "HIT" | "MISS".
  // Si loader() échoue, l'erreur remonte (l'appelant décide du repli).
  async getOrLoad(key, loader) {
    const fresh = this.getFresh(key);
    if (fresh) return { value: fresh.value, status: "HIT", storedAt: fresh.storedAt };

    if (!this.inFlight.has(key)) {
      const promise = loader()
        .then((value) => {
          this.set(key, value);
          return value;
        })
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, promise);
    }

    const value = await this.inFlight.get(key);
    return { value, status: "MISS", storedAt: this.entries.get(key).storedAt };
  }
}
