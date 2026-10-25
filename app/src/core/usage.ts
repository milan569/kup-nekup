import { MODEL, PRICES, WEB_SEARCH_PER_1K } from "./config";

/**
 * Every call to Claude reports its token and web-search usage here. The app
 * turns that into an estimated spend shown in the profile and into a daily
 * cap: the only cost guard left once there is no server.
 */
export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null;
}

export interface UsageEvent {
  label: string;
  model: string;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  searches: number;
  fetches: number;
  at: string;
}

type Listener = (e: UsageEvent) => void;
/** Returns a Czech message when AI calls must not start now (daily cap reached), otherwise undefined. */
type Guard = () => string | undefined;

let listener: Listener | undefined;
let guard: Guard | undefined;

export function setUsageListener(fn: Listener | undefined): void {
  listener = fn;
}

export function setSpendGuard(fn: Guard | undefined): void {
  guard = fn;
}

export class DailyCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyCapError";
  }
}

/** Call before any request that spends credit. */
export function assertSpendAllowed(): void {
  const blocked = guard?.();
  if (blocked) throw new DailyCapError(blocked);
}

export function estimateCost(u: UsageLike, model: string): number {
  const p = PRICES[model] ?? PRICES[MODEL]!;
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
      1_000_000 +
    (searches * WEB_SEARCH_PER_1K) / 1000
  );
}

export function recordUsage(u: UsageLike | null | undefined, model: string, label: string): number {
  if (!u) return 0;
  const usd = estimateCost(u, model);
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  const fetches = u.server_tool_use?.web_fetch_requests ?? 0;
  console.log(
    `[${label}] ${model} in ${u.input_tokens} (+cache ${u.cache_read_input_tokens ?? 0}/${u.cache_creation_input_tokens ?? 0}) out ${u.output_tokens}, searches ${searches}, fetches ${fetches}, ~${usd.toFixed(4)} USD`,
  );
  try {
    listener?.({ label, model, usd, inputTokens: u.input_tokens, outputTokens: u.output_tokens, searches, fetches, at: new Date().toISOString() });
  } catch {
    // a listener bug must never break a lookup
  }
  return usd;
}
