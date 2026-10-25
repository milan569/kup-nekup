import "./env.js"; // must stay first: loads server/.env before other modules read it
import Anthropic from "@anthropic-ai/sdk";
import { Hono, type Context } from "hono";
import { stream } from "hono/streaming";
import { applyFoundComposition, splitIngredients } from "./ingredients.js";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AlternativesResearchResponse, Assessment, CompareItem, CompareResponse, CompareResult, IngredientInfoResponse, Insight, InsightResponse, ProductData, ProductResult, QuickInsight, QuickInsightResponse, UserProfile } from "./types.js";
import { INSIGHT_MODEL, applyValue, combine, quickInsight, researchInsight } from "./insight.js";
import { ENRICH_VERSION, enrichAlternatives } from "./alternatives-enrich.js";
import { MAX_COMPARE_ITEMS, compareKey, deepCompare, quickCompare } from "./compare.js";
import { marketOf, researchAlternatives, type AlternativesResearch } from "./alternatives-research.js";
import { EMPTY_PROFILE } from "./types.js";
import { Cache, TTL } from "./cache.js";
import { fetchByEan, isInStoreCode, mapLimit, offStatus, searchByText, OffUnavailableError } from "./off.js";
import { assess } from "./scoring.js";
import { productNamespace, referenceData } from "./data.js";
import { findAlternatives } from "./alternatives.js";
import { healthData, ingredientInfo, ingredientInfoByRef, itemSeverity } from "./health.js";
import { looksCzech } from "./lang.js";
import { relevantFlags } from "./category.js";
import { translateIngredients } from "./translate.js";
import { createHash } from "node:crypto";
import { rateLimit, requireAppToken } from "./security.js";
import {
  MODEL,
  ClaudeNotConfiguredError,
  ClaudeRefusedError,
  assessManual,
  extractFromPhoto,
  INVALID_KEY_MESSAGE,
  isConfigured,
  keyFormatProblem,
  manufacturerInfo,
  mergePhotoIntoProduct,
  productFromPhoto,
  supplementAdded,
  supplementProduct,
} from "./claude.js";

// ---- env (server/.env is loaded by ./env.js, the first import) ----
const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const APP_TOKEN = process.env.APP_TOKEN?.trim() || undefined;
const DB_PATH = process.env.DB_PATH ?? join(here, "..", "data", "cache.sqlite");

const cache = new Cache(DB_PATH);
const ref = referenceData();
const PRODUCT_NS = productNamespace();

// ---- validation ----
const ProfileSchema = z
  .object({
    countries: z.array(z.string()).default(["cz"]),
    stores: z.array(z.string()).default([]),
    allergens: z.array(z.string()).default([]),
    diets: z.array(z.string()).default([]),
    avoid: z.array(z.string()).default([]),
    showSustainability: z.boolean().default(true),
    tone: z.enum(["humor", "serious"]).default("humor"),
  })
  .partial()
  .optional();

function toProfile(p: z.infer<typeof ProfileSchema>): UserProfile {
  return { ...EMPTY_PROFILE, ...(p ?? {}) } as UserProfile;
}

const EanBody = z.object({ ean: z.string().regex(/^\d{8,14}$/, "EAN musí mít 8 až 14 číslic"), profile: ProfileSchema });
const PhotoBody = z.object({
  imageBase64: z.string().min(100).max(8_000_000),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  profile: ProfileSchema,
  hint: z.string().max(300).optional(),
  /** product already on screen; the photo supplements it */
  base: z.record(z.string(), z.unknown()).optional(),
});
const ManualBody = z.object({
  name: z.string().trim().min(2).max(200),
  brand: z.string().trim().max(200).optional(),
  description: z.string().trim().max(500).optional(),
  profile: ProfileSchema,
});
const ManufacturerBody = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).optional(),
  country: z.string().trim().max(100).optional(),
});
const InsightBody = z.object({
  product: z
    .object({ id: z.string().min(1), name: z.string().min(1), source: z.enum(["off", "obf", "opf", "photo", "manual"]) })
    .passthrough(),
  assessment: z.object({ verdict: z.string() }).passthrough(),
  profile: ProfileSchema,
  previousQuick: z.object({ verdict: z.string(), headline: z.string(), opinion: z.string() }).passthrough().optional(),
  previousInsight: z.object({ verdict: z.string(), headline: z.string(), generatedAt: z.string() }).passthrough().optional(),
});

const AlternativesBody = z.object({
  productId: z.string(),
  categoryTags: z.array(z.string()).default([]),
  countries: z.array(z.string()).default([]),
  stores: z.array(z.string()).default([]),
  profile: ProfileSchema,
  minScore: z.number().optional(),
});

// ---- helpers ----
function unknownProduct(ean: string): ProductData {
  return {
    id: ean,
    ean,
    name: "Neznámý produkt",
    categoryTags: [],
    source: "off",
    dataCompleteness: "minimal",
    fetchedAt: new Date().toISOString(),
  };
}

function result(product: ProductData, assessment: Assessment, path: string, started: number): ProductResult {
  const ms = Date.now() - started;
  cache.logScan(product.id, path, assessment.verdict, ms);
  return { product: relevantFlags(product), assessment, timing: { ms, path } };
}

const app = new Hono();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "x-app-token"] }));
app.use("*", async (c, next) => {
  const t = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} -> ${c.res.status} ${Date.now() - t} ms`);
});
app.use("/api/*", requireAppToken(APP_TOKEN));
// endpoints that spend Claude credit
const aiLimit = rateLimit({ windowMs: 3600_000, max: Number(process.env.AI_RATE_PER_HOUR ?? 60), name: "limit za hodinu" });
app.use("/api/lookup/photo", aiLimit);
app.use("/api/lookup/manual", aiLimit);
app.use("/api/insight", aiLimit);
app.use("/api/insight/quick", aiLimit);
app.use("/api/manufacturer", aiLimit);
app.use("/api/compare", aiLimit);
app.use("/api/alternatives/research", aiLimit);
app.use("/api/compare/quick", aiLimit);
// translations are tiny and cached, but still AI calls: their own, looser limit
app.use("/api/ingredients/translate", rateLimit({ windowMs: 3600_000, max: 300, name: "limit překladů za hodinu" }));

/** Maps any error to a status and a short Czech message; details go to the log only. */
function errorResult(err: unknown, path: string): { status: number; body: { error: string } } {
  if (err instanceof z.ZodError) {
    return { status: 400, body: { error: "Neplatný požadavek: " + err.issues.map((i) => i.message).join("; ") } };
  }
  if (err instanceof ClaudeNotConfiguredError) return { status: 503, body: { error: err.message } };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error(`[claude] ${err.status} – ${keyFormatProblem() ?? "klíč má správný tvar, ale Anthropic ho nepřijal (zrušený nebo z jiného workspace?)"}`);
    return { status: 503, body: { error: INVALID_KEY_MESSAGE } };
  }
  if (err instanceof ClaudeRefusedError) return { status: 422, body: { error: err.message } };
  if (err instanceof OffUnavailableError) {
    const limited = /HTTP 429/.test(err.message);
    return {
      status: 503,
      body: {
        error: limited
          ? "Databáze produktů nás na chvíli brzdí kvůli počtu dotazů. Zkuste to za minutu, nebo vyfoťte etiketu."
          : "Databáze produktů je dočasně nedostupná. Zkuste fotku etikety nebo ruční zadání.",
      },
    };
  }
  if (err instanceof Anthropic.APIError) {
    console.error(`[claude] ${path} HTTP ${err.status ?? "?"} request_id=${err.requestID ?? "?"}: ${err.message}`);
    if (err.status === 429 || err.status === 529 || (err.status ?? 0) >= 500) {
      return { status: 503, body: { error: "AI je teď přetížená. Zkuste to za chvíli znovu, mezitím funguje čárový kód." } };
    }
    return { status: 502, body: { error: "AI požadavek nezpracovala kvůli chybě na serveru. Zkuste to znovu, případně čárový kód nebo ruční zadání. Chyba je zapsaná v logu serveru." } };
  }
  console.error(err);
  return { status: 500, body: { error: "Na serveru se něco pokazilo. Zkuste to znovu, chyba je zapsaná v logu serveru." } };
}

app.onError((err, c) => {
  const { status, body } = errorResult(err, c.req.path);
  return c.json(body, status as 400 | 422 | 500 | 502 | 503);
});

// ---- routes ----
// Protected by requireAppToken like every /api/* route except health:
// lets the app verify that its stored access token really works.
app.get("/api/auth-check", (c) => c.json({ ok: true, tokenRequired: !!APP_TOKEN }));

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    model: MODEL,
    insightModel: INSIGHT_MODEL,
    hasKey: isConfigured(),
    keyProblem: keyFormatProblem() ?? null,
    additives: ref.additives.length,
    health: healthData().counts(),
    cachedProducts: cache.count(PRODUCT_NS),
    offCooldownSeconds: offStatus().cooldownSeconds,
    version: "0.1.0",
  }),
);

app.post("/api/lookup/ean", async (c) => {
  const started = Date.now();
  const body = EanBody.parse(await c.req.json());
  const profile = toProfile(body.profile);
  const ean = body.ean;

  let product = cache.get<ProductData>(PRODUCT_NS, ean, TTL.product);
  let path = "cache";
  // scale/price label of the shop: tell the app to keep scanning for the maker's code
  const inStoreAnswer = () =>
    c.json(
      {
        error: "Tohle je kód z váhy obchodu (nese cenu a hmotnost), ne kód výrobce. Namiřte na čárový kód výrobce na obalu, nebo vyfoťte etiketu.",
        code: "in_store_code",
      },
      422,
    );
  if (!product) {
    if (cache.get<boolean>("instore", ean, TTL.productNotFound)) return inStoreAnswer();
    if (cache.get<boolean>("notfound", ean, TTL.productNotFound)) {
      if (isInStoreCode(ean)) return inStoreAnswer();
      return c.json(result(unknownProduct(ean), notFoundAssessment(), "notfound-cache", started));
    }
    const lookup = await fetchByEan(ean);
    if (lookup.product) {
      product = lookup.product;
      cache.set(PRODUCT_NS, ean, product);
      path = product.source;
    } else if (lookup.notFound && isInStoreCode(ean)) {
      cache.set("instore", ean, true);
      return inStoreAnswer();
    } else if (lookup.notFound) {
      cache.set("notfound", ean, true);
      return c.json(result(unknownProduct(ean), notFoundAssessment(), "notfound", started));
    } else {
      throw new OffUnavailableError(lookup.errors.join("; "));
    }
  }
  return c.json(result(product, assess(product, profile), path, started));
});

function notFoundAssessment(): Assessment {
  return {
    verdict: "nevime",
    confidence: "low",
    reasons: [{ kind: "neutral", text: "Produkt s tímto kódem není v databázi. Vyfoťte etiketu se složením, přečteme ji." }],
    breakdown: {},
    hardRules: [],
    profileWarnings: [],
  };
}

app.post("/api/lookup/photo", async (c) => {
  const started = Date.now();
  const body = PhotoBody.parse(await c.req.json());
  const profile = toProfile(body.profile);
  const base = body.base as unknown as ProductData | undefined;
  const hint =
    body.hint ??
    (base
      ? `Doplňková fotka k výrobku: ${[base.name !== "Neznámý produkt" ? base.name : "", base.brand, base.ean ? `EAN ${base.ean}` : ""].filter(Boolean).join(", ")}`
      : undefined);

  const extraction = await extractFromPhoto(body.imageBase64, body.mediaType, hint, profile.tone);
  if (!extraction.isProductLabel && base) {
    return c.json({ error: extraction.notes?.trim() || "Na doplňkové fotce nevidíme etiketu výrobku. Zkuste záběr na složení nebo přední stranu." }, 422);
  }
  if (!extraction.isProductLabel) {
    const product: ProductData = {
      id: `photo:none`,
      name: "Nerozpoznáno",
      categoryTags: [],
      source: "photo",
      dataCompleteness: "minimal",
      fetchedAt: new Date().toISOString(),
    };
    const assessment: Assessment = {
      verdict: "nevime",
      confidence: "low",
      reasons: [{ kind: "neutral", text: extraction.notes?.trim() || "Na fotce nevidíme etiketu produktu. Zkuste záběr na složení." }],
      breakdown: {},
      hardRules: [],
      profileWarnings: [],
    };
    return c.json(result(product, assessment, "photo-none", started));
  }

  let product = productFromPhoto(extraction, body.imageBase64);
  let path = "photo";
  if (extraction.barcode && /^\d{8,14}$/.test(extraction.barcode) && !isInStoreCode(extraction.barcode)) {
    const cached = cache.get<ProductData>(PRODUCT_NS, extraction.barcode, TTL.product);
    const base = cached ?? (await fetchByEan(extraction.barcode).catch(() => undefined))?.product;
    if (base) {
      product = mergePhotoIntoProduct(base, product);
      cache.set(PRODUCT_NS, extraction.barcode, product);
      path = "photo+off";
    }
  }
  let supplement: ProductResult["supplement"];
  if (base) {
    const merged = supplementProduct(base, product);
    supplement = { added: supplementAdded(base, merged), replaces: base.id };
    product = merged;
    path = "photo-supplement";
    // next scan of the same code finds the richer product (only when the photo shows no other code)
    const photoCode = extraction.barcode?.trim();
    if (base.ean && (!photoCode || photoCode === base.ean)) cache.set(PRODUCT_NS, base.ean, product);
  }
  cache.set(PRODUCT_NS, product.id, product);
  const assessment = assess(product, profile);
  if (supplement) {
    assessment.reasons.unshift({
      kind: "neutral",
      text: supplement.added.length ? `📷 Doplňková fotka přidala: ${supplement.added.join(", ")}.` : "📷 Doplňková fotka nepřinesla nic nového, hodnocení zůstává.",
    });
  }
  if (product.ingredientsPartial) {
    if (assessment.confidence === "high") assessment.confidence = "medium";
    assessment.reasons.unshift({ kind: "warning", text: "Složení je na fotce zčásti zakryté – hodnotíme čitelnou část. Posudek AI zkusí dohledat zbytek." });
  }
  if (extraction.readability === "poor") {
    assessment.confidence = "low";
    assessment.reasons.unshift({ kind: "warning", text: "Etiketa byla špatně čitelná, údaje mohou být neúplné." });
  }
  return c.json({ ...result(product, assessment, path, started), supplement });
});

app.post("/api/lookup/manual", async (c) => {
  const started = Date.now();
  const body = ManualBody.parse(await c.req.json());
  const profile = toProfile(body.profile);
  const key = `${body.name}|${body.brand ?? ""}|${body.description ?? ""}|${profile.diets.join(",")}|${profile.avoid.join(",")}`.toLowerCase();
  const cached = cache.get<ProductResult>("manual", key, TTL.manufacturer);
  if (cached) {
    cache.logScan(cached.product.id, "manual-cache", cached.assessment.verdict, Date.now() - started);
    return c.json({ ...cached, timing: { ms: Date.now() - started, path: "manual-cache" } });
  }
  const res = await assessManual(body.name, body.brand, body.description, profile);
  cache.set("manual", key, res);
  cache.logScan(res.product.id, "manual", res.assessment.verdict, Date.now() - started);
  return c.json({ ...res, timing: { ms: Date.now() - started, path: "manual" } });
});

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ candidates: [] });
  const countries = (c.req.query("countries") ?? "cz").split(",").map((s) => s.trim()).filter(Boolean);
  const key = `${q.toLowerCase()}|${countries.join(",")}`;
  const cached = cache.get<unknown[]>("search", key, TTL.search);
  if (cached) return c.json({ candidates: cached });
  const candidates = await searchByText(q, countries);
  cache.set("search", key, candidates);
  return c.json({ candidates });
});

// AI research of the product and its maker. Slow on first call (web search),
// then cached. Identical concurrent requests share one model call.
const insightInFlight = new Map<string, Promise<Insight>>();

// ---- quick opinion with a small web search (shown automatically) ----
const quickInFlight = new Map<string, Promise<QuickInsight>>();
const QUICK_VERSION = "8"; // 8: dTest findings of recent category tests
const quickKey = (productId: string, tone: string | undefined) => `${productId}|${tone ?? "humor"}|${ref.version}|q${QUICK_VERSION}`;

app.post("/api/insight/quick", async (c) => {
  const started = Date.now();
  const body = InsightBody.parse(await c.req.json());
  const product = body.product as unknown as ProductData;
  const rule = body.assessment as unknown as Assessment;
  const profile = toProfile(body.profile);
  if (product.id === "photo:none") return c.json({ error: "Na fotce nebyl rozpoznán žádný výrobek." }, 422);
  const key = quickKey(product.id, profile.tone);

  const finish = (quick: QuickInsight, cached: boolean): QuickInsightResponse => {
    const combined = applyValue(combine(product, rule, quick, "Rychlý názor AI"), quick.value, quick.confidence, profile.tone);
    return { quick, assessment: combined !== rule ? combined : undefined, cached, ms: Date.now() - started };
  };
  const cachedQuick = cache.get<QuickInsight>("quick", key, TTL.insight);
  if (cachedQuick) return c.json(finish(cachedQuick, true));

  const previousQuick = body.previousQuick as unknown as QuickInsight | undefined;
  let pending = quickInFlight.get(key);
  if (!pending) {
    pending = quickInsight(product, rule, profile, previousQuick).finally(() => quickInFlight.delete(key));
    quickInFlight.set(key, pending);
  }
  const work = pending.then((quick) => {
    cache.set("quick", key, quick);
    return finish(quick, false);
  });
  return slowJson(c, work, "/api/insight/quick");
});

/**
 * Streams spaces every 10 s while slow AI work runs, then the JSON (JSON
 * allows leading whitespace), so no proxy or phone drops the connection.
 * Errors after the headers are sent travel in the body as { error }.
 */
function slowJson(c: Context, work: Promise<unknown>, path: string): Response {
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Cache-Control", "no-store");
  return stream(c, async (s) => {
    const keepAlive = setInterval(() => {
      s.write(" ").catch(() => undefined);
    }, 10_000);
    try {
      await s.write(JSON.stringify(await work));
    } catch (err) {
      await s.write(JSON.stringify(errorResult(err, path).body));
    } finally {
      clearInterval(keepAlive);
    }
  });
}

// bump when the insight prompt/schema changes so old cached insights are not reused
const INSIGHT_VERSION = "8"; // 8: alternatives never worse, best of the kind first, at least 3

app.post("/api/insight", async (c) => {
  const started = Date.now();
  const body = InsightBody.parse(await c.req.json());
  const product0 = body.product as unknown as ProductData;
  const rule0 = body.assessment as unknown as Assessment;
  const profile = toProfile(body.profile);
  const tone = profile.tone ?? "humor";
  if (product0.id === "photo:none") return c.json({ error: "Na fotce nebyl rozpoznán žádný výrobek." }, 422);
  const key = `${product0.id}|${tone}|${ref.version}|v${INSIGHT_VERSION}`;

  // composition found online → the rules can judge it; the AI then nudges by one step
  const finish = (insight: Insight, cached: boolean): InsightResponse => {
    let product = product0;
    let rule = rule0;
    if (insight.foundComposition && (!product0.ingredientsText?.trim() || product0.ingredientsPartial)) {
      product = applyFoundComposition(product0, insight.foundComposition);
      rule = assess(product, profile);
      if (rule.confidence === "high") rule.confidence = "medium";
      const fc = insight.foundComposition;
      rule.reasons.unshift({
        kind: "neutral",
        text: `Složení dohledané na webu${fc.market ? ` (trh: ${fc.market})` : ""}: ${fc.sourceTitle}. Na obalu u nás se může lišit.`,
      });
    }
    // price/value comes from the quick opinion (it always runs first); the deep tool schema has no room for it
    const quick = insight.value ? undefined : cache.get<QuickInsight>("quick", quickKey(product0.id, tone), TTL.insight);
    const value = insight.value ?? quick?.value;
    const valueConfidence = insight.value ? insight.confidence : (quick?.confidence ?? "low");
    return {
      insight: value && !insight.value ? { ...insight, value } : insight,
      assessment: applyValue(combine(product, rule, insight), value, valueConfidence, tone),
      product: product !== product0 ? product : undefined,
      cached,
      ms: Date.now() - started,
    };
  };

  // a supplementary photo refined the product: the research (history, maker, alternatives) still holds
  const previousInsight = body.previousInsight as unknown as Insight | undefined;
  if (previousInsight && !cache.get<Insight>("insight", key, TTL.insight)) {
    cache.set("insight", key, previousInsight);
    console.log("[insight] reused previous research for refined product", product0.id);
  }

  const cachedInsight = cache.get<Insight>("insight", key, TTL.insight);
  if (cachedInsight && (!cachedInsight.alternatives?.length || (cachedInsight.enrichVersion ?? 1) >= ENRICH_VERSION)) {
    return c.json(finish(cachedInsight, true));
  }
  if (cachedInsight) {
    // researched before the alternatives got photos and links from the web: add them once (a few seconds)
    const reenrich = enrichAlternatives(cachedInsight.alternatives!, profile)
      .catch(() => cachedInsight.alternatives)
      .then((alternatives) => {
        const updated: Insight = { ...cachedInsight, alternatives, enrichVersion: ENRICH_VERSION };
        cache.set("insight", key, updated);
        return finish(updated, true);
      });
    return slowJson(c, reenrich, "/api/insight");
  }

  let pending = insightInFlight.get(key);
  if (!pending) {
    pending = researchInsight(product0, rule0, profile).finally(() => insightInFlight.delete(key));
    insightInFlight.set(key, pending);
  }
  // research takes one to three minutes – keep the connection alive meanwhile
  const work = pending.then((insight) => {
    cache.set("insight", key, insight);
    return finish(insight, false);
  });
  return slowJson(c, work, "/api/insight");
});

// ---- closest alternatives of the same kind in one country (web research) ----
const AltResearchBody = z.object({
  product: z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough(),
  assessment: z.object({ verdict: z.string() }).passthrough(),
  country: z.string().regex(/^[a-zA-Z]{2}$/),
  profile: ProfileSchema,
});
const ALT_RESEARCH_VERSION = "2";

app.post("/api/alternatives/research", async (c) => {
  const started = Date.now();
  const body = AltResearchBody.parse(await c.req.json());
  const product = body.product as unknown as ProductData;
  const assessment = body.assessment as unknown as Assessment;
  const profile = toProfile(body.profile);
  const country = marketOf(body.country).code;
  const key = `${product.id}|${country}|${profile.tone ?? "humor"}|${ref.version}|a${ALT_RESEARCH_VERSION}`;
  const finish = (r: AlternativesResearch, cached: boolean): AlternativesResearchResponse => ({ ...r, cached, ms: Date.now() - started });
  const cached = cache.get<AlternativesResearch>("alt-research", key, TTL.insight);
  if (cached) return c.json(finish(cached, true));
  const work = researchAlternatives(product, assessment, country, profile).then((r) => {
    cache.set("alt-research", key, r);
    return finish(r, false);
  });
  return slowJson(c, work, "/api/alternatives/research");
});

// ---- comparison of the basket (2–4 products) ----
const CompareBody = z.object({
  items: z
    .array(
      z.object({
        product: z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough(),
        assessment: z.object({ verdict: z.string() }).passthrough(),
      }),
    )
    .min(2)
    .max(MAX_COMPARE_ITEMS),
  profile: ProfileSchema,
});
const COMPARE_VERSION = "1";

app.post("/api/compare/quick", async (c) => {
  const started = Date.now();
  const body = CompareBody.parse(await c.req.json());
  const items = body.items as unknown as CompareItem[];
  const profile = toProfile(body.profile);
  const key = compareKey(items, profile.tone, "quick", `${ref.version}|c${COMPARE_VERSION}`);
  const cached = cache.get<CompareResult>("compare", key, TTL.insight);
  if (cached) return c.json({ result: cached, cached: true, ms: Date.now() - started } satisfies CompareResponse);
  const work = quickCompare(items, profile).then((result): CompareResponse => {
    cache.set("compare", key, result);
    return { result, cached: false, ms: Date.now() - started };
  });
  return slowJson(c, work, "/api/compare/quick");
});

app.post("/api/compare", async (c) => {
  const started = Date.now();
  const body = CompareBody.parse(await c.req.json());
  const items = body.items as unknown as CompareItem[];
  const profile = toProfile(body.profile);
  const tone = profile.tone ?? "humor";
  const key = compareKey(items, tone, "deep", `${ref.version}|c${COMPARE_VERSION}|v${INSIGHT_VERSION}`);
  const cached = cache.get<CompareResult>("compare", key, TTL.insight);
  if (cached) return c.json({ result: cached, cached: true, ms: Date.now() - started } satisfies CompareResponse);
  const work = (async (): Promise<CompareResponse> => {
    // every product gets its full research first (free when the user already ran it), two at a time
    const insights = await mapLimit(items, 2, async (it) => {
      const ikey = `${it.product.id}|${tone}|${ref.version}|v${INSIGHT_VERSION}`;
      const known = cache.get<Insight>("insight", ikey, TTL.insight);
      if (known) return known;
      const insight = await researchInsight(it.product, it.assessment, profile).catch((err) => {
        console.warn("[compare] research failed for", it.product.name, (err as Error).message);
        return undefined;
      });
      if (insight) cache.set("insight", ikey, insight);
      return insight;
    });
    const result = await deepCompare(items, insights, profile);
    cache.set("compare", key, result);
    return { result, cached: false, ms: Date.now() - started };
  })();
  return slowJson(c, work, "/api/compare");
});

app.post("/api/manufacturer", async (c) => {
  const body = ManufacturerBody.parse(await c.req.json());
  const key = `${body.name}|${body.brand ?? ""}|${body.country ?? ""}`.toLowerCase();
  const cached = cache.get("manufacturer", key, TTL.manufacturer);
  if (cached) return c.json(cached);
  const info = await manufacturerInfo(body.name, body.brand, body.country);
  cache.set("manufacturer", key, info);
  return c.json(info);
});

// Health impact of one tapped ingredient: a pure lookup in server/data/health, no AI cost.
const IngredientBody = z.object({
  q: z.string().max(400).optional(),
  ref: z.string().max(80).optional(),
  /** the whole ingredient list, so meat-only fillers are recognised */
  context: z.string().max(4000).optional(),
});

app.post("/api/ingredient", async (c) => {
  const body = IngredientBody.parse(await c.req.json());
  const q = (body.q ?? "").trim();
  const ref = (body.ref ?? "").trim();
  if (!q && !ref) return c.json({ error: "Chybí název složky." }, 400);
  const matches = ref ? ingredientInfoByRef(ref) : ingredientInfo(q, body.context || q);
  const res: IngredientInfoResponse = { query: q || ref, matches };
  return c.json(res);
});

// Ingredient list in Czech for display: foreign lists are translated once and cached.
const TranslateBody = z.object({ text: z.string().min(1).max(4000) });

app.post("/api/ingredients/translate", async (c) => {
  const original = TranslateBody.parse(await c.req.json()).text.trim();
  const translated = !looksCzech(original);
  let text = original;
  let cached = true;
  if (translated) {
    const key = createHash("sha1").update(original).digest("hex");
    const hit = cache.get<string>("translation", key, TTL.translation);
    if (hit) {
      text = hit;
    } else {
      text = await translateIngredients(original);
      cache.set("translation", key, text);
      cached = false;
    }
  }
  const context = text.replace(/_/g, "");
  const items = splitIngredients(context).map((t) => ({ text: t, severity: itemSeverity(t, context) }));
  return c.json({ text, translated, cached, items });
});

app.post("/api/alternatives", async (c) => {
  const body = AlternativesBody.parse(await c.req.json());
  const alternatives = await findAlternatives(
    {
      productId: body.productId,
      categoryTags: body.categoryTags,
      countries: body.countries,
      stores: body.stores,
      profile: toProfile(body.profile),
      minScore: body.minScore,
    },
    cache,
  );
  return c.json({ alternatives });
});

// ---- start ----
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === "IPv4" && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

// Graceful shutdown (Fly sends SIGINT, then SIGTERM after a few seconds):
// stop accepting connections and close the SQLite cache so the volume
// unmounts cleanly. Running AI research gets a short grace period.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: ukončuji server (běžících posudků: ${insightInFlight.size})`);
  server.close();
  const finish = () => {
    try {
      cache.close();
    } catch {
      // already closed
    }
    process.exit(0);
  };
  if (insightInFlight.size === 0) return finish();
  // give in-flight research a moment; Fly escalates to SIGKILL after its kill timeout
  Promise.race([Promise.allSettled([...insightInFlight.values()]), new Promise((r) => setTimeout(r, 2500))]).then(finish);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
  console.log(`Kup/Nekup server běží na portu ${PORT}`);
  console.log(`Model: ${MODEL}, posudek AI: ${INSIGHT_MODEL}, Claude klíč: ${isConfigured() ? (keyFormatProblem() ? `ŠPATNÝ TVAR – ${keyFormatProblem()}` : "nastaven") : "CHYBÍ (fotka, ruční zadání a posudek AI nepůjdou)"}`);
  console.log(`Přístupový klíč aplikace: ${APP_TOKEN ? "vyžadován" : "vypnut (jen pro domácí síť)"}`);
  console.log(`Aditiva v tabulce: ${ref.additives.length}, nežádoucí vzory: ${ref.unwanted.length}, alergeny: ${ref.allergens.length}`);
  for (const ip of lanAddresses()) console.log(`  V aplikaci nastavte server: http://${ip}:${PORT}`);
});
