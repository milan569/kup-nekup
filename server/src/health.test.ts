import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HealthData, ingredientInfo, ingredientInfoByRef, toHealth } from "./health.js";

const row = {
  excess: "Ve velkém množství zatěžuje ledviny.",
  occasional: "Jednou za čas nevadí.",
  occasionalLevel: 1,
  limit: "",
  groups: "",
  sources: ["https://www.efsa.europa.eu/en/topics/topic/food-additives", "javascript:alert(1)"],
};

describe("toHealth", () => {
  it("keeps valid rows and drops non-https sources", () => {
    const h = toHealth(row);
    expect(h?.occasionalLevel).toBe(1);
    expect(h?.sources).toEqual(["https://www.efsa.europa.eu/en/topics/topic/food-additives"]);
  });

  it("rejects rows without texts or with a bad level", () => {
    expect(toHealth({ ...row, excess: "" })).toBeUndefined();
    expect(toHealth({ ...row, occasionalLevel: 5 })).toBeUndefined();
  });
});

describe("HealthData", () => {
  it("sorts rows into additives, unwanted and ingredients", () => {
    const dir = mkdtempSync(join(tmpdir(), "health-"));
    writeFileSync(join(dir, "a.json"), JSON.stringify([{ id: "E250", ...row }]));
    writeFileSync(join(dir, "u.json"), JSON.stringify([{ id: "palm-oil", ...row }]));
    writeFileSync(
      join(dir, "i.json"),
      JSON.stringify([{ id: "sugar", label: "cukr", category: "sladidlo", patterns: ["(?<!\\p{L})cukr\\p{L}*", "(bad"], ...row }]),
    );
    writeFileSync(join(dir, "broken.json"), "{ not json");
    const h = new HealthData(dir);
    expect(h.counts()).toEqual({ additives: 1, unwanted: 1, ingredients: 1 });
    expect(h.additive("e-250")?.excess).toContain("ledviny");
    expect(h.ingredient("sugar")?.regexes).toHaveLength(1);
  });
});

describe("ingredientInfo", () => {
  it("explains the additive inside a curing mix once, not twice as a nitrite flag", () => {
    const m = ingredientInfo("dusitanová solicí směs (jedlá sůl, konzervant E250)");
    expect(m[0]).toMatchObject({ kind: "additive", id: "E250" });
    expect(m.some((x) => x.id === "nitrites-nitrates")).toBe(false);
  });

  it("finds unwanted ingredients without an E-number", () => {
    const m = ingredientInfo("palmový tuk");
    expect(m.some((x) => x.kind === "unwanted" && x.id === "palm-oil")).toBe(true);
  });

  it("uses the whole list as context for meat-only fillers", () => {
    const alone = ingredientInfo("sójová bílkovina");
    const inSausage = ingredientInfo("sójová bílkovina", "vepřové maso 60 %, voda, sójová bílkovina, sůl");
    expect(alone.some((x) => x.id === "soy-protein-filler")).toBe(false);
    expect(inSausage.some((x) => x.id === "soy-protein-filler")).toBe(true);
  });

  it("returns nothing for an empty query", () => {
    expect(ingredientInfo("  _ ")).toEqual([]);
  });
});

describe("ingredientInfoByRef", () => {
  it("looks up additives and unwanted keys directly", () => {
    expect(ingredientInfoByRef("additive:e621")[0]).toMatchObject({ kind: "additive", id: "E621" });
    expect(ingredientInfoByRef("unwanted:palm-oil")[0]).toMatchObject({ kind: "unwanted", title: "palmový olej" });
    expect(ingredientInfoByRef("unwanted:nope")).toEqual([]);
    expect(ingredientInfoByRef("weird")).toEqual([]);
  });
});
