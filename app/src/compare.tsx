import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ProductResult } from "./api/types";
import { readJson, writeJson } from "./storage/kv";

/**
 * The comparison basket: 2–4 scanned, photographed or typed products the
 * user wants judged against each other. Lives across tabs and app restarts.
 * `collecting` = the next lookup result goes into the basket instead of
 * opening its own result screen.
 */
export const MAX_COMPARE = 4;
const KEY = "compare-basket";

interface CompareContextValue {
  items: ProductResult[];
  /** false when the basket is full or the product is already in it */
  add: (result: ProductResult) => boolean;
  remove: (productId: string) => void;
  /** refresh a basket entry when its result changed (AI opinion arrived, supplementary photo) */
  update: (result: ProductResult) => void;
  /** reopen a stored comparison: the basket becomes its products */
  replaceAll: (results: ProductResult[]) => void;
  clear: () => void;
  has: (productId: string) => boolean;
  collecting: boolean;
  setCollecting: (on: boolean) => void;
}

const CompareContext = createContext<CompareContextValue | null>(null);

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ProductResult[]>([]);
  const [collecting, setCollecting] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    readJson<ProductResult[]>(KEY, [])
      .then((saved) => {
        if (Array.isArray(saved)) setItems(saved.slice(0, MAX_COMPARE));
      })
      .catch(() => undefined)
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  useEffect(() => {
    if (loaded.current) writeJson(KEY, items).catch(() => undefined);
  }, [items]);

  const add = useCallback((result: ProductResult): boolean => {
    let ok = false;
    setItems((prev) => {
      if (prev.length >= MAX_COMPARE || prev.some((r) => r.product.id === result.product.id)) return prev;
      ok = true;
      return [...prev, result];
    });
    return ok;
  }, []);
  const remove = useCallback((productId: string) => setItems((prev) => prev.filter((r) => r.product.id !== productId)), []);
  const update = useCallback(
    (result: ProductResult) =>
      setItems((prev) => {
        const i = prev.findIndex((r) => r.product.id === result.product.id);
        if (i < 0 || prev[i]!.assessment === result.assessment) return prev;
        const next = prev.slice();
        next[i] = result;
        return next;
      }),
    [],
  );
  const replaceAll = useCallback((results: ProductResult[]) => setItems(results.slice(0, MAX_COMPARE)), []);
  const clear = useCallback(() => setItems([]), []);
  const has = useCallback((productId: string) => items.some((r) => r.product.id === productId), [items]);

  const value = useMemo(
    () => ({ items, add, remove, update, replaceAll, clear, has, collecting, setCollecting }),
    [items, add, remove, update, replaceAll, clear, has, collecting],
  );
  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare(): CompareContextValue {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error("useCompare must be used inside CompareProvider");
  return ctx;
}
