import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { enrichAlternatives, keepNotWorse } from "./alternatives-enrich";
import { categoryRules, detectCategory } from "./category";
import { SCALE_TEXT, VerdictSchema, toneInstruction } from "./claude";
import { ALT_RESEARCH_MAX_FETCHES, ALT_RESEARCH_MAX_SEARCHES } from "./config";
import { normalizeUrl, runToolLoop, webFetch, webSearch } from "./insight";
import type { Assessment, InsightAlternative, InsightSource, ProductData, UserProfile } from "./types";
import { EMPTY_PROFILE } from "./types";

/**
 * Targeted search for the closest alternatives of the SAME kind in one chosen
 * country (the deep research names 2–4 across the user's countries; this one
 * digs for a specific market and is strict about the kind: a chocolate wafer
 * is replaced by another chocolate wafer, never by a chocolate bar).
 */

const MAX_SEARCHES = ALT_RESEARCH_MAX_SEARCHES;
const MAX_FETCHES = ALT_RESEARCH_MAX_FETCHES;
const str = (description: string) => ({ type: "string", description }) as const;

export const ALTERNATIVES_TOOL: Anthropic.Messages.Tool = {
  name: "submit_alternatives",
  description: "Odevzdej nejbližší alternativy stejného druhu v dané zemi. Zavolej přesně jednou. Texty česky.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["productType", "alternatives", "sources", "confidence"],
    properties: {
      productType: str("přesný druh posuzovaného výrobku, např. „čokoládová oplatka s krémovou náplní v čokoládové polevě, cca 30 g“"),
      alternatives: {
        type: "array",
        description: "3–5 výrobků přesně stejného druhu prodávaných v dané zemi, od nejlepšího",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "brand", "sameKind", "whyBetter", "whereToBuy", "sourceUrl", "verdict"],
          properties: {
            name: str("název výrobku"),
            brand: str("značka / výrobce"),
            sameKind: str("jedna věta: čím je to přesně stejný druh výrobku jako posuzovaný"),
            whyBetter: str("jedna až dvě věty: v čem je lepší (složení, poctivost, testy, cena za kg)"),
            whereToBuy: str("kde v dané zemi koupit: řetězce, e-shopy"),
            sourceUrl: str("URL stránky výrobku u prodejce nebo výrobce v dané zemi z výsledků vyhledávání; prázdný řetězec, pokud není"),
            verdict: { type: "string", enum: [...VerdictSchema.options], description: "tvůj odhad verdiktu alternativy" },
          },
        },
      },
      sources: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } },
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
  },
};

const Submitted = z.object({
  productType: z.string(),
  alternatives: z.array(
    z.object({ name: z.string(), brand: z.string(), sameKind: z.string(), whyBetter: z.string(), whereToBuy: z.string(), sourceUrl: z.string(), verdict: VerdictSchema }),
  ),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  confidence: z.enum(["high", "medium", "low"]),
});

const MARKETS: Record<string, { name: string; lang: string; chains: string }> = {
  cz: { name: "Česko", lang: "česky", chains: "Lidl, Kaufland, Albert, Billa, Tesco, Penny, Globus, Rohlik.cz, Košík.cz" },
  sk: { name: "Slovensko", lang: "slovensky", chains: "Tesco, Kaufland, Lidl, Billa, COOP Jednota, Kraj" },
  me: { name: "Černá Hora", lang: "černohorsky/srbsky", chains: "Voli, Idea, Mega Market, HDL, Aroma, Franca" },
  rs: { name: "Srbsko", lang: "srbsky", chains: "Maxi, Idea, Lidl, Univerexport, Roda, Mercator" },
  hr: { name: "Chorvatsko", lang: "chorvatsky", chains: "Konzum, Lidl, Kaufland, Plodine, Tommy, Spar" },
  ba: { name: "Bosna a Hercegovina", lang: "bosensky", chains: "Bingo, Konzum, Mercator, Amko Komerc" },
  si: { name: "Slovinsko", lang: "slovinsky", chains: "Mercator, Spar, Lidl, Hofer, Tuš" },
  mk: { name: "Severní Makedonie", lang: "makedonsky", chains: "Vero, Tinex, Ramstore, Kam" },
  al: { name: "Albánie", lang: "albánsky", chains: "Spar, Conad, Big Market, Ecomarket" },
  de: { name: "Německo", lang: "německy", chains: "Rewe, Edeka, Lidl, Aldi, Kaufland, dm, Rossmann" },
  at: { name: "Rakousko", lang: "německy", chains: "Billa, Spar, Hofer, Lidl, Penny" },
  pl: { name: "Polsko", lang: "polsky", chains: "Biedronka, Lidl, Kaufland, Auchan, Carrefour, Żabka" },
  hu: { name: "Maďarsko", lang: "maďarsky", chains: "Tesco, Spar, Lidl, Aldi, Auchan, Penny" },
};

export function marketOf(country: string): { code: string; name: string; lang: string; chains: string } {
  const code = country.toLowerCase();
  const m = MARKETS[code] ?? { name: code.toUpperCase(), lang: "místním jazykem", chains: "místní řetězce" };
  return { code, ...m };
}

const SYSTEM = `Jsi zkušený potravinářský odborník a spotřebitelský poradce. Člověk drží v ruce výrobek a chce vědět, co si místo něj koupit v konkrétní zemi.

Úkol: najdi 3–5 NEJBLIŽŠÍCH alternativ přesně stejného druhu, které se v dané zemi skutečně prodávají, a seřaď je od nejlepší.
Pravidla přesnosti (nejdůležitější):
- Nejdřív si ujasni druh výrobku (productType): co to je, jak se jí, velikost porce, podstatné znaky (např. „čokoládová oplatka s krémovou náplní v polevě, cca 30 g“, „vídeňské párky“, „bílý jogurt 3,5 %“).
- Alternativa musí být stejný druh a stejné použití: za čokoládovou oplatku jinou čokoládovou oplatku, ne tabulku čokolády ani sušenku bez polevy; za párky jiné párky, ne šunku; za pivo pivo stejného typu. Když si nejsi jistý, že je to stejný druh, nenavrhuj to.
- Uživatel hledá alternativu, aby koupil LÉPE: začni tím nejlepším, co se v daném druhu v dané zemi dá koupit (máslo a kakaové máslo místo palmy, bez ztužených tuků a náhražek, krátké složení, poctivý nebo regionální výrobce, dobré testy). Každá alternativa musí být lepší než posuzovaný výrobek, nikdy horší ani stejná; aspoň 3. Když nic lepšího prokazatelně neexistuje, uveď nejlepší dostupné stejné úrovně a napiš to do whyBetter.
- Každá alternativa má mít sourceUrl na stránku výrobku u prodejce nebo výrobce v dané zemi (z výsledků vyhledávání; nikdy nesestavuj). Bez stránky ji uveď jen tehdy, když víš jistě, že se v zemi prodává.
- Hledej v jazyce dané země i anglicky; stránky e-shopů řetězců jsou nejlepší zdroj. Nejvýš ${MAX_SEARCHES} vyhledávání a ${MAX_FETCHES} otevření stránek.
Výsledek odevzdej nástrojem submit_alternatives.
${SCALE_TEXT}`;

function brief(product: ProductData, assessment: Assessment, country: string, profile: UserProfile): string {
  const m = marketOf(country);
  const cat = categoryRules(product);
  return [
    `Posuzovaný výrobek: ${product.name}${product.brand ? ` – ${product.brand}` : ""}${product.quantity ? ` (${product.quantity})` : ""}`,
    product.category ? `Kategorie podle databáze: ${product.category} (${detectCategory(product)})` : `Druh podle pravidel: ${detectCategory(product)}`,
    product.ingredientsText ? `Složení: ${product.ingredientsText.slice(0, 600)}` : "Složení: neznámé",
    cat.facts.meatPercent !== undefined ? `Podíl masa: ${cat.facts.meatPercent} %` : undefined,
    cat.facts.cocoaPercent !== undefined ? `Kakaová sušina: ${cat.facts.cocoaPercent} %` : undefined,
    `Verdikt podle pravidel: ${assessment.verdict}${assessment.score !== undefined ? ` (${assessment.score} bodů)` : ""}; hlavní výhrady: ${assessment.reasons
      .filter((r) => r.kind === "negative")
      .slice(0, 3)
      .map((r) => r.text)
      .join(" | ") || "–"}`,
    `Země, kde chce uživatel nakupovat: ${m.name} (${m.code}). Běžné řetězce: ${m.chains}. Hledej ${m.lang}.`,
    profile.stores.length ? `Řetězce uživatele: ${profile.stores.join(", ")}` : undefined,
    `Tón textů whyBetter: ${toneInstruction(profile.tone)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface AlternativesResearch {
  country: string;
  productType: string;
  alternatives: InsightAlternative[];
  droppedWorse?: number;
  sources: InsightSource[];
  confidence: "high" | "medium" | "low";
  generatedAt: string;
}

export async function researchAlternatives(
  product: ProductData,
  assessment: Assessment,
  country: string,
  profile: UserProfile = EMPTY_PROFILE,
): Promise<AlternativesResearch> {
  const { submitted, hits } = await runToolLoop({
    system: SYSTEM,
    brief: brief(product, assessment, country, profile),
    tools: [webSearch(MAX_SEARCHES), webFetch(MAX_FETCHES), ALTERNATIVES_TOOL as Anthropic.Beta.Messages.BetaTool],
    submitName: "submit_alternatives",
    schema: Submitted,
    effort: "medium",
    maxTurns: 10,
    requireWeb: true,
  });
  const allowed = (u: string) => (u.trim() ? hits.get(normalizeUrl(u))?.url : undefined);
  const raw: InsightAlternative[] = submitted.alternatives
    .filter((a) => a.name.trim() && a.whyBetter.trim())
    .slice(0, 5)
    .map((a) => ({
      name: a.name.trim(),
      brand: a.brand.trim() || undefined,
      whyBetter: [a.whyBetter.trim(), a.sameKind.trim()].filter(Boolean).join(" "),
      whereToBuy: a.whereToBuy.trim() || undefined,
      sourceUrl: allowed(a.sourceUrl),
      verdict: a.verdict === "nevime" ? undefined : a.verdict,
      verdictSource: a.verdict === "nevime" ? undefined : ("ai" as const),
    }));
  // photos, EANs and our own verdicts – looked up in the chosen country
  const enriched = await enrichAlternatives(raw, { ...profile, countries: [country.toLowerCase()] }).catch(() => raw);
  const { kept: alternatives, dropped } = keepNotWorse(enriched, assessment.verdict);
  const sources: InsightSource[] = [];
  const seen = new Set<string>();
  for (const s of submitted.sources) {
    const url = allowed(s.url);
    if (!url || seen.has(normalizeUrl(url))) continue;
    seen.add(normalizeUrl(url));
    sources.push({ url, title: s.title || hits.get(normalizeUrl(url))?.title || url });
  }
  return {
    country: country.toLowerCase(),
    productType: submitted.productType.trim(),
    alternatives,
    droppedWorse: dropped || undefined,
    sources,
    confidence: submitted.confidence,
    generatedAt: new Date().toISOString(),
  };
}
