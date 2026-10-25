import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  Assessment,
  Insight,
  InsightAlternative,
  InsightComposition,
  InsightEvent,
  InsightSource,
  NutritionPer100g,
  QuickInsight,
  ProductData,
  Reason,
  DtestRef,
  Tone,
  UserProfile,
  ValueAssessment,
  Verdict,
} from "./types";
import { EMPTY_PROFILE } from "./types";
import { ClaudeRefusedError, SCALE_TEXT, VerdictSchema, toneInstruction } from "./claude";
import { getClient } from "./anthropic";
import { INSIGHT_EFFORT, INSIGHT_MAX_FETCHES, INSIGHT_MAX_SEARCHES, INSIGHT_MODEL, QUICK_MAX_SEARCHES } from "./config";
import { assertSpendAllowed, recordUsage } from "./usage";
import { scoreForVerdict } from "./scoring";
import { QUALITY_FIRST, detectCategory, categoryRules } from "./category";
import { VALUE_CAP, VERDICTS, VERDICT_SCALE, isBetter, valueText } from "./verdicts";
import { ENRICH_VERSION, enrichAlternatives, keepNotWorse } from "./alternatives-enrich";

/**
 * AI insight: Claude researches the product and its maker on the web
 * (ownership history, acquisitions, recipe downgrades, awards, recalls,
 * consumer tests), finds the ingredient list online when the label/database
 * had none, suggests better products sold in the user's countries, and
 * returns a clear, sourced opinion on the verdict scale.
 *
 * One request: server-side web_search + web_fetch plus a strict client tool
 * `submit_insight` that carries the structured result. Every URL the model
 * cites is checked against URLs that search or fetch actually returned.
 */

export { INSIGHT_MODEL };
const MAX_SEARCHES = INSIGHT_MAX_SEARCHES;
const MAX_FETCHES = INSIGHT_MAX_FETCHES;

// ---- schema of the submit_insight tool ----
// No nullable/union fields at all: the API allows at most 16 per schema.
// Unknown text = "", unknown number = -1.

const str = (description: string) => ({ type: "string", description }) as const;
const eventSchema = {
  type: "object",
  additionalProperties: false,
  required: ["year", "text", "impact", "sourceUrl"],
  properties: {
    year: str("rok nebo období; prázdný řetězec, pokud ho zdroj neuvádí"),
    text: str("jedna věta česky"),
    impact: { type: "string", enum: ["positive", "negative", "neutral"] },
    sourceUrl: str("URL z výsledků vyhledávání nebo otevřené stránky, které tvrzení dokládá; jinak prázdný řetězec"),
  },
} as const;
const num = (description: string) => ({ type: "number", description: `${description}; -1 pokud neznámé` }) as const;

const valueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "reason", "cheaperOption", "sourceUrl"],
  description: "Poměr cena / co za to dostaneš – nezávisle na kvalitě.",
  properties: {
    verdict: { type: "string", enum: ["vyhozene_prachy", "ok", "vyhodne", "nevime"] },
    reason: str("1–2 věty: typická cena za kg/l proti srovnatelným výrobkům stejné kvality a za co se připlácí; prázdné u nevime"),
    cheaperOption: str("levnější výrobek stejné kvality s orientační cenou; jinak prázdný řetězec"),
    sourceUrl: str("stránka s cenou (e-shop, leták, srovnávač) z výsledků vyhledávání; jinak prázdný řetězec"),
  },
} as const;

const ValueZ = z.object({
  verdict: z.enum(["vyhozene_prachy", "ok", "vyhodne", "nevime"]),
  reason: z.string(),
  cheaperOption: z.string(),
  sourceUrl: z.string(),
});

/** Prompt text shared by the quick and the deep opinion. */
const VALUE_RULES = `Cena („value“), nezávisle na kvalitě:
- "vyhozene_prachy": platí se hlavně za značku, obal nebo marketing a stejnou kvalitu jde koupit výrazně levněji – zhruba dvakrát a víc za kg/l než srovnatelný výrobek stejné kvality. Typicky prémiová balená voda (pořád je to H2O), „funkční“ nápoje, superpotraviny s marketingem, drahé značky komodit (sůl, cukr, mouka, olej), malá balení za násobnou cenu. Patří sem i značka nebo výrobce známý předraženým šuntem – jen se zdrojem.
- "vyhodne": kvalita aspoň slušná a cena běžná nebo nízká.
- "ok": běžná cena za to, co dostaneš.
- "nevime": cenu jsi nenašel. Nehádej, ceny nevymýšlej.
Ceny ber jen z výsledků vyhledávání (e-shopy řetězců, letáky, srovnávače), přepočítej na kg nebo litr a uveď je v měně uživatele (Kč v Česku, € v Černé Hoře). "vyhozene_prachy" bez sourceUrl se stránkou s cenou neplatí.`;

export const SUBMIT_TOOL: Anthropic.Messages.Tool = {
  name: "submit_insight",
  description: "Odevzdej výsledný posudek produktu. Zavolej přesně jednou, až dokončíš průzkum. Všechny texty česky (složení v originále).",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "headline", "opinion", "manufacturer", "history", "recipeChange", "awards", "issues", "reviews", "foundComposition", "alternatives", "sources", "confidence"],
    properties: {
      verdict: { type: "string", enum: [...VerdictSchema.options] },
      headline: str("jedna úderná věta, max 90 znaků"),
      opinion: str("3–6 vět: jasný názor, proč koupit nebo nekoupit; u tradiční značky po převzetí shrň i to, co se s výrobkem stalo"),
      manufacturer: {
        type: "object",
        additionalProperties: false,
        required: ["name", "type", "country", "owner", "summary"],
        properties: {
          name: str("výrobce"),
          type: { type: "string", enum: ["family", "craft", "regional", "industrial", "private-label", "unknown"] },
          country: str("země; prázdný řetězec, pokud nevíš"),
          owner: str("současný vlastník / skupina; prázdný řetězec, pokud nevíš"),
          summary: str("2–3 věty o firmě"),
        },
      },
      history: { type: "array", items: eventSchema, description: "vlastnické změny, převzetí, přesuny výroby, důležité milníky značky" },
      recipeChange: {
        type: "object",
        additionalProperties: false,
        required: ["changed", "summary", "sourceUrl"],
        properties: {
          changed: { type: "string", enum: ["yes", "no", "unknown"] },
          summary: str("3–6 vět konkrétně: co bylo ve složení dřív a co je teď, změny gramáže a ceny, kdy k tomu došlo; prázdné, když se nic nezměnilo nebo to nejde doložit"),
          sourceUrl: str("zdroj; prázdný řetězec, pokud není"),
        },
      },
      awards: { type: "array", items: eventSchema },
      issues: { type: "array", items: eventSchema, description: "stažení z trhu, Potraviny na pranýři, kauzy – jen se zdrojem" },
      reviews: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "sourceUrl"],
        properties: { summary: str("testy a reakce zákazníků: co chválí, co kritizují (chuť, konzistence, bojkot), s roky a weby; může být prázdné"), sourceUrl: str("zdroj; může být prázdné") },
      },
      foundComposition: {
        type: "object",
        additionalProperties: false,
        required: ["found", "ingredientsText", "market", "sourceUrl", "nutritionPer100g"],
        description: "Vyplň, jen když složení v zadání chybí: složení a nutriční hodnoty nalezené na webu.",
        properties: {
          found: { type: "boolean" },
          ingredientsText: str("celé složení doslova z nalezené stránky, v původním jazyce; prázdné, pokud nenalezeno"),
          market: str("země/trh, pro který tato receptura platí, např. 'USA', 'EU (Německo)', 'Česko'"),
          sourceUrl: str("URL stránky, ze které je složení opsané (musí být z vyhledávání nebo otevřená)"),
          nutritionPer100g: {
            type: "object",
            additionalProperties: false,
            required: ["energyKcal", "fat", "saturatedFat", "carbs", "sugars", "fiber", "proteins", "salt"],
            properties: {
              energyKcal: num("kcal na 100 g"),
              fat: num("tuky g/100 g"),
              saturatedFat: num("nasycené mastné kyseliny g/100 g"),
              carbs: num("sacharidy g/100 g"),
              sugars: num("cukry g/100 g"),
              fiber: num("vláknina g/100 g"),
              proteins: num("bílkoviny g/100 g"),
              salt: num("sůl g/100 g (sodík × 2,5)"),
            },
          },
        },
      },
      alternatives: {
        type: "array",
        description: "3–5 konkrétních výrobků přesně stejného druhu dostupných v zemích uživatele, každý lepší než posuzovaný, od nejlepšího",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "brand", "whyBetter", "whereToBuy", "sourceUrl", "verdict"],
          properties: {
            verdict: { type: "string", enum: [...VerdictSchema.options], description: "tvůj odhad verdiktu této alternativy na stejné škále" },
            name: str("název výrobku"),
            brand: str("značka / výrobce"),
            whyBetter: str("jedna věta, proč je lepší"),
            whereToBuy: str("kde koupit: řetězce, e-shopy, typ obchodu"),
            sourceUrl: str("URL stránky tohoto výrobku (e-shop řetězce nebo výrobce) z výsledků vyhledávání; prázdný, pokud jsi ji nenašel"),
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

const Event = z.object({ year: z.string(), text: z.string(), impact: z.enum(["positive", "negative", "neutral"]), sourceUrl: z.string() });
const Nutrition = z.object({
  energyKcal: z.number(),
  fat: z.number(),
  saturatedFat: z.number(),
  carbs: z.number(),
  sugars: z.number(),
  fiber: z.number(),
  proteins: z.number(),
  salt: z.number(),
});
const Submitted = z.object({
  verdict: VerdictSchema,
  headline: z.string(),
  opinion: z.string(),
  manufacturer: z.object({
    name: z.string(),
    type: z.enum(["family", "craft", "regional", "industrial", "private-label", "unknown"]),
    country: z.string(),
    owner: z.string(),
    summary: z.string(),
  }),
  history: z.array(Event),
  recipeChange: z.object({ changed: z.enum(["yes", "no", "unknown"]), summary: z.string(), sourceUrl: z.string() }),
  awards: z.array(Event),
  issues: z.array(Event),
  reviews: z.object({ summary: z.string(), sourceUrl: z.string() }),
  foundComposition: z.object({ found: z.boolean(), ingredientsText: z.string(), market: z.string(), sourceUrl: z.string(), nutritionPer100g: Nutrition }),
  alternatives: z.array(z.object({ name: z.string(), brand: z.string(), whyBetter: z.string(), whereToBuy: z.string(), sourceUrl: z.string(), verdict: VerdictSchema })),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  confidence: z.enum(["high", "medium", "low"]),
});
export type SubmittedT = z.infer<typeof Submitted>;

// ---- prompt ----

const SYSTEM = `Jsi zkušený potravinářský odborník a investigativní spotřebitelský novinář pro trh v Česku, na Slovensku, v Černé Hoře a na Balkáně. Pomáháš člověku, který stojí v obchodě a rozhoduje se, zda produkt koupit.

Úkol: důkladně prozkoumej na webu výrobek a jeho výrobce a vytvoř jasný, podložený posudek.
1. Složení: když v zadání chybí nebo je neúplné, najdi ho – web výrobce, e-shopy a řetězce (Rohlik, Košík, Tesco, Kaufland, Lidl, Albert, Billa, dm, Voli, Idea, Amazon, Kroger, Walmart…), Open Food Facts. Stránku otevři nástrojem web_fetch a opiš složení doslova a nutriční hodnoty na 100 g. Receptury se mezi trhy liší (USA vs. EU), proto upřednostni verzi pro zemi uživatele nebo EU; do market napiš, pro který trh nalezené složení platí.
2. Výrobce a vlastník: kdo produkt vyrábí, kdo značku vlastní, rodinná/regionální firma, nadnárodní koncern, nebo privátní značka řetězce.
3. Historie značky: převzetí a prodeje (např. Opavia → Danone/Kraft → Mondelez), přesuny výroby, zánik původních závodů – s roky.
4. Zhoršení tradičního výrobku po převzetí – když značku vlastní nadnárodní koncern nebo změnila majitele, prozkoumej to DŮKLADNĚ a doslova, s příklady:
   a) objektivní změny složení: co bylo dřív a co je teď (kakaové máslo vs. palmový/palmojádrový tuk, máslo vs. rostlinný tuk, podíl masa, nové náhražky) – porovnej dnešní složení se starším z databází, archivů, diskusí;
   b) „shrinkflace“: konkrétní změny gramáže a ceny;
   c) reakce zákazníků: recenze a diskuse (Heureka, Vitalia, dTest, Mapy.cz, Facebook, Reddit) – co lidem vadí (umělá pachuť, jiná konzistence), zda deklarují bojkot;
   d) sourozenecké výrobky téže značky se stejným osudem (např. u Opavie piškoty po přesunu do Polska, Disco, Zlaté Esíčka, Miňonky, BeBe) – každý jako událost v history se zdrojem;
   e) oficiální postoj výrobce, pokud existuje.
   Shrnutí a) a b) patří do recipeChange.summary (3–6 vět, konkrétně), reakce c) do reviews.summary, d) a převzetí do history. Když výrobek takovou historii nemá, napiš to stručně a nevymýšlej.
5. Ocenění a značky kvality (Klasa, Regionální potravina, Česká chuťovka, DLG, Great Taste…).
6. Problémy: Potraviny na pranýři (SZPI), stažení z trhu, RASFF, kauzy, pokuty.
7. Spotřebitelské testy: nejdřív dTest. Zjisti, zda dTest v posledních zhruba šesti letech testoval tento druh výrobku (hledej „dTest test <druh výrobku>“, stránky dtest.cz/testy, tiskové zprávy dTestu a články médií o tom testu). Do reviews.summary napiš rok testu a veřejně známá zjištění (co laboratoř našla, které výrobky podle veřejného textu propadly nebo vyhrály) a do reviews.sourceUrl zdroj. Když byl testován přímo tento výrobek a veřejný text uvádí jeho výsledek, promítni ho do verdiktu a názoru. Hodnocení skrytá za přihlášením neodhaduj. Když dTest nic k tomuto druhu výrobku nemá, dTest nezmiňuj. Pak Stiftung Warentest, ÖKO-TEST, testy v médiích, diskuze.
8. Alternativy: 3–5 konkrétních výrobků PŘESNĚ stejného druhu a použití (za čokoládovou oplatku jinou čokoládovou oplatku, ne tabulku čokolády; za párky párky, ne šunku), které se prodávají v zemích uživatele (ideálně v jeho řetězcích). Uživatel hledá alternativu, aby koupil LÉPE: začni tím nejlepším, co se v daném druhu dá koupit (máslo a kakaové máslo místo palmy, bez ztužených tuků a náhražek, krátké složení, poctivý nebo regionální výrobce, dobré testy), a každá alternativa musí být lepší než posuzovaný výrobek – nikdy horší ani stejná. Když nic lepšího prokazatelně neexistuje, napiš to v opinion a uveď nejlepší dostupné stejné úrovně. Ke každé důvod a kde koupit. Když je výrobek zjevně předražený (platí se hlavně za značku nebo obal), řekni to v názoru a uveď mezi alternativami i levnější rovnocenný výrobek. U každé alternativy uveď sourceUrl: přednostně stránku výrobku v databázi Open Food Facts (openfoodfacts.org/product/<kód>), jinak e-shop řetězce nebo výrobce, vždy jen pokud ji máš ve výsledcích vyhledávání.
Hledej v jazyce země původu i v jazycích zemí uživatele (česky, slovensky, srbsky/černohorsky, chorvatsky, německy) a anglicky. Použij až ${MAX_SEARCHES} vyhledávání a ${MAX_FETCHES} otevření stránek; nehledej zbytečně, když už máš odpověď.

Pravidla:
- Každé negativní tvrzení o firmě (kauza, zhoršení receptury, pokuta) musí mít sourceUrl z výsledků vyhledávání nebo z otevřené stránky. Bez zdroje ho vynech.
- URL přebírej přesně z výsledků, nikdy je nesestavuj.
- Roky uváděj jen, když jsou ve zdroji.
- Analýza složení z etikety už proběhla podle pravidel a je níže. Fakta z etikety nepopírej, doplň je o kontext. Když jsi složení dohledal, opři verdikt o něj.
- Měj jasný názor a nemlž. Když je to průmyslový šmejd, řekni to. Když je to poctivá věc, pochval ji.
- Výsledek odevzdej voláním nástroje submit_insight, přesně jednou.

${SCALE_TEXT}`;

/** Alcoholic drinks: health is the same for every bottle, quality and reputation are not. */
const ALCOHOL_BRIEF = `Jde o alkoholický nápoj. Škodlivost alkoholu jako takového NEhodnoť ani nekomentuj – je známá a stejná pro každou lahev. Verdikt postav na kvalitě:
- chuťová hodnocení a recenze (pivo: Untappd, RateBeer; víno: Vivino, soutěže a vinařské průvodce; destiláty: soutěže a medaile, recenze),
- reputace výrobce a poctivost výroby (pivo ze sladu vs. s cukrem, sirupem nebo kukuřicí; pravý destilát vs. lihovina z líhu s aromatem a cukrem; víno s původem vs. aromatizované),
- označení původu a ceny (předražená značka = vyhozený prachy).
Zdraví zmiň jen u rizikového výrobku: alkohol s kofeinem nebo energetickými látkami, extrémně sladký likér, podezřelý původ (riziko metanolu). Vyhledej hlavně hodnocení a recenze tohoto konkrétního nápoje.`;

const COFFEE_BRIEF = `Jde o kávu. Kofein ani zdraví nekomentuj, je to známé. Verdikt postav na kvalitě: odrůda (100 % arabika vs. směs s robustou), zrnková vs. mletá vs. instantní, původ a zpracování, pražírna a její pověst, čerstvost, testy (dTest, Stiftung Warentest, ÖKO-TEST: chuť, akrylamid, plísně), recenze a cena za kg (předražená značka = vyhozený prachy). Zdraví zmiň jen u rizika zjištěného v testu.`;
const TEA_BRIEF = `Jde o čaj. Zdraví nekomentuj. Verdikt postav na kvalitě: sypaný list vs. prach v sáčcích, původ a sklizeň, aromatizace místo skutečného ovoce, podíl ovoce z názvu, testy (dTest, ÖKO-TEST: pesticidy, pyrrolizidinové alkaloidy, minerální oleje), recenze a cena. Zdraví zmiň jen u rizika: projímavé „detox“ čaje se senou, kontaminanty zjištěné v testu.`;
const SPICE_BRIEF = `Jde o koření. Nutriční hodnoty nehodnoť, jí se po špetkách. Verdikt postav na kvalitě: čistota (bez soli, cukru, glutamátu, škrobu a maltodextrinu jako plniv), u směsí podíl soli, původ, vůně, testy falšování a kontaminantů (dTest, ÖKO-TEST: oregano s cizími listy, obarvená paprika, plísně), pověst značky a cena za kg. Zdraví zmiň jen u rizika: kasie a kumarin ve velkém množství, kontaminanty z testu.`;
const QUALITY_BRIEF: Partial<Record<string, string>> = { alcohol: ALCOHOL_BRIEF, coffee: COFFEE_BRIEF, tea: TEA_BRIEF, spice: SPICE_BRIEF };

function productBrief(p: ProductData, a: Assessment, profile: UserProfile): string {
  const cat = categoryRules(p);
  const lines = [
    `Produkt: ${p.name}`,
    p.brand ? `Značka: ${p.brand}` : undefined,
    p.manufacturer && p.manufacturer !== p.brand ? `Výrobce/vlastník podle databáze: ${p.manufacturer}` : undefined,
    p.ean ? `EAN: ${p.ean}` : undefined,
    p.quantity ? `Balení: ${p.quantity}` : undefined,
    p.category ? `Kategorie: ${p.category} (${detectCategory(p)})` : `Typ: ${detectCategory(p)}`,
    p.countries?.length ? `Prodáváno v: ${p.countries.join(", ")}` : undefined,
    `Uživatel nakupuje v zemích: ${profile.countries.join(", ")}`,
    profile.stores.length ? `Řetězce uživatele: ${profile.stores.join(", ")}` : undefined,
    p.name === "Neznámý produkt" && p.ean
      ? `Název ani výrobce zatím neznáme – nejdřív dohledej výrobek podle čárového kódu ${p.ean} (hledej přímo toto číslo).`
      : undefined,
    p.ingredientsText
      ? p.ingredientsPartial
        ? `Složení z etikety je jen ČÁSTEČNÉ (zakryté): ${p.ingredientsText.slice(0, 1500)} – dohledej celé složení tohoto výrobku na webu a vyplň foundComposition.`
        : `Složení: ${p.ingredientsText.slice(0, 1500)}`
      : "Složení: NEZNÁMÉ – dohledej ho na webu (bod 1) a vyplň foundComposition.",
    cat.facts.meatPercent !== undefined ? `Podíl masa podle etikety: ${cat.facts.meatPercent} %` : undefined,
    cat.facts.cocoaPercent !== undefined ? `Kakaová sušina podle etikety: ${cat.facts.cocoaPercent} %` : undefined,
    p.nutriScore ? `Nutri-Score: ${p.nutriScore.toUpperCase()}` : undefined,
    p.novaGroup ? `NOVA: ${p.novaGroup}` : undefined,
    a.verdict !== "nevime"
      ? `Verdikt podle pravidel: ${a.verdict} (${a.score ?? "?"} bodů). Hlavní důvody: ${a.reasons.slice(0, 5).map((r) => r.text).join(" | ")}`
      : "Pravidla nemají dost dat na verdikt – tvůj verdikt bude rozhodující.",
    QUALITY_BRIEF[detectCategory(p)],
    `Tón textů headline a opinion: ${toneInstruction(profile.tone)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

// ---- run ----

interface SourceHit {
  url: string;
  title: string;
}

/** URLs the model may cite: everything web_search returned or web_fetch opened. */
function collectHits(content: Anthropic.Beta.Messages.BetaContentBlock[], into: Map<string, SourceHit>): void {
  for (const block of content) {
    const b = block as { type: string; content?: unknown };
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as { type?: string; url?: string; title?: string }[]) {
        if (r.type === "web_search_result" && r.url) into.set(normalizeUrl(r.url), { url: r.url, title: r.title ?? r.url });
      }
    }
    if (b.type === "web_fetch_tool_result" && b.content && typeof b.content === "object") {
      const r = b.content as { type?: string; url?: string; content?: { title?: string } };
      if (r.type === "web_fetch_result" && r.url) into.set(normalizeUrl(r.url), { url: r.url, title: r.content?.title ?? r.url });
    }
  }
}

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u.trim());
    url.hash = "";
    for (const k of [...url.searchParams.keys()]) if (/^utm_/i.test(k)) url.searchParams.delete(k);
    return (url.host.replace(/^www\./, "") + url.pathname.replace(/\/+$/, "") + (url.search || "")).toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

function findSubmit(content: Anthropic.Beta.Messages.BetaContentBlock[], name: string): unknown | undefined {
  for (const block of content) {
    if (block.type === "tool_use" && block.name === name) return block.input;
  }
  return undefined;
}

export interface ToolLoopOptions<T> {
  system: string;
  brief: string;
  tools: Anthropic.Beta.Messages.BetaToolUnion[];
  submitName: string;
  schema: z.ZodType<T>;
  effort: "low" | "medium" | "high";
  maxTurns: number;
  /** reject a submission made without any web search and ask for one first */
  requireWeb?: boolean;
}

/**
 * Runs Claude with server-side web tools plus one strict client "submit" tool
 * and returns the submitted object and every URL the web tools returned.
 */
export async function runToolLoop<T>(o: ToolLoopOptions<T>): Promise<{ submitted: T; hits: Map<string, SourceHit> }> {
  assertSpendAllowed();
  // one research turn can take a few minutes; the app keeps the rule verdict meanwhile
  const c = getClient("insight");
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: o.brief }];
  const hits = new Map<string, SourceHit>();
  let nudged = false;
  let webNudged = false;

  for (let turn = 0; turn < o.maxTurns; turn++) {
    const res = await c.beta.messages.create({
      model: INSIGHT_MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
      messages,
      tools: o.tools,
      tool_choice: { type: "auto" },
      output_config: { effort: o.effort },
      betas: ["server-side-fallback-2026-07-01"],
      // re-runs a safety decline on Anthropic's recommended fallback model
      fallbacks: "default",
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

    recordUsage(res.usage, INSIGHT_MODEL, o.submitName);
    if (res.stop_reason === "refusal") throw new ClaudeRefusedError();
    collectHits(res.content, hits);

    const input = findSubmit(res.content, o.submitName);
    if (input !== undefined && o.requireWeb && hits.size === 0 && !webNudged) {
      // the model answered from memory only – send it back to check the web first
      webNudged = true;
      const toolUse = res.content.find((b) => b.type === "tool_use" && b.name === o.submitName) as { id: string } | undefined;
      messages.push({ role: "assistant", content: res.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse!.id,
            is_error: true,
            content: "Nejdřív ověř výrobek nebo výrobce aspoň jedním webovým vyhledáváním, pak odevzdej znovu se zdroji.",
          },
        ],
      });
      continue;
    }
    if (input !== undefined) {
      const parsed = o.schema.safeParse(input);
      if (parsed.success) return { submitted: parsed.data, hits };
      throw new Error("Posudek AI nemá očekávaný tvar: " + parsed.error.issues.map((i) => i.path.join(".")).join(", "));
    }

    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    if (res.stop_reason === "pause_turn") continue; // server-side tool loop hit its limit – resume
    if (res.stop_reason === "max_tokens") throw new Error("Posudek AI byl příliš dlouhý.");
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: `Odevzdej teď výsledek voláním nástroje ${o.submitName}.` });
  }
  throw new Error("AI posudek neodevzdala.");
}

export const webSearch = (maxUses: number) => ({ type: "web_search_20260209", name: "web_search", max_uses: maxUses }) as Anthropic.Beta.Messages.BetaToolUnion;
export const webFetch = (maxUses: number) =>
  ({ type: "web_fetch_20260209", name: "web_fetch", max_uses: maxUses, max_content_tokens: 8000 }) as Anthropic.Beta.Messages.BetaToolUnion;

async function runResearch(brief: string, useWeb: boolean): Promise<{ submitted: SubmittedT; hits: Map<string, SourceHit> }> {
  return runToolLoop({
    system: useWeb
      ? SYSTEM
      : SYSTEM + '\n\nWebové nástroje teď nejsou k dispozici: vycházej ze svých znalostí, sourceUrl nech prázdné, foundComposition.found=false a confidence nejvýš "medium".',
    brief,
    tools: useWeb
      ? [webSearch(MAX_SEARCHES), webFetch(MAX_FETCHES), SUBMIT_TOOL as Anthropic.Beta.Messages.BetaTool]
      : [SUBMIT_TOOL as Anthropic.Beta.Messages.BetaTool],
    submitName: "submit_insight",
    schema: Submitted,
    effort: INSIGHT_EFFORT,
    maxTurns: 8,
  });
}

function isWebToolUnavailable(err: unknown): boolean {
  return err instanceof Anthropic.BadRequestError && /web[_ ](search|fetch)/i.test(err.message);
}

// ---- assemble ----

const blank = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);

const DTEST_PAGE = /^https?:\/\/(www\.)?dtest\.(cz|sk)\/(testy\/|testy-vyrobku-\d+\/|test-|produkt|search\?|clanek-\d+\/(test|tiskov))/i;

/** Only the sentences that talk about dTest (the quick opinion passes its whole text). */
export function dtestSentences(text: string): string {
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  const about = sentences.filter((s) => DTEST_WORD.test(s));
  return (about.length ? about : sentences).join(" ").trim();
}
const DTEST_HOME_OR_META = /^https?:\/\/(www\.)?dtest\.(cz|sk)\/?$|casto-kladene|podminky|kontakt/i;
const DTEST_WORD = /d-?test/i;
const YEAR = /\b(20[0-3]\d)\b/;

/**
 * What the research found about dTest: the test page itself, or a dTest press
 * release or media report about the test (public facts only). The summary is
 * the reviews text when it talks about dTest.
 */
export function dtestRef(
  sources: { url: string; title: string }[],
  reviews?: { summary: string; sourceUrl?: string },
  productName?: string,
): DtestRef | undefined {
  const onDtest = sources.find((s) => DTEST_PAGE.test(s.url));
  const aboutDtest = sources.find((s) => !DTEST_HOME_OR_META.test(s.url) && DTEST_WORD.test(s.title) && /test/i.test(s.title));
  const summaryMentions = reviews && DTEST_WORD.test(reviews.summary) ? reviews : undefined;
  const hit = onDtest ?? aboutDtest ?? (summaryMentions?.sourceUrl ? { url: summaryMentions.sourceUrl, title: "Test dTest" } : undefined);
  if (!hit) return undefined;
  const title = hit.title.replace(/^dTest:\s*/i, "").replace(/\s*-\s*Nezávislé testy.*$/i, "").trim() || "Test dTest";
  const summary = summaryMentions ? dtestSentences(summaryMentions.summary) : undefined;
  const year = YEAR.exec(`${title} ${summary ?? ""}`)?.[1];
  const firstWord = productName?.split(/\s+/)[0]?.toLowerCase();
  const named = !!(firstWord && firstWord.length >= 3 && summary && summary.toLowerCase().includes(firstWord));
  return { url: hit.url, title, year, summary, productNamed: named || undefined };
}

function cleanEvents(events: z.infer<typeof Event>[], allowed: (u: string) => string | undefined, requireSource: boolean): InsightEvent[] {
  const out: InsightEvent[] = [];
  for (const e of events) {
    const sourceUrl = allowed(e.sourceUrl);
    if (requireSource && !sourceUrl) continue; // unsourced negative claims are dropped
    out.push({ year: blank(e.year), text: e.text, impact: e.impact, sourceUrl });
  }
  return out;
}

function toNutrition(n: z.infer<typeof Nutrition>): NutritionPer100g | undefined {
  const v = (x: number) => (Number.isFinite(x) && x >= 0 ? x : undefined);
  const out: NutritionPer100g = {
    energyKcal: v(n.energyKcal),
    fat: v(n.fat),
    saturatedFat: v(n.saturatedFat),
    carbs: v(n.carbs),
    sugars: v(n.sugars),
    fiber: v(n.fiber),
    proteins: v(n.proteins),
    salt: v(n.salt),
  };
  return Object.values(out).some((x) => x !== undefined) ? out : undefined;
}

export function buildInsight(s: SubmittedT, hits: Map<string, SourceHit>, webResearch: boolean, tone: Tone): Insight {
  const allowed = (u: string): string | undefined => {
    if (!u.trim()) return undefined;
    return hits.get(normalizeUrl(u))?.url;
  };
  const sources: InsightSource[] = [];
  const seen = new Set<string>();
  const addSource = (url: string | undefined, title?: string) => {
    if (!url) return;
    const key = normalizeUrl(url);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({ url, title: title ?? hits.get(key)?.title ?? url });
  };
  for (const src of s.sources) addSource(allowed(src.url), src.title);

  const history = cleanEvents(s.history, allowed, false);
  const awards = cleanEvents(s.awards, allowed, false);
  // problems and recipe downgrades are serious claims – keep only sourced ones
  const issues = cleanEvents(s.issues, allowed, webResearch);
  for (const e of [...history, ...awards, ...issues]) addSource(e.sourceUrl);

  const recipeUrl = allowed(s.recipeChange.sourceUrl);
  const recipeChange: Insight["recipeChange"] =
    s.recipeChange.changed === "yes" && webResearch && !recipeUrl
      ? { changed: "unknown" }
      : { changed: s.recipeChange.changed, summary: blank(s.recipeChange.summary), sourceUrl: recipeUrl };
  addSource(recipeUrl);

  const reviewsUrl = allowed(s.reviews.sourceUrl);
  addSource(reviewsUrl);

  // composition found online counts only with a verifiable source page
  let foundComposition: InsightComposition | undefined;
  const fc = s.foundComposition;
  const fcUrl = allowed(fc.sourceUrl);
  if (fc.found && fc.ingredientsText.trim().length >= 10 && fcUrl) {
    foundComposition = {
      ingredientsText: fc.ingredientsText.trim(),
      nutrition: toNutrition(fc.nutritionPer100g),
      market: blank(fc.market),
      sourceUrl: fcUrl,
      sourceTitle: hits.get(normalizeUrl(fcUrl))?.title ?? fcUrl,
    };
    addSource(fcUrl, foundComposition.sourceTitle);
  }

  const alternatives: InsightAlternative[] = s.alternatives
    .filter((a) => a.name.trim() && a.whyBetter.trim())
    .slice(0, 4)
    .map((a) => ({
      name: a.name.trim(),
      brand: blank(a.brand),
      whyBetter: a.whyBetter.trim(),
      whereToBuy: blank(a.whereToBuy),
      sourceUrl: allowed(a.sourceUrl),
      verdict: a.verdict === "nevime" ? undefined : a.verdict,
      verdictSource: a.verdict === "nevime" ? undefined : ("ai" as const),
    }));

  const hasSources = sources.length > 0;
  let confidence = s.confidence;
  if (!hasSources && confidence === "high") confidence = "medium";
  if (!webResearch) confidence = confidence === "high" ? "medium" : confidence;

  return {
    verdict: s.verdict,
    headline: s.headline,
    opinion: s.opinion,
    manufacturer: {
      name: s.manufacturer.name,
      type: s.manufacturer.type,
      country: blank(s.manufacturer.country),
      owner: blank(s.manufacturer.owner),
      summary: s.manufacturer.summary,
      awards: awards.map((a) => (a.year ? `${a.text} (${a.year})` : a.text)),
      certifications: [],
      verified: hasSources,
      sources,
      updatedAt: new Date().toISOString(),
    },
    history,
    recipeChange,
    awards,
    issues,
    reviews: blank(s.reviews.summary) ? { summary: s.reviews.summary.trim(), sourceUrl: reviewsUrl } : undefined,
    sources,
    confidence,
    foundComposition,
    alternatives,
    dtest: dtestRef(sources, blank(s.reviews.summary) ? { summary: s.reviews.summary, sourceUrl: reviewsUrl } : undefined),
    webResearch,
    model: INSIGHT_MODEL,
    tone,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Combine the rule verdict with the AI verdict.
 * - Rules have no verdict ("nevime"): the AI verdict is shown, even with low
 *   confidence – the confidence chip says how sure it is.
 * - Manual entries: the researched AI verdict wins (unless low confidence).
 * - Label-based products: when the AI is harsher it wins in full (it read the
 *   real composition, the sources and the price; a hero saying "ber a neřeš"
 *   under an opinion calling the product a sugar bomb is what users remember
 *   as unreliable). When the AI is kinder, the verdict improves one step only.
 * - Allergen / diet conflicts are never improved.
 */
export function combine(
  product: ProductData,
  rule: Assessment,
  insight: Pick<Insight, "verdict" | "confidence" | "headline">,
  label = "Posudek AI",
): Assessment {
  const ai = insight.verdict;
  if (ai === "nevime") return rule;
  if (insight.confidence === "low" && rule.verdict !== "nevime") return rule;

  let target: Verdict;
  // a manual entry whose composition was found online is judged like a label
  // alcohol: the label only shows how honestly it is made; reviews and reputation decide
  if (rule.verdict === "nevime" || (product.source === "manual" && !product.compositionSource) || QUALITY_FIRST.has(detectCategory(product))) {
    target = ai;
  } else {
    const from = VERDICTS[rule.verdict].rank;
    const to = VERDICTS[ai].rank;
    if (to < from) {
      target = ai;
    } else {
      const rank = from + Math.sign(to - from);
      target = VERDICT_SCALE.find((v) => VERDICTS[v].rank === rank) ?? rule.verdict;
    }
  }
  if (rule.hardRules.length && rule.verdict !== "nevime" && isBetter(target, rule.verdict)) target = rule.verdict;
  if (target === rule.verdict) return rule;

  const fromUnknown = rule.verdict === "nevime";
  const reason: Reason = fromUnknown
    ? { kind: "neutral", text: `Verdikt podle: ${label} (pravidla neměla dost údajů). ${insight.headline}` }
    : {
        kind: isBetter(target, rule.verdict) ? "positive" : "negative",
        text: `${label} ${isBetter(target, rule.verdict) ? "zlepšil" : "zhoršil"} verdikt: ${insight.headline}`,
      };
  const mid = Math.round(((VERDICTS[target].minScore ?? 0) + (VERDICTS[target].maxScore ?? 100)) / 2);
  return {
    ...rule,
    verdict: target,
    score: scoreForVerdict(rule.score ?? mid, target),
    confidence: fromUnknown ? insight.confidence : rule.confidence,
    reasons: [reason, ...rule.reasons],
    aiAdjusted: { from: rule.verdict, to: target },
  };
}

export async function researchInsight(product: ProductData, rule: Assessment, profile: UserProfile = EMPTY_PROFILE): Promise<Insight> {
  const brief = productBrief(product, rule, profile);
  const tone: Tone = profile.tone ?? "humor";
  let insight: Insight;
  try {
    const { submitted, hits } = await runResearch(brief, true);
    insight = buildInsight(submitted, hits, true, tone);
  } catch (err) {
    if (!isWebToolUnavailable(err)) throw err;
    console.warn("[insight] web tools unavailable, falling back to model knowledge:", (err as Error).message);
    const { submitted, hits } = await runResearch(brief, false);
    insight = buildInsight(submitted, hits, false, tone);
  }
  // package photo + our own verdict for each suggested alternative (a few seconds); nothing worse than the product itself
  if (insight.alternatives?.length) {
    const enriched = await enrichAlternatives(insight.alternatives, profile).catch((err) => {
      console.warn("[insight] alternatives enrichment failed:", (err as Error).message);
      return insight.alternatives!;
    });
    const baseline = insight.verdict !== "nevime" ? insight.verdict : rule.verdict;
    const { kept, dropped } = keepNotWorse(enriched, baseline);
    insight.alternatives = kept;
    if (dropped) insight.alternativesDropped = dropped;
  }
  insight.enrichVersion = ENRICH_VERSION;
  return insight;
}

// ---- quick opinion: small web research, shown within ~15–25 s ----

export const QUICK_TOOL: Anthropic.Messages.Tool = {
  name: "submit_quick",
  description: "Odevzdej rychlý posudek. Zavolej přesně jednou. Texty česky.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "headline", "opinion", "value", "confidence", "sources"],
    properties: {
      verdict: { type: "string", enum: [...VerdictSchema.options] },
      headline: { type: "string", description: "jedna úderná věta, max 90 znaků" },
      opinion: { type: "string", description: "2–4 věty: jasný názor – kvalita, výrobce, cena, na co si dát pozor" },
      value: valueSchema,
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      sources: {
        type: "array",
        description: "POVINNĚ 1–3 stránky z výsledků vyhledávání, o které se názor opírá (přesné URL)",
        items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } },
      },
    },
  },
};

const QuickSubmitted = z.object({
  verdict: VerdictSchema,
  headline: z.string(),
  opinion: z.string(),
  value: ValueZ,
  confidence: z.enum(["high", "medium", "low"]),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

const QUICK_SYSTEM = `Jsi zkušený potravinář a spotřebitelský poradce pro Česko, Černou Horu a Balkán. Člověk stojí v obchodě a chce odpověď do pár vteřin.
Vždy udělej RYCHLÝ průzkum na webu – i když údaje v zadání vypadají dostatečně, ověř výrobek nebo výrobce aspoň jedním vyhledáváním: 1–${QUICK_MAX_SEARCHES} cílená vyhledávání (výrobek, výrobce, případně složení nebo test), žádné dlouhé bádání. Pak dej jasný názor a verdikt.
Pravidla: negativní tvrzení o firmě jen se zdrojem z vyhledávání; URL přebírej přesně; nevymýšlej čísla ani roky. Fakta z etikety v zadání nepopírej.
U výrobku prodávaného v Česku nebo na Slovensku věnuj jedno vyhledávání dTestu (dotaz: „dTest test <druh výrobku>“ nebo název výrobku). Když dTest v posledních letech tento druh výrobku testoval, uveď stránku testu nebo článek o něm ve sources a v názoru zmiň s rokem veřejně známá zjištění testu (co laboratoř našla, kdo podle veřejného textu propadl nebo vyhrál) a to, zda byl tento výrobek v testu (veřejná stránka „Testované produkty“ na dtest.cz to potvrzuje); přihlédni k tomu ve verdiktu. Hodnocení skrytá za přihlášením neodhaduj. Když dTest nic k tomuto druhu výrobku nemá, dTest vůbec nezmiňuj.
Když ve výsledcích vyhledávání narazíš na cenu (e-shop, leták), posuď i poměr ceny a kvality; cenu cíleně dohledej jen u výrobků, kde je předražení pravděpodobné (balená voda, nápoje, superpotraviny, drahé značky běžných potravin).
Výsledek odevzdej nástrojem submit_quick.
${VALUE_RULES}
${SCALE_TEXT}`;

/** One verdict step at most away from `from`, in the direction of `to`. */
export function stepTowards(from: Verdict, to: Verdict): Verdict {
  if (from === "nevime" || to === "nevime") return to;
  const a = VERDICTS[from].rank;
  const b = VERDICTS[to].rank;
  if (Math.abs(a - b) <= 1) return to;
  const rank = a + Math.sign(b - a);
  return VERDICT_SCALE.find((v) => VERDICTS[v].rank === rank) ?? to;
}

/**
 * `previous`: the opinion given before a supplementary photo. The model then
 * refines it with the new data instead of starting over (which would reroll
 * the verdict), the earlier sources are kept and the verdict may move by one
 * step at most.
 */
export async function quickInsight(
  product: ProductData,
  rule: Assessment,
  profile: UserProfile = EMPTY_PROFILE,
  previous?: QuickInsight,
): Promise<QuickInsight> {
  let brief = productBrief(product, rule, profile)
    .split("\n")
    .map((line) => line.replace(/ – dohledej.*$/, "").replace(/NEZNÁMÉ – dohledej.*$/, "NEZNÁMÉ"))
    .join("\n");
  if (previous) {
    brief += `

UPŘESNĚNÍ, NE NOVÝ POSUDEK: uživatel k tomuto výrobku dodal další fotku obalu a údaje výše jsou teď úplnější. Tvůj předchozí rychlý názor (už ověřený na webu):
- verdikt: ${previous.verdict}
- titulek: ${previous.headline}
- názor: ${previous.opinion}
Vyjdi z něj a uprav ho jen tam, kde nové údaje (složení, nutriční hodnoty, název, značka) něco mění. Verdikt změň nejvýš o jeden stupeň a jen s důvodem opřeným o nové údaje; jinak ho ponech. Další vyhledávání jen pokud nové údaje otevřely něco, co ještě nebylo ověřeno; sources mohou být prázdné.`;
  }
  const { submitted, hits } = await runToolLoop({
    system: QUICK_SYSTEM,
    brief,
    tools: [webSearch(QUICK_MAX_SEARCHES), QUICK_TOOL as Anthropic.Beta.Messages.BetaTool],
    submitName: "submit_quick",
    schema: QuickSubmitted,
    effort: "low",
    maxTurns: 5,
    requireWeb: !previous,
  });
  const seen = new Set<string>();
  const sources: InsightSource[] = [];
  for (const src of submitted.sources) {
    const hit = hits.get(normalizeUrl(src.url));
    if (!hit || seen.has(normalizeUrl(hit.url))) continue;
    seen.add(normalizeUrl(hit.url));
    sources.push({ url: hit.url, title: src.title || hit.title });
  }
  // the model searched but cited nothing: show the top pages the search actually returned
  if (sources.length === 0 && !previous) for (const hit of [...hits.values()].slice(0, 2)) sources.push({ url: hit.url, title: hit.title });
  // a refinement keeps what the first opinion verified
  for (const src of previous?.sources ?? []) {
    if (!seen.has(normalizeUrl(src.url))) {
      seen.add(normalizeUrl(src.url));
      sources.push(src);
    }
  }
  let confidence = sources.length === 0 && submitted.confidence === "high" ? "medium" : submitted.confidence;
  if (previous && VERDICTS[previous.verdict] && ["high", "medium", "low"].indexOf(previous.confidence) < ["high", "medium", "low"].indexOf(confidence)) {
    confidence = previous.confidence;
  }
  const value = toValue(submitted.value, (u) => (u.trim() ? hits.get(normalizeUrl(u))?.url : undefined));
  if (value?.sourceUrl && !sources.some((x) => normalizeUrl(x.url) === normalizeUrl(value.sourceUrl!))) {
    const hit = hits.get(normalizeUrl(value.sourceUrl));
    sources.push({ url: value.sourceUrl, title: hit?.title ?? value.sourceUrl });
  }
  const verdict = previous ? stepTowards(previous.verdict, submitted.verdict) : submitted.verdict;
  return {
    verdict,
    headline: submitted.headline,
    opinion: submitted.opinion,
    confidence,
    sources,
    value: value ?? previous?.value,
    dtest: dtestRef(sources, { summary: submitted.opinion }) ?? previous?.dtest,
    refined: previous ? true : undefined,
    generatedAt: new Date().toISOString(),
  };
}

// ---- price / value ----

/**
 * The model's price judgement → what we show. "Overpriced" is a claim about a
 * brand, so it needs a price page the search really returned; without one it
 * is dropped. "ok" / "nevime" are kept as data but shown nowhere.
 */
export function toValue(
  v: z.infer<typeof ValueZ>,
  resolveUrl: (url: string) => string | undefined,
): ValueAssessment | undefined {
  const reason = v.reason.trim();
  const sourceUrl = resolveUrl(v.sourceUrl);
  if (v.verdict === "nevime") return undefined;
  if (v.verdict === "vyhozene_prachy" && (!sourceUrl || !reason)) return undefined;
  if (v.verdict === "vyhodne" && !reason) return undefined;
  return { verdict: v.verdict, reason, cheaperOption: blank(v.cheaperOption), sourceUrl };
}

/**
 * Overpriced ("vyhozený prachy"): the same quality is much cheaper, so the
 * product is at best "jsou lepší" and the reason goes first. Good value only
 * adds a reason. Returns the same object when nothing changes.
 */
export function applyValue(
  a: Assessment,
  value: ValueAssessment | undefined,
  confidence: "high" | "medium" | "low",
  tone: Tone = "humor",
): Assessment {
  if (!value || confidence === "low") return a;
  if (value.verdict === "vyhozene_prachy") {
    const t = valueText("vyhozene_prachy", tone);
    const reason: Reason = { kind: "negative", text: `💸 ${t.label}: ${value.reason}` };
    if (a.verdict === "nevime" || !isBetter(a.verdict, VALUE_CAP)) return { ...a, reasons: [reason, ...a.reasons] };
    return {
      ...a,
      verdict: VALUE_CAP,
      score: scoreForVerdict(a.score ?? VERDICTS[VALUE_CAP].maxScore ?? 70, VALUE_CAP),
      reasons: [reason, ...a.reasons],
      aiAdjusted: { from: a.aiAdjusted?.from ?? a.verdict, to: VALUE_CAP },
    };
  }
  if (value.verdict === "vyhodne") {
    const t = valueText("vyhodne", tone);
    return { ...a, reasons: [{ kind: "positive", text: `💰 ${t.label}: ${value.reason}` }, ...a.reasons] };
  }
  return a;
}
