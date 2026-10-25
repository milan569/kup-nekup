import { describe, expect, it, vi } from "vitest";
import { Cache, memoryStore } from "./cache";

describe("Cache", () => {
  it("stores and reads values per namespace", async () => {
    const c = new Cache(memoryStore());
    await c.set("product", "123", { name: "Nutella" });
    await c.set("search", "123", ["x"]);
    expect(await c.get<{ name: string }>("product", "123")).toEqual({ name: "Nutella" });
    expect(await c.get<string[]>("search", "123")).toEqual(["x"]);
    expect(await c.get("product", "999")).toBeUndefined();
  });

  it("expires entries older than the given age and drops them", async () => {
    const store = memoryStore();
    const c = new Cache(store);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await c.set("quick", "a", 1);
    vi.spyOn(Date, "now").mockReturnValue(now + 2000);
    expect(await c.get("quick", "a", 5000)).toBe(1);
    expect(await c.get("quick", "a", 1000)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(await store.keys()).toEqual([]);
    vi.restoreAllMocks();
  });

  it("survives a failing store", async () => {
    const broken = {
      get: async () => {
        throw new Error("quota");
      },
      set: async () => {
        throw new Error("quota");
      },
      delete: async () => undefined,
      keys: async () => [],
    };
    const c = new Cache(broken);
    await expect(c.set("x", "y", 1)).resolves.toBeUndefined();
    expect(await c.get("x", "y")).toBeUndefined();
  });

  it("sweeps old entries by their timestamp prefix without parsing values", async () => {
    const store = memoryStore();
    const c = new Cache(store);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now - 40 * 24 * 3600 * 1000);
    await c.set("old", "1", "x");
    vi.spyOn(Date, "now").mockReturnValue(now);
    await c.set("new", "1", "y");
    expect(await c.sweep()).toBe(1);
    expect(await c.get("new", "1")).toBe("y");
    expect(await c.get("old", "1")).toBeUndefined();
    vi.restoreAllMocks();
  });
});
