import { createStore, del, get, set } from "idb-keyval";

/**
 * Web variant of kv.ts: profile, history and settings live in IndexedDB
 * instead of localStorage (AsyncStorage's web backend), whose ~5 MB would
 * not hold 200 history entries with their AI opinions. Same API as kv.ts;
 * Metro picks this file on web.
 */
const PREFIX = "kupnekup:";
const store = createStore("kupnekup", "kv");

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await get<string>(PREFIX + key, store);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await set(PREFIX + key, JSON.stringify(value), store);
  } catch {
    // Storage is a convenience; never crash the app on a failed write.
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await del(PREFIX + key, store);
  } catch {
    // ignore
  }
}
