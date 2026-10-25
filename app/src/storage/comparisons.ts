import type { CompareResult, ProductResult } from "../api/types";
import { readJson, writeJson } from "./kv";

/**
 * Comparisons the user ran, newest first. Saved automatically when a result
 * arrives; favourites use the same star list as products (storage/history.ts)
 * with the comparison id.
 */
export interface ComparisonEntry {
  /** "cmp:" + the sorted product ids, so the same basket is one entry */
  id: string;
  at: string;
  items: ProductResult[];
  quick?: CompareResult;
  deep?: CompareResult;
}

const KEY = "comparisons";
const MAX = 100;

export function comparisonId(items: { product: { id: string } }[]): string {
  return "cmp:" + items.map((r) => r.product.id).sort().join("+");
}

export async function loadComparisons(): Promise<ComparisonEntry[]> {
  const list = await readJson<ComparisonEntry[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function findComparison(id: string): Promise<ComparisonEntry | undefined> {
  return (await loadComparisons()).find((e) => e.id === id);
}

/** Insert or refresh (newest first). */
export async function saveComparison(entry: ComparisonEntry): Promise<void> {
  const list = await loadComparisons();
  const old = list.find((e) => e.id === entry.id);
  const merged: ComparisonEntry = { ...old, ...entry, quick: entry.quick ?? old?.quick, deep: entry.deep ?? old?.deep };
  await writeJson(KEY, [merged, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX));
}

export async function removeComparison(id: string): Promise<void> {
  const list = await loadComparisons();
  await writeJson(
    KEY,
    list.filter((e) => e.id !== id),
  );
}
