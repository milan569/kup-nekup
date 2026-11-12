import { describe, expect, it } from "vitest";
import { ScanVoter } from "./scan";

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
