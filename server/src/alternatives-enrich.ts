import type { InsightAlternative, SearchCandidate, UserProfile, Verdict } from "./types.js";
import { VERDICTS } from "./verdicts.js";
import { fetchByEan, mapLimit, searchByText } from "./off.js";
import { assess } from "./scoring.js";
import { webSearchOnce, type WebHit } from "./websearch.js";

/**
 * The AI names alternatives by text ("Váhala Vídeňské párky, Lidl"). To show a
 * package photo, a link and a fair "better / worse" we look each one up:
 *  1. Open Food Facts in the user's countries → EAN, photos, OUR rule verdict
 *  2. no database match and no link → one cheap web search for the product
 *     page (e-shop of the chain or the maker)
 *  3. photo from that page (og:image), the AI's verdict estimate stays
 */

/** bump when enrichment learns something new; cached insights are re-enriched once */
export const ENRICH_VERSION = 2;

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

async function ogImage(url: string, timeoutMs = 4000): Promise<string | undefined> {
  if (!/^https:\/\//i.test(url)) return undefined;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (KupNekup preview)" }, redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return undefined;
    const html = (await res.text()).slice(0, 400_000);
    const m =
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
      /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html);
    if (!m?.[1]) return undefined;
    const img = new URL(m[1].replace(/&amp;/g, "&"), url).toString();
    return /^https:\/\//i.test(img) && looksLikeProductPhoto(img) ? img : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

/** EAN from an Open Food Facts product link, e.g. de.openfoodfacts.org/produkt/4056489605195/… */
export function eanFromOffUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = /openfoodfacts\.(?:org|net)\/(?:product|produit|produkt|producto|prodotto|proizvod)\/(\d{8,14})(?:[/?#]|$)/i.exec(url);
  return m?.[1];
}

/** logos, icons and sprites are not package photos */
export function looksLikeProductPhoto(url: string): boolean {
  return !/logo|icon|sprite|favicon|placeholder|blank\.|\.svg(\?|$)/i.test(url);
}

/** "Voli (prodejny i voli.me)" → "Voli" */
function storeHint(whereToBuy: string | undefined): string {
  return (whereToBuy ?? "").split(/[(,;/]/)[0]!.trim().slice(0, 40);
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

async function findProductPage(alt: InsightAlternative): Promise<string | undefined> {
  const query = [alt.brand, alt.name, storeHint(alt.whereToBuy)].filter(Boolean).join(" ");
  const hits = await webSearchOnce(query);
  return pickProductPage(alt, hits);
}

async function offMatch(alt: InsightAlternative, profile: UserProfile): Promise<SearchCandidate | undefined> {
  const offEan = eanFromOffUrl(alt.sourceUrl);
  if (offEan) return { id: offEan, ean: offEan, name: alt.name, brand: alt.brand };
  try {
    const candidates = await searchByText(`${alt.brand ?? ""} ${alt.name}`.trim(), profile.countries, 4000);
    return candidates.find((c) => matches(alt, c));
  } catch {
    return undefined; // search down – fall back to the web page
  }
}

async function enrichOne(alt0: InsightAlternative, profile: UserProfile): Promise<InsightAlternative> {
  let alt = alt0;
  let hit = await offMatch(alt, profile);

  // not in the database and no link from the research: look for the product page
  if (!hit?.ean && !alt.sourceUrl) {
    const page = await findProductPage(alt).catch((err) => {
      console.warn("[enrich] product page search failed:", (err as Error).message);
      return undefined;
    });
    if (page) {
      alt = { ...alt, sourceUrl: page };
      const offEan = eanFromOffUrl(page);
      if (offEan) hit = { id: offEan, ean: offEan, name: alt.name, brand: alt.brand };
    }
  }

  if (hit?.ean) {
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
  if (!alt.imageUrl && alt.sourceUrl) {
    const img = await ogImage(alt.sourceUrl);
    if (img) return { ...alt, imageUrl: img };
  }
  return alt;
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
