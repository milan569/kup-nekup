import { describe, expect, it } from "vitest";
import { applyValue, buildInsight, combine, dtestRef, normalizeUrl, toValue, type SubmittedT } from "./insight.js";
import { applyFoundComposition } from "./ingredients.js";
import { assess } from "./scoring.js";
import type { Assessment, Insight, ProductData } from "./types.js";

const hits = new Map(
  [
    { url: "https://www.idnes.cz/ekonomika/opavia-mondelez.A123", title: "Opavia pod Mondelezem" },
    { url: "https://www.potravinynapranyri.cz/Detail.aspx?id=42", title: "Potraviny na pranýři" },
    { url: "https://www.dtest.cz/clanek-1234/test-oplatek", title: "dTest: oplatky" },
    { url: "https://www.kroger.com/p/jack-link-s-jalapeno-beef-jerky/0001782200093", title: "Kroger – Jack Link's Jalapeño" },
    { url: "https://www.rohlik.cz/1234-beef-jerky", title: "Rohlik – Beef Jerky" },
  ].map((h) => [normalizeUrl(h.url), h]),
);

const noNutrition = { energyKcal: -1, fat: -1, saturatedFat: -1, carbs: -1, sugars: -1, fiber: -1, proteins: -1, salt: -1 };

const submitted: SubmittedT = {
  verdict: "radsi_ne",
  headline: "Kdysi legenda, dnes korporátní oplatka.",
  opinion: "Po převzetí koncernem se receptura zhoršila.",
  manufacturer: { name: "Mondelez Czech Republic", type: "industrial", country: "CZ", owner: "Mondelez International", summary: "Nadnárodní koncern." },
  history: [
    { year: "2007", text: "Značku převzal Kraft Foods, později Mondelez.", impact: "negative", sourceUrl: "https://idnes.cz/ekonomika/opavia-mondelez.A123/" },
    { year: "", text: "Výroba v Opavě.", impact: "neutral", sourceUrl: "" },
  ],
  recipeChange: { changed: "yes", summary: "Méně ořechů, více rostlinného tuku.", sourceUrl: "https://www.dtest.cz/clanek-1234/test-oplatek?utm_source=x" },
  awards: [],
  issues: [
    { year: "2020", text: "Nevyhovující šarže.", impact: "negative", sourceUrl: "https://www.potravinynapranyri.cz/Detail.aspx?id=42" },
    { year: "2019", text: "Vymyšlená kauza.", impact: "negative", sourceUrl: "https://example.com/fake" },
    { year: "", text: "Kauza bez zdroje.", impact: "negative", sourceUrl: "" },
  ],
  reviews: { summary: "V testu dTestu průměr.", sourceUrl: "https://www.dtest.cz/clanek-1234/test-oplatek" },
  foundComposition: { found: false, ingredientsText: "", market: "", sourceUrl: "", nutritionPer100g: noNutrition },
  alternatives: [],
  sources: [{ title: "Smyšlený zdroj", url: "https://made-up.example/x" }],
  confidence: "high",
};

describe("buildInsight", () => {
  const insight = buildInsight(submitted, hits, true, "humor");

  it("keeps only URLs that search or fetch actually returned", () => {
    const urls = insight.sources.map((s) => s.url);
    expect(urls).toContain("https://www.idnes.cz/ekonomika/opavia-mondelez.A123");
    expect(urls).not.toContain("https://made-up.example/x");
    expect(urls).not.toContain("https://example.com/fake");
  });

  it("drops unsourced or fake-sourced issues but keeps sourced ones", () => {
    expect(insight.issues.map((i) => i.text)).toEqual(["Nevyhovující šarže."]);
  });

  it("maps empty strings to missing values", () => {
    expect(insight.history[1]!.year).toBeUndefined();
    expect(insight.history[1]!.sourceUrl).toBeUndefined();
    expect(insight.history[0]!.sourceUrl).toBe("https://www.idnes.cz/ekonomika/opavia-mondelez.A123");
  });

  it("accepts a recipe change only with a real source (utm params ignored)", () => {
    expect(insight.recipeChange.changed).toBe("yes");
    expect(insight.recipeChange.sourceUrl).toBe("https://www.dtest.cz/clanek-1234/test-oplatek");
    const noSource = buildInsight({ ...submitted, recipeChange: { changed: "yes", summary: "x", sourceUrl: "https://nope.example" } }, hits, true, "humor");
    expect(noSource.recipeChange.changed).toBe("unknown");
  });

  it("accepts a composition found online only from a page that was really searched or fetched", () => {
    const jerky = {
      found: true,
      ingredientsText: "Beef, Water, Sugar, Less than 2% of: Salt, Jalapeño Peppers, Soy Sauce, Flavorings, Sodium Nitrite.",
      market: "USA",
      sourceUrl: "https://www.kroger.com/p/jack-link-s-jalapeno-beef-jerky/0001782200093",
      nutritionPer100g: { ...noNutrition, energyKcal: 280, proteins: 39, sugars: 21, salt: 4.4 },
    };
    const ok = buildInsight({ ...submitted, foundComposition: jerky }, hits, true, "humor");
    expect(ok.foundComposition?.market).toBe("USA");
    expect(ok.foundComposition?.nutrition?.proteins).toBe(39);
    expect(ok.foundComposition?.nutrition?.fat).toBeUndefined();
    expect(ok.sources.some((s) => s.url.includes("kroger.com"))).toBe(true);
    const invented = buildInsight({ ...submitted, foundComposition: { ...jerky, sourceUrl: "https://shop.example/jerky" } }, hits, true, "humor");
    expect(invented.foundComposition).toBeUndefined();
  });

  it("keeps up to four alternatives and validates their links", () => {
    const alt = (n: string, url = "") => ({ name: n, brand: "Značka", whyBetter: "Kratší složení.", whereToBuy: "Lidl", sourceUrl: url, verdict: "urcite_kup" as const });
    const s = buildInsight(
      { ...submitted, alternatives: [alt("A", "https://www.rohlik.cz/1234-beef-jerky"), alt("B", "https://fake.example"), alt("C"), alt("D"), alt("E")] },
      hits,
      true,
      "humor",
    );
    expect(s.alternatives).toHaveLength(4);
    expect(s.alternatives![0]!.sourceUrl).toBe("https://www.rohlik.cz/1234-beef-jerky");
    expect(s.alternatives![1]!.sourceUrl).toBeUndefined();
  });

  it("marks the manufacturer as verified when sources exist", () => {
    expect(insight.manufacturer.verified).toBe(true);
    expect(insight.webResearch).toBe(true);
  });
});

function product(source: ProductData["source"] = "off", partial: Partial<ProductData> = {}): ProductData {
  return { id: "1", name: "Tatranky", categoryTags: [], source, dataCompleteness: "full", fetchedAt: "", ...partial };
}

function rule(verdict: Assessment["verdict"], score?: number, hardRules: string[] = []): Assessment {
  return { verdict, score, confidence: "high", reasons: [], breakdown: {}, hardRules, profileWarnings: [] };
}

function insightWith(verdict: Insight["verdict"], confidence: Insight["confidence"] = "high"): Insight {
  return { ...buildInsight(submitted, hits, true, "humor"), verdict, confidence };
}

describe("combine", () => {
  it("lets a harsher AI verdict win in full (Balans obrok case)", () => {
    const a = combine(product(), rule("poklad", 92), insightWith("kup_jestli_musis"));
    expect(a.verdict).toBe("kup_jestli_musis");
    expect(a.aiAdjusted).toEqual({ from: "poklad", to: "kup_jestli_musis" });
    expect(a.score).toBeLessThanOrEqual(59);
    expect(a.reasons[0]!.text).toMatch(/Posudek AI zhoršil/);
  });

  it("improves a label-based verdict by one step only", () => {
    const a = combine(product(), rule("kup_jestli_musis", 50), insightWith("poklad"));
    expect(a.verdict).toBe("jsou_lepsi");
    expect(a.reasons[0]!.text).toMatch(/Posudek AI zlepšil/);
  });

  it("uses the AI verdict for manual entries and unknown products", () => {
    expect(combine(product("manual"), rule("jsou_lepsi", 65), insightWith("poklad")).verdict).toBe("poklad");
    expect(combine(product(), rule("nevime"), insightWith("radsi_ne")).verdict).toBe("radsi_ne");
  });

  it("shows a low-confidence AI verdict instead of 'nevime' (Jack Link's case)", () => {
    const a = combine(product("photo"), rule("nevime"), insightWith("kup_jestli_musis", "low"));
    expect(a.verdict).toBe("kup_jestli_musis");
    expect(a.confidence).toBe("low");
    expect(a.reasons[0]!.text).toMatch(/pravidla neměla dost údajů/);
  });

  it("ignores low-confidence insights when rules have a verdict and never improves an allergen verdict", () => {
    expect(combine(product(), rule("jsou_lepsi", 65), insightWith("sracka", "low")).verdict).toBe("jsou_lepsi");
    expect(combine(product(), rule("nekupuj", 30, ["allergen:milk"]), insightWith("poklad")).verdict).toBe("nekupuj");
  });
});

describe("applyFoundComposition", () => {
  const comp = {
    ingredientsText: "hovězí maso, voda, cukr, sůl, sójová omáčka (voda, sója, pšenice, sůl), aroma, konzervant: dusitan sodný",
    nutrition: { energyKcal: 280, proteins: 39, sugars: 21, salt: 4.4 },
    market: "EU",
    sourceUrl: "https://www.rohlik.cz/1234-beef-jerky",
    sourceTitle: "Rohlik – Beef Jerky",
  };

  it("fills a product without ingredients and lets the rules produce a verdict", () => {
    const photo = product("photo", { name: "Jalapeño Beef Jerky", brand: "Jack Link's", dataCompleteness: "minimal" });
    expect(assess(photo).verdict).toBe("nevime");
    const enriched = applyFoundComposition(photo, comp);
    expect(enriched.compositionSource?.market).toBe("EU");
    expect(enriched.additives?.some((a) => a.code === "E250")).toBe(true);
    expect(enriched.allergens).toEqual(expect.arrayContaining(["soybeans", "gluten"]));
    expect(assess(enriched).verdict).not.toBe("nevime");
  });

  it("never overrides an ingredient list from the label", () => {
    const labelled = product("photo", { ingredientsText: "hovězí maso, sůl" });
    expect(applyFoundComposition(labelled, comp)).toBe(labelled);
  });
});

describe("dTest reference", () => {
  it("picks a dTest test or product page and cleans its title", () => {
    const ref = dtestRef([
      { url: "https://www.idnes.cz/x", title: "iDNES" },
      { url: "https://www.dtest.cz/testy/c565-cukrovinky-a-cokolady", title: "dTest: Cukrovinky a čokolády - Nezávislé testy" },
    ]);
    expect(ref).toEqual({ url: "https://www.dtest.cz/testy/c565-cukrovinky-a-cokolady", title: "Cukrovinky a čokolády" });
  });

  it("accepts a media report about a dTest test and takes the findings from the reviews text", () => {
    const ref = dtestRef(
      [{ url: "https://dvojka.rozhlas.cz/test-oplatek-a-trubicek-7535024", title: "ČRo Dvojka – Test oplatek a trubiček (dTest)" }],
      { summary: "dTest 2014: deset z 27 oplatek obsahovalo tuk s vysokým podílem trans-mastných kyselin; Horalky dopadly průměrně.", sourceUrl: "https://dvojka.rozhlas.cz/test-oplatek-a-trubicek-7535024" },
      "Horalky",
    );
    expect(ref).toMatchObject({ url: "https://dvojka.rozhlas.cz/test-oplatek-a-trubicek-7535024", year: "2014", productNamed: true });
    expect(ref?.summary).toContain("trans-mastných");
  });

  it("keeps only the sentences about dTest from a whole opinion", () => {
    const ref = dtestRef(
      [{ url: "https://www.dtest.cz/testy-vyrobku-443/plnene-oplatky", title: "dTest – Plněné oplatky" }],
      { summary: "Jestli máš chuť, dej si ji. Je to tuková bomba. dTest testoval plněné oplatky v roce 2014, Horalky v něm byly." },
      "Horalky",
    );
    expect(ref).toMatchObject({ url: "https://www.dtest.cz/testy-vyrobku-443/plnene-oplatky", year: "2014", productNamed: true });
    expect(ref?.summary).toBe("dTest testoval plněné oplatky v roce 2014, Horalky v něm byly.");
  });

  it("ignores the dTest home page and unrelated articles", () => {
    expect(dtestRef([{ url: "https://www.dtest.cz/", title: "dTest" }])).toBeUndefined();
    expect(dtestRef([{ url: "https://www.dtest.cz/clanek-5320/casto-kladene-otazky", title: "FAQ" }])).toBeUndefined();
    expect(dtestRef([])).toBeUndefined();
  });

  it("flows from the research sources into the insight", () => {
    const withDtest = buildInsight(
      { ...submitted, sources: [{ title: "dTest: Test plněných oplatek", url: "https://www.dtest.cz/clanek-1234/test-oplatek" }] },
      hits,
      true,
      "humor",
    );
    expect(withDtest.dtest).toMatchObject({ url: "https://www.dtest.cz/clanek-1234/test-oplatek", title: "Test plněných oplatek" });
    // the reviews text mentions dTest, so it becomes the public summary of the test
    expect(withDtest.dtest?.summary).toContain("dTestu");
  });
});

describe("price / value", () => {
  const resolve = (u: string) => hits.get(normalizeUrl(u))?.url;
  const overpriced = {
    verdict: "vyhozene_prachy" as const,
    reason: "Litr vyjde na 110 Kč, běžná pramenitá voda stojí 15 Kč.",
    cheaperOption: "Rajec 1,5 l za ~15 Kč",
    sourceUrl: "https://www.rohlik.cz/1234-beef-jerky",
  };

  it("keeps 'overpriced' only with a price page the search returned", () => {
    expect(toValue(overpriced, resolve)?.verdict).toBe("vyhozene_prachy");
    expect(toValue({ ...overpriced, sourceUrl: "https://made-up.example/price" }, resolve)).toBeUndefined();
    expect(toValue({ ...overpriced, reason: " " }, resolve)).toBeUndefined();
    expect(toValue({ verdict: "nevime", reason: "", cheaperOption: "", sourceUrl: "" }, resolve)).toBeUndefined();
  });

  const good: Assessment = {
    verdict: "urcite_kup",
    score: 80,
    confidence: "high",
    reasons: [{ kind: "positive", text: "Čisté složení." }],
    breakdown: {},
    hardRules: [],
    profileWarnings: [],
  };

  it("caps an overpriced product at 'jsou lepší' and says why first", () => {
    const v = toValue(overpriced, resolve)!;
    const a = applyValue(good, v, "high", "humor");
    expect(a.verdict).toBe("jsou_lepsi");
    expect(a.score).toBeLessThanOrEqual(73);
    expect(a.reasons[0]!.text).toMatch(/^💸 Vyhozený prachy: Litr/);
    expect(a.aiAdjusted).toEqual({ from: "urcite_kup", to: "jsou_lepsi" });
    expect(applyValue(good, v, "high", "serious").reasons[0]!.text).toMatch(/^💸 Předražené:/);
  });

  it("does not improve a worse verdict and ignores low confidence", () => {
    const v = toValue(overpriced, resolve)!;
    const bad = applyValue({ ...good, verdict: "nekupuj", score: 20 }, v, "medium");
    expect(bad.verdict).toBe("nekupuj");
    expect(bad.reasons[0]!.kind).toBe("negative");
    expect(applyValue(good, v, "low")).toBe(good);
    expect(applyValue(good, undefined, "high")).toBe(good);
  });

  it("good value only adds a positive reason", () => {
    const v = toValue({ verdict: "vyhodne", reason: "Poctivá šunka za běžnou cenu.", cheaperOption: "", sourceUrl: "" }, resolve)!;
    const a = applyValue(good, v, "high");
    expect(a.verdict).toBe("urcite_kup");
    expect(a.reasons[0]).toEqual({ kind: "positive", text: "💰 Za ty prachy dobrý: Poctivá šunka za běžnou cenu." });
  });
});
