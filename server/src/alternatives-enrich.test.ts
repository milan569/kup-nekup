import { describe, expect, it } from "vitest";
import { eanFromOffUrl, keepNotWorse, looksLikeProductPhoto, matches, overlap, pickProductPage, tokens } from "./alternatives-enrich.js";

describe("alternative ↔ database matching", () => {
  it("normalises diacritics and drops filler words", () => {
    expect(tokens("Vídeňské párky z Vysočiny 250 g")).toEqual(["videnske", "parky", "vysociny", "250"]);
  });

  it("matches the same product with different wording", () => {
    expect(matches({ name: "Vídeňské párky", brand: "Váhala" }, { name: "Vídeňské párky jemné", brand: "Váhala a spol." })).toBe(true);
    expect(overlap("Indiana Jerky Beef Original", "Beef Jerky Original")).toBeGreaterThanOrEqual(0.5);
  });

  it("rejects a different product or brand", () => {
    expect(matches({ name: "Vídeňské párky", brand: "Váhala" }, { name: "Vídeňské párky", brand: "Kostelecké uzeniny" })).toBe(false);
    expect(matches({ name: "Maasdamer plátky", brand: "Milbona" }, { name: "Eidam 30 %", brand: "Milbona" })).toBe(false);
  });
});

describe("photo and code helpers", () => {
  it("reads the EAN from Open Food Facts links in any language", () => {
    expect(eanFromOffUrl("https://de.openfoodfacts.org/produkt/4056489605195/maasdamer-bio-in-scheiben-lidl")).toBe("4056489605195");
    expect(eanFromOffUrl("https://world.openfoodfacts.org/product/0017082883902")).toBe("0017082883902");
    expect(eanFromOffUrl("https://www.rohlik.cz/1234-beef-jerky")).toBeUndefined();
  });
  it("rejects logos as package photos", () => {
    expect(looksLikeProductPhoto("https://static.openfoodfacts.org/images/logos/off-logo-vertical-white-social-media-preview.png")).toBe(false);
    expect(looksLikeProductPhoto("https://images.openfoodfacts.org/images/products/405/648/960/5188/front_de.3.400.jpg")).toBe(true);
  });
});

describe("product page from a web search", () => {
  const hits = [
    { url: "https://voli.me/kategorije/76", title: "Maslinovo i druga ulja - Voli eCommerce" },
    { url: "https://primorski.me/info/barsko-zlato-u-klasteru", title: "Barsko zlato u klasteru najzdravijih maslinovih ulja Mediterana" },
    { url: "https://voli.me/proizvod/5126", title: "Ekstra djevičansko maslinovo ulje 750ml Barsko Zlato - Voli eCommerce" },
  ];

  it("prefers the shop product page over articles and category listings", () => {
    const alt = { name: "Ekstra djevičansko maslinovo ulje 750 ml Barsko Zlato", brand: "Barska uljara" };
    expect(pickProductPage(alt, hits)).toBe("https://voli.me/proizvod/5126");
  });

  it("returns nothing when no title resembles the product", () => {
    expect(pickProductPage({ name: "Vídeňské párky Váhala" }, hits)).toBeUndefined();
  });
});

describe("keepNotWorse", () => {
  const alt = (name: string, verdict?: "poklad" | "urcite_kup" | "jsou_lepsi" | "kup_jestli_musis" | "radsi_ne") => ({ name, whyBetter: "x", verdict });

  it("drops suggestions worse than the product and puts the best first", () => {
    const { kept, dropped } = keepNotWorse([alt("průměr", "jsou_lepsi"), alt("šmejd", "radsi_ne"), alt("poklad", "poklad"), alt("neznámý")], "jsou_lepsi");
    expect(kept.map((a) => a.name)).toEqual(["poklad", "průměr", "neznámý"]);
    expect(dropped).toBe(1);
  });

  it("keeps everything when the product itself is unknown", () => {
    expect(keepNotWorse([alt("a", "radsi_ne"), alt("b")], "nevime").kept).toHaveLength(2);
  });
});
