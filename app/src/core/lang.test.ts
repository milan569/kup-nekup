import { describe, expect, it } from "vitest";
import { mergePhotoIntoProduct, supplementAdded, supplementProduct } from "./claude";
import { stepTowards } from "./insight";
import { itemSeverity } from "./health";
import { looksCzech } from "./lang";
import type { ProductData } from "./types";

describe("looksCzech", () => {
  it("recognises Czech labels", () => {
    expect(looksCzech("pšeničná mouka, cukr, rostlinný tuk (palmový), sušené mléko")).toBe(true);
    expect(looksCzech("Pitná voda")).toBe(true);
    expect(looksCzech("vepřové maso 90 %, voda, jedlá sůl")).toBe(true);
  });

  it("treats Serbian, Slovak, English and German as foreign", () => {
    expect(looksCzech("šećer, biljna mast (palmina), pšenično brašno, banana 12%, emulgator: lecitin")).toBe(false);
    expect(looksCzech("cukor, pšeničná múka, rastlinný tuk, mlieko")).toBe(false);
    expect(looksCzech("Sugar, wheat flour, palm fat, banana powder 3%")).toBe(false);
    expect(looksCzech("Zucker, Weizenmehl, Palmfett, Bananenpulver")).toBe(false);
  });
});

describe("measured contents in water analyses", () => {
  it("does not flag nitrates measured in mineral water", async () => {
    const { referenceData } = await import("./data");
    const ref = referenceData();
    const water = "Water. Composition: TDS 44 mg/L; pH 5.8; Ca 2.7 mg/L; nitrates 1 mg/L.";
    expect(ref.unwantedInText(water).map((x) => x.record.key)).not.toContain("nitrites-nitrates");
    expect(ref.unwantedInText("přírodní minerální voda, dusičnany (NO3-): 3,1 mg/l").map((x) => x.record.key)).not.toContain(
      "nitrites-nitrates",
    );
    expect(ref.unwantedInText("vepřové maso, sůl, dusitan sodný").map((x) => x.record.key)).toContain("nitrites-nitrates");
  });
});

describe("itemSeverity", () => {
  it("colours an ingredient by the worst thing inside it", () => {
    expect(itemSeverity("dusitanová solicí směs (jedlá sůl, E250)")).toBe(3);
    expect(itemSeverity("pšeničná mouka")).toBe(0);
    expect(itemSeverity("rostlinný tuk (palmový)")).toBeGreaterThanOrEqual(1);
  });
});

describe("mergePhotoIntoProduct", () => {
  const base = {
    id: "3850000000001",
    name: "Choco Banana",
    ingredientsText: "šećer, biljna mast (palmina), pšenično brašno, banana 12%",
    source: "off",
    dataCompleteness: "partial",
    fetchedAt: "2026-10-23T00:00:00Z",
  } as ProductData;
  const photo = {
    ...base,
    id: "photo:abc",
    ingredientsText: "cukr, rostlinný tuk (palmový), pšeničná mouka, banán 12 %",
    source: "photo",
  } as ProductData;

  it("shows the Czech label instead of a foreign database list", () => {
    expect(mergePhotoIntoProduct(base, photo).ingredientsText).toBe(photo.ingredientsText);
  });

  it("keeps the database list when the photo was only partly readable", () => {
    expect(mergePhotoIntoProduct(base, { ...photo, ingredientsPartial: true }).ingredientsText).toBe(base.ingredientsText);
  });
});

describe("supplementProduct", () => {
  const unknown = {
    id: "8018440046757",
    ean: "8018440046757",
    name: "Neznámý produkt",
    source: "off",
    dataCompleteness: "minimal",
    fetchedAt: "2026-10-23T00:00:00Z",
  } as ProductData;
  const front = {
    id: "photo:abc123",
    name: "Olio extra vergine di oliva",
    brand: "Olio Lori",
    quantity: "0,75 l",
    labels: ["extra virgin"],
    source: "photo",
    dataCompleteness: "minimal",
    fetchedAt: "2026-10-24T00:00:00Z",
  } as ProductData;

  it("gives an unknown barcode the name and brand from the front label", () => {
    const m = supplementProduct(unknown, front);
    expect(m).toMatchObject({ name: "Olio extra vergine di oliva", brand: "Olio Lori", ean: "8018440046757", quantity: "0,75 l", source: "photo" });
    expect(m.id).toBe("8018440046757+abc123");
  });

  it("adds the ingredients from the back label without losing what was known", () => {
    const named = supplementProduct(unknown, front);
    const back = {
      ...front,
      id: "photo:def456",
      name: "Produkt z fotky",
      brand: undefined,
      ingredientsText: "extra panenský olivový olej",
      nutrition: { energyKcal: 824, fat: 91.6 },
    } as ProductData;
    const m = supplementProduct(named, back);
    expect(m.name).toBe("Olio extra vergine di oliva");
    expect(m.brand).toBe("Olio Lori");
    expect(m.ingredientsText).toBe("extra panenský olivový olej");
    expect(m.nutrition?.energyKcal).toBe(824);
    expect(m.id).toBe("8018440046757+def456");
  });
});

describe("verdictText label sets", () => {
  it("uses the drinking scale only in the humour tone", async () => {
    const { verdictText } = await import("./verdicts");
    expect(verdictText("kup_jestli_musis", "humor", "alcohol").label).toBe("Slabej odvar");
    expect(verdictText("kup_jestli_musis", "humor").label).toBe("Nouzovka");
    expect(verdictText("kup_jestli_musis", "serious", "alcohol").label).toBe("Kup, jestli musíš");
  });
});

describe("refinement after a supplementary photo", () => {
  it("lists what the photo added", () => {
    const base = { id: "1", ean: "1", name: "Neznámý produkt", source: "off", dataCompleteness: "minimal", fetchedAt: "x" } as ProductData;
    const photo = { id: "photo:a", name: "SKYY Vodka", brand: "SKYY", ingredientsText: "voda, obilný líh", source: "photo", dataCompleteness: "partial", fetchedAt: "x" } as ProductData;
    const merged = supplementProduct(base, photo);
    expect(supplementAdded(base, merged)).toEqual(["název", "značka", "složení"]);
    expect(supplementAdded(merged, supplementProduct(merged, { ...photo, id: "photo:b" }))).toEqual([]);
  });

  it("moves a refined verdict by one step at most", () => {
    expect(stepTowards("urcite_kup", "jsou_lepsi")).toBe("jsou_lepsi");
    expect(stepTowards("urcite_kup", "radsi_ne")).toBe("jsou_lepsi");
    expect(stepTowards("sracka", "poklad")).toBe("nekupuj");
    expect(stepTowards("urcite_kup", "urcite_kup")).toBe("urcite_kup");
    expect(stepTowards("nevime", "poklad")).toBe("poklad");
  });
});
