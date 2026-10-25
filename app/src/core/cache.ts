/**
 * Key/value cache with a time-to-live checked on read, over any async
 * storage: IndexedDB in the browser, AsyncStorage on the phone, a Map in
 * tests. Replaces the server's SQLite cache; namespaces and keys are the
 * same, so the same product or insight is paid for once per device.
 */
export interface CacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const SEP = "\u0000";
const SWEEP_MAX_AGE = 30 * 24 * 3600 * 1000;

export class Cache {
  constructor(private readonly store: CacheStore) {}

  async get<T>(ns: string, key: string, maxAgeMs?: number): Promise<T | undefined> {
    let raw: string | undefined;
    try {
      raw = await this.store.get(ns + SEP + key);
    } catch {
      return undefined;
    }
    if (!raw) return undefined;
    try {
      const entry = JSON.parse(raw) as { t: number; v: T };
      if (maxAgeMs !== undefined && Date.now() - entry.t > maxAgeMs) {
        void this.delete(ns, key);
        return undefined;
      }
      return entry.v;
    } catch {
      return undefined;
    }
  }

  /** Storage is a convenience: a failed write never fails the lookup. */
  async set(ns: string, key: string, value: unknown): Promise<void> {
    try {
      // `t` first, so sweep() can read the age without parsing the value
      await this.store.set(ns + SEP + key, JSON.stringify({ t: Date.now(), v: value }));
    } catch (err) {
      console.warn(`[cache] write failed for ${ns}: ${(err as Error).message}`);
    }
  }

  async delete(ns: string, key: string): Promise<void> {
    try {
      await this.store.delete(ns + SEP + key);
    } catch {
      // ignore
    }
  }

  /** Drops everything older than `maxAgeMs` (nothing is read fully, only the timestamp prefix). */
  async sweep(maxAgeMs = SWEEP_MAX_AGE): Promise<number> {
    let removed = 0;
    try {
      const now = Date.now();
      for (const key of await this.store.keys()) {
        const raw = await this.store.get(key);
        const m = raw && /^\{"t":(\d+)/.exec(raw.slice(0, 24));
        if (!m) continue;
        if (now - Number(m[1]) > maxAgeMs) {
          await this.store.delete(key);
          removed++;
        }
      }
    } catch (err) {
      console.warn(`[cache] sweep failed: ${(err as Error).message}`);
    }
    return removed;
  }
}

/** In-memory store for tests and as a last resort when the platform storage is unavailable. */
export function memoryStore(): CacheStore {
  const m = new Map<string, string>();
  return {
    async get(key) {
      return m.get(key);
    },
    async set(key, value) {
      m.set(key, value);
    },
    async delete(key) {
      m.delete(key);
    },
    async keys() {
      return [...m.keys()];
    },
  };
}

export const TTL = {
  product: 7 * 24 * 3600 * 1000,
  productNotFound: 6 * 3600 * 1000,
  search: 3600 * 1000,
  category: 24 * 3600 * 1000,
  /** the database search was down: do not hammer it, try again in a while */
  categoryUnavailable: 10 * 60 * 1000,
  manufacturer: 30 * 24 * 3600 * 1000,
  insight: 14 * 24 * 3600 * 1000,
  translation: 180 * 24 * 3600 * 1000,
};
