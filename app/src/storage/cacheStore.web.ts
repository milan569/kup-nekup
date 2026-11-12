import { createStore, del, get, keys, set } from "idb-keyval";
import type { CacheStore } from "../core/cache";

/**
 * Product/insight cache in the browser: IndexedDB, its own database, so the
 * quota is far above localStorage's ~5 MB and a full cache never evicts the
 * profile or the history.
 */
const store = createStore("kupnekup-cache", "kv");

export function platformCacheStore(): CacheStore {
  return {
    async get(key) {
      try {
        const v = await get<string>(key, store);
        return typeof v === "string" ? v : undefined;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        await set(key, value, store);
      } catch (err) {
        console.warn("[cache] write failed:", (err as Error).message);
      }
    },
    async delete(key) {
      try {
        await del(key, store);
      } catch {
        // ignore
      }
    },
    async keys() {
      try {
        return (await keys<string>(store)).filter((k): k is string => typeof k === "string");
      } catch {
        return [];
      }
    },
  };
}
