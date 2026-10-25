import type { Assessment, Insight, ProductData, ProductResult, QuickInsight } from "../api/types";
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

// ---- the same product again? (name + brand, ignoring size, vintage, packaging) ----

const NOISE =
  /\b\d+([.,]\d+)?\s*(g|kg|mg|ml|l|cl|dl|%|ks|pcs|x|st)\b|\b(19|20)\d{2}\b|\b(plech(ovka)?|lahev|láhev|sklo|pet|baleni|balení|multipack|karton|sacek|sáček|kelimek|kelímek|vratna|vratná|nevratna|nevratná|family|mini|maxi|xl|xxl)\b/giu;

export function productTokens(s: string | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(NOISE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1);
}

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

/** "Balans obrok 330 g" (Imlek) and "Balans obrok 500 g" (Imlek) are the same product. */
export function sameProduct(a: { id: string; name: string; brand?: string }, b: { id: string; name: string; brand?: string }): boolean {
  if (a.id === b.id) return true;
  const na = productTokens(a.name);
  const nb = productTokens(b.name);
  if (overlap(na, nb) < 0.75) return false;
  const ba = productTokens(a.brand);
  const bb = productTokens(b.brand);
  if (ba.length && bb.length) return overlap(ba, bb) >= 0.5;
  // one side has no brand: the names together must still match
  return overlap([...na, ...ba], [...nb, ...bb]) >= 0.75;
}

/** The newest history entry for the same product that already has an AI opinion. */
export async function findSimilar(product: { id: string; name: string; brand?: string }): Promise<HistoryEntry | undefined> {
  const list = await loadHistory();
  return list.find((e) => (e.quick || e.insight) && sameProduct(e.result.product, product));
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
