import { describe, expect, it } from "vitest";
import { sugarLedPreparation } from "./scoring.js";

describe("Serbian labels", () => {
  it("flags hydrogenated fat and starch syrup written in Serbian (Romantic mešavina case)", async () => {
    const { referenceData } = await import("./data.js");
    const keys = referenceData()
      .unwantedInText("_pšenično_ brašno, šećer, hidrogenovana biljna mast, kakao u prahu, _skrobni_ sirup, so, arome")
      .map((x) => x.record.key);
    expect(keys).toContain("hydrogenated-fat");
    expect(keys).toContain("glucose-syrup");
  });

  it("never rates a biscuit with hydrogenated fat 'určitě kup'", async () => {
    const { assess } = await import("./scoring.js");
    const { analyzeIngredients } = await import("./ingredients.js");
    const text = "_pšenično_ brašno, šećer, hidrogenovana biljna mast, kakao u prahu, _skrobni_ sirup, _sojino_ brašno, _jaja_ u prahu, so, emulgator _sojin_ lecitin E322, sredstva za rastenje testa E500 i E503, arome, limunska kiselina.";
    const a = analyzeIngredients(text);
    const { VERDICTS } = await import("./verdicts.js");
    const product = {
      id: "r",
      name: "Romantic mešavina",
      categoryTags: ["en:biscuits", "en:chocolate-biscuits"],
      ingredientsText: text,
      ingredients: a.ingredients,
      additives: a.additives,
      flagged: a.flagged,
      source: "off" as const,
      dataCompleteness: "full" as const,
      fetchedAt: "x",
    };
    expect(VERDICTS[assess(product).verdict].rank).toBeLessThanOrEqual(VERDICTS.jsou_lepsi.rank);
  });
});

describe("sugarLedPreparation", () => {
  it("finds sugar hidden as the first sub-ingredient of a fruit preparation", () => {
    const p = { id: "x", name: "Balans obrok", source: "off", dataCompleteness: "full", fetchedAt: "x", ingredientsText: "Pasterizovano mleko sa 1% mlecne masti, vocna preradjevina 18% (secer, komadici jagode 30%, spelta 2%), oligofruktoza 1,5%, probiotske kulture" } as const;
    expect(sugarLedPreparation(p)).toBe("vocna preradjevina 18%");
    expect(sugarLedPreparation({ ...p, ingredientsText: "mléko, jahody 12 % (jahody, pektin), cukr" })).toBeUndefined();
  });
});
import { assess, ingredientCount, ingredientsWord, isPrivateLabel, verdictFromScore } from "./scoring.js";
import type { ProductData, UserProfile } from "./types.js";
import { EMPTY_PROFILE } from "./types.js";

function product(partial: Partial<ProductData>): ProductData {
  return {
    id: partial.ean ?? "test",
    name: "Test",
    categoryTags: [],
    source: "off",
    dataCompleteness: "full",
    fetchedAt: new Date().toISOString(),
    ...partial,
  };
}

const additive = (code: string, risk: 0 | 1 | 2 | 3) => ({
  code,
  name: code,
  category: "test",
  risk,
  note: "",
  sources: [],
});

describe("verdictFromScore", () => {
  it("maps thresholds", () => {
    expect(verdictFromScore(95)).toBe("poklad");
    expect(verdictFromScore(80)).toBe("urcite_kup");
    expect(verdictFromScore(65)).toBe("jsou_lepsi");
    expect(verdictFromScore(50)).toBe("kup_jestli_musis");
    expect(verdictFromScore(40)).toBe("radsi_ne");
    expect(verdictFromScore(20)).toBe("nekupuj");
    expect(verdictFromScore(5)).toBe("sracka");
  });
});

describe("assess", () => {
  it("returns nevime when there is no usable data", () => {
    const a = assess(product({ dataCompleteness: "minimal" }));
    expect(a.verdict).toBe("nevime");
    expect(a.score).toBeUndefined();
    expect(a.confidence).toBe("low");
  });

  it("rates clean bio oat flakes as poklad", () => {
    const a = assess(
      product({
        name: "Ovesné vločky BIO",
        brand: "Probio",
        ingredientsText: "ovesné vločky z ekologického zemědělství",
        ingredients: ["ovesné vločky"],
        additives: [],
        novaGroup: 1,
        nutriScore: "a",
        labels: ["organic"],
        nutrition: { sugars: 1, salt: 0.01, saturatedFat: 1.2, fiber: 10, proteins: 13 },
      }),
    );
    expect(a.verdict).toBe("poklad");
    expect(a.score).toBeGreaterThanOrEqual(88);
    expect(a.confidence).toBe("high");
    expect(a.reasons.some((r) => r.kind === "positive")).toBe(true);
  });

  it("caps a product with two high-risk additives at radsi_ne", () => {
    const a = assess(
      product({
        name: "Dětské želé",
        ingredientsText: "cukr, glukózový sirup, želatina, barviva E102, E110",
        ingredients: ["cukr", "glukózový sirup", "želatina", "barviva"],
        additives: [additive("E102", 3), additive("E110", 3)],
        novaGroup: 4,
        nutriScore: "d",
      }),
    );
    expect(["radsi_ne", "nekupuj", "sracka"]).toContain(a.verdict);
    expect(a.reasons.some((r) => /vysokým rizikem/.test(r.text))).toBe(true);
    expect(a.reasons.some((r) => /Cukr je první/.test(r.text))).toBe(true);
  });

  it("gives nekupuj when the user's allergen is present", () => {
    const profile: UserProfile = { ...EMPTY_PROFILE, allergens: ["milk"] };
    const a = assess(
      product({
        name: "Mléčná čokoláda",
        ingredientsText: "cukr, kakaové máslo, sušené plnotučné mléko",
        allergens: ["milk"],
        additives: [],
        nutriScore: "e",
      }),
      profile,
    );
    expect(a.verdict).toBe("nekupuj");
    expect(a.hardRules).toContain("allergen:milk");
    expect(a.profileWarnings[0]).toMatch(/nevhodné/);
  });

  it("warns about traces without changing the verdict", () => {
    const profile: UserProfile = { ...EMPTY_PROFILE, allergens: ["nuts"] };
    const a = assess(
      product({
        ingredientsText: "ovesné vločky",
        ingredients: ["ovesné vločky"],
        additives: [],
        traces: ["nuts"],
        nutriScore: "a",
        novaGroup: 1,
      }),
      profile,
    );
    expect(a.verdict).not.toBe("nekupuj");
    expect(a.profileWarnings.some((w) => /stopy/.test(w))).toBe(true);
  });

  it("applies the avoid list and caps at jsou_lepsi", () => {
    const profile: UserProfile = { ...EMPTY_PROFILE, avoid: ["palm-oil"] };
    const a = assess(
      product({
        ingredientsText: "pšeničná mouka, palmový olej, cukr",
        ingredients: ["pšeničná mouka", "palmový olej", "cukr"],
        additives: [],
        flagged: [{ key: "palm-oil", label: "palmový olej", severity: 1, note: "Levný tuk.", matchedText: "palmový olej" }],
        nutriScore: "a",
        novaGroup: 1,
      }),
      profile,
    );
    expect(a.verdict).toBe("jsou_lepsi");
    expect(a.profileWarnings.some((w) => /palmový olej/.test(w))).toBe(true);
  });

  it("penalises nitrites and NOVA 4 in a salami", () => {
    const a = assess(
      product({
        name: "Vysočina",
        ingredientsText:
          "vepřové maso 80 %, hovězí maso, jedlá sůl, koření, dextróza, stabilizátor E450, antioxidant E316, konzervant E250, kouřové aroma",
        additives: [additive("E450", 2), additive("E316", 1), additive("E250", 3)],
        novaGroup: 4,
        nutrition: { salt: 4.2, saturatedFat: 12, proteins: 25 },
      }),
    );
    // compared with other cured meats: 80 % meat with nitrite and phosphate is average
    expect(["jsou_lepsi", "kup_jestli_musis"]).toContain(a.verdict);
    expect(a.breakdown.composition).toBeLessThan(75);
    expect(a.reasons.some((r) => /středním rizikem: .*E250/.test(r.text))).toBe(true);
  });

  it("counts nested ingredients of compound ingredients", () => {
    const kofola = product({
      ingredientsText:
        "voda, sirup KOFO® (ovocný sirup, cukr, glukózo-fruktózový sirup, voda, karamel-pálený cukr, barvivo E150d, kyselina: kyselina citrónová, chlorid sodný, kofein, konzervant E211), oxid uhličitý,",
    });
    expect(ingredientCount(kofola)).toBeGreaterThanOrEqual(12);
    expect(ingredientsWord(1)).toBe("přísada");
    expect(ingredientsWord(3)).toBe("přísady");
    expect(ingredientsWord(7)).toBe("přísad");
  });

  it("maps app avoid groups to data keys and E-numbers", () => {
    const profile: UserProfile = { ...EMPTY_PROFILE, avoid: ["sweeteners", "colours"] };
    const a = assess(
      product({
        ingredientsText: "voda, kyselina citronová, sladidla: aspartam, acesulfam K, barvivo E102",
        ingredients: ["voda", "kyselina citronová", "sladidla", "barvivo"],
        additives: [additive("E330", 0), { ...additive("E951", 2), category: "sladidlo" }, additive("E950", 2), additive("E102", 3)],
        flagged: [{ key: "sweeteners-generic", label: "sladidla", severity: 1, note: "", matchedText: "sladidla" }],
        nutriScore: "b",
      }),
      profile,
    );
    expect(a.profileWarnings.filter((w) => /sladidla/.test(w))).toHaveLength(1);
    expect(a.profileWarnings.some((w) => /barviva/.test(w))).toBe(true);
    expect(["kup_jestli_musis", "radsi_ne", "nekupuj", "sracka"]).toContain(a.verdict);
  });

  it("never rates Nutri-Score E better than kup_jestli_musis", () => {
    const nutellaLike = assess(
      product({
        ingredientsText: "cukr, palmový olej, lískové ořechy 13 %, kakao, sušené mléko",
        ingredients: ["cukr", "palmový olej", "lískové ořechy 13 %", "kakao", "sušené mléko"],
        additives: [],
        nutriScore: "e",
        novaGroup: 3,
      }),
    );
    expect(nutellaLike.verdict).toBe("kup_jestli_musis");
    expect(nutellaLike.score).toBeLessThanOrEqual(59);
    const noIngredients = assess(product({ dataCompleteness: "partial", nutriScore: "e", nutrition: { sugars: 20 } }));
    expect(noIngredients.verdict).toBe("kup_jestli_musis");
  });

  it("caps products with extreme sugar when Nutri-Score is missing", () => {
    const a = assess(product({ ingredientsText: "cukr, želatina", ingredients: ["cukr", "želatina"], additives: [], nutrition: { sugars: 65 } }));
    expect(["kup_jestli_musis", "nekupuj"]).toContain(a.verdict);
  });

  it("real cured meats: quality ham vs separated-meat sausages (calibration cases)", () => {
    const vocilka = assess(
      product({
        name: "Šunka od kosti nejvyšší jakosti",
        brand: "Vocílka",
        ingredientsText:
          "Vepřová kýta 95 %, pitná voda, jedlá sůl, konzervant (E250), cukr, stabilizátor (E451), antioxidant (E301), extrakty koření. Obsah čistých svalových bílkovin: min. 16%.",
        additives: [additive("E250", 3), additive("E451", 2), additive("E301", 0)],
        flagged: [{ key: "nitrites-nitrates", label: "dusitany / dusičnany", severity: 2, note: "", matchedText: "E250" }],
        novaGroup: 4,
        nutriScore: "d",
      }),
    );
    expect(["urcite_kup", "jsou_lepsi"]).toContain(vocilka.verdict);
    const parky = assess(
      product({
        name: "Drůbeží párky",
        ingredientsText:
          "Drůbeží maso strojně oddělené 70 %, kuřecí kůže, pitná voda, bramborový škrob, dusitanová solící směs (jedlá sůl, konzervant: dusitan sodný), stabilizátor: trifosforečnany, dextróza, antioxidant: erythorban sodný; extrakty koření",
        categoryTags: ["en:meats-and-their-products", "en:prepared-meats", "en:sausages"],
        additives: [additive("E250", 3), additive("E451", 2), additive("E316", 1)],
        flagged: [
          { key: "mechanically-separated-meat", label: "strojně oddělené maso", severity: 3, note: "", matchedText: "strojně oddělené" },
          { key: "nitrites-nitrates", label: "dusitany", severity: 2, note: "", matchedText: "dusitan" },
          { key: "phosphates", label: "fosfáty", severity: 2, note: "", matchedText: "trifosforečnany" },
          { key: "starch-filler", label: "škrob jako plnidlo", severity: 1, note: "", matchedText: "škrob" },
        ],
        novaGroup: 4,
        nutriScore: "d",
      }),
    );
    expect(["nekupuj", "sracka"]).toContain(parky.verdict);
    expect(parky.reasons.some((r) => /separát/.test(r.text))).toBe(true);
  });

  it("does not punish pure butter for its natural Nutri-Score E", () => {
    const butter = assess(product({ name: "Máslo", brand: "Lumiko", ingredientsText: "smetana", ingredients: ["smetana"], additives: [], nutriScore: "e", novaGroup: 2 }));
    expect(["urcite_kup", "poklad", "jsou_lepsi"]).toContain(butter.verdict);
    expect(butter.reasons.some((r) => /o kvalitě to neříká mnoho/.test(r.text))).toBe(true);
    const spread = assess(product({ name: "Lahůdková pomazánka", ingredientsText: "rostlinný tuk, voda, cukr", additives: [], nutriScore: "e", novaGroup: 4 }));
    expect(["kup_jestli_musis", "radsi_ne", "nekupuj", "sracka"]).toContain(spread.verdict);
  });

  it("does not call a sugary US beef jerky a top pick (Jack Link's case)", () => {
    const a = assess(
      product({
        name: "Jalapeño Beef Jerky / Carne Seca",
        brand: "Jack Link's",
        ingredientsText:
          "Beef, sugar, water, contains 2% or less of salt, beef stock, natural and artificial flavors, vinegar, yeast extract, jalapeno pepper, citric acid, bromelain (from pineapple).",
        additives: [additive("E330", 0)],
        flagged: [
          { key: "artificial-flavouring", label: "umělé aroma", severity: 2, note: "", matchedText: "artificial flavors" },
          { key: "flavouring-unspecified", label: "aroma (nespecifikované)", severity: 1, note: "", matchedText: "flavors" },
          { key: "yeast-extract", label: "kvasničný extrakt", severity: 1, note: "", matchedText: "yeast extract" },
        ],
        nutrition: { energyKcal: 294, fat: 5.4, saturatedFat: 1.8, carbs: 25, sugars: 21.4, fiber: 0, proteins: 35.7, salt: 3.3 },
      }),
    );
    expect(["jsou_lepsi", "kup_jestli_musis", "radsi_ne"]).toContain(a.verdict);
    expect(a.reasons.some((r) => /Cukr je hned druhá/.test(r.text))).toBe(true);
    expect(a.reasons.some((r) => /Na masný výrobek hodně cukru/.test(r.text))).toBe(true);
  });

  it("does not count nitrite or phosphate twice (Vienna sausages, 90 % meat)", () => {
    const a = assess(
      product({
        name: "Vídeňské párky",
        ingredientsText: "vepřové maso 82%, hovězí maso 8%, pitná voda, jedlá sůl, koření, dextróza, skopové střívko, stabilizátor: difosforečnany, antioxidant: kyselina askorbová, konzervant: dusitan sodný",
        additives: [additive("E300", 0), additive("E450", 2), additive("E250", 3)],
        flagged: [
          { key: "nitrites-nitrates", label: "dusitany / dusičnany", severity: 3, note: "", matchedText: "dusitan sodný" },
          { key: "phosphates", label: "fosfáty", severity: 2, note: "", matchedText: "difosforečnany" },
          { key: "dextrose", label: "dextróza", severity: 1, note: "", matchedText: "dextróza" },
        ],
        nutrition: { energyKcal: 262, fat: 22.3, saturatedFat: 8.3, carbs: 0.5, sugars: 0.5, proteins: 14, salt: 2.1 },
      }),
    );
    expect(["jsou_lepsi", "kup_jestli_musis"]).toContain(a.verdict);
    // the explanation stays
    expect(a.reasons.some((r) => /Dusitany|dusitany/.test(r.text))).toBe(true);
  });

  it("says nevime when only harmless nutrition data exist", () => {
    const a = assess(product({ name: "Vepřové párky", dataCompleteness: "partial", nutrition: { sugars: 1, salt: 1.2, saturatedFat: 4 } }));
    expect(a.verdict).toBe("nevime");
    expect(a.reasons[0]!.text).toMatch(/Složení chybí/);
  });

  it("sends the worst junk to sracka", () => {
    const a = assess(
      product({
        name: "Párky",
        ingredientsText:
          "strojně oddělené drůbeží maso 60 %, voda, vepřové kůže, škrob, sójová bílkovina, sůl, stabilizátory E450, E451, zahušťovadlo E407, zvýrazňovač chuti E621, barvivo E120, E129, antioxidant E316, konzervant E250, aroma",
        additives: [additive("E450", 2), additive("E451", 2), additive("E407", 2), additive("E621", 2), additive("E129", 3), additive("E316", 1), additive("E250", 3)],
        flagged: [
          { key: "mechanically-separated-meat", label: "strojně oddělené maso", severity: 3, note: "", matchedText: "strojně oddělené" },
          { key: "phosphates", label: "fosfáty", severity: 2, note: "", matchedText: "E450" },
          { key: "starch-filler", label: "škrob jako plnidlo", severity: 1, note: "", matchedText: "škrob" },
        ],
        novaGroup: 4,
        nutriScore: "e",
      }),
    );
    expect(a.verdict).toBe("sracka");
    expect(a.score).toBeLessThanOrEqual(15);
  });

  it("an allergen never improves a verdict and poklad needs a spotless product", () => {
    const profile: UserProfile = { ...EMPTY_PROFILE, allergens: ["milk"] };
    const junk = assess(product({ ingredientsText: "mléko, E129", additives: [additive("E129", 3), additive("E250", 3), additive("E320", 3)], allergens: ["milk"], novaGroup: 4, nutriScore: "e" }), profile);
    expect(["nekupuj", "sracka"]).toContain(junk.verdict);
    const almost = assess(product({ ingredientsText: "mléko, kultura, E330", ingredients: ["mléko", "kultura", "E330"], additives: [additive("E330", 0), additive("E415", 1)], nutriScore: "a", novaGroup: 1, labels: ["organic"] }));
    expect(almost.verdict).toBe("urcite_kup");
  });

  it("marks private labels in the manufacturer component", () => {
    expect(isPrivateLabel("Pilos")).toBe(true);
    expect(isPrivateLabel("K-Classic")).toBe(true);
    expect(isPrivateLabel("Madeta")).toBe(false);
    const a = assess(product({ brand: "Pilos", ingredientsText: "mléko", ingredients: ["mléko"], additives: [], nutriScore: "b" }));
    expect(a.breakdown.manufacturer).toBe(45);
  });

  it("lowers confidence for photo-sourced partial data", () => {
    const a = assess(product({ source: "photo", dataCompleteness: "partial", ingredientsText: "mouka, voda, sůl", ingredients: ["mouka", "voda", "sůl"], additives: [] }));
    expect(a.confidence).toBe("medium");
  });
});
