import { z } from "zod";
import type {
  Alternative,
  AlternativesRequest,
  AlternativesResearchRequest,
  AlternativesResearchResponse,
  Assessment,
  CompareItem,
  CompareRequest,
  CompareResponse,
  CompareResult,
  EanLookupRequest,
  IngredientInfoResponse,
  Insight,
  InsightRequest,
  InsightResponse,
  ManualLookupRequest,
  ManufacturerInfo,
  ManufacturerRequest,
  PhotoLookupRequest,
  ProductData,
  ProductResult,
  QuickInsight,
  QuickInsightResponse,
  SearchCandidate,
  UserProfile,
} from "./types";
import { EMPTY_PROFILE } from "./types";
import { Cache, TTL, memoryStore } from "./cache";
import { ApiError } from "./errors";
import { applyValue, combine, quickInsight as runQuickInsight, researchInsight } from "./insight";
import { ENRICH_VERSION, enrichAlternatives } from "./alternatives-enrich";
import { MAX_COMPARE_ITEMS, compareKey, deepCompare, quickCompare } from "./compare";
import { marketOf, researchAlternatives, type AlternativesResearch } from "./alternatives-research";
import { OffUnavailableError, fetchByEan, isInStoreCode, mapLimit, searchProducts } from "./off";
import { assess } from "./scoring";
import { productNamespace, referenceData } from "./data";
import { findAlternatives } from "./alternatives";
import { ingredientInfo as healthIngredientInfo, ingredientInfoByRef, itemSeverity } from "./health";
import { looksCzech } from "./lang";
import { relevantFlags } from "./category";
import { translateIngredients as runTranslate } from "./translate";
import { applyFoundComposition, splitIngredients } from "./ingredients";
import { sha1Hex } from "./hash";
import {
  assessManual,
  extractFromPhoto,
  manufacturerInfo as claudeManufacturerInfo,
  mergePhotoIntoProduct,
  productFromPhoto,
  supplementAdded,
  supplementProduct,
} from "./claude";

/**
 * The former server routes as plain functions. Same requests, same answers,
 * same cache keys and versions; only the HTTP layer, the access token and the
 * rate limits are gone (the device is the only caller now).
 */

let cache = new Cache(memoryStore());

/** The app calls this once with the device storage; tests run on memory. */
export function initLookup(c: Cache): void {
  cache = c;
}

const ref = () => referenceData();
const productNs = () => productNamespace();

// ---- validation (cheap, and it catches UI bugs early) ----
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
const AltResearchBody = z.object({
  product: z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough(),
  assessment: z.object({ verdict: z.string() }).passthrough(),
  country: z.string().regex(/^[a-zA-Z]{2}$/),
  profile: ProfileSchema,
});
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
const IngredientBody = z.object({
  q: z.string().max(400).optional(),
  ref: z.string().max(80).optional(),
  /** the whole ingredient list, so meat-only fillers are recognised */
  context: z.string().max(4000).optional(),
});
const TranslateBody = z.object({ text: z.string().min(1).max(4000) });

// bump when a prompt or schema changes so old cached answers are not reused
const QUICK_VERSION = "8"; // 8: dTest findings of recent category tests
const INSIGHT_VERSION = "8"; // 8: alternatives never worse, best of the kind first, at least 3
const ALT_RESEARCH_VERSION = "2";
const COMPARE_VERSION = "1";

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
  return { product: relevantFlags(product), assessment, timing: { ms: Date.now() - started, path } };
}

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

const IN_STORE_MESSAGE =
  "Tohle je kód z váhy obchodu (nese cenu a hmotnost), ne kód výrobce. Namiřte na čárový kód výrobce na obalu, nebo vyfoťte etiketu.";
const inStoreError = () => new ApiError("http", IN_STORE_MESSAGE, 422, "in_store_code");

// ---- lookups ----

export async function lookupEan(body: EanLookupRequest): Promise<ProductResult> {
  const started = Date.now();
  const parsed = EanBody.parse(body);
  const profile = toProfile(parsed.profile);
  const ean = parsed.ean;
  const ns = productNs();

  let product = await cache.get<ProductData>(ns, ean, TTL.product);
  let path = "cache";
  if (!product) {
    // scale/price label of the shop: tell the app to keep scanning for the maker's code
    if (await cache.get<boolean>("instore", ean, TTL.productNotFound)) throw inStoreError();
    if (await cache.get<boolean>("notfound", ean, TTL.productNotFound)) {
      if (isInStoreCode(ean)) throw inStoreError();
      return result(unknownProduct(ean), notFoundAssessment(), "notfound-cache", started);
    }
    const lookup = await fetchByEan(ean);
    if (lookup.product) {
      product = lookup.product;
      await cache.set(ns, ean, product);
      path = product.source;
    } else if (lookup.notFound && isInStoreCode(ean)) {
      await cache.set("instore", ean, true);
      throw inStoreError();
    } else if (lookup.notFound) {
      await cache.set("notfound", ean, true);
      return result(unknownProduct(ean), notFoundAssessment(), "notfound", started);
    } else {
      throw new OffUnavailableError(lookup.errors.join("; "));
    }
  }
  return result(product, assess(product, profile), path, started);
}

export async function lookupPhoto(body: PhotoLookupRequest): Promise<ProductResult> {
  const started = Date.now();
  const parsed = PhotoBody.parse(body);
  const profile = toProfile(parsed.profile);
  const base = parsed.base as unknown as ProductData | undefined;
  const ns = productNs();
  const hint =
    parsed.hint ??
    (base
      ? `Doplňková fotka k výrobku: ${[base.name !== "Neznámý produkt" ? base.name : "", base.brand, base.ean ? `EAN ${base.ean}` : ""].filter(Boolean).join(", ")}`
      : undefined);

  const extraction = await extractFromPhoto(parsed.imageBase64, parsed.mediaType, hint, profile.tone);
  if (!extraction.isProductLabel && base) {
    throw new ApiError("http", extraction.notes?.trim() || "Na doplňkové fotce nevidíme etiketu výrobku. Zkuste záběr na složení nebo přední stranu.", 422);
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
    return result(product, assessment, "photo-none", started);
  }

  let product = productFromPhoto(extraction, parsed.imageBase64);
  let path = "photo";
  if (extraction.barcode && /^\d{8,14}$/.test(extraction.barcode) && !isInStoreCode(extraction.barcode)) {
    const cached = await cache.get<ProductData>(ns, extraction.barcode, TTL.product);
    const known = cached ?? (await fetchByEan(extraction.barcode).catch(() => undefined))?.product;
    if (known) {
      product = mergePhotoIntoProduct(known, product);
      await cache.set(ns, extraction.barcode, product);
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
    if (base.ean && (!photoCode || photoCode === base.ean)) await cache.set(ns, base.ean, product);
  }
  await cache.set(ns, product.id, product);
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
  return { ...result(product, assessment, path, started), supplement };
}

export async function lookupManual(body: ManualLookupRequest): Promise<ProductResult> {
  const started = Date.now();
  const parsed = ManualBody.parse(body);
  const profile = toProfile(parsed.profile);
  const key = `${parsed.name}|${parsed.brand ?? ""}|${parsed.description ?? ""}|${profile.diets.join(",")}|${profile.avoid.join(",")}`.toLowerCase();
  const cached = await cache.get<ProductResult>("manual", key, TTL.manufacturer);
  if (cached) return { ...cached, timing: { ms: Date.now() - started, path: "manual-cache" } };
  const res = await assessManual(parsed.name, parsed.brand, parsed.description, profile);
  await cache.set("manual", key, res);
  return { ...res, timing: { ms: Date.now() - started, path: "manual" } };
}

export interface SearchResponse {
  candidates: SearchCandidate[];
  /** "ai" when the database was down and one web search through Claude answered instead */
  via?: "off" | "ai" | "none";
}

export async function search(q: string, countries: string[]): Promise<SearchResponse> {
  const query = q.trim();
  if (query.length < 2) return { candidates: [], via: "none" };
  const list = countries.length ? countries : ["cz"];
  const key = `${query.toLowerCase()}|${list.join(",")}`;
  const cached = await cache.get<SearchResponse>("search", key, TTL.search);
  if (cached) return cached;
  const res = await searchProducts(query, list);
  const out: SearchResponse = { candidates: res.candidates, via: res.via };
  await cache.set("search", key, out);
  return out;
}

// ---- AI opinions (identical concurrent requests share one model call) ----

const quickInFlight = new Map<string, Promise<QuickInsight>>();
const insightInFlight = new Map<string, Promise<Insight>>();

const quickKey = (productId: string, tone: string | undefined) => `${productId}|${tone ?? "humor"}|${ref().version}|q${QUICK_VERSION}`;
const insightKey = (productId: string, tone: string) => `${productId}|${tone}|${ref().version}|v${INSIGHT_VERSION}`;

export async function quickInsight(body: InsightRequest): Promise<QuickInsightResponse> {
  const started = Date.now();
  const parsed = InsightBody.parse(body);
  const product = parsed.product as unknown as ProductData;
  const rule = parsed.assessment as unknown as Assessment;
  const profile = toProfile(parsed.profile);
  if (product.id === "photo:none") throw new ApiError("http", "Na fotce nebyl rozpoznán žádný výrobek.", 422);
  const key = quickKey(product.id, profile.tone);

  const finish = (quick: QuickInsight, cached: boolean): QuickInsightResponse => {
    const combined = applyValue(combine(product, rule, quick, "Rychlý názor AI"), quick.value, quick.confidence, profile.tone);
    return { quick, assessment: combined !== rule ? combined : undefined, cached, ms: Date.now() - started };
  };
  const cachedQuick = await cache.get<QuickInsight>("quick", key, TTL.insight);
  if (cachedQuick) return finish(cachedQuick, true);

  const previousQuick = parsed.previousQuick as unknown as QuickInsight | undefined;
  let pending = quickInFlight.get(key);
  if (!pending) {
    pending = runQuickInsight(product, rule, profile, previousQuick).finally(() => quickInFlight.delete(key));
    quickInFlight.set(key, pending);
  }
  const quick = await pending;
  await cache.set("quick", key, quick);
  return finish(quick, false);
}

export async function insight(body: InsightRequest): Promise<InsightResponse> {
  const started = Date.now();
  const parsed = InsightBody.parse(body);
  const product0 = parsed.product as unknown as ProductData;
  const rule0 = parsed.assessment as unknown as Assessment;
  const profile = toProfile(parsed.profile);
  const tone = profile.tone ?? "humor";
  if (product0.id === "photo:none") throw new ApiError("http", "Na fotce nebyl rozpoznán žádný výrobek.", 422);
  const key = insightKey(product0.id, tone);

  // composition found online → the rules can judge it; the AI then nudges by one step
  const finish = async (ins: Insight, cached: boolean): Promise<InsightResponse> => {
    let product = product0;
    let rule = rule0;
    if (ins.foundComposition && (!product0.ingredientsText?.trim() || product0.ingredientsPartial)) {
      product = applyFoundComposition(product0, ins.foundComposition);
      rule = assess(product, profile);
      if (rule.confidence === "high") rule.confidence = "medium";
      const fc = ins.foundComposition;
      rule.reasons.unshift({
        kind: "neutral",
        text: `Složení dohledané na webu${fc.market ? ` (trh: ${fc.market})` : ""}: ${fc.sourceTitle}. Na obalu u nás se může lišit.`,
      });
    }
    // price/value comes from the quick opinion (it always runs first); the deep tool schema has no room for it
    const quick = ins.value ? undefined : await cache.get<QuickInsight>("quick", quickKey(product0.id, tone), TTL.insight);
    const value = ins.value ?? quick?.value;
    const valueConfidence = ins.value ? ins.confidence : (quick?.confidence ?? "low");
    return {
      insight: value && !ins.value ? { ...ins, value } : ins,
      assessment: applyValue(combine(product, rule, ins), value, valueConfidence, tone),
      product: product !== product0 ? product : undefined,
      cached,
      ms: Date.now() - started,
    };
  };

  // a supplementary photo refined the product: the research (history, maker, alternatives) still holds
  const previousInsight = parsed.previousInsight as unknown as Insight | undefined;
  if (previousInsight && !(await cache.get<Insight>("insight", key, TTL.insight))) {
    await cache.set("insight", key, previousInsight);
    console.log("[insight] reused previous research for refined product", product0.id);
  }

  const cachedInsight = await cache.get<Insight>("insight", key, TTL.insight);
  if (cachedInsight && (!cachedInsight.alternatives?.length || (cachedInsight.enrichVersion ?? 1) >= ENRICH_VERSION)) {
    return finish(cachedInsight, true);
  }
  if (cachedInsight) {
    // researched before the alternatives got photos and codes: add them once (a few seconds)
    const alternatives = await enrichAlternatives(cachedInsight.alternatives!, profile).catch(() => cachedInsight.alternatives!);
    const updated: Insight = { ...cachedInsight, alternatives, enrichVersion: ENRICH_VERSION };
    await cache.set("insight", key, updated);
    return finish(updated, true);
  }

  let pending = insightInFlight.get(key);
  if (!pending) {
    pending = researchInsight(product0, rule0, profile).finally(() => insightInFlight.delete(key));
    insightInFlight.set(key, pending);
  }
  const ins = await pending;
  await cache.set("insight", key, ins);
  return finish(ins, false);
}

// ---- closest alternatives of the same kind in one country (web research) ----

export async function alternativesResearch(body: AlternativesResearchRequest): Promise<AlternativesResearchResponse> {
  const started = Date.now();
  const parsed = AltResearchBody.parse(body);
  const product = parsed.product as unknown as ProductData;
  const assessment = parsed.assessment as unknown as Assessment;
  const profile = toProfile(parsed.profile);
  const country = marketOf(parsed.country).code;
  const key = `${product.id}|${country}|${profile.tone ?? "humor"}|${ref().version}|a${ALT_RESEARCH_VERSION}`;
  const finish = (r: AlternativesResearch, cached: boolean): AlternativesResearchResponse => ({ ...r, cached, ms: Date.now() - started });
  const cached = await cache.get<AlternativesResearch>("alt-research", key, TTL.insight);
  if (cached) return finish(cached, true);
  const r = await researchAlternatives(product, assessment, country, profile);
  await cache.set("alt-research", key, r);
  return finish(r, false);
}

// ---- comparison of the basket (2–4 products) ----

export async function compareQuick(body: CompareRequest): Promise<CompareResponse> {
  const started = Date.now();
  const parsed = CompareBody.parse(body);
  const items = parsed.items as unknown as CompareItem[];
  const profile = toProfile(parsed.profile);
  const key = compareKey(items, profile.tone, "quick", `${ref().version}|c${COMPARE_VERSION}`);
  const cached = await cache.get<CompareResult>("compare", key, TTL.insight);
  if (cached) return { result: cached, cached: true, ms: Date.now() - started };
  const res = await quickCompare(items, profile);
  await cache.set("compare", key, res);
  return { result: res, cached: false, ms: Date.now() - started };
}

export async function compare(body: CompareRequest): Promise<CompareResponse> {
  const started = Date.now();
  const parsed = CompareBody.parse(body);
  const items = parsed.items as unknown as CompareItem[];
  const profile = toProfile(parsed.profile);
  const tone = profile.tone ?? "humor";
  const key = compareKey(items, tone, "deep", `${ref().version}|c${COMPARE_VERSION}|v${INSIGHT_VERSION}`);
  const cached = await cache.get<CompareResult>("compare", key, TTL.insight);
  if (cached) return { result: cached, cached: true, ms: Date.now() - started };
  // every product gets its full research first (free when the user already ran it), two at a time
  const insights = await mapLimit(items, 2, async (it) => {
    const ikey = insightKey(it.product.id, tone);
    const known = await cache.get<Insight>("insight", ikey, TTL.insight);
    if (known) return known;
    const ins = await researchInsight(it.product, it.assessment, profile).catch((err) => {
      console.warn("[compare] research failed for", it.product.name, (err as Error).message);
      return undefined;
    });
    if (ins) await cache.set("insight", ikey, ins);
    return ins;
  });
  const res = await deepCompare(items, insights, profile);
  await cache.set("compare", key, res);
  return { result: res, cached: false, ms: Date.now() - started };
}

// ---- small lookups ----

export async function manufacturer(body: ManufacturerRequest): Promise<ManufacturerInfo> {
  const parsed = ManufacturerBody.parse(body);
  const key = `${parsed.name}|${parsed.brand ?? ""}|${parsed.country ?? ""}`.toLowerCase();
  const cached = await cache.get<ManufacturerInfo>("manufacturer", key, TTL.manufacturer);
  if (cached) return cached;
  const info = await claudeManufacturerInfo(parsed.name, parsed.brand, parsed.country);
  await cache.set("manufacturer", key, info);
  return info;
}

/** Health impact of one tapped ingredient: a pure lookup in the bundled tables, no AI cost. */
export async function ingredientInfo(body: { q?: string; ref?: string; context?: string }): Promise<IngredientInfoResponse> {
  const parsed = IngredientBody.parse(body);
  const q = (parsed.q ?? "").trim();
  const refId = (parsed.ref ?? "").trim();
  if (!q && !refId) throw new ApiError("http", "Chybí název složky.", 400);
  const matches = refId ? ingredientInfoByRef(refId) : healthIngredientInfo(q, parsed.context || q);
  return { query: q || refId, matches };
}

/** Ingredient list in Czech for display: foreign lists are translated once and cached. */
export async function translateIngredients(body: { text: string }): Promise<{ text: string; translated: boolean; cached: boolean; items: { text: string; severity: number }[] }> {
  const original = TranslateBody.parse(body).text.trim();
  const translated = !looksCzech(original);
  let text = original;
  let cached = true;
  if (translated) {
    const key = sha1Hex(original);
    const hit = await cache.get<string>("translation", key, TTL.translation);
    if (hit) {
      text = hit;
    } else {
      text = await runTranslate(original);
      await cache.set("translation", key, text);
      cached = false;
    }
  }
  const context = text.replace(/_/g, "");
  const items = splitIngredients(context).map((t) => ({ text: t, severity: itemSeverity(t, context) }));
  return { text, translated, cached, items };
}

export async function alternatives(body: AlternativesRequest): Promise<{ alternatives: Alternative[] }> {
  const parsed = AlternativesBody.parse(body);
  const list = await findAlternatives(
    {
      productId: parsed.productId,
      categoryTags: parsed.categoryTags,
      countries: parsed.countries,
      stores: parsed.stores,
      profile: toProfile(parsed.profile),
      minScore: parsed.minScore,
    },
    cache,
  );
  return { alternatives: list };
}
