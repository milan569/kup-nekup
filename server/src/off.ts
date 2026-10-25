import type { ProductData, ProductImage, SearchCandidate, NutritionPer100g } from "./types.js";
import { referenceData } from "./data.js";

/**
 * Open Food Facts / Open Beauty Facts / Open Products Facts client.
 * All calls have a hard timeout, send a proper User-Agent (OFF requires it)
 * and never throw on "not found" – they return undefined.
 */

const USER_AGENT = "KupNekup/0.1 (prototype; hanmil2019@gmail.com)";
const PRODUCT_FIELDS = [
  "code",
  "product_name",
  "product_name_cs",
  "product_name_en",
  "brands",
  "brand_owner",
  "categories",
  "categories_tags",
  "countries_tags",
  "quantity",
  "ingredients_text",
  "ingredients_text_cs",
  "ingredients_text_sk",
  "ingredients_text_en",
  "ingredients_text_de",
  "ingredients_text_fr",
  "ingredients_text_pl",
  "ingredients_text_hu",
  "ingredients_text_it",
  "ingredients_text_hr",
  "ingredients_text_sr",
  "ingredients_text_sl",
  "ingredients_text_bs",
  "ingredients",
  "lang",
  "additives_tags",
  "allergens_tags",
  "traces_tags",
  "ingredients_analysis_tags",
  "nutriments",
  "nutriscore_grade",
  "nova_group",
  "ecoscore_grade",
  "labels_tags",
  "stores_tags",
  "image_front_url",
  "image_url",
  "image_ingredients_url",
  "image_nutrition_url",
  "image_packaging_url",
  "states_tags",
  "manufacturing_places",
  "origins",
].join(",");

type OffSource = "off" | "obf" | "opf";
const HOSTS: Record<OffSource, string> = {
  off: "https://world.openfoodfacts.org",
  obf: "https://world.openbeautyfacts.org",
  opf: "https://world.openproductsfacts.org",
};

/**
 * EAN-13 with GS1 prefix 20–29 = in-store codes: scale and price labels of
 * weighed goods (they carry weight/price, not the product). EAN-8 codes
 * starting with 2 are NOT included: Lidl uses them for its own brands.
 */
export function isInStoreCode(code: string): boolean {
  return code.length === 13 && code.startsWith("2");
}

export class OffUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffUnavailableError";
  }
}

// ---- respecting OFF rate limits ----
// OFF allows roughly 100 product reads per minute per IP and answers 429 above
// that. We stay well below, give the user's own scan priority over background
// work (alternatives), and back off after a 429. We never route around the
// limit through other OFF hostnames.

export type Priority = "user" | "background";

class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private readonly capacity: number, private readonly perMinute: number) {
    this.tokens = capacity;
  }
  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 60_000) * this.perMinute);
    this.last = now;
  }
  /** take one token unless that would leave fewer than `reserve` */
  take(reserve = 0): boolean {
    this.refill();
    if (this.tokens - 1 < reserve) return false;
    this.tokens -= 1;
    return true;
  }
}

const productBudget = new TokenBucket(40, 50);
const BACKGROUND_RESERVE = 15; // always keep room for the user's next scans
let cooldownUntil = 0;

export function offStatus(): { cooldownSeconds: number } {
  return { cooldownSeconds: Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)) };
}

function admit(priority: Priority): boolean {
  if (priority === "background") {
    if (Date.now() < cooldownUntil) return false;
    return productBudget.take(BACKGROUND_RESERVE);
  }
  productBudget.take(0); // user requests always go through, but are counted
  return true;
}

/** OFF answers 503 intermittently under load; one quick retry fixes most of them. */
async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  try {
    return await getJsonOnce(url, timeoutMs);
  } catch (err) {
    if (!(err instanceof OffUnavailableError) || !/HTTP (503|502)/.test(err.message)) throw err;
    await new Promise((r) => setTimeout(r, 700));
    return getJsonOnce(url, timeoutMs);
  }
}

async function getJsonOnce(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Note: OFF's edge answers 503 to requests carrying "Accept: application/json",
    // so only the User-Agent (which OFF requires) is sent.
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: ctrl.signal,
    });
    if (res.status === 404) return { status: 0 };
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      cooldownUntil = Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000);
    }
    if (!res.ok) throw new OffUnavailableError(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } catch (err) {
    if (err instanceof OffUnavailableError) throw err;
    throw new OffUnavailableError(`${(err as Error).name}: ${(err as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

export interface OffLookup {
  product?: ProductData;
  /** true when every database answered and none had it */
  notFound: boolean;
  /** databases that failed (timeout, 5xx) */
  errors: string[];
}

export async function fetchByEan(ean: string, timeoutMs = 4000, priority: Priority = "user"): Promise<OffLookup> {
  const errors: string[] = [];
  // background work only asks the main food database and only with spare budget
  const order: OffSource[] = priority === "user" ? ["off", "obf", "opf"] : ["off"];
  for (const src of order) {
    if (!admit(priority)) {
      errors.push(`${src}: rate budget reserved for user scans`);
      break;
    }
    try {
      const json = (await getJson(
        `${HOSTS[src]}/api/v2/product/${encodeURIComponent(ean)}?fields=${PRODUCT_FIELDS}`,
        timeoutMs,
      )) as { status?: number; product?: RawProduct };
      if (json.status === 1 && json.product) {
        return { product: normalize(json.product, src), notFound: false, errors };
      }
    } catch (err) {
      errors.push(`${src}: ${(err as Error).message}`);
    }
  }
  return { notFound: errors.length === 0, errors };
}

const SEARCH_HOST = "https://search.openfoodfacts.org";
const SEARCH_FIELDS = "code,product_name,product_name_cs,brands,quantity,image_front_small_url,countries_tags";

interface SearchHit {
  code?: string;
  product_name?: string;
  product_name_cs?: string;
  brands?: string[] | string;
  quantity?: string;
  image_front_small_url?: string;
  countries_tags?: string[];
}

function hitToCandidate(h: SearchHit): SearchCandidate | undefined {
  if (!h.code) return undefined;
  const brand = Array.isArray(h.brands) ? h.brands[0] : h.brands?.split(",")[0]?.trim();
  return {
    id: h.code,
    ean: h.code,
    name: h.product_name_cs || h.product_name || "(bez názvu)",
    brand,
    quantity: h.quantity,
    imageUrl: h.image_front_small_url,
  };
}

/** Escape characters with special meaning in the Lucene-style query syntax. */
function luceneEscape(s: string): string {
  return s.replace(/[+\-!(){}[\]^"~*?:\\/]|&&|\|\|/g, (m) => "\\" + m).replace(/\b(AND|OR|NOT)\b/g, (m) => m.toLowerCase());
}

/**
 * Text search. Uses OFF's Elasticsearch-based "search-a-licious" service first
 * (fast, supports a country filter). Results from the user's countries come
 * first, then the rest of the world. Falls back to the legacy search.pl.
 */
/** lower-case, diacritics stripped: "Zlaté Koka" → "zlate koka" */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function queryWords(q: string): string[] {
  return foldText(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2);
}

/**
 * How well a candidate answers the query: share of query words found in its
 * name or brand (diacritics ignored, prefix match so "koka" finds "Koka" and
 * "sušenky" finds "sušenka"). "Zlaté koka" → Zlaté Koka 1.0, Koka Noodles 0.5.
 */
export function matchScore(words: string[], c: { name: string; brand?: string }): number {
  if (!words.length) return 0;
  const hay = foldText(`${c.name} ${c.brand ?? ""}`).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let hit = 0;
  for (const w of words) if (hay.some((h) => h.startsWith(w) || (w.length >= 4 && w.startsWith(h) && h.length >= 4))) hit++;
  return hit / words.length;
}

/** Candidates that answer the query best first; ties: the user's countries, then a photo. */
export function rankCandidates(q: string, candidates: SearchCandidate[], local: Set<string>): SearchCandidate[] {
  const words = queryWords(q);
  return candidates
    .map((c) => ({ c: { ...c, match: Math.round(matchScore(words, c) * 100) / 100 }, loc: local.has(c.id) ? 1 : 0, img: c.imageUrl ? 1 : 0 }))
    .sort((a, b) => (b.c.match ?? 0) - (a.c.match ?? 0) || b.loc - a.loc || b.img - a.img)
    .map((x) => x.c);
}

/**
 * Text search in the product database. All words must match first (AND), with
 * and without diacritics, in the user's countries and then anywhere; only when
 * that finds too little does it fall back to any-word matching. Results come
 * back ranked by how many query words they really contain.
 */
export async function searchByText(q: string, countries: string[], timeoutMs = 5000): Promise<SearchCandidate[]> {
  const raw = q.trim();
  const words = raw.split(/\s+/).filter(Boolean);
  const folded = foldText(raw);
  const tags = countries.map(countryTag);
  const langs = ["cs", "sk", "sr", "hr", "en", "de"].join(",");
  const countryFilter = tags.length ? `countries_tags:(${tags.map((t) => `"${t}"`).join(" OR ")})` : undefined;
  const params = (terms: string, extra?: string) =>
    new URLSearchParams({ q: extra ? `(${terms}) AND ${extra}` : terms, langs, page_size: "15", fields: SEARCH_FIELDS });
  const andFolded = folded !== raw.toLowerCase() ? folded.split(/\s+/).filter(Boolean).map((w) => luceneEscape(w)).join(" AND ") : undefined;
  const orTerms = luceneEscape(raw);

  const out = new Map<string, SearchCandidate>();
  const local = new Set<string>();
  const good = () => [...out.values()].filter((c) => matchScore(queryWords(raw), c) >= 0.99).length;

  // query plan: the user's countries first, then anywhere; the folded spelling only when the
  // original finds nothing (the engine matches any word anyway, so the ranking does the real work)
  const plan: { terms: string; extra?: string; onlyIfEmpty?: boolean }[] = [];
  if (countryFilter) plan.push({ terms: orTerms, extra: countryFilter });
  plan.push({ terms: orTerms });
  if (andFolded) plan.push({ terms: andFolded.replace(/ AND /g, " "), onlyIfEmpty: true });

  try {
    for (const step of plan) {
      if (good() >= 5) break;
      if (step.onlyIfEmpty && out.size > 0) continue;
      const res = (await getJson(`${SEARCH_HOST}/search?${params(step.terms, step.extra)}`, timeoutMs)) as { hits?: SearchHit[] };
      for (const h of res.hits ?? []) {
        const c = hitToCandidate(h);
        if (!c) continue;
        if (!out.has(c.id)) out.set(c.id, c);
        if (step.extra) local.add(c.id);
      }
    }
    return rankCandidates(raw, [...out.values()], local).slice(0, 15);
  } catch (err) {
    console.warn(`[off] search-a-licious failed, falling back: ${(err as Error).message}`);
    const legacy = await legacySearch(q, countries, timeoutMs);
    return rankCandidates(raw, legacy, new Set());
  }
}

async function legacySearch(q: string, countries: string[], timeoutMs: number): Promise<SearchCandidate[]> {
  const params = new URLSearchParams({
    search_terms: q,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "15",
    fields: "code,product_name,product_name_cs,brands,quantity,image_front_small_url,countries_tags",
  });
  const json = (await getJson(`${HOSTS.off}/cgi/search.pl?${params}`, timeoutMs)) as {
    products?: RawProduct[];
  };
  const products = json.products ?? [];
  const wanted = new Set(countries.map(countryTag));
  const score = (p: RawProduct) =>
    (p.countries_tags ?? []).some((t) => wanted.has(t)) ? 1 : 0;
  return products
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => b.s - a.s)
    .map(({ p }) => ({
      id: p.code ?? "",
      ean: p.code,
      name: p.product_name_cs || p.product_name || "(bez názvu)",
      brand: p.brands,
      quantity: p.quantity,
      imageUrl: p.image_front_small_url,
    }))
    .filter((c) => c.id);
}

export interface CategoryCandidate {
  code: string;
  categoryTags: string[];
  nutriScore?: string;
  novaGroup?: number;
}

/**
 * Lightweight candidate list for a category in the given countries, most
 * scanned first. Uses search-a-licious (reliable, but it does not return
 * ingredients or additives – full data is fetched per product afterwards).
 */
export async function categoryCandidates(
  categoryTag: string,
  countries: string[],
  pageSize = 60,
  timeoutMs = 6000,
): Promise<CategoryCandidate[]> {
  const tags = (countries.length ? countries : ["cz"]).map(countryTag);
  const q = `categories_tags:"${categoryTag}" AND countries_tags:(${tags.map((t) => `"${t}"`).join(" OR ")})`;
  const params = new URLSearchParams({
    q,
    page_size: String(pageSize),
    sort_by: "-unique_scans_n",
    fields: "code,categories_tags,nutriscore_grade,nova_group",
  });
  const json = (await getJson(`${SEARCH_HOST}/search?${params}`, timeoutMs)) as {
    hits?: { code?: string; categories_tags?: string[]; nutriscore_grade?: string; nova_group?: number }[];
  };
  return (json.hits ?? [])
    .filter((h): h is typeof h & { code: string } => !!h.code)
    .map((h) => ({
      code: h.code,
      categoryTags: h.categories_tags ?? [],
      nutriScore: h.nutriscore_grade,
      novaGroup: h.nova_group,
    }));
}

/** Run async jobs with a concurrency limit, keeping only fulfilled results. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R | undefined>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      try {
        const r = await fn(item);
        if (r !== undefined) out.push(r);
      } catch {
        // one failed product must not sink the whole list
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// ---- normalization ----

interface RawIngredient {
  id?: string;
  text?: string;
  percent_estimate?: number;
}

export interface RawProduct {
  code?: string;
  product_name?: string;
  product_name_cs?: string;
  product_name_en?: string;
  brands?: string;
  brand_owner?: string;
  categories?: string;
  categories_tags?: string[];
  countries_tags?: string[];
  quantity?: string;
  ingredients_text?: string;
  ingredients_text_cs?: string;
  ingredients_text_sk?: string;
  ingredients_text_en?: string;
  ingredients_text_de?: string;
  ingredients_text_fr?: string;
  ingredients_text_pl?: string;
  ingredients_text_hu?: string;
  ingredients_text_it?: string;
  ingredients_text_hr?: string;
  ingredients_text_sr?: string;
  ingredients_text_sl?: string;
  ingredients_text_bs?: string;
  lang?: string;
  ingredients?: RawIngredient[];
  additives_tags?: string[];
  allergens_tags?: string[];
  traces_tags?: string[];
  ingredients_analysis_tags?: string[];
  nutriments?: Record<string, number | string>;
  nutriscore_grade?: string;
  nova_group?: number;
  ecoscore_grade?: string;
  labels_tags?: string[];
  stores_tags?: string[];
  image_front_url?: string;
  image_front_small_url?: string;
  image_url?: string;
  image_ingredients_url?: string;
  image_nutrition_url?: string;
  image_packaging_url?: string;
  states_tags?: string[];
  manufacturing_places?: string;
  origins?: string;
}

const COUNTRY_TAGS: Record<string, string> = {
  cz: "en:czech-republic",
  sk: "en:slovakia",
  me: "en:montenegro",
  rs: "en:serbia",
  hr: "en:croatia",
  ba: "en:bosnia-and-herzegovina",
  si: "en:slovenia",
  mk: "en:north-macedonia",
  al: "en:albania",
  de: "en:germany",
  at: "en:austria",
  pl: "en:poland",
  hu: "en:hungary",
};

export function countryTag(cc: string): string {
  return COUNTRY_TAGS[cc.toLowerCase()] ?? `en:${cc.toLowerCase()}`;
}

/**
 * OFF returns `ingredients_text` in the request language (English by default),
 * which for a French or German product is often a partial translation.
 * Prefer Czech/Slovak, then the product's own language, then the longest text.
 */
export function pickIngredientsText(p: RawProduct): string | undefined {
  const clean = (s?: string) => (s && s.trim().length > 0 ? s.trim() : undefined);
  const cs = clean(p.ingredients_text_cs) ?? clean(p.ingredients_text_sk);
  if (cs) return cs;
  const variants: (string | undefined)[] = [
    p.ingredients_text_en,
    p.ingredients_text_de,
    p.ingredients_text_fr,
    p.ingredients_text_pl,
    p.ingredients_text_hu,
    p.ingredients_text_it,
    p.ingredients_text_hr,
    p.ingredients_text_sr,
    p.ingredients_text_sl,
    p.ingredients_text_bs,
    p.ingredients_text,
  ].map(clean);
  const longest = variants.filter((v): v is string => !!v).sort((a, b) => b.length - a.length)[0];
  if (!longest) return undefined;
  const en = clean(p.ingredients_text_en);
  // English is easier for the user than e.g. French, but not if it is clearly truncated
  if (en && en.length >= longest.length * 0.6) return en;
  return longest;
}

function num(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function stripLang(tag: string): string {
  return tag.replace(/^[a-z]{2}:/, "");
}

function humanize(tag: string): string {
  return stripLang(tag).replace(/-/g, " ");
}

export function normalize(p: RawProduct, source: OffSource): ProductData {
  const ref = referenceData();
  const n = p.nutriments ?? {};
  const nutrition: NutritionPer100g = {
    energyKcal: num(n["energy-kcal_100g"]),
    fat: num(n["fat_100g"]),
    saturatedFat: num(n["saturated-fat_100g"]),
    carbs: num(n["carbohydrates_100g"]),
    sugars: num(n["sugars_100g"]),
    fiber: num(n["fiber_100g"]),
    proteins: num(n["proteins_100g"]),
    salt: num(n["salt_100g"]),
  };
  const hasNutrition = Object.values(nutrition).some((v) => v !== undefined);

  const ingredientsText = pickIngredientsText(p);
  // OFF's structured list follows the request language and is often truncated
  // for foreign products; only trust it when it is at least as rich as the text.
  const structured = (p.ingredients ?? [])
    .map((i) => i.text?.trim())
    .filter((t): t is string => !!t);
  const textCount = ingredientsText ? ingredientsText.split(/[,;]/).length : 0;
  const ingredients = structured.length >= textCount ? structured : [];

  // additives: OFF tags first, then anything the text mentions by name
  const additiveMap = new Map<string, ReturnType<typeof ref.additiveByCode>>();
  for (const tag of p.additives_tags ?? []) {
    const rec = ref.additiveByCode(tag);
    if (rec) additiveMap.set(rec.code, rec);
    else additiveMap.set(stripLang(tag).toUpperCase(), undefined);
  }
  if (ingredientsText) {
    for (const rec of ref.additivesInText(ingredientsText)) additiveMap.set(rec.code, rec);
  }
  const additives = [...additiveMap.entries()].map(([code, rec]) =>
    rec
      ? { code: rec.code, name: rec.name, category: rec.category, risk: rec.risk, note: rec.note, sources: rec.sources }
      : { code, name: code, category: "aditivum", risk: 1 as const, note: "Aditivum zatím nemáme v tabulce.", sources: [] },
  );

  const flagged = ingredientsText
    ? ref.unwantedInText(ingredientsText).map(({ record, matchedText }) => ({
        key: record.key,
        label: record.label,
        severity: record.severity,
        note: record.note,
        matchedText,
      }))
    : [];
  const analysisTags = (p.ingredients_analysis_tags ?? []).map(stripLang);
  if (analysisTags.includes("palm-oil") && !flagged.some((f) => f.key === "palm-oil")) {
    flagged.push({
      key: "palm-oil",
      label: ref.unwantedLabel("palm-oil") === "palm-oil" ? "palmový olej" : ref.unwantedLabel("palm-oil"),
      severity: 1,
      note: "Podle analýzy Open Food Facts obsahuje palmový olej.",
      matchedText: "palm-oil",
    });
  }

  const allergens = new Set((p.allergens_tags ?? []).map(stripLang));
  if (ingredientsText && allergens.size === 0) {
    for (const tag of ref.allergensInText(ingredientsText)) allergens.add(tag);
  }

  const states = p.states_tags ?? [];
  const completeness: ProductData["dataCompleteness"] =
    ingredientsText && hasNutrition ? "full" : ingredientsText || hasNutrition ? "partial" : "minimal";

  const brand = p.brands?.split(",")[0]?.trim() || undefined;
  const categoryTags = p.categories_tags ?? [];
  const englishTags = categoryTags.filter((t) => t.startsWith("en:"));
  const category = englishTags.length
    ? humanize(englishTags[englishTags.length - 1]!)
    : p.categories?.split(",").pop()?.trim() || undefined;

  const grade = (g?: string) => (g && /^[a-e]$/.test(g) ? (g as "a" | "b" | "c" | "d" | "e") : undefined);
  const nova = p.nova_group && p.nova_group >= 1 && p.nova_group <= 4 ? (p.nova_group as 1 | 2 | 3 | 4) : undefined;

  const labels = (p.labels_tags ?? []).map(stripLang);
  const analysis = analysisTags;

  return {
    id: p.code ?? `off:${Math.random().toString(36).slice(2)}`,
    ean: p.code,
    name: p.product_name_cs || p.product_name || p.product_name_en || "(bez názvu)",
    brand,
    manufacturer: p.brand_owner?.trim() || brand,
    category,
    categoryTags,
    countries: (p.countries_tags ?? []).map(stripLang),
    quantity: p.quantity,
    ingredientsText,
    ingredients,
    additives,
    flagged,
    allergens: [...allergens],
    traces: (p.traces_tags ?? []).map(stripLang),
    nutrition: hasNutrition ? nutrition : undefined,
    nutriScore: grade(p.nutriscore_grade),
    novaGroup: nova,
    ecoScore: grade(p.ecoscore_grade),
    labels: [...labels, ...analysis.map((a) => `analysis:${a}`)],
    stores: (p.stores_tags ?? []).map(stripLang),
    imageUrl: p.image_front_url || p.image_url,
    images: productImages(p),
    source,
    dataCompleteness: states.includes("en:empty") ? "minimal" : completeness,
    fetchedAt: new Date().toISOString(),
  };
}

/** All package photos OFF has selected for the product, front first, without duplicates. */
function productImages(p: RawProduct): ProductImage[] | undefined {
  const out: ProductImage[] = [];
  const add = (url: string | undefined, label: string) => {
    if (url && url.toLowerCase().startsWith("https://") && !out.some((x) => x.url === url)) out.push({ url, label });
  };
  add(p.image_front_url || p.image_url, "Přední strana");
  add(p.image_ingredients_url, "Složení");
  add(p.image_nutrition_url, "Nutriční hodnoty");
  add(p.image_packaging_url, "Obal");
  return out.length ? out : undefined;
}
