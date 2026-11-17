import { describe, expect, it } from "vitest";
import { isPlaceholderName, productTokens, sameProduct } from "./identity";
import { valueBadge } from "./verdicts";

describe("sameProduct", () => {
  it("matches the same product in another size", () => {
    expect(sameProduct({ id: "1", name: "Balans obrok 330 g", brand: "Imlek" }, { id: "2", name: "Balans obrok 500 g", brand: "Imlek" })).toBe(true);
  });

  it("does not match a short name against a longer one", () => {
    expect(sameProduct({ id: "1", name: "Jogurt" }, { id: "2", name: "Jogurt bílý" })).toBe(false);
  });

  it("never matches two unknown codes: their shared placeholder name is no identity", () => {
    // regression: every unknown barcode showed the stored AI opinion of the first unknown product (a laundry gel)
    const gel = { id: "5901234123457", name: "Neznámý produkt" };
    const lemonade = { id: "8594001234561", name: "Neznámý produkt" };
    expect(sameProduct(gel, lemonade)).toBe(false);
    expect(sameProduct({ id: "photo:aaa", name: "Produkt z fotky" }, { id: "photo:bbb", name: "Produkt z fotky" })).toBe(false);
    expect(sameProduct({ id: "photo:aaa", name: "(bez názvu)" }, { id: "photo:bbb", name: "(bez názvu)" })).toBe(false);
  });

  it("still matches an unknown code scanned again", () => {
    expect(sameProduct({ id: "5901234123457", name: "Neznámý produkt" }, { id: "5901234123457", name: "Neznámý produkt" })).toBe(true);
  });

  it("does not treat two unrecognised photos as one product", () => {
    expect(sameProduct({ id: "photo:none", name: "Nerozpoznáno" }, { id: "photo:none", name: "Nerozpoznáno" })).toBe(false);
  });
});

describe("isPlaceholderName", () => {
  it("knows the app's own placeholder names and empty names", () => {
    for (const n of ["Neznámý produkt", "neznámý PRODUKT", "(bez názvu)", "Produkt z fotky", "Nerozpoznáno", "", undefined]) expect(isPlaceholderName(n)).toBe(true);
    expect(isPlaceholderName("Tatranky")).toBe(false);
  });

  it("is built on the same tokens as the matching", () => {
    expect(productTokens("Šunka od kosti 100 g")).toEqual(["sunka", "od", "kosti"]);
  });
});

describe("valueBadge: the price badge follows the quality verdict", () => {
  it("praises the price only on a product worth buying", () => {
    expect(valueBadge("vyhodne", "urcite_kup")?.kind).toBe("vyhodne");
    expect(valueBadge("vyhodne", "urcite_kup")?.text.subtitle).toBe("Poctivá věc za rozumnou cenu.");
    expect(valueBadge("vyhodne", "jsou_lepsi")?.kind).toBe("vyhodne");
    expect(valueBadge("vyhodne", "jsou_lepsi")?.text.subtitle).not.toContain("Poctivá");
  });

  it("calls a poor product cheap, never honest", () => {
    for (const quality of ["kup_jestli_musis", "radsi_ne", "nekupuj", "sracka"] as const) {
      const badge = valueBadge("vyhodne", quality);
      expect(badge?.kind).toBe("levne");
      expect(`${badge?.text.label} ${badge?.text.subtitle}`).not.toMatch(/Poctiv|dobrý/);
    }
  });

  it("does not judge quality it does not know", () => {
    const badge = valueBadge("vyhodne", "nevime");
    expect(badge?.kind).toBe("levne");
    expect(badge?.text.subtitle).toMatch(/nevíme/);
  });

  it("keeps the overpriced badge whatever the quality, and shows nothing for a fair or unknown price", () => {
    expect(valueBadge("vyhozene_prachy", "sracka")?.kind).toBe("vyhozene_prachy");
    expect(valueBadge("vyhozene_prachy", "poklad", "serious")?.text.label).toBe("Předražené");
    expect(valueBadge("ok", "poklad")).toBeNull();
    expect(valueBadge("nevime", "poklad")).toBeNull();
    expect(valueBadge(undefined, "poklad")).toBeNull();
  });
});
