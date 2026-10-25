import { looksCzech } from "./lang.js";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { createHash } from "node:crypto";
import type {
  Assessment,
  ManufacturerInfo,
  ManufacturerType,
  NutritionPer100g,
  ProductData,
  ProductResult,
  Reason,
  Tone,
  UserProfile,
} from "./types.js";
import { referenceData } from "./data.js";
import { splitIngredients } from "./ingredients.js";
import { assess, scoreForVerdict } from "./scoring.js";
import { VERDICTS, VERDICT_SCALE } from "./verdicts.js";

/**
 * Everything that talks to Claude lives here: reading a label photo,
 * assessing a product typed by hand, and the orientational manufacturer card.
 * The API key never leaves the server.
 */

/** pinned so an inherited ANTHROPIC_BASE_URL cannot redirect the key; override only via KUPNEKUP_API_BASE_URL */
export const API_BASE_URL = process.env.KUPNEKUP_API_BASE_URL?.trim() || "https://api.anthropic.com";

export const MODEL = process.env.CLAUDE_MODEL?.trim() || "claude-opus-5-5";

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY není nastaven. Vytvořte server/.env podle .env.example.");
    this.name = "ClaudeNotConfiguredError";
  }
}

export class ClaudeRefusedError extends Error {
  constructor() {
    super("Model odmítl požadavek zpracovat.");
    this.name = "ClaudeRefusedError";
  }
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new ClaudeNotConfiguredError();
  }
  if (!client) client = new Anthropic({ baseURL: API_BASE_URL, timeout: 45_000, maxRetries: 1 });
  return client;
}

export function isConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Format check only (never logs the value). Console keys start with
 * "sk-ant-" – "sk-ant-api03-…" (classic) or "sk-ant-usr…" (user-linked,
 * verified working 2026-10-23) – and contain only letters, digits, "-", "_".
 * Admin keys and OAuth tokens cannot call the model with x-api-key.
 */
export function keyFormatProblem(): string | undefined {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return process.env.ANTHROPIC_AUTH_TOKEN ? undefined : "klíč chybí";
  if (!key.startsWith("sk-ant-")) return "to není klíč z Claude Console (musí začínat sk-ant-)";
  const tag = /^sk-ant-([a-z]+)/.exec(key)?.[1] ?? "";
  if (["admin", "oat", "ort", "sid"].includes(tag)) return `sk-ant-${tag}… není API klíč pro dotazy na model – vytvořte klíč v Keys & access → Create key`;
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return "klíč obsahuje nepovolené znaky (mezera, tečka, uvozovky?) – zkopírujte ho znovu celý";
  return undefined;
}

export const INVALID_KEY_MESSAGE =
  "Claude odmítl API klíč. Zkontrolujte server/.env: vložte celý klíč z Claude Console (Keys & access → Create key), bez mezer a uvozovek.";

const COMMON_RULES = `Odpovídej pouze strukturovaně podle schématu. Nikdy si nevymýšlej: když něco nevidíš nebo nevíš, dej null, prázdné pole nebo "unknown".
Neuváděj žádné kauzy, skandály, pokuty ani jiná negativní tvrzení o konkrétních firmách – ta se doplní později jen s ověřenými zdroji.
Texty pro uživatele piš česky, stručně, bez vykřičníků a bez marketingových frází.`;

// ---- shared: verdict scale and tone (used by photo, manual entry and insight) ----

export const VerdictSchema = z.enum(["poklad", "urcite_kup", "jsou_lepsi", "kup_jestli_musis", "radsi_ne", "nekupuj", "sracka", "nevime"]);

/** The verdict scale explained for the model (score bands come from verdicts.ts). */
export const SCALE_TEXT = `Hodnoticí škála (od nejlepšího):
${VERDICT_SCALE.slice()
  .reverse()
  .map((v) => `- "${v}" (${VERDICTS[v].minScore}–${VERDICTS[v].maxScore} bodů): ${VERDICTS[v].serious.label} – ${VERDICTS[v].serious.subtitle}`)
  .join("\n")}
- "nevime": nedokážeš posoudit.
"poklad" jen pro skutečně výjimečné produkty bez výhrad; "sracka" jen pro to nejhorší (náhražky, separát, hromada rizikových aditiv, podvod se složením).`;

/** Tone instruction for user-facing texts. Facts stay factual in both tones. */
export function toneInstruction(tone: Tone | undefined): string {
  return tone === "serious"
    ? "Piš věcně a slušně."
    : [
        "Piš jako kámoš z hospody, který se v jídle fakt vyzná: s nadsázkou, ostře a klidně sprostě (sračka, hnus, šmejd, prasárna, šizené jak prase, nežral by to ani pes), aby pointa byla jasná na první přečtení.",
        "Titulek je jedna úderná věta s pointou; názor začni tím nejdůležitějším (kup / nekupuj a proč).",
        "Dobrý produkt pochval stejně barvitě, jak špatný strháš.",
        "Sprostota míří na produkt a jeho složení, nikdy na lidi, kteří ho kupují, ani na konkrétní osoby.",
        "Fakta musí sedět: o výrobci piš jen ověřené věci a nic si nevymýšlej.",
      ].join(" ");
}

// ---------------------------------------------------------------------------
// 1) Label photo → structured product data
// ---------------------------------------------------------------------------

const NutritionSchema = z.object({
  energyKcal: z.number().nullable(),
  fat: z.number().nullable(),
  saturatedFat: z.number().nullable(),
  carbs: z.number().nullable(),
  sugars: z.number().nullable(),
  fiber: z.number().nullable(),
  proteins: z.number().nullable(),
  salt: z.number().nullable(),
});

export const PhotoExtraction = z.object({
  isProductLabel: z.boolean().describe("true pokud je na fotce produkt, jeho obal nebo etiketa"),
  // Text fields use "" for "unknown" instead of null: the API allows at most
  // 16 nullable/union parameters per schema (nutrition already needs 8).
  barcode: z.string().describe("číslice EAN/UPC, pouze pokud jsou celé a jistě čitelné, jinak prázdný řetězec"),
  name: z.string().describe("název produktu tak, jak je na obalu; prázdný řetězec, pokud není vidět"),
  brand: z.string().describe("značka; prázdný řetězec, pokud není vidět"),
  manufacturer: z.string().describe("firma uvedená jako výrobce nebo balírna, např. za 'Vyrábí:' / 'Proizvođač:' / 'Hersteller:'; prázdný řetězec, pokud není vidět"),
  category: z.string().describe("krátká kategorie česky, např. 'trvanlivý salám', 'sušenky', 'prací gel'; prázdný řetězec, pokud nevíš"),
  countryOfOrigin: z.string().describe("země původu nebo výroby, česky; prázdný řetězec, pokud není uvedena"),
  quantity: z.string().describe("hmotnost nebo objem, např. '250 g'; prázdný řetězec, pokud není vidět"),
  ingredientsText: z
    .string()
    .describe("složení přesně tak, jak je vytištěno, v původním jazyce. Když je část zakrytá (cenovka, přehyb, odlesk), opiš všechno čitelné a zakrytá místa označ '…'. Prázdný řetězec jen tehdy, když složení není vidět vůbec."),
  ingredientsTextCs: z.string().describe("stejné (i neúplné) složení přeložené do češtiny; prázdný řetězec, pokud je originál česky nebo složení chybí"),
  ingredientsPartial: z.boolean().describe("true, když je složení na fotce jen částečně čitelné nebo zakryté"),
  allergensDeclared: z
    .array(z.string())
    .describe("zvýrazněné nebo deklarované alergeny jako anglické tagy: gluten, milk, eggs, nuts, peanuts, soybeans, fish, crustaceans, molluscs, celery, mustard, sesame-seeds, sulphur-dioxide-and-sulphites, lupin"),
  nutritionPer100g: NutritionSchema,
  labels: z.array(z.string()).describe("viditelné certifikace a značky: organic, fairtrade, klasa, regionalni-potravina, gluten-free, vegan, msc, rainforest-alliance, bez-konzervantu apod., malými písmeny"),
  readability: z.enum(["good", "partial", "poor"]).describe("jak dobře je etiketa čitelná"),
  notes: z.string().describe("jedna věta česky, co je na fotce důležité nebo co chybí; může být prázdný řetězec"),
});
export type PhotoExtractionT = z.infer<typeof PhotoExtraction>;

const PHOTO_SYSTEM = `Jsi přesná čtečka etiket potravin a drogerie pro spotřebitelskou aplikaci. Čteš česky, slovensky, srbsky a černohorsky (latinka i cyrilice), chorvatsky, bosensky, slovinsky, makedonsky, albánsky, německy, anglicky, polsky, maďarsky a italsky.
Přepiš složení doslova, včetně E-čísel a procent. I neúplné nebo částečně zakryté složení je cenné – opiš každou čitelnou část a zakrytá místa označ „…“. Nutriční tabulku přečti vždy, když je vidět. Alergeny, které jsou na etiketě zvýrazněny (tučně, velkými písmeny), uveď v allergensDeclared.
${COMMON_RULES}`;

export async function extractFromPhoto(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  hint?: string,
  tone?: Tone,
): Promise<PhotoExtractionT> {
  const c = getClient();
  const res = await c.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: [{ type: "text", text: PHOTO_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          {
            type: "text",
            text:
              "Přečti tuto etiketu a vyplň schéma." + (hint ? ` Nápověda od uživatele: ${hint}` : ""),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(PhotoExtraction), effort: "low" },
  });
  if (res.stop_reason === "refusal") throw new ClaudeRefusedError();
  if (!res.parsed_output) throw new Error("Model nevrátil strukturovaná data.");
  return res.parsed_output;
}

/** "" (the schema's "unknown") → undefined */
function text(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export function productFromPhoto(x: PhotoExtractionT, imageBase64: string): ProductData {
  const ref = referenceData();
  const hash = createHash("sha1").update(imageBase64).digest("hex").slice(0, 12);
  const original = x.ingredientsText?.trim() || undefined;
  const czech = x.ingredientsTextCs?.trim() || undefined;
  const display = czech ?? original;
  const forMatching = [original, czech].filter(Boolean).join(" | ");

  const additives = forMatching ? ref.additivesInText(forMatching) : [];
  const flagged = forMatching
    ? ref.unwantedInText(forMatching).map(({ record, matchedText }) => ({
        key: record.key,
        label: record.label,
        severity: record.severity,
        note: record.note,
        matchedText,
      }))
    : [];
  const allergens = new Set(x.allergensDeclared.map((a) => a.toLowerCase().trim()));
  if (forMatching) for (const t of ref.allergensInText(forMatching)) allergens.add(t);

  const nut = x.nutritionPer100g;
  const nutrition = {
    energyKcal: nut.energyKcal ?? undefined,
    fat: nut.fat ?? undefined,
    saturatedFat: nut.saturatedFat ?? undefined,
    carbs: nut.carbs ?? undefined,
    sugars: nut.sugars ?? undefined,
    fiber: nut.fiber ?? undefined,
    proteins: nut.proteins ?? undefined,
    salt: nut.salt ?? undefined,
  };
  const hasNutrition = Object.values(nutrition).some((v) => v !== undefined);

  return {
    id: `photo:${hash}`,
    ean: text(x.barcode),
    name: text(x.name) ?? "Produkt z fotky",
    brand: text(x.brand),
    manufacturer: text(x.manufacturer) ?? text(x.brand),
    category: text(x.category),
    categoryTags: [],
    countries: text(x.countryOfOrigin) ? [text(x.countryOfOrigin)!] : [],
    quantity: text(x.quantity),
    ingredientsText: display,
    ingredients: display ? splitIngredients(display) : [],
    additives: additives.map((a) => ({ code: a.code, name: a.name, category: a.category, risk: a.risk, note: a.note, sources: a.sources })),
    flagged,
    allergens: [...allergens],
    traces: [],
    nutrition: hasNutrition ? nutrition : undefined,
    labels: x.labels.map((l) => l.toLowerCase()),
    source: "photo",
    dataCompleteness: display && hasNutrition && !x.ingredientsPartial ? "full" : display || hasNutrition ? "partial" : "minimal",
    ingredientsPartial: display ? x.ingredientsPartial : undefined,
    fetchedAt: new Date().toISOString(),
  };
}

/** Fill gaps of an Open Food Facts product with what the photo showed. */
export function mergePhotoIntoProduct(base: ProductData, photo: ProductData): ProductData {
  const merged: ProductData = { ...base };
  // the label photo was read in Czech, the database only has a foreign list: show the label
  const czechLabelWins =
    !!merged.ingredientsText &&
    !looksCzech(merged.ingredientsText) &&
    !!photo.ingredientsText &&
    !photo.ingredientsPartial &&
    looksCzech(photo.ingredientsText);
  if ((!merged.ingredientsText || czechLabelWins) && photo.ingredientsText) {
    merged.ingredientsText = photo.ingredientsText;
    merged.ingredients = photo.ingredients;
    merged.additives = photo.additives;
    merged.flagged = photo.flagged;
    if (!merged.allergens?.length) merged.allergens = photo.allergens;
  }
  if (!merged.nutrition && photo.nutrition) merged.nutrition = photo.nutrition;
  if (!merged.manufacturer && photo.manufacturer) merged.manufacturer = photo.manufacturer;
  if (!merged.brand && photo.brand) merged.brand = photo.brand;
  if (merged.name === "(bez názvu)" && photo.name) merged.name = photo.name;
  merged.dataCompleteness =
    merged.ingredientsText && merged.nutrition ? "full" : merged.ingredientsText || merged.nutrition ? "partial" : "minimal";
  return merged;
}

// ---------------------------------------------------------------------------
// 2) Manual entry (name + brand, e.g. at a butcher) → assessment
// ---------------------------------------------------------------------------

const ManufacturerTypeSchema = z.enum(["family", "craft", "regional", "industrial", "private-label", "unknown"]);

export const ManualAssessment = z.object({
  knownProduct: z.boolean().describe("true pokud produkt nebo značku skutečně znáš"),
  category: z.string().nullable().describe("kategorie česky"),
  manufacturer: z.object({
    name: z.string().nullable(),
    type: ManufacturerTypeSchema,
    country: z.string().nullable(),
    owner: z.string().nullable().describe("vlastník nebo mateřská skupina, jen pokud je to obecně známé"),
    summary: z.string().describe("1–2 věty česky, jen obecně známá fakta; prázdný řetězec pokud nic nevíš"),
  }),
  typicalComposition: z.string().describe("1–2 věty česky, co takový produkt obvykle obsahuje a na co si dát pozor"),
  concerns: z.array(z.string()).describe("konkrétní výhrady česky, každá jedna věta"),
  positives: z.array(z.string()).describe("konkrétní plusy česky, každý jedna věta"),
  verdict: VerdictSchema,
  score: z.number().nullable().describe("0–100 v pásmu zvoleného verdiktu, null pokud nevime"),
  confidence: z.enum(["high", "medium", "low"]),
  explanation: z.string().describe("2–3 věty česky pro nakupujícího"),
  alternativesHint: z.array(z.string()).describe("0–3 konkrétní lepší volby česky, včetně toho, na co se v obchodě zeptat"),
});
export type ManualAssessmentT = z.infer<typeof ManualAssessment>;

const MANUAL_SYSTEM = `Jsi zkušený a přímočarý poradce pro nákup potravin v Česku, Černé Hoře a na Balkáně. Uživatel ti napíše název produktu a výrobce (často u pultu v řeznictví nebo pekařství, kde není čárový kód). Posuď, jak kvalitní takový produkt bývá, co typicky obsahuje a zda ho koupit. Měj jasný názor, nemlž.
${SCALE_TEXT}
Když produkt neznáš, posuď alespoň kategorii (např. "uzená krkovice z řeznictví") a dej confidence "low".
${COMMON_RULES}`;

export async function assessManual(
  name: string,
  brand: string | undefined,
  description: string | undefined,
  profile: UserProfile,
): Promise<ProductResult> {
  const c = getClient();
  const started = Date.now();
  const userText = [
    `Produkt: ${name}`,
    brand ? `Výrobce/značka: ${brand}` : undefined,
    description ? `Poznámka: ${description}` : undefined,
    profile.countries.length ? `Země nákupu: ${profile.countries.join(", ")}` : undefined,
    profile.allergens.length ? `Alergie uživatele: ${profile.allergens.join(", ")}` : undefined,
    profile.diets.length ? `Dieta: ${profile.diets.join(", ")}` : undefined,
    profile.avoid.length ? `Chce se vyhnout: ${profile.avoid.join(", ")}` : undefined,
    `Tón textů: ${toneInstruction(profile.tone)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await c.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: [{ type: "text", text: MANUAL_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
    output_config: { format: zodOutputFormat(ManualAssessment), effort: "medium" },
  });
  if (res.stop_reason === "refusal") throw new ClaudeRefusedError();
  const x = res.parsed_output;
  if (!x) throw new Error("Model nevrátil strukturovaná data.");

  const slug = `${name} ${brand ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const product: ProductData = {
    id: `manual:${slug}`,
    name,
    brand: brand || x.manufacturer.name || undefined,
    manufacturer: x.manufacturer.name || brand || undefined,
    category: x.category ?? undefined,
    categoryTags: [],
    countries: x.manufacturer.country ? [x.manufacturer.country] : [],
    ingredientsText: undefined,
    ingredients: [],
    additives: [],
    flagged: [],
    allergens: [],
    traces: [],
    labels: [],
    source: "manual",
    dataCompleteness: "minimal",
    fetchedAt: new Date().toISOString(),
  };

  const reasons: Reason[] = [
    { kind: "neutral", text: x.explanation },
    ...x.concerns.map((t): Reason => ({ kind: "negative", text: t })),
    ...x.positives.map((t): Reason => ({ kind: "positive", text: t })),
  ];
  if (x.typicalComposition) reasons.push({ kind: "neutral", text: x.typicalComposition });
  if (x.alternativesHint.length) reasons.push({ kind: "neutral", text: `Lepší volba: ${x.alternativesHint.join("; ")}` });

  const profileWarnings: string[] = [];
  if (profile.allergens.length || profile.diets.length) {
    profileWarnings.push("Složení neznáme – alergeny a vhodnost pro vaši dietu ověřte na místě.");
  }

  const confidence: Assessment["confidence"] = x.confidence === "high" ? "medium" : x.confidence;
  const assessment: Assessment = {
    verdict: x.verdict,
    score:
      x.verdict === "nevime"
        ? undefined
        : scoreForVerdict(x.score ?? Math.round(((VERDICTS[x.verdict].minScore ?? 0) + (VERDICTS[x.verdict].maxScore ?? 100)) / 2), x.verdict),
    confidence,
    reasons: reasons.slice(0, 8),
    breakdown: {},
    hardRules: [],
    profileWarnings,
  };

  const manufacturer: ManufacturerInfo | undefined = x.manufacturer.name
    ? {
        name: x.manufacturer.name,
        type: x.manufacturer.type,
        country: x.manufacturer.country ?? undefined,
        owner: x.manufacturer.owner ?? undefined,
        summary: x.manufacturer.summary,
        awards: [],
        certifications: [],
        verified: false,
        sources: [],
        updatedAt: new Date().toISOString(),
      }
    : undefined;

  return { product, assessment, manufacturer, timing: { ms: Date.now() - started, path: "manual" } };
}

// ---------------------------------------------------------------------------
// 3) Manufacturer card (model knowledge only, marked unverified)
// ---------------------------------------------------------------------------

export const ManufacturerSchema = z.object({
  known: z.boolean().describe("true pokud firmu skutečně znáš; jinak false a vše ostatní prázdné/unknown"),
  name: z.string(),
  type: ManufacturerTypeSchema,
  country: z.string().nullable(),
  owner: z.string().nullable().describe("vlastník nebo mateřská skupina, jen pokud je to obecně známé"),
  summary: z.string().describe("2–3 věty česky, jen obecně známá fakta: co firma vyrábí, odkud je, velikost, historie"),
  awards: z.array(z.string()).describe("obecně známá ocenění kvality, pokud nějaká"),
  certifications: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
});

const MANUFACTURER_SYSTEM = `Jsi encyklopedický asistent pro potravinářské a drogistické výrobce v Evropě. Uživatel pošle název výrobce nebo značky a případně zemi. Vrať jen to, co o firmě obecně víš: typ firmy (rodinná, řemeslná, regionální, průmyslová, privátní značka řetězce), zemi, vlastníka, krátké shrnutí, ocenění.
Typy: "family" rodinná firma, "craft" malá řemeslná výroba, "regional" střední regionální výrobce, "industrial" velký průmyslový zpracovatel nebo nadnárodní koncern, "private-label" privátní značka obchodního řetězce, "unknown" nevíš.
${COMMON_RULES}`;

export async function manufacturerInfo(name: string, brand?: string, country?: string): Promise<ManufacturerInfo> {
  const c = getClient();
  const res = await c.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: "text", text: MANUFACTURER_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [`Výrobce: ${name}`, brand && brand !== name ? `Značka: ${brand}` : undefined, country ? `Země: ${country}` : undefined]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(ManufacturerSchema), effort: "low" },
  });
  if (res.stop_reason === "refusal") throw new ClaudeRefusedError();
  const x = res.parsed_output;
  if (!x) throw new Error("Model nevrátil strukturovaná data.");
  const type: ManufacturerType = x.known ? x.type : "unknown";
  return {
    name: x.name || name,
    type,
    country: x.country ?? undefined,
    owner: x.owner ?? undefined,
    summary: x.known ? x.summary : "Tohoto výrobce zatím neznáme. Ověřené informace doplníme ve fázi 2.",
    awards: x.awards,
    certifications: x.certifications,
    verified: false,
    sources: [],
    updatedAt: new Date().toISOString(),
  };
}

export { assess };

const UNKNOWN_NAMES = new Set(["Neznámý produkt", "(bez názvu)", "Produkt z fotky", "Nerozpoznáno"]);

function definedOnly<T extends object>(o: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * A supplementary photo of a product already on screen (back label after a
 * barcode nobody knew, the front after the ingredients…). Everything the
 * product lacked is taken from the photo, nothing it already knew is lost.
 * The id changes, so the AI opinions are worked out again for the richer data.
 */
export function supplementProduct(base: ProductData, photo: ProductData): ProductData {
  const merged = mergePhotoIntoProduct(base, photo);
  if (UNKNOWN_NAMES.has(base.name) && photo.name && !UNKNOWN_NAMES.has(photo.name)) merged.name = photo.name;
  // a fully readable list beats a partly covered one
  if (base.ingredientsPartial && photo.ingredientsText && !photo.ingredientsPartial) {
    merged.ingredientsText = photo.ingredientsText;
    merged.ingredients = photo.ingredients;
    merged.additives = photo.additives;
    merged.flagged = photo.flagged;
    merged.ingredientsPartial = false;
  }
  merged.ean = base.ean ?? photo.ean;
  merged.brand = merged.brand ?? photo.brand;
  merged.manufacturer = merged.manufacturer ?? photo.manufacturer;
  merged.quantity = merged.quantity ?? photo.quantity;
  merged.category = merged.category ?? photo.category;
  if (!merged.countries?.length) merged.countries = photo.countries;
  merged.labels = [...new Set([...(base.labels ?? []), ...(photo.labels ?? [])])];
  merged.allergens = [...new Set([...(merged.allergens ?? []), ...(photo.allergens ?? [])])];
  if (base.nutrition || photo.nutrition) merged.nutrition = { ...definedOnly(photo.nutrition), ...definedOnly(base.nutrition) };
  if (base.dataCompleteness === "minimal" && base.source !== "photo") merged.source = "photo";
  merged.dataCompleteness =
    merged.ingredientsText && merged.nutrition && !merged.ingredientsPartial ? "full" : merged.ingredientsText || merged.nutrition ? "partial" : "minimal";
  // the photo showed the same barcode the product already has: keep its id (and its cached opinions)
  const suffix = photo.id.replace(/^photo:/, "");
  const root = base.id.split("+")[0]!;
  merged.id = suffix === root || suffix === base.ean ? base.id : `${root}+${suffix}`;
  merged.fetchedAt = new Date().toISOString();
  return merged;
}

/** Czech list of what a supplementary photo added to the product ("složení", "nutriční hodnoty"…). */
export function supplementAdded(base: ProductData, merged: ProductData): string[] {
  const added: string[] = [];
  if (UNKNOWN_NAMES.has(base.name) && !UNKNOWN_NAMES.has(merged.name)) added.push("název");
  if (!base.brand && merged.brand) added.push("značka");
  if (!base.ingredientsText?.trim() && merged.ingredientsText?.trim()) added.push("složení");
  else if (base.ingredientsPartial && merged.ingredientsText && !merged.ingredientsPartial) added.push("úplné složení");
  const nutritionKeys = (n: NutritionPer100g | undefined) => Object.entries(n ?? {}).filter(([, v]) => v !== undefined).length;
  if (nutritionKeys(merged.nutrition) > nutritionKeys(base.nutrition)) added.push("nutriční hodnoty");
  if ((merged.allergens?.length ?? 0) > (base.allergens?.length ?? 0)) added.push("alergeny");
  if (!base.quantity && merged.quantity) added.push("množství");
  if ((merged.labels?.length ?? 0) > (base.labels?.length ?? 0)) added.push("značky kvality");
  return added;
}
