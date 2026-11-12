import { describe, expect, it } from "vitest";
import { ScanVoter, isUnknownCodeProduct, pickScannedCode } from "./scan";
import type { ProductData } from "./types";

describe("ScanVoter", () => {
  it("confirms a code only on the second agreeing read", () => {
    const v = new ScanVoter(2, 1500);
    expect(v.read("8594026123314", 0)).toBe(false);
    expect(v.read("8594026123314", 300)).toBe(true);
  });

  it("drops a one-off misread between two good reads", () => {
    const v = new ScanVoter(2, 1500);
    expect(v.read("2832038003696", 0)).toBe(false);
    // a wrong value with a valid check digit, read from one blurred frame
    expect(v.read("6852031013696", 300)).toBe(false);
    expect(v.read("2832038003696", 600)).toBe(false);
    expect(v.read("2832038003696", 900)).toBe(true);
  });

  it("forgets a read that is older than the window", () => {
    const v = new ScanVoter(2, 1500);
    expect(v.read("8594026123314", 0)).toBe(false);
    expect(v.read("8594026123314", 2000)).toBe(false);
    expect(v.read("8594026123314", 2300)).toBe(true);
  });

  it("starts over after a confirmation", () => {
    const v = new ScanVoter(2, 1500);
    v.read("8594026123314", 0);
    expect(v.read("8594026123314", 300)).toBe(true);
    expect(v.read("8594026123314", 600)).toBe(false);
  });

  it("needs three reads when asked", () => {
    const v = new ScanVoter(3, 1500);
    expect(v.read("a", 0)).toBe(false);
    expect(v.read("a", 100)).toBe(false);
    expect(v.read("a", 200)).toBe(true);
  });
});

describe("pickScannedCode", () => {
  it("prefers the maker's code over the shop's scale label", () => {
    expect(pickScannedCode(["2832038003696", "8594026123314"])).toBe("8594026123314");
  });

  it("returns the scale label when it is the only code", () => {
    expect(pickScannedCode(["2832038003696"])).toBe("2832038003696");
  });

  it("ignores values that are not product codes", () => {
    expect(pickScannedCode(["", "abc", "1234567", " 20012345 "])).toBe("20012345");
    expect(pickScannedCode([])).toBeNull();
    expect(pickScannedCode(["https://example.com"])).toBeNull();
  });
});

describe("isUnknownCodeProduct", () => {
  const unknown: ProductData = { id: "8594026123314", ean: "8594026123314", name: "Neznámý produkt", categoryTags: [], source: "off", dataCompleteness: "minimal", fetchedAt: "" };

  it("recognises the placeholder of an unknown code", () => {
    expect(isUnknownCodeProduct(unknown)).toBe(true);
  });

  it("does not match a real product or a photo result", () => {
    expect(isUnknownCodeProduct({ ...unknown, name: "Tatranky", dataCompleteness: "full" })).toBe(false);
    expect(isUnknownCodeProduct({ ...unknown, id: "photo:abc", source: "photo" })).toBe(false);
  });
});
