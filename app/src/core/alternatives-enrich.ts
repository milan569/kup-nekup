import type { InsightAlternative, SearchCandidate, UserProfile, Verdict } from "./types";
import { VERDICTS } from "./verdicts";
import { hasApiKey } from "./anthropic";
import { eanFromOffUrl, fetchByEan, mapLimit, searchProducts } from "./off";
import { assess } from "./scoring";
import { webSearchOnce, type WebHit } from "./websearch";

/**
 * The AI names alternatives by text ("Váhala Vídeňské párky, Lidl"). To show a
 * package photo and a fair "better / worse" we look each one up in Open Food
 * Facts: a link the research already gave, the database's own search, or one
 * cheap web search limited to openfoodfacts.org. A match gives the EAN, the
 * photos and OUR rule verdict. Shop pages cannot be read from a browser, so
 * an alternative without a database match keeps the AI's estimate and no photo.
 */

/** bump when enrichment learns something new; cached insights are re-enriched once */
export const ENRICH_VERSION = 3;

export { eanFromOffUrl };

const STOP = new Set(["a", "s", "z", "ze", "the", "and", "with", "bez", "na", "do", "od", "pro", "g", "kg", "ml", "l"]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** share of the shorter token set found in the longer one (0–1) */
export function overlap(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Does a database hit plausibly describe the suggested alternative? */
export function matches(alt: { name: string; brand?: string }, hit: { name: string; brand?: string }): boolean {
  const nameSim = overlap(alt.name, hit.name);
  const brandOk = !alt.brand || overlap(alt.brand, `${hit.brand ?? ""} ${hit.name}`) >= 0.5;
  return brandOk && nameSim >= 0.5;
}

/** logos, icons and sprites are not package photos */
export function looksLikeProductPhoto(url: string): boolean {
  return !/logo|icon|sprite|favicon|placeholder|blank\.|\.svg(\?|$)/i.test(url);
}

const PRODUCT_PATH = /\/(proizvod|produkt|product|products|p|item|artikal|artikel|detail|shop)\//i;
const LISTING_PATH = /\/(kategorij\w*|category|categories|kategorie|search|pretraga|hledat)(?![a-z])/i;

/**
 * The search hit that is most likely this product's own page: the title must
 * share most of the name, product pages beat articles, listings never win.
 */
export function pickProductPage(alt: { name: string; brand?: string }, hits: WebHit[]): string | undefined {
  let best: { url: string; score: number } | undefined;
  for (const h of hits) {
    if (LISTING_PATH.test(h.url)) continue;
    const nameSim = overlap(alt.name, h.title);
    if (nameSim < 0.5) continue;
    const brandSim = alt.brand ? overlap(alt.brand, `${h.title} ${h.url}`) : 0.5;
    const score = nameSim + 0.5 * brandSim + (PRODUCT_PATH.test(h.url) ? 0.5 : 0);
    if (!best || score > best.score) best = { url: h.url, score };
  }
  return best?.url;
}

async function offMatch(alt: InsightAlternative, profile: UserProfile): Promise<SearchCandidate | undefined> {
  const offEan = eanFromOffUrl(alt.sourceUrl);
  if (offEan) return { id: offEan, ean: offEan, name: alt.name, brand: alt.brand };
  const query = `${alt.brand ?? ""} ${alt.name}`.trim();
  try {
    const { candidates } = await searchProducts(query, profile.countries, { timeoutMs: 4000, allowAi: false });
    const hit = candidates.find((c) => matches(alt, c));
    if (hit) return hit;
  } catch {
    // database search down – try the web below
  }
  if (!hasApiKey()) return undefined;
  try {
    const hits = await webSearchOnce(query, {
      allowedDomains: ["openfoodfacts.org"],
      prompt: `Najdi tento výrobek v databázi Open Food Facts: ${query}`,
    });
    for (const h of hits) {
      const ean = eanFromOffUrl(h.url);
      if (ean && overlap(alt.name, h.title) >= 0.5) return { id: ean, ean, name: alt.name, brand: alt.brand };
    }
  } catch (err) {
    console.warn("[enrich] Open Food Facts web search failed:", (err as Error).message);
  }
  return undefined;
}

async function enrichOne(alt: InsightAlternative, profile: UserProfile): Promise<InsightAlternative> {
  const hit = await offMatch(alt, profile);
  if (!hit?.ean) return alt;
  const lookup = await fetchByEan(hit.ean, 4000, "background").catch(() => undefined);
  const product = lookup?.product;
  if (product) {
    const a = assess(product, profile);
    return {
      ...alt,
      ean: hit.ean,
      imageUrl: product.imageUrl ?? hit.imageUrl ?? alt.imageUrl,
      images: product.images,
      ...(a.verdict !== "nevime" ? { verdict: a.verdict, score: a.score, verdictSource: "rules" as const } : {}),
    };
  }
  return { ...alt, ean: hit.ean, imageUrl: hit.imageUrl ?? alt.imageUrl };
}

export async function enrichAlternatives(alts: InsightAlternative[], profile: UserProfile): Promise<InsightAlternative[]> {
  const out = await mapLimit(alts.map((a, i) => ({ a, i })), 4, async ({ a, i }) => ({ i, v: await enrichOne(a, profile).catch(() => a) }));
  return out.sort((x, y) => x.i - y.i).map((x) => x.v);
}

/**
 * An alternative is only worth showing when it is at least as good as the
 * product in hand (the user looks for alternatives to buy BETTER). Unknown
 * verdicts stay. Best first.
 */
export function keepNotWorse(alts: InsightAlternative[], baseline: Verdict): { kept: InsightAlternative[]; dropped: number } {
  const base = baseline === "nevime" ? undefined : VERDICTS[baseline].rank;
  const kept = alts.filter((a) => !a.verdict || base === undefined || VERDICTS[a.verdict].rank >= base);
  kept.sort((a, b) => (b.verdict ? VERDICTS[b.verdict].rank : 0) - (a.verdict ? VERDICTS[a.verdict].rank : 0));
  return { kept, dropped: alts.length - kept.length };
}
