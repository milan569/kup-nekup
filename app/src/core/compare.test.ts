import { describe, expect, it } from "vitest";
import { buildCompareResult, compareKey } from "./compare";
import { normalizeUrl } from "./insight";
import type { CompareItem } from "./types";

const item = (id: string, name: string, verdict: CompareItem["assessment"]["verdict"]): CompareItem => ({
  product: { id, name, source: "off", dataCompleteness: "full", fetchedAt: "x" },
  assessment: { verdict, confidence: "high", reasons: [], breakdown: {}, hardRules: [], profileWarnings: [] },
});
const items = [item("a", "Párky A", "urcite_kup"), item("b", "Párky B", "radsi_ne")];
const hits = new Map([[normalizeUrl("https://www.dtest.cz/testy/parky"), { url: "https://www.dtest.cz/testy/parky", title: "dTest – párky" }]]);

describe("buildCompareResult", () => {
  it("keeps valid unique indices, numbers the places and limits verdict shifts to one step", () => {
    const r = buildCompareResult(
      {
        comparable: "yes",
        headline: "A vede",
        summary: "A má víc masa.",
        winnerIndex: 0,
        ranking: [
          { index: 0, verdict: "poklad", pros: ["90 % masa"], cons: [], note: "víc masa" },
          { index: 1, verdict: "sracka", pros: [], cons: ["separát"], note: "náhražky" },
          { index: 1, verdict: "sracka", pros: [], cons: [], note: "duplicate" },
          { index: 7, verdict: "poklad", pros: [], cons: [], note: "out of range" },
        ],
        confidence: "high",
        sources: [{ title: "dTest", url: "https://www.dtest.cz/testy/parky" }, { title: "fake", url: "https://made-up.example" }],
      },
      items,
      hits,
      "quick",
    );
    expect(r.ranking.map((x) => [x.index, x.place, x.verdict])).toEqual([
      [0, 1, "poklad"],
      [1, 2, "nekupuj"],
    ]);
    expect(r.winnerIndex).toBe(0);
    expect(r.sources).toEqual([{ title: "dTest", url: "https://www.dtest.cz/testy/parky" }]);
    expect(r.mode).toBe("quick");
  });

  it("ranks nothing and names no winner when the products are not comparable", () => {
    const r = buildCompareResult(
      { comparable: "no", headline: "Olej vs. čokoláda", summary: "Každý jiný.", winnerIndex: 0, ranking: [{ index: 0, verdict: "poklad", pros: [], cons: [], note: "" }], confidence: "high", sources: [] },
      items,
      new Map(),
      "quick",
    );
    expect(r.ranking).toEqual([]);
    expect(r.winnerIndex).toBeUndefined();
  });

  it("falls back to the first ranked product as winner", () => {
    const r = buildCompareResult(
      { comparable: "partly", headline: "", summary: "", winnerIndex: -1, ranking: [{ index: 1, verdict: "radsi_ne", pros: [], cons: [], note: "" }], confidence: "low", sources: [] },
      items,
      new Map(),
      "deep",
    );
    expect(r.winnerIndex).toBe(1);
  });
});

describe("compareKey", () => {
  it("does not depend on the order of the basket", () => {
    expect(compareKey(items, "humor", "quick", "v")).toBe(compareKey([items[1]!, items[0]!], "humor", "quick", "v"));
    expect(compareKey(items, "humor", "quick", "v")).not.toBe(compareKey(items, "serious", "quick", "v"));
  });
});
