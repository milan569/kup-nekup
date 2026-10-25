import { describe, expect, it } from "vitest";
import { categoryRules, detectCategory, parseCocoaPercent, parseMeatPercent } from "./category.js";
import type { ProductData } from "./types.js";

function product(partial: Partial<ProductData>): ProductData {
  return {
    id: "t",
    name: "Test",
    categoryTags: [],
    source: "off",
    dataCompleteness: "full",
    fetchedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("detectCategory", () => {
  it("uses OFF tags first, then the product name", () => {
    expect(detectCategory(product({ categoryTags: ["en:meats", "en:salamis"] }))).toBe("meat");
    expect(detectCategory(product({ name: "Šunka od kosti" }))).toBe("meat");
    expect(detectCategory(product({ name: "Bílý jogurt" }))).toBe("dairy");
    expect(detectCategory(product({ name: "Tatranky lískooříškové" }))).toBe("sweets");
    expect(detectCategory(product({ name: "Minerální voda" }))).toBe("other");
    expect(detectCategory(product({ name: "Máslové sušenky" }))).toBe("sweets");
    expect(detectCategory(product({ name: "Mléčná čokoláda" }))).toBe("sweets");
    expect(detectCategory(product({ name: "Jogurt s čokoládou" }))).toBe("dairy");
  });
});

describe("parseMeatPercent", () => {
  it("sums declared meat percentages", () => {
    expect(parseMeatPercent("vepřové maso 80 %, hovězí maso 12 %, sůl, koření")).toBe(92);
  });
  it("reads 'g masa na 100 g výrobku'", () => {
    expect(parseMeatPercent("Na 100 g výrobku bylo použito 120 g masa. Složení: vepřové maso, sůl")).toBe(100);
  });
  it("ignores skins and mechanically separated meat", () => {
    expect(parseMeatPercent("strojně oddělené drůbeží maso 55 %, vepřové kůže 10 %, vepřové maso 8 %, voda")).toBe(8);
  });
  it("returns undefined without a declaration", () => {
    expect(parseMeatPercent("vepřové maso, voda, sůl")).toBeUndefined();
  });
});

describe("parseCocoaPercent", () => {
  it("reads common declarations", () => {
    expect(parseCocoaPercent("Kakaová sušina minimálně 70 %.")).toBe(70);
    expect(parseCocoaPercent("cocoa solids: 33% minimum")).toBe(33);
  });
});

describe("categoryRules", () => {
  it("rewards a high-meat ham", () => {
    const r = categoryRules(product({ name: "Šunka nejvyšší jakosti", ingredientsText: "vepřová kýta 93 %, voda, sůl, konzervant E250" }));
    expect(r.kind).toBe("meat");
    expect(r.delta).toBeGreaterThan(0);
  });

  it("reads meat protein declarations in Czech and Montenegrin", () => {
    const cz = categoryRules(product({ name: "Šunka", ingredientsText: "vepřové maso, sůl. Obsah masných bílkovin 16 %" }));
    expect(cz.reasons.some((x) => /svalových bílkovin \(16 %\)/.test(x.text))).toBe(true);
    const me = categoryRules(product({ name: "Njeguška kobasica", ingredientsText: "svinjsko meso, masno tkivo, kuhinjska so, šećer, E575, konzervans E250, sadržaj proteina mesa 16%" }));
    expect(me.reasons.some((x) => /16 %/.test(x.text))).toBe(true);
  });

  it("caps a sausage with little meat and water second", () => {
    const r = categoryRules(product({ name: "Párky", ingredientsText: "vepřové maso 40 %, pitná voda, vepřové kůže, škrob, sůl" }));
    expect(r.cap).toBe("radsi_ne");
    expect(r.reasons.some((x) => /Voda hned na druhém/.test(x.text))).toBe(true);
    expect(r.reasons.some((x) => /kůže/.test(x.text))).toBe(true);
  });

  it("flags butter that is not butter", () => {
    const r = categoryRules(product({ name: "Máslo 250 g", categoryTags: ["en:dairies"], ingredientsText: "smetana, rostlinné oleje (řepkový, palmový), sůl" }));
    expect(r.cap).toBe("radsi_ne");
    expect(r.reasons.some((x) => /Tvrdí, že je to máslo/.test(x.text))).toBe(true);
  });

  it("criticises thickeners and sugar in yogurt", () => {
    const r = categoryRules(product({ name: "Jahodový jogurt", ingredientsText: "mléko, cukr, jahody 8 %, modifikovaný škrob, želatina, jogurtová kultura" }));
    expect(r.kind).toBe("dairy");
    expect(r.delta).toBeLessThanOrEqual(-10);
  });

  it("spots cocoa glaze and vegetable fats in sweets, but praises real butter", () => {
    const glazed = categoryRules(product({ name: "Oplatky s kakaovou polevou", ingredientsText: "pšeničná mouka, cukr, rostlinný tuk (palmový), kakaová poleva 20 % (cukr, rostlinný tuk, kakao)" }));
    expect(glazed.reasons.some((x) => /poleva/.test(x.text))).toBe(true);
    expect(glazed.reasons.some((x) => /Rostlinné tuky/.test(x.text))).toBe(true);
    const butter = categoryRules(product({ name: "Máslové sušenky", ingredientsText: "pšeničná mouka, máslo 25 %, cukr, vejce" }));
    expect(butter.reasons.some((x) => /skutečné máslo/.test(x.text))).toBe(true);
    const cocoaButterOnly = categoryRules(product({ name: "Hořká čokoláda", ingredientsText: "kakaová hmota, cukr, kakaové máslo. Kakaová sušina minimálně 70 %." }));
    expect(cocoaButterOnly.reasons.some((x) => /skutečné máslo/.test(x.text))).toBe(false);
    expect(cocoaButterOnly.facts.cocoaPercent).toBe(70);
  });

  it("rewards quality and origin marks", () => {
    const r = categoryRules(product({ labels: ["klasa"], ingredientsText: "mléko" }));
    expect(r.reasons.some((x) => /Značka kvality/.test(x.text))).toBe(true);
  });
});
