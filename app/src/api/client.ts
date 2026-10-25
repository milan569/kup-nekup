import Anthropic from "@anthropic-ai/sdk";
import { hasApiKey, keyFormatProblem, setApiKey, testApiKey } from "../core/anthropic";
import { Cache } from "../core/cache";
import { MODEL } from "../core/config";
import { ApiError, describeError, toApiError } from "../core/errors";
import * as lookup from "../core/lookup";
import { setSpendGuard, setUsageListener } from "../core/usage";
import { platformCacheStore } from "../storage/cacheStore";
import { addSpend, spendGuardMessage } from "../storage/spend";
import { withWakeLock } from "../utils/wakeLock";
import type {
  Alternative,
  AlternativesRequest,
  AlternativesResearchRequest,
  AlternativesResearchResponse,
  CompareRequest,
  CompareResponse,
  EanLookupRequest,
  IngredientInfoResponse,
  InsightRequest,
  InsightResponse,
  ManualLookupRequest,
  ManufacturerInfo,
  ManufacturerRequest,
  PhotoLookupRequest,
  ProductResult,
  QuickInsightResponse,
  SearchCandidate,
} from "./types";

/**
 * The app's "API": the same calls the screens always made, now answered on
 * the device by src/core instead of a server. Every failure becomes an
 * ApiError with a short Czech message (kind "auth" = no Claude key or a
 * rejected one; code "in_store_code" = a shop scale label).
 */

export { ApiError, describeError, hasApiKey, keyFormatProblem };

const cache = new Cache(platformCacheStore());
lookup.initLookup(cache);
setUsageListener((e) => {
  void addSpend(e.usd);
});
setSpendGuard(spendGuardMessage);
// old cache entries go after start-up, not on the critical path
setTimeout(() => {
  void cache.sweep();
}, 8000);

/** Called by the profile provider when the stored key loads or changes. */
export function setClaudeApiKey(key: string | undefined): void {
  setApiKey(key);
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toApiError(err);
  }
}

export const api = {
  /** Checks a key without spending credit (a GET of the model record). */
  async testKey(key: string): Promise<{ model: string }> {
    try {
      return await testApiKey(key);
    } catch (err) {
      if (err instanceof Anthropic.NotFoundError) {
        throw new ApiError("http", `Klíč platí, ale model ${MODEL} není pro vaši organizaci dostupný. Zkontrolujte v Claude Console, že máte kredit.`, 404);
      }
      throw toApiError(err);
    }
  },

  lookupEan(body: EanLookupRequest): Promise<ProductResult> {
    return call(() => lookup.lookupEan(body));
  },

  lookupPhoto(body: PhotoLookupRequest): Promise<ProductResult> {
    return call(() => lookup.lookupPhoto(body));
  },

  lookupManual(body: ManualLookupRequest): Promise<ProductResult> {
    return call(() => lookup.lookupManual(body));
  },

  search(q: string, countries: string[]): Promise<{ candidates: SearchCandidate[]; via?: "off" | "ai" | "none" }> {
    return call(() => lookup.search(q, countries));
  },

  manufacturer(body: ManufacturerRequest): Promise<ManufacturerInfo> {
    return call(() => lookup.manufacturer(body));
  },

  alternatives(body: AlternativesRequest): Promise<{ alternatives: Alternative[] }> {
    return call(() => lookup.alternatives(body));
  },

  /** fast first opinion with a short web check (10–20 s) */
  quickInsight(body: InsightRequest): Promise<QuickInsightResponse> {
    return call(() => withWakeLock(() => lookup.quickInsight(body)));
  },

  /** closest alternatives of the same kind in one country (web research, up to ~1 min) */
  alternativesResearch(body: AlternativesResearchRequest): Promise<AlternativesResearchResponse> {
    return call(() => withWakeLock(() => lookup.alternativesResearch(body)));
  },

  /** quick comparison of the basket (rules + short web check, 10–20 s) */
  compareQuick(body: CompareRequest): Promise<CompareResponse> {
    return call(() => withWakeLock(() => lookup.compareQuick(body)));
  },

  /** deep comparison: full research of every product first (1–3 min) */
  compare(body: CompareRequest): Promise<CompareResponse> {
    return call(() => withWakeLock(() => lookup.compare(body)));
  },

  /** ingredient list in Czech (foreign lists are translated once and cached) */
  translateIngredients(body: { text: string }): Promise<{ text: string; translated: boolean; cached: boolean; items: { text: string; severity: number }[] }> {
    return call(() => lookup.translateIngredients(body));
  },

  /** health impact of one tapped ingredient (bundled tables, no AI cost) */
  ingredientInfo(body: { q?: string; ref?: string; context?: string }): Promise<IngredientInfoResponse> {
    return call(() => lookup.ingredientInfo(body));
  },

  /** deep research: 1–3 minutes, keep the screen on */
  insight(body: InsightRequest): Promise<InsightResponse> {
    return call(() => withWakeLock(() => lookup.insight(body)));
  },
};
