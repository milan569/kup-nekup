import { describe, expect, it } from "vitest";
import { cleanCategoryTags, jaccard } from "./alternatives.js";

describe("cleanCategoryTags", () => {
  it("keeps canonical English taxonomy tags only", () => {
    expect(
      cleanCategoryTags(["en:breakfasts", "en:sweet-spreads", "en:Petit-déjeuners", "fr:Nutella", "en:Pâtes à tartiner", "de:Fruchtkonfitüren"]),
    ).toEqual(["en:breakfasts", "en:sweet-spreads"]);
  });
});

describe("jaccard", () => {
  const nutella = ["en:breakfasts", "en:spreads", "en:sweet-spreads", "en:confectionary-based-spreads"];

  it("ranks a chocolate spread above a jam", () => {
    const choco = ["en:breakfasts", "en:spreads", "en:sweet-spreads", "en:chocolate-spreads", "en:hazelnut-spreads", "en:cocoa-and-hazelnuts-spreads"];
    const jam = ["en:plant-based-foods-and-beverages", "en:plant-based-foods", "en:fruits-based-foods", "en:breakfasts", "en:spreads", "en:sweet-spreads", "en:fruit-and-vegetable-preserves", "en:jams", "en:berry-jams"];
    expect(jaccard(nutella, choco)).toBeGreaterThan(jaccard(nutella, jam));
  });

  it("puts a mis-tagged legume product below the similarity threshold", () => {
    const barley = [
      "en:plant-based-foods-and-beverages", "en:plant-based-foods", "en:fruits-and-vegetables-based-foods", "en:legumes-and-their-products",
      "en:breakfasts", "en:fruits-based-foods", "en:legumes", "en:seeds", "en:spreads", "en:legume-seeds", "en:plant-based-spreads",
      "en:sweet-spreads", "en:fruit-and-vegetable-preserves", "en:pulses", "en:jams", "en:mixed-fruit-jams",
    ];
    expect(jaccard(nutella, barley)).toBeLessThan(0.2);
  });

  it("handles empty input", () => {
    expect(jaccard([], [])).toBe(0);
  });
});
