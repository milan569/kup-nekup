import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { detectCategory } from "./category.js";
import { SCALE_TEXT, VerdictSchema, toneInstruction } from "./claude.js";
import { normalizeUrl, runToolLoop, stepTowards, webSearch } from "./insight.js";
import type { CompareItem, CompareRankEntry, CompareResult, Insight, InsightSource, UserProfile, Verdict } from "./types.js";
import { EMPTY_PROFILE } from "./types.js";
import { VERDICTS } from "./verdicts.js";

/**
 * Head-to-head comparison of 2–4 products the user put in the basket.
 *  - quick: rule verdicts + a short web check (max 2 searches), ~15 s
 *  - deep: built on the full research of every product (history, recipe
 *    changes, tests, value), no new web search for the comparison itself
 * Products of different kinds (ham vs. chocolate) are "nesrovnatelné": the
 * answer then explains why and ranks nothing.
 */

export const MAX_COMPARE_ITEMS = 4;
const QUICK_SEARCHES = Number(process.env.COMPARE_MAX_SEARCHES ?? 2);

const str = (description: string) => ({ type: "string", description }) as const;

export const COMPARE_TOOL: Anthropic.Messages.Tool = {
  name: "submit_comparison",
  description: "Odevzdej porovnání výrobků. Zavolej přesně jednou. Texty česky.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["comparable", "headline", "summary", "winnerIndex", "ranking", "confidence", "sources"],
    properties: {
      comparable: { type: "string", enum: ["yes", "partly", "no"], description: "yes = stejný druh výrobku; partly = příbuzné, srovnání jen orientační; no = každý je jiný druh" },
      headline: str("jedna úderná věta, max 90 znaků: kdo vyhrál a proč, nebo proč to nejde srovnat"),
      summary: str("3–6 vět: rozhodující rozdíly (složení, poctivost výroby, výrobce, testy, cena za kg/l), nebo proč jsou výrobky nesrovnatelné"),
      winnerIndex: { type: "number", description: "index vítěze v zadání (0 = první); -1 když není vítěz nebo jsou nesrovnatelné" },
      ranking: {
        type: "array",
        description: "všechny porovnávané výrobky od nejlepšího; prázdné pole, když jsou nesrovnatelné",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "verdict", "pros", "cons", "note"],
          properties: {
            index: { type: "number", description: "index výrobku v zadání" },
            verdict: { type: "string", enum: [...VerdictSchema.options], description: "verdikt tohoto výrobku na škále" },
            pros: { type: "array", items: { type: "string" }, description: "1–3 krátká plus" },
            cons: { type: "array", items: { type: "string" }, description: "1–3 krátká minus" },
            note: str("jedna věta: proč je na tomto místě"),
          },
        },
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      sources: {
        type: "array",
        description: "stránky z výsledků vyhledávání, o které se porovnání opírá (může být prázdné)",
        items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } },
      },
    },
  },
};

const Submitted = z.object({
  comparable: z.enum(["yes", "partly", "no"]),
  headline: z.string(),
  summary: z.string(),
  winnerIndex: z.number(),
  ranking: z.array(z.object({ index: z.number(), verdict: VerdictSchema, pros: z.array(z.string()), cons: z.array(z.string()), note: z.string() })),
  confidence: z.enum(["high", "medium", "low"]),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

const SYSTEM = `Jsi zkušený potravinářský odborník a spotřebitelský poradce pro Česko, Slovensko, Černou Horu a Balkán. Člověk stojí v obchodě s několika výrobky v ruce a chce vědět, který z nich koupit.

Postup:
1. Nejdřív rozhodni, zda jsou výrobky vůbec srovnatelné: stejný druh (dvoje párky, dva sýry, dvě piva) = "yes"; příbuzné, ale ne totéž (šunka vs. salám, čokoláda vs. oplatka) = "partly" se srovnáním jen orientačním; různé druhy (olej vs. čokoláda) = "no" – pak vysvětli proč a nic neřaď.
2. Srovnatelné výrobky seřaď od nejlepšího. Rozhoduje kvalita a poctivost: složení (podíl masa, náhražky, plnidla, aditiva), verdikt z pravidel v zadání, výrobce a jeho pověst, změny receptury, spotřebitelské testy, cena za kg nebo litr (předražené prohrává při stejné kvalitě). Zdravotní hlediska podle druhu výrobku: u alkoholu, kávy, čaje a koření nehodnoť zdraví, jen kvalitu.
3. U každého výrobku napiš 1–3 plus, 1–3 minus a jednu větu, proč je na svém místě. Verdikty z pravidel v zadání respektuj; posuň je nejvýš o jeden stupeň a jen s důvodem.
4. Měj jasný názor. Když je rozdíl malý, řekni to; když jeden výrobek jasně vede, řekni to naplno.
Vyhledávání na webu použij jen tam, kde zadání nestačí (nejvýš ${QUICK_SEARCHES}); URL přebírej přesně z výsledků, čísla si nevymýšlej.
Výsledek odevzdej nástrojem submit_comparison.
${SCALE_TEXT}`;

const KIND_LABEL: Record<string, string> = {
  meat: "maso a uzeniny",
  dairy: "mléčné výrobky",
  sweets: "sladkosti",
  alcohol: "alkohol",
  coffee: "káva",
  tea: "čaj",
  spice: "koření",
  other: "ostatní",
};

function itemBrief(i: number, it: CompareItem, insight?: Insight): string {
  const p = it.product;
  const a = it.assessment;
  const n = p.nutrition;
  const nutrition = n
    ? [n.energyKcal !== undefined ? `${n.energyKcal} kcal` : "", n.sugars !== undefined ? `cukry ${n.sugars} g` : "", n.salt !== undefined ? `sůl ${n.salt} g` : "", n.saturatedFat !== undefined ? `nasycené ${n.saturatedFat} g` : "", n.proteins !== undefined ? `bílkoviny ${n.proteins} g` : ""]
        .filter(Boolean)
        .join(", ")
    : "";
  const lines = [
    `[${i}] ${p.name}${p.brand ? ` – ${p.brand}` : ""}${p.quantity ? ` (${p.quantity})` : ""}`,
    `  druh: ${KIND_LABEL[detectCategory(p)] ?? "ostatní"}${p.category ? ` / ${p.category}` : ""}`,
    `  verdikt podle pravidel: ${a.verdict}${a.score !== undefined ? ` (${a.score} bodů)` : ""}; důvody: ${a.reasons.slice(0, 4).map((r) => r.text).join(" | ") || "–"}`,
    p.ingredientsText ? `  složení: ${p.ingredientsText.slice(0, 500)}` : "  složení: neznámé",
    nutrition ? `  na 100 g: ${nutrition}` : undefined,
    p.nutriScore || p.novaGroup ? `  Nutri-Score ${p.nutriScore?.toUpperCase() ?? "–"}, NOVA ${p.novaGroup ?? "–"}` : undefined,
    insight
      ? `  průzkum: ${insight.headline} ${insight.opinion.slice(0, 400)}${insight.recipeChange.changed === "yes" && insight.recipeChange.summary ? ` Změna receptury: ${insight.recipeChange.summary}` : ""}${insight.issues.length ? ` Kauzy: ${insight.issues.map((e) => e.text).join("; ")}` : ""}${insight.reviews ? ` Testy: ${insight.reviews.summary}` : ""}${insight.value && insight.value.verdict !== "ok" ? ` Cena: ${insight.value.reason}` : ""}`
      : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}

function compareBrief(items: CompareItem[], profile: UserProfile, insights?: (Insight | undefined)[]): string {
  const kinds = new Set(items.map((it) => detectCategory(it.product)));
  return [
    `Porovnej tyto výrobky (${items.length}):`,
    ...items.map((it, i) => itemBrief(i, it, insights?.[i])),
    "",
    kinds.size > 1 ? "Pozor: výrobky jsou podle databáze různého druhu – zvaž, zda jsou vůbec srovnatelné." : "Výrobky jsou stejného druhu.",
    `Uživatel nakupuje v zemích: ${profile.countries.join(", ")}`,
    `Tón textů headline, summary a note: ${toneInstruction(profile.tone)}`,
  ].join("\n");
}

/** Sanity: valid, unique indices; verdicts at most one step from the rules; no winner when not comparable. */
export function buildCompareResult(
  s: z.infer<typeof Submitted>,
  items: CompareItem[],
  hits: Map<string, { url: string; title: string }>,
  mode: "quick" | "deep",
): CompareResult {
  const seen = new Set<number>();
  const ranking: CompareRankEntry[] = [];
  for (const r of s.ranking) {
    const idx = Math.trunc(r.index);
    if (idx < 0 || idx >= items.length || seen.has(idx)) continue;
    seen.add(idx);
    const rule = items[idx]!.assessment.verdict;
    const verdict: Verdict = rule === "nevime" ? r.verdict : stepTowards(rule, r.verdict);
    ranking.push({
      index: idx,
      place: ranking.length + 1,
      verdict,
      pros: r.pros.map((x) => x.trim()).filter(Boolean).slice(0, 3),
      cons: r.cons.map((x) => x.trim()).filter(Boolean).slice(0, 3),
      note: r.note.trim(),
    });
  }
  const comparable = s.comparable;
  if (comparable === "no") ranking.length = 0;
  const winner = Math.trunc(s.winnerIndex);
  const winnerIndex = comparable !== "no" && winner >= 0 && winner < items.length ? winner : ranking[0]?.index;

  const sources: InsightSource[] = [];
  const seenUrl = new Set<string>();
  for (const src of s.sources) {
    const hit = hits.get(normalizeUrl(src.url));
    if (!hit || seenUrl.has(normalizeUrl(hit.url))) continue;
    seenUrl.add(normalizeUrl(hit.url));
    sources.push({ url: hit.url, title: src.title || hit.title });
  }
  return {
    comparable,
    headline: s.headline.trim(),
    summary: s.summary.trim(),
    ranking,
    winnerIndex: comparable === "no" ? undefined : winnerIndex,
    sources,
    mode,
    confidence: s.confidence,
    generatedAt: new Date().toISOString(),
  };
}

export async function quickCompare(items: CompareItem[], profile: UserProfile = EMPTY_PROFILE): Promise<CompareResult> {
  const { submitted, hits } = await runToolLoop({
    system: SYSTEM,
    brief: compareBrief(items, profile),
    tools: [webSearch(QUICK_SEARCHES), COMPARE_TOOL as Anthropic.Beta.Messages.BetaTool],
    submitName: "submit_comparison",
    schema: Submitted,
    effort: "low",
    maxTurns: 4,
    requireWeb: false,
  });
  return buildCompareResult(submitted, items, hits, "quick");
}

/** Deep comparison: the research of every product is already done (or was just run); the model only weighs it. */
export async function deepCompare(items: CompareItem[], insights: (Insight | undefined)[], profile: UserProfile = EMPTY_PROFILE): Promise<CompareResult> {
  const { submitted, hits } = await runToolLoop({
    system: SYSTEM.replace(`Vyhledávání na webu použij jen tam, kde zadání nestačí (nejvýš ${QUICK_SEARCHES}); URL přebírej přesně z výsledků, čísla si nevymýšlej.`, "Každý výrobek už prošel důkladným průzkumem (viz zadání) – opři se o něj, na web už nechoď."),
    brief: compareBrief(items, profile, insights),
    tools: [COMPARE_TOOL as Anthropic.Beta.Messages.BetaTool],
    submitName: "submit_comparison",
    schema: Submitted,
    effort: "medium",
    maxTurns: 2,
    requireWeb: false,
  });
  const result = buildCompareResult(submitted, items, hits, "deep");
  // the research pages of all products back the comparison
  const seen = new Set(result.sources.map((s) => normalizeUrl(s.url)));
  for (const ins of insights) for (const src of ins?.sources ?? []) {
    if (seen.has(normalizeUrl(src.url))) continue;
    seen.add(normalizeUrl(src.url));
    result.sources.push(src);
  }
  result.sources = result.sources.slice(0, 12);
  return result;
}

/** Stable cache key: the same basket in any order gives the same comparison. */
export function compareKey(items: CompareItem[], tone: string | undefined, mode: "quick" | "deep", version: string): string {
  return `${items.map((it) => `${it.product.id}:${it.assessment.verdict}`).sort().join("|")}|${tone ?? "humor"}|${mode}|${version}`;
}

export function verdictRank(v: Verdict): number {
  return VERDICTS[v].rank;
}
