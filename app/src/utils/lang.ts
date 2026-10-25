/**
 * Is an ingredient list already in Czech? Letters ě, ř, ů exist only in
 * Czech; otherwise a few typical Czech label words decide. Slovak, Serbian,
 * Croatian etc. count as foreign (they get translated).
 * Copy of server/src/lang.ts – keep in sync.
 */
const CZECH_WORDS = new Set([
  "cukr",
  "sůl",
  "mléko",
  "mléčný",
  "mléčná",
  "mouka",
  "pšeničná",
  "máslo",
  "smetana",
  "koření",
  "sušené",
  "sušená",
  "vepřové",
  "hovězí",
  "kuřecí",
  "škrob",
  "směs",
  "jedlá",
  "pitná",
  "rostlinný",
  "rostlinné",
  "zahušťovadlo",
  "kypřicí",
  "látka",
  "přírodní",
  "obsahuje",
  "stopy",
  "lískové",
  "ořechy",
  "vejce",
  "syrovátka",
]);

export function looksCzech(text: string): boolean {
  const t = text.toLowerCase();
  if (/[ěřů]/.test(t)) return true;
  const words = t.match(/\p{L}+/gu) ?? [];
  let hits = 0;
  for (const w of words) if (CZECH_WORDS.has(w)) hits++;
  return hits >= 2 || (hits >= 1 && words.length <= 3);
}
