import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoExtractionT } from "./claude";
import { lookupPhoto } from "./lookup";

/** What the model "read" off the label: one digit of the barcode is wrong (…315 instead of …314). */
const EXTRACTION: PhotoExtractionT = {
  isProductLabel: true,
  barcode: "8594026123315",
  name: "Lovecký salám",
  brand: "Řezník",
  manufacturer: "",
  category: "trvanlivý salám",
  countryOfOrigin: "",
  quantity: "100 g",
  ingredientsText: "vepřové maso 60 %, hovězí maso 30 %, jedlá sůl, koření",
  ingredientsTextCs: "",
  ingredientsPartial: false,
  allergensDeclared: [],
  nutritionPer100g: { energyKcal: null, fat: null, saturatedFat: null, carbs: null, sugars: null, fiber: null, proteins: null, salt: null },
  labels: [],
  readability: "good",
  notes: "",
};

vi.mock("./claude", async (importOriginal) => {
  const original = await importOriginal<typeof import("./claude")>();
  return { ...original, extractFromPhoto: vi.fn(async () => EXTRACTION) };
});

const IMAGE = "A".repeat(200);

describe("lookupPhoto with a barcode decoded on the device", () => {
  beforeEach(() => {
    // no database knows the code: the product comes from the photo alone
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404, ok: false, headers: { get: () => null }, json: async () => ({}) })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the model's digits when the device decoded nothing", async () => {
    const r = await lookupPhoto({ imageBase64: IMAGE, mediaType: "image/jpeg" });
    expect(r.product.ean).toBe("8594026123315");
  });

  it("lets the decoded code win over the digits the model read", async () => {
    const r = await lookupPhoto({ imageBase64: IMAGE, mediaType: "image/jpeg", ean: "8594026123314" });
    expect(r.product.ean).toBe("8594026123314");
    expect(r.product.name).toBe("Lovecký salám");
  });

  it("rejects a decoded code that is not a barcode", async () => {
    await expect(lookupPhoto({ imageBase64: IMAGE, mediaType: "image/jpeg", ean: "abc" })).rejects.toThrow();
  });
});
