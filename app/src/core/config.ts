/**
 * Runtime constants of the engine. The server read these from environment
 * variables; the app has no environment, so they live here. Change a model
 * or a limit by editing this file and publishing a new version.
 */

/** pinned so nothing can redirect the key elsewhere */
export const API_BASE_URL = "https://api.anthropic.com";

/** main model: label photos, manual entry, manufacturer card, research */
export const MODEL: string = "claude-opus-5-5";
export const INSIGHT_MODEL: string = MODEL;
export const INSIGHT_EFFORT: "low" | "medium" | "high" = "medium";
export const INSIGHT_MAX_SEARCHES = 12;
export const INSIGHT_MAX_FETCHES = 4;
export const QUICK_MAX_SEARCHES = 3;
export const COMPARE_MAX_SEARCHES = 2;
export const ALT_RESEARCH_MAX_SEARCHES = 6;
export const ALT_RESEARCH_MAX_FETCHES = 2;

/** small fast model: ingredient translation and the one-shot product search */
export const TRANSLATE_MODEL: string = "claude-haiku-5-5";
export const SEARCH_MODEL: string = "claude-haiku-5-5";

export interface ModelPrice {
  /** USD per 1M tokens */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** List prices (Claude API, 2026-10) used only to estimate the spend shown in the app. */
export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** USD per 1 000 web searches; web fetch has no extra fee */
export const WEB_SEARCH_PER_1K = 10;

/** Open Food Facts identifies apps by User-Agent; browsers cannot set it, so the query string carries the name. */
export const OFF_APP_NAME = "kup-nekup";
export const OFF_APP_VERSION = "0.2";
