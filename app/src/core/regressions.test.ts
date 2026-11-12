import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, TTL, memoryStore } from "./cache";
import { barcodeDigits } from "./claude";
import { alternativesBaseline, buildInsight, combine } from "./insight";
import { fetchByEan } from "./off";
import type { Assessment, Insight, ProductData } from "./types";

/**
 * Regressions from the review of 2026-11-12: each test pins one fixed bug.
 */

function product(partial: Partial<ProductData> = {}): ProductData {
  return { id: "1", name: "Tatranky", categoryTags: [], source: "off", dataCompleteness: "full", fetchedAt: "", ...partial };
}

function rule(verdict: Assessment["verdict"], score?: number): Assessment {
  return { verdict, score, confidence: "high", reasons: [], breakdown: {}, hardRules: [], profileWarnings: [] };
}

function ai(verdict: Insight["verdict"], confidence: Insight["confidence"] = "high"): Pick<Insight, "verdict" | "confidence" | "headline"> {
  return { verdict, confidence, headline: "Titulek." };
}

describe("alternativesBaseline: alternatives must beat the verdict on screen", () => {
  it("ignores a low-confidence AI verdict, as combine does", () => {
    expect(alternativesBaseline(product(), rule("urcite_kup", 80), ai("kup_jestli_musis", "low"))).toBe("urcite_kup");
  });

  it("moves one step towards a kinder AI verdict, not all the way", () => {
    expect(alternativesBaseline(product(), rule("kup_jestli_musis", 50), ai("poklad"))).toBe("jsou_lepsi");
  });

  it("falls back to the AI verdict when the rules know nothing", () => {
    expect(alternativesBaseline(product(), rule("nevime"), ai("radsi_ne"))).toBe("radsi_ne");
  });
});

describe("combine", () => {
  it("never grants poklad on a composition copied from the web", () => {
    const p = product({ compositionSource: { url: "https://shop.example/x", title: "E-shop" } });
    expect(combine(p, rule("urcite_kup", 80), ai("poklad")).verdict).toBe("urcite_kup");
  });

  it("keeps the AI headline out of the stored reason (the card shows it in the current tone)", () => {
    const a = combine(product(), rule("kup_jestli_musis", 50), ai("poklad"));
    expect(a.reasons[0]!.text).toMatch(/Posudek AI zlepšil verdikt/);
    expect(a.reasons[0]!.text).not.toContain("Titulek.");
  });
});

describe("barcodeDigits", () => {
  it("keeps digits only and rejects anything that is not a barcode", () => {
    expect(barcodeDigits("4 056489 605195")).toBe("4056489605195");
    expect(barcodeDigits("EAN: 8594026123314")).toBe("8594026123314");
    expect(barcodeDigits("12345")).toBeUndefined();
    expect(barcodeDigits("")).toBeUndefined();
    expect(barcodeDigits(null)).toBeUndefined();
  });
});

describe("Cache.sweep", () => {
  it("keeps translations for their long TTL but drops month-old products", async () => {
    const store = memoryStore();
    const c = new Cache(store);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now - 40 * 24 * 3600 * 1000);
    await c.set("product", "p", { name: "old" });
    await c.set("translation", "t", "starý překlad");
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(await c.sweep()).toBe(1);
    expect(await c.get("product", "p")).toBeUndefined();
    expect(await c.get("translation", "t", TTL.translation)).toBe("starý překlad");
    vi.restoreAllMocks();
  });
});

describe("fetchByEan: the food database decides 'unknown'", () => {
  afterEach(() => vi.unstubAllGlobals());

  const notFoundResponse = { status: 404, ok: false, headers: { get: () => null }, json: async () => ({}) };

  it("answers notFound when OFF says 404 even though the side databases fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("openfoodfacts.org")) return notFoundResponse;
        throw new TypeError("Failed to fetch");
      }),
    );
    const r = await fetchByEan("2903331004168");
    expect(r.product).toBeUndefined();
    expect(r.notFound).toBe(true);
    expect(r.errors.length).toBe(2);
  });

  it("reports unavailable when OFF itself failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("openfoodfacts.org")) throw new TypeError("Failed to fetch");
        return notFoundResponse;
      }),
    );
    const r = await fetchByEan("8594026123314");
    expect(r.notFound).toBe(false);
    expect(r.errors[0]).toMatch(/^off:/);
  });
});

// buildInsight is imported so the module graph matches the app's (insight → alternatives-enrich → off)
void buildInsight;
