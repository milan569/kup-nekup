import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CacheStore } from "../core/cache";

/**
 * Product/insight cache on the phone (native). The web build uses
 * cacheStore.web.ts (IndexedDB) instead; Metro picks the file by platform.
 */
const PREFIX = "kupnekup-cache:";

export function platformCacheStore(): CacheStore {
  return {
    async get(key) {
      try {
        return (await AsyncStorage.getItem(PREFIX + key)) ?? undefined;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        await AsyncStorage.setItem(PREFIX + key, value);
      } catch (err) {
        console.warn("[cache] write failed:", (err as Error).message);
      }
    },
    async delete(key) {
      try {
        await AsyncStorage.removeItem(PREFIX + key);
      } catch {
        // ignore
      }
    },
    async keys() {
      try {
        return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
      } catch {
        return [];
      }
    },
  };
}
