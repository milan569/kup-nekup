import type { Alternative, AlternativesRequest, Assessment, ProductData } from "./types.js";
import { EMPTY_PROFILE } from "./types.js";
import { Cache, TTL } from "./cache.js";
import { categoryCandidates, fetchByEan, mapLimit, type CategoryCandidate } from "./off.js";
import { assess } from "./scoring.js";
import { productNamespace } from "./data.js";
import { VERDICTS } from "./verdicts.js";

const PRODUCT_NS = productNamespace();

/**
 * Alternatives = products of a closely related category, sold in the user's
 * countries, that score clearly better.
 *
 * 1. Clean the category tags (OFF data contains free-text tags like
 *    "fr:Nuttela" or "en:Pâtes à tartiner").
 * 2. Ask search-a-licious for the most scanned products of the two most
 *    specific categories in the user's countries.
 * 3. Rank candidates by category similarity (Jaccard) to the original, so a
 *    chocolate spread is preferred over honey within "sweet spreads", and drop
 *    obviously mis-tagged products.
 * 4. Fetch full data for the best candidates (cached per product), score them
 *    with the same engine and keep the clearly better ones.
 *
 * Store filtering is best-effort: OFF store tags are user-contributed and
 * often missing, so store matches are ranked first rather than required.
 */

const MIN_SIMILARITY = 0.2;
// cached candidates are free; uncached ones are fetched only with spare OFF budget
const FETCH_TOP = 15;

export function cleanCategoryTags(tags: string[]): string[] {
  return tags.filter((t) => /^en:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t));
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export async function findAlternatives(req: AlternativesRequest, cache: Cache): Promise<Alternative[]> {
  const profile = req.profile ?? EMPTY_PROFILE;
  const countries = req.countries.length ? req.countries : profile.countries;
  const original = cleanCategoryTags(req.categoryTags);
  if (original.length === 0) return [];

  const stores = new Set(req.stores.map((s) => s.toLowerCase()));
  const minScore = (req.minScore ?? 0) + 8;

  // 2. candidate pool from the two most specific categories
  const levels = [...original].reverse().slice(0, 2);
  const pool = new Map<string, CategoryCandidate>();
  for (const tag of levels) {
    for (const c of await candidatesFor(tag, countries, cache)) {
      if (c.code !== req.productId && !pool.has(c.code)) pool.set(c.code, c);
    }
    if (pool.size >= 25) break;
  }

  // 3. rank by similarity, skip ones the light data already rules out;
  //    the candidate must share the product's most specific category (a breakfast
  //    biscuit is not an alternative to a chocolate wafer) unless the tag sets nearly coincide
  const leaf = original[original.length - 1]!;
  const ranked = [...pool.values()]
    .map((c) => ({ c, tags: cleanCategoryTags(c.categoryTags) }))
    .map(({ c, tags }) => ({ c, sim: jaccard(original, tags), sameLeaf: tags.includes(leaf) }))
    .filter(({ sim, sameLeaf }) => sim >= MIN_SIMILARITY && (sameLeaf || sim >= 0.75))
    .filter(({ c }) => c.nutriScore !== "e")
    .sort((a, b) => b.sim - a.sim || nutriRank(a.c.nutriScore) - nutriRank(b.c.nutriScore))
    .slice(0, FETCH_TOP);

  // 4. full data + scoring
  const scored = await mapLimit(ranked, 3, async ({ c, sim }) => {
    const product = await productByCode(c.code, cache);
    if (!product || !(product.ingredientsText ?? "").length) return undefined;
    const assessment = assess(product, profile);
    if (assessment.score === undefined || assessment.score < minScore) return undefined;
    // only recommend things that are at least "ujde to"
    if (assessment.verdict === "nevime" || VERDICTS[assessment.verdict].rank < VERDICTS.jsou_lepsi.rank) return undefined;
    const storeMatch = stores.size > 0 && (product.stores ?? []).some((s) => stores.has(s.toLowerCase()));
    return { product, assessment, sim, storeMatch };
  });

  scored.sort(
    (a, b) =>
      Number(b.storeMatch) - Number(a.storeMatch) ||
      Math.round(b.sim * 10) - Math.round(a.sim * 10) ||
      (b.assessment.score ?? 0) - (a.assessment.score ?? 0),
  );

  return scored.slice(0, 6).map(({ product, assessment, storeMatch }) => ({
    product,
    assessment,
    whyBetter: whyBetter(assessment, storeMatch, req.stores),
  }));
}

function nutriRank(g?: string): number {
  return g ? "abcde".indexOf(g) : 3;
}

async function candidatesFor(tag: string, countries: string[], cache: Cache): Promise<CategoryCandidate[]> {
  const key = `${tag}|${[...countries].sort().join(",")}`;
  const cached = cache.get<CategoryCandidate[]>("category2", key, TTL.category);
  if (cached) return cached;
  try {
    const list = await categoryCandidates(tag, countries);
    cache.set("category2", key, list);
    return list;
  } catch (err) {
    console.warn(`[alternatives] candidates for ${tag} failed: ${(err as Error).message}`);
    return [];
  }
}

async function productByCode(code: string, cache: Cache): Promise<ProductData | undefined> {
  const cached = cache.get<ProductData>(PRODUCT_NS, code, TTL.product);
  if (cached) return cached;
  const lookup = await fetchByEan(code, 4000, "background");
  if (lookup.product) cache.set(PRODUCT_NS, code, lookup.product);
  return lookup.product;
}

function whyBetter(a: Assessment, storeMatch: boolean, stores: string[]): string {
  const positives = a.reasons.filter((r) => r.kind === "positive").map((r) => r.text.replace(/\.$/, ""));
  const parts: string[] = [];
  if (positives.length) parts.push(positives.slice(0, 2).join(", "));
  else parts.push(`vyšší celkové skóre (${a.score ?? 0} bodů)`);
  if (storeMatch && stores.length === 1) parts.push(`k dostání v: ${stores[0]}`);
  return parts.join(" · ");
}
