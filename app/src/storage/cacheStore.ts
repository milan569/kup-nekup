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
      return (await AsyncStorage.getItem(PREFIX + key)) ?? undefined;
    },
    async set(key, value) {
      await AsyncStorage.setItem(PREFIX + key, value);
    },
    async delete(key) {
      await AsyncStorage.removeItem(PREFIX + key);
    },
    async keys() {
      return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
    },
  };
}
