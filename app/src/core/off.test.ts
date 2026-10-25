import { describe, expect, it } from "vitest";
import { isInStoreCode, foldText, matchScore, rankCandidates } from "./off";

describe("isInStoreCode", () => {
  it("recognises in-store price/weight labels (GS1 prefix 2)", () => {
    expect(isInStoreCode("2903331004168")).toBe(true); // HDL Radanovići scale label
  });
  it("keeps manufacturer codes", () => {
    expect(isInStoreCode("5120711004168")).toBe(false); // Primato, Montenegro
    expect(isInStoreCode("8594026123314")).toBe(false);
    expect(isInStoreCode("96385074")).toBe(false);
    expect(isInStoreCode("20217136")).toBe(false); // Lidl own brand (EAN-8), must stay searchable
    expect(isInStoreCode("20614089")).toBe(false);
  });
});

describe("text search ranking", () => {
  it("ignores diacritics and prefers candidates containing every query word", () => {
    expect(foldText("Zlaté Koka")).toBe("zlate koka");
    const words = ["zlate", "koka"];
    expect(matchScore(words, { name: "Zlaté Koka kakaové sušenky s kokosem", brand: "Opavia" })).toBe(1);
    expect(matchScore(words, { name: "Koka Noodles", brand: "Koka" })).toBe(0.5);
    expect(matchScore(words, { name: "Zlaté kolečka", brand: "Opavia" })).toBe(0.5);
    expect(matchScore(["susenky"], { name: "Zlaté Koka kakaové sušenky" })).toBe(1);
  });

  it("ranks exact answers first, then the user's countries", () => {
    const ranked = rankCandidates(
      "zlaté koka",
      [
        { id: "1", name: "Koka Noodles", brand: "Koka" },
        { id: "2", name: "Zlaté kolečka", brand: "Opavia" },
        { id: "3", name: "Zlaté Koka kakaové sušenky s kokosem", brand: "Opavia" },
      ],
      new Set(["2"]),
    );
    expect(ranked.map((c) => c.id)).toEqual(["3", "2", "1"]);
    expect(ranked[0]!.match).toBe(1);
  });
});
