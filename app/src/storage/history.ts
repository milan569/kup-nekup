import type { Assessment, Insight, ProductData, ProductResult, QuickInsight, Tone } from "../api/types";
import { productTokens, sameProduct } from "../core/identity";
import { readJson, removeKey, writeJson } from "./kv";

export interface HistoryEntry {
  id: string;
  at: string;
  /** result.assessment is the final one (AI-adjusted when an insight exists) */
  result: ProductResult;
  /** deep research (button) */
  insight?: Insight;
  /** fast first opinion */
  quick?: QuickInsight;
}

const HISTORY_KEY = "history";
const FAVORITES_KEY = "favorites";
const REPORTS_KEY = "reports";
const MAX_HISTORY = 200;

export async function loadHistory(): Promise<HistoryEntry[]> {
  const list = await readJson<HistoryEntry[]>(HISTORY_KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function addToHistory(result: ProductResult, insight?: Insight, quick?: QuickInsight, replaces?: string): Promise<void> {
  const list = await loadHistory();
  // a product refined by a supplementary photo replaces its earlier entry
  const filtered = list.filter((e) => e.id !== result.product.id && e.id !== replaces);
  const entry: HistoryEntry = { id: result.product.id, at: new Date().toISOString(), result, insight, quick };
  await writeJson(HISTORY_KEY, [entry, ...filtered].slice(0, MAX_HISTORY));
}

/**
 * Store the final assessment, the AI insight and (when the insight enriched it)
 * the updated product on the entry for this product (adds it when missing).
 */
export async function updateHistoryInsight(
  result: ProductResult,
  assessment: Assessment,
  insight: Insight,
  product?: ProductData,
): Promise<void> {
  const list = await loadHistory();
  const idx = list.findIndex((e) => e.id === result.product.id);
  if (idx >= 0) {
    const old = list[idx];
    list[idx] = { ...old, result: { ...old.result, assessment, product: product ?? old.result.product }, insight };
    await writeJson(HISTORY_KEY, list);
  } else {
    const entry: HistoryEntry = {
      id: result.product.id,
      at: new Date().toISOString(),
      result: { ...result, assessment, product: product ?? result.product },
      insight,
    };
    await writeJson(HISTORY_KEY, [entry, ...list].slice(0, MAX_HISTORY));
  }
}

/** Store the quick opinion (and the assessment when it changed) on the entry for this product. */
export async function updateHistoryQuick(result: ProductResult, quick: QuickInsight, assessment?: Assessment): Promise<void> {
  const list = await loadHistory();
  const idx = list.findIndex((e) => e.id === result.product.id);
  if (idx >= 0) {
    const old = list[idx];
    // a stored deep insight owns the assessment; never overwrite it with the quick one
    const nextAssessment = !old.insight && assessment ? assessment : old.result.assessment;
    list[idx] = { ...old, result: { ...old.result, assessment: nextAssessment }, quick };
    await writeJson(HISTORY_KEY, list);
  } else {
    const entry: HistoryEntry = {
      id: result.product.id,
      at: new Date().toISOString(),
      result: { ...result, assessment: assessment ?? result.assessment },
      quick,
    };
    await writeJson(HISTORY_KEY, [entry, ...list].slice(0, MAX_HISTORY));
  }
}

// "The same product again?" lives in the engine (src/core/identity.ts), where it is unit-tested.
export { productTokens, sameProduct };

/** The newest history entry for the same product that already has an AI opinion (in the given tone, when known). */
export async function findSimilar(product: { id: string; name: string; brand?: string }, tone?: Tone): Promise<HistoryEntry | undefined> {
  const list = await loadHistory();
  const toneOf = (e: HistoryEntry) => e.insight?.tone ?? e.quick?.tone;
  return list.find((e) => (e.quick || e.insight) && (!tone || !toneOf(e) || toneOf(e) === tone) && sameProduct(e.result.product, product));
}

export async function removeFromHistory(id: string): Promise<void> {
  const list = await loadHistory();
  await writeJson(
    HISTORY_KEY,
    list.filter((e) => e.id !== id),
  );
}

export async function clearHistory(): Promise<void> {
  await removeKey(HISTORY_KEY);
}

export async function loadFavorites(): Promise<string[]> {
  const list = await readJson<string[]>(FAVORITES_KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function toggleFavorite(id: string): Promise<boolean> {
  const list = await loadFavorites();
  const has = list.includes(id);
  const next = has ? list.filter((x) => x !== id) : [id, ...list];
  await writeJson(FAVORITES_KEY, next);
  return !has;
}

export interface ErrorReport {
  productId: string;
  productName: string;
  text: string;
  at: string;
}

export async function addReport(report: ErrorReport): Promise<void> {
  const list = await readJson<ErrorReport[]>(REPORTS_KEY, []);
  await writeJson(REPORTS_KEY, [report, ...(Array.isArray(list) ? list : [])].slice(0, 100));
}
