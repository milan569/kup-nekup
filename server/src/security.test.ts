import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { normalizeToken, requireAppToken } from "./security.js";

describe("normalizeToken", () => {
  it("forgives what phone keyboards and people do to a typed token", () => {
    const real = normalizeToken("kupnekup-abcd-efgh-jkmn-pqrs");
    expect(real).toBe("abcdefghjkmnpqrs");
    expect(normalizeToken("Kupnekup-abcd-efgh-jkmn-pqrs ")).toBe(real); // auto-capitalised, trailing space
    expect(normalizeToken("kupnekup–abcd—efgh‐jkmn-pqrs")).toBe(real); // typographic dashes
    expect(normalizeToken(" kupnekup-abcd-efgh-jkmn-pqrs\n")).toBe(real);
    expect(normalizeToken("abcd-efgh-jkmn-pqrs")).toBe(real); // prefix skipped (19 characters, seen on the iPhone)
    expect(normalizeToken("abcd efgh jkmn pqrs")).toBe(real); // spaces instead of dashes
  });

  it("still rejects a partial token", () => {
    expect(normalizeToken("abcd-efgh-jkmn")).not.toBe(normalizeToken("kupnekup-abcd-efgh-jkmn-pqrs"));
  });
});

describe("requireAppToken", () => {
  const app = new Hono();
  app.use("/api/*", requireAppToken("kupnekup-abcd-efgh-jkmn-pqrs"));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/auth-check", (c) => c.json({ ok: true }));

  it("keeps health public", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("rejects a missing or wrong token with a Czech message", async () => {
    const missing = await app.request("/api/auth-check");
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { error: string }).error).toMatch(/chybí/);
    const wrong = await app.request("/api/auth-check", { headers: { "x-app-token": "kupnekup-xxxx" } });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { error: string }).error).toMatch(/nesedí/);
  });

  it("accepts the token typed with a capital letter or without the prefix", async () => {
    const res = await app.request("/api/auth-check", { headers: { "x-app-token": "Kupnekup-ABCD-efgh-jkmn-pqrs" } });
    expect(res.status).toBe(200);
    const noPrefix = await app.request("/api/auth-check", { headers: { "x-app-token": "abcd-efgh-jkmn-pqrs" } });
    expect(noPrefix.status).toBe(200);
  });
});
