import { readJson, removeKey, writeJson } from "./kv";

/**
 * The Claude API key, stored only on this device (IndexedDB on web,
 * AsyncStorage on the phone). It is never put in a URL, a log or the repo.
 */
const KEY = "claude-key";

export async function loadClaudeKey(): Promise<string> {
  const k = await readJson<string>(KEY, "");
  return typeof k === "string" ? k.trim() : "";
}

export async function saveClaudeKey(key: string): Promise<void> {
  await writeJson(KEY, key.trim());
}

export async function clearClaudeKey(): Promise<void> {
  await removeKey(KEY);
}
