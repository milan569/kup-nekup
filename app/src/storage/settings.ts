import { readJson, writeJson } from "./kv";

const KEY = "settings";

export interface AppSettings {
  apiUrl: string;
  /** sent as `x-app-token` when non-empty */
  appToken: string;
}

export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8787";
export const DEFAULT_APP_TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN || "";

export async function loadSettings(): Promise<AppSettings> {
  const s = await readJson<Partial<AppSettings>>(KEY, {});
  return {
    apiUrl: typeof s.apiUrl === "string" && s.apiUrl.trim() ? s.apiUrl.trim() : DEFAULT_API_URL,
    // An explicitly stored empty string means "no token" and wins over the env default.
    appToken: typeof s.appToken === "string" ? s.appToken.trim() : DEFAULT_APP_TOKEN,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJson(KEY, {
    apiUrl: settings.apiUrl.trim().replace(/\/+$/, ""),
    appToken: settings.appToken.trim(),
  });
}
