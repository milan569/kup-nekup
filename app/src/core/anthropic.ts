import Anthropic from "@anthropic-ai/sdk";
import { API_BASE_URL, MODEL } from "./config";
import { ClaudeNotConfiguredError } from "./errors";

/**
 * The Claude key lives in memory here (loaded from the device storage by the
 * app) and nowhere else. Calls go straight from the phone to api.anthropic.com,
 * which is why the browser flag is set: there is no server in between.
 */

type Profile = "default" | "insight" | "search" | "translate";

const OPTIONS: Record<Profile, { timeout: number; maxRetries: number }> = {
  default: { timeout: 45_000, maxRetries: 1 },
  // research runs up to four minutes; a silent retry would pay for it twice, the UI has a retry button
  insight: { timeout: 240_000, maxRetries: 0 },
  search: { timeout: 20_000, maxRetries: 0 },
  translate: { timeout: 30_000, maxRetries: 1 },
};

let apiKey: string | undefined;
const clients = new Map<Profile, Anthropic>();

export function setApiKey(key: string | undefined): void {
  const k = key?.trim();
  apiKey = k || undefined;
  clients.clear();
}

export function hasApiKey(): boolean {
  return !!apiKey;
}

/**
 * Format check only (never logs the value). Console keys start with
 * "sk-ant-" – "sk-ant-api03-…" (classic) or "sk-ant-usr…" (user-linked) –
 * and contain only letters, digits, "-", "_". Admin keys and OAuth tokens
 * cannot call the model.
 */
export function keyFormatProblem(key: string | undefined = apiKey): string | undefined {
  const k = key?.trim();
  if (!k) return "klíč chybí";
  if (!k.startsWith("sk-ant-")) return "to není klíč z Claude Console (musí začínat sk-ant-)";
  const tag = /^sk-ant-([a-z]+)/.exec(k)?.[1] ?? "";
  if (["admin", "oat", "ort", "sid"].includes(tag)) return `sk-ant-${tag}… není API klíč pro dotazy na model – vytvořte klíč v Keys & access → Create key`;
  if (!/^[A-Za-z0-9_-]+$/.test(k)) return "klíč obsahuje nepovolené znaky (mezera, tečka, uvozovky?) – zkopírujte ho znovu celý";
  return undefined;
}

export function getClient(profile: Profile = "default"): Anthropic {
  if (!apiKey) throw new ClaudeNotConfiguredError();
  let c = clients.get(profile);
  if (!c) {
    c = new Anthropic({ apiKey, baseURL: API_BASE_URL, ...OPTIONS[profile], dangerouslyAllowBrowser: true });
    clients.set(profile, c);
  }
  return c;
}

/**
 * Checks a key for real without spending credit: a GET of the model record.
 * 401 = bad key, 404 = the model is not available to this organisation.
 */
export async function testApiKey(key: string): Promise<{ model: string }> {
  const c = new Anthropic({ apiKey: key.trim(), baseURL: API_BASE_URL, timeout: 15_000, maxRetries: 0, dangerouslyAllowBrowser: true });
  const m = await c.models.retrieve(MODEL);
  return { model: m.id };
}
