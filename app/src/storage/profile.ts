import { EMPTY_PROFILE, type UserProfile } from "../api/types";
import { readJson, writeJson } from "./kv";

const KEY = "profile";

/** Returns null when the user has not completed onboarding yet. */
export async function loadProfile(): Promise<UserProfile | null> {
  const stored = await readJson<UserProfile | null>(KEY, null);
  if (!stored) return null;
  return normalizeProfile(stored);
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await writeJson(KEY, normalizeProfile(profile));
}

export function normalizeProfile(p: Partial<UserProfile>): UserProfile {
  return {
    countries: Array.isArray(p.countries) && p.countries.length ? p.countries : EMPTY_PROFILE.countries,
    stores: Array.isArray(p.stores) ? p.stores : [],
    allergens: Array.isArray(p.allergens) ? p.allergens : [],
    diets: Array.isArray(p.diets) ? p.diets : [],
    avoid: Array.isArray(p.avoid) ? p.avoid : [],
    showSustainability: p.showSustainability ?? true,
    tone: p.tone === "serious" ? "serious" : "humor",
  };
}
