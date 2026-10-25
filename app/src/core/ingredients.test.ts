import { describe, expect, it } from "vitest";
import { splitIngredients } from "./ingredients";

describe("splitIngredients", () => {
  it("keeps sub-ingredients in parentheses together", () => {
    expect(splitIngredients("vepřové maso 90 %, dusitanová solicí směs (sůl, E250), koření")).toEqual([
      "vepřové maso 90 %",
      "dusitanová solicí směs (sůl, E250)",
      "koření",
    ]);
  });

  it("does not split on a decimal comma", () => {
    expect(splitIngredients("cukr, kakaová poleva 7,5 % (cukr, palmový tuk), sůl.")).toEqual([
      "cukr",
      "kakaová poleva 7,5 % (cukr, palmový tuk)",
      "sůl",
    ]);
  });

  it("splits a trailing sentence such as a traces warning", () => {
    expect(splitIngredients("aroma, kypřicí látka: hydrogenuhličitan sodný. Může obsahovat stopy lískových ořechů.")).toEqual([
      "aroma",
      "kypřicí látka: hydrogenuhličitan sodný",
      "Může obsahovat stopy lískových ořechů",
    ]);
  });

  it("drops the 'Složení:' prefix", () => {
    expect(splitIngredients("Složení: mléko, sůl")).toEqual(["mléko", "sůl"]);
  });
});
