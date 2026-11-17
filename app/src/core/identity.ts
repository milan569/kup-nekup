/**
 * "The same product again?" By name and brand, ignoring size, vintage and
 * packaging. The app uses it to show a stored AI opinion instead of paying
 * for a new one, so a false match puts another product's opinion on screen.
 */

const NOISE =
  /\b\d+([.,]\d+)?\s*(g|kg|mg|ml|l|cl|dl|%|ks|pcs|x|st)\b|\b(19|20)\d{2}\b|\b(plech(ovka)?|lahev|sklo|pet|baleni|multipack|karton|sacek|kelimek|vratna|nevratna|family|mini|maxi|xl|xxl)\b/giu;

export function productTokens(s: string | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(NOISE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1);
}

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  // against the longer name: "jogurt" alone must not match every "jogurt bílý", "jogurt jahodový"…
  return n / Math.max(A.size, B.size);
}

/**
 * Names the app itself gives to a product it could not identify (unknown
 * barcode, photo without a readable name). They name nothing: every unknown
 * code would otherwise count as "the same product" as the first one.
 */
const PLACEHOLDER_NAMES = new Set(["Neznámý produkt", "(bez názvu)", "Produkt z fotky", "Nerozpoznáno"].map((n) => productTokens(n).join(" ")));

export function isPlaceholderName(name: string | undefined): boolean {
  const tokens = productTokens(name);
  return tokens.length === 0 || PLACEHOLDER_NAMES.has(tokens.join(" "));
}

/** every photo on which nothing was recognised shares this id: it identifies no product */
const NO_PRODUCT_ID = "photo:none";

/** "Balans obrok 330 g" (Imlek) and "Balans obrok 500 g" (Imlek) are the same product. */
export function sameProduct(a: { id: string; name: string; brand?: string }, b: { id: string; name: string; brand?: string }): boolean {
  if (a.id === b.id) return a.id !== NO_PRODUCT_ID;
  // an unidentified product equals another only by its code (the id), never by its placeholder name
  if (isPlaceholderName(a.name) || isPlaceholderName(b.name)) return false;
  const na = productTokens(a.name);
  const nb = productTokens(b.name);
  if (overlap(na, nb) < 0.75) return false;
  const ba = productTokens(a.brand);
  const bb = productTokens(b.brand);
  if (ba.length && bb.length) return overlap(ba, bb) >= 0.5;
  // one side has no brand: the names together must still match
  return overlap([...na, ...ba], [...nb, ...bb]) >= 0.75;
}
