import type { ProductData, ProductImage, SearchCandidate, NutritionPer100g } from "./types";
import { hasApiKey } from "./anthropic";
import { OFF_APP_NAME, OFF_APP_VERSION } from "./config";
import { referenceData } from "./data";
import { OffUnavailableError } from "./errors";
import { webSearchOnce } from "./websearch";

/**
 * Open Food Facts / Open Beauty Facts / Open Products Facts client, called
 * straight from the browser. All calls have a hard timeout and never throw
 * on "not found" – they return undefined. The product API allows browser
 * calls; the database's text search does not, so text search has its own
 * path below.
 */

export { OffUnavailableError };

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
    // Note: OFF's edge answers 503 to requests carrying "Accept: application/json".
    // Browsers cannot set a User-Agent, so the app identifies itself in the query string.
    const res = await fetch(withApp(url), { signal: ctrl.signal });
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

function withApp(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}app_name=${OFF_APP_NAME}&app_version=${OFF_APP_VERSION}`;
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

/** EAN from an Open Food Facts product link, e.g. de.openfoodfacts.org/produkt/4056489605195/… */
export function eanFromOffUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = /openfoodfacts\.(?:org|net)\/(?:product|produit|produkt|producto|prodotto|proizvod)\/(\d{8,14})(?:[/?#]|$)/i.exec(url);
  return m?.[1];
}

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

export interface ProductSearch {
  candidates: SearchCandidate[];
  /** where the answer came from: the database, a web search through Claude, or nothing was asked */
  via: "off" | "ai" | "none";
}

export interface SearchOptions {
  timeoutMs?: number;
  /** when the database is down, run one web search through Claude (about 0,01 USD); default true */
  allowAi?: boolean;
}

/**
 * Text search in the product database. The database's own search engine
 * refuses browsers and the classic search is down more often than up, so:
 *  1. one attempt at the classic search, results ranked by how many query
 *     words they really contain, the user's countries first;
 *  2. when it fails and a Claude key is set: one web search limited to
 *     openfoodfacts.org – product pages give the codes, the product API the rest.
 */
export async function searchProducts(q: string, countries: string[], opts: SearchOptions = {}): Promise<ProductSearch> {
  const raw = q.trim();
  if (raw.length < 2) return { candidates: [], via: "none" };
  const timeoutMs = opts.timeoutMs ?? 5000;
  try {
    const legacy = await legacySearch(raw, countries, timeoutMs);
    return { candidates: rankCandidates(raw, legacy, new Set()).slice(0, 15), via: "off" };
  } catch (err) {
    if (opts.allowAi === false || !hasApiKey()) throw err;
    console.warn(`[off] database search failed, asking the web: ${(err as Error).message}`);
  }
  const hits = await webSearchOnce(raw, {
    allowedDomains: ["openfoodfacts.org"],
    prompt: `Najdi v databázi Open Food Facts stránky výrobku: ${raw}`,
  });
  const codes = [...new Set(hits.map((h) => eanFromOffUrl(h.url)).filter((c): c is string => !!c))].slice(0, 5);
  const candidates = await mapLimit(codes, 3, async (code): Promise<SearchCandidate | undefined> => {
    const p = (await fetchByEan(code, timeoutMs)).product;
    return p ? { id: p.id, ean: p.ean, name: p.name, brand: p.brand, quantity: p.quantity, imageUrl: p.imageUrl } : undefined;
  });
  return { candidates: rankCandidates(raw, candidates, new Set()), via: "ai" };
}

/** Candidates only; the database first, then the web (see searchProducts). */
export async function searchByText(q: string, countries: string[], timeoutMs = 5000): Promise<SearchCandidate[]> {
  return (await searchProducts(q, countries, { timeoutMs })).candidates;
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
 * scanned first, from the product API's tag search – the only search a
 * browser may call. It is often down; then this throws and the caller
 * remembers that for a while. Full data is fetched per product afterwards.
 */
export async function categoryCandidates(
  categoryTag: string,
  countries: string[],
  pageSize = 60,
  timeoutMs = 6000,
): Promise<CategoryCandidate[]> {
  const list = (countries.length ? countries : ["cz"]).slice(0, 3);
  const out = new Map<string, CategoryCandidate>();
  let failures = 0;
  for (const cc of list) {
    const params = new URLSearchParams({
      categories_tags: categoryTag,
      countries_tags: countryTag(cc),
      sort_by: "unique_scans_n",
      page_size: String(pageSize),
      fields: "code,categories_tags,nutriscore_grade,nova_group",
    });
    try {
      const json = (await getJsonOnce(`${HOSTS.off}/api/v2/search?${params}`, timeoutMs)) as {
        products?: { code?: string; categories_tags?: string[]; nutriscore_grade?: string; nova_group?: number }[];
      };
      for (const p of json.products ?? []) {
        if (!p.code || out.has(p.code)) continue;
        out.set(p.code, { code: p.code, categoryTags: p.categories_tags ?? [], nutriScore: p.nutriscore_grade, novaGroup: p.nova_group });
      }
    } catch (err) {
      failures++;
      console.warn(`[off] category search for ${cc} failed: ${(err as Error).message}`);
    }
  }
  if (failures === list.length && out.size === 0) throw new OffUnavailableError("category search unavailable");
  return [...out.values()];
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
