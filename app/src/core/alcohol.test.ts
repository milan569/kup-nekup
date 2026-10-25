import { describe, expect, it } from "vitest";
import { alcoholKind, detectCategory, relevantFlags } from "./category";
import { analyzeIngredients } from "./ingredients";
import { combine } from "./insight";
import { assess } from "./scoring";
import type { ProductData } from "./types";
import { VERDICTS } from "./verdicts";

function drink(name: string, ingredientsText: string | undefined, extra: Partial<ProductData> = {}): ProductData {
  const a = ingredientsText ? analyzeIngredients(ingredientsText) : undefined;
  return {
    id: name,
    name,
    categoryTags: [],
    ingredientsText,
    ingredients: a?.ingredients,
    additives: a?.additives,
    flagged: a?.flagged,
    source: "off",
    dataCompleteness: "full",
    fetchedAt: "2026-10-24T00:00:00Z",
    ...extra,
  };
}

const rank = (v: keyof typeof VERDICTS) => VERDICTS[v].rank;

describe("alcohol detection", () => {
  it("recognises drinks by tags and by name", () => {
    expect(detectCategory(drink("Ležák", undefined, { categoryTags: ["en:beverages", "en:alcoholic-beverages", "en:beers"] }))).toBe("alcohol");
    expect(detectCategory(drink("Pilsner Urquell", undefined))).toBe("alcohol");
    expect(detectCategory(drink("Jack Daniel's Tennessee Whiskey", undefined))).toBe("alcohol");
    expect(alcoholKind(drink("Becherovka Original", undefined))).toBe("liqueur");
    expect(alcoholKind(drink("Vranac Plantaže", undefined))).toBe("wine");
  });

  it("does not take food with a drink in its name for a drink", () => {
    expect(detectCategory(drink("Vinný ocet bílý", undefined))).not.toBe("alcohol");
    expect(detectCategory(drink("Rumové pralinky", undefined))).not.toBe("alcohol");
    expect(detectCategory(drink("Pivní klobása", undefined))).not.toBe("alcohol");
  });
});

describe("alcohol scoring: craft, not health", () => {
  it("rewards a beer made only from water, malt, hops and yeast, without NOVA penalty", () => {
    const a = assess(drink("Světlý ležák", "voda, ječný slad, chmel, pivovarské kvasnice", { novaGroup: 3 }));
    expect(a.reasons.some((r) => /Poctivé pivo/.test(r.text))).toBe(true);
    expect(rank(a.verdict)).toBeGreaterThanOrEqual(rank("urcite_kup"));
  });

  it("marks malt substitutes in beer and keeps it at most 'jsou lepší'", () => {
    const a = assess(drink("Pivo výčepní", "voda, ječný slad, kukuřičný škrob, glukózový sirup, chmelový extrakt"));
    expect(a.reasons.some((r) => /náhražkou sladu/.test(r.text))).toBe(true);
    expect(rank(a.verdict)).toBeLessThanOrEqual(rank("jsou_lepsi"));
  });

  it("does not call a whisky ultra-processed but notes caramel colour", () => {
    const a = assess(drink("Scotch Whisky", "skotská whisky, barvivo E150a", { novaGroup: 4 }));
    expect(a.reasons.some((r) => /NOVA 4/.test(r.text))).toBe(false);
    expect(a.reasons.some((r) => /dochucený nebo obarvený/.test(r.text))).toBe(true);
  });

  it("treats neutral spirit with flavouring as a fake distillate", () => {
    const a = assess(drink("Tuzemák", "voda, líh, aroma, barvivo karamel"));
    expect(a.reasons.some((r) => /ne pravý destilát/.test(r.text))).toBe(true);
    expect(rank(a.verdict)).toBeLessThanOrEqual(rank("kup_jestli_musis"));
  });

  it("does not punish sulphites in wine", () => {
    const a = assess(drink("Ryzlink rýnský pozdní sběr", "víno, oxid siřičitý E220"));
    expect(a.reasons.some((r) => /E220/.test(r.text) && r.kind === "negative")).toBe(false);
  });

  it("does not count the alcohol of a drink as an additive (E1510)", () => {
    const p = drink("Jägermeister - Der Kräuterlikör", "Wasser, Alkohol, Zucker, botanische Extrakte, karamellisierter Zucker");
    expect(assess(p).reasons.some((r) => /E1510/.test(r.text))).toBe(false);
    expect(relevantFlags(p).additives?.some((a) => a.code === "E1510")).toBe(false);
  });

  it("notes hop products in Czech beer", () => {
    const a = assess(drink("Gambrinus pivo 10", "Voda, ječné slady, chmelové výrobky."));
    expect(a.reasons.some((r) => /Chmelové výrobky/.test(r.text))).toBe(true);
  });

  it("does not flag 'alcohol in sweets' on a liqueur", () => {
    const p = drink("Vaječný likér", "líh, cukr, vaječné žloutky, smetana");
    expect(assess(p).reasons.some((r) => /alkohol|líh/i.test(r.text) && r.kind !== "positive")).toBe(false);
    expect(relevantFlags(p).flagged?.some((f) => f.key === "alcohol-in-sweets")).toBe(false);
  });
});

describe("coffee, tea and spices: quality, not health", () => {
  it("treats coffee and spices as quality-first and keeps sweet drinks out", () => {
    expect(detectCategory(drink("Lavazza Qualità Oro", "Roasted ground coffee.", { categoryTags: ["en:coffees"] }))).toBe("coffee");
    expect(detectCategory(drink("Lipton Yellow Label", undefined, { categoryTags: ["en:teas", "en:black-teas"] }))).toBe("tea");
    expect(detectCategory(drink("Kotányi pepř černý mletý", "černý pepř"))).toBe("spice");
    expect(detectCategory(drink("Nestea Raspberry", "voda, cukr, extrakt z čaje", { categoryTags: ["en:teas", "en:iced-teas"] }))).not.toBe("tea");
    expect(detectCategory(drink("Jacobs 3v1", "cukr, sušená smetana, instantní káva"))).not.toBe("coffee");
    expect(detectCategory(drink("Chilli con carne", "fazole, maso, chilli"))).not.toBe("spice");
  });

  it("ignores NOVA for ground coffee and never calls instant coffee a treasure", () => {
    const ground = assess(drink("Zrnková káva 100% arabica Etiopie", "pražená zrnková káva", { novaGroup: 4, categoryTags: ["en:coffees"] }));
    expect(ground.reasons.some((r) => /NOVA/.test(r.text))).toBe(false);
    expect(ground.verdict).toBe("poklad");
    const instant = assess(drink("Nescafé Gold", "instantní káva 100 % z kávových zrn", { categoryTags: ["en:instant-coffees"] }));
    expect(instant.verdict).toBe("urcite_kup");
  });

  it("marks a seasoning that is mostly salt with a flavour enhancer", () => {
    const a = assess(drink("Vegeta", "sůl 56 %, sušená zelenina 15 %, cukr, zvýrazňovač chuti E621, E631, koření", { novaGroup: 4, nutriScore: "c" }));
    expect(a.reasons.some((r) => /hlavně sůl/.test(r.text))).toBe(true);
    expect(a.reasons.some((r) => /Zvýrazňovač chuti/.test(r.text))).toBe(true);
    expect(rank(a.verdict)).toBeLessThanOrEqual(rank("kup_jestli_musis"));
    const pepper = assess(drink("Pepř černý mletý", "černý pepř mletý", { categoryTags: ["en:spices"] }));
    expect(pepper.reasons.some((r) => /Čisté koření/.test(r.text))).toBe(true);
  });

  it("flags senna in a detox tea", () => {
    const a = assess(drink("Detox čaj", "list senny, máta, zelený čaj", { categoryTags: ["en:herbal-teas"] }));
    expect(a.reasons.some((r) => /senu/.test(r.text))).toBe(true);
    expect(rank(a.verdict)).toBeLessThanOrEqual(rank("jsou_lepsi"));
  });
});

describe("alcohol labels", () => {
  it("marks drink assessments so the app shows the drinking scale", () => {
    expect(assess(drink("Gambrinus pivo 10", "voda, ječné slady, chmel")).labelSet).toBe("alcohol");
    expect(assess(drink("Becherovka", undefined)).labelSet).toBe("alcohol");
    expect(assess(drink("Eidam 30 %", "mléko, sůl, kultury")).labelSet).toBeUndefined();
  });
});

describe("alcohol: reviews lead, risk stays", () => {
  it("lets the AI verdict decide for alcohol (reviews, reputation)", () => {
    const p = drink("Pivo výčepní", "voda, ječný slad, kukuřičný škrob");
    const rule = assess(p);
    const out = combine(p, rule, { verdict: "urcite_kup", confidence: "high", headline: "Recenze chválí" });
    expect(out.verdict).toBe("urcite_kup");
  });

  it("keeps alcohol with caffeine risky whatever the AI says", () => {
    const p = drink("Vodka Energy", "voda, líh, cukr, kofein, taurin");
    const rule = assess(p);
    expect(rule.hardRules).toContain("alcohol-energy");
    expect(rank(rule.verdict)).toBeLessThanOrEqual(rank("radsi_ne"));
    const out = combine(p, rule, { verdict: "urcite_kup", confidence: "high", headline: "Chutná" });
    expect(rank(out.verdict)).toBeLessThanOrEqual(rank("radsi_ne"));
  });
});
