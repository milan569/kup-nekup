import type { MiddlewareHandler } from "hono";
import { timingSafeEqual } from "node:crypto";

/**
 * Protection for a server exposed to the internet:
 * - APP_TOKEN: when set, every /api/* request except /api/health must carry
 *   the header `x-app-token` with this value (the app stores it in settings).
 * - Rate limit for the endpoints that spend Claude credit.
 */

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Typing a token on a phone adds surprises: auto-capitalised first letter,
 * trailing spaces, typographic dashes. Normalise both sides before comparing.
 */
export function normalizeToken(raw: string): string {
  return (
    raw
      .normalize("NFKC")
      .replace(/[‐-―−﹘﹣－]/g, "-")
      .replace(/\s+/g, "")
      .toLowerCase()
      // the "kupnekup-" prefix is the same for every token (no secret in it),
      // so it is optional – people tend to read it as a label and skip it
      .replace(/^kupnekup-?/, "")
      // dashes are only for readability
      .replace(/-/g, "")
  );
}

export function requireAppToken(token: string | undefined): MiddlewareHandler {
  const expected = token ? normalizeToken(token) : undefined;
  return async (c, next) => {
    if (!expected || c.req.path === "/api/health" || c.req.method === "OPTIONS") return next();
    const raw = c.req.header("x-app-token") ?? "";
    if (!safeEqual(normalizeToken(raw), expected)) {
      const why = raw ? "nesedí" : "chybí";
      console.warn(`[auth] ${c.req.method} ${c.req.path}: přístupový klíč ${why}${raw ? ` (délka ${raw.length}, čekáno ${expected.length})` : ""}`);
      return c.json({ error: `Přístupový klíč aplikace ${why}. Zadejte ho v Profil → Nastavení serveru a stiskněte Uložit a otestovat.` }, 401);
    }
    return next();
  };
}

/** Sliding-window limiter per client IP and route group, in memory. */
export function rateLimit(opts: { windowMs: number; max: number; name: string }): MiddlewareHandler {
  const hits = new Map<string, number[]>();
  return async (c, next) => {
    const ip =
      c.req.header("fly-client-ip") ??
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "local";
    const now = Date.now();
    const list = (hits.get(ip) ?? []).filter((t) => now - t < opts.windowMs);
    if (list.length >= opts.max) {
      const retry = Math.ceil((opts.windowMs - (now - list[0]!)) / 60000);
      return c.json({ error: `Příliš mnoho dotazů na AI (${opts.name}). Zkuste to za ${retry} min.` }, 429);
    }
    list.push(now);
    hits.set(ip, list);
    return next();
  };
}
