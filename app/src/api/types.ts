// API contract shared between server and app.
// Keep in sync with app/src/api/types.ts.

/** Best → worst; see verdicts.ts for labels, colours and score bands. */
export type Verdict =
  | "poklad"
  | "urcite_kup"
  | "jsou_lepsi"
  | "kup_jestli_musis"
  | "radsi_ne"
  | "nekupuj"
  | "sracka"
  | "nevime";

/**
 * Price against what you get – separate from the quality verdict.
 * "vyhozene_prachy": you pay for the brand, packaging or marketing; the same
 * quality is much cheaper (bottled water is still H2O). "vyhodne": good value.
 */
export type ValueVerdict = "vyhozene_prachy" | "ok" | "vyhodne" | "nevime";

export interface ValueAssessment {
  verdict: ValueVerdict;
  /** 1–2 sentences: typical price vs. comparable products, what the extra money buys */
  reason: string;
  /** a cheaper option of the same quality, e.g. "Rajec 1,5 l za ~15 Kč" */
  cheaperOption?: string;
  /** page with the price the judgement rests on (from the web search) */
  sourceUrl?: string;
}

/** "humor" = vtipné názvy verdiktů (výchozí), "serious" = slušný režim */
export type Tone = "humor" | "serious";

/** 0 = bez obav, 1 = nízké, 2 = střední, 3 = vysoké */
export type Risk = 0 | 1 | 2 | 3;

export interface UserProfile {
  /** ISO 3166-1 alpha-2, lower-case, e.g. ["cz", "me"] */
  countries: string[];
  /** store slugs, e.g. ["lidl", "kaufland"] */
  stores: string[];
  /** OFF allergen tags without language prefix, e.g. ["gluten", "milk"] */
  allergens: string[];
  /** "vegan" | "vegetarian" | "gluten-free" | "lactose-free" | "low-sugar" */
  diets: string[];
  /** keys from unwanted.json the user wants to avoid, e.g. ["palm-oil", "sweeteners"] */
  avoid: string[];
  showSustainability: boolean;
  /** optional for backward compatibility with stored profiles; default "humor" */
  tone?: Tone;
}

export const EMPTY_PROFILE: UserProfile = {
  countries: ["cz"],
  stores: [],
  allergens: [],
  diets: [],
  avoid: [],
  showSustainability: true,
  tone: "humor",
};

export interface AdditiveInfo {
  code: string;
  name: string;
  category: string;
  risk: Risk;
  note: string;
  sources: string[];
}

export interface FlaggedIngredient {
  key: string;
  label: string;
  severity: 1 | 2 | 3;
  note: string;
  matchedText: string;
}

/** Health impact of an ingredient, written once and stored in server/data/health (no AI cost per tap). */
export interface HealthInfo {
  /** what excessive or long-term high intake does to the body */
  excess: string;
  /** how much it matters when eaten only once in a while */
  occasional: string;
  /** 0 = fine even regularly, 1 = fine occasionally, 2 = only exceptionally, 3 = better avoid */
  occasionalLevel: 0 | 1 | 2 | 3;
  /** ADI or official limit, "" when not established */
  limit: string;
  /** groups at higher risk, "" when none */
  groups: string;
  sources: string[];
}

/** One thing found in a tapped ingredient: an additive, an unwanted ingredient or a common ingredient. */
export interface IngredientInfo {
  kind: "additive" | "unwanted" | "ingredient";
  /** "E250", an unwanted key ("nitrites-nitrates") or an ingredient id ("sugar") */
  id: string;
  title: string;
  category: string;
  /** additive risk or unwanted severity; ingredients use health.occasionalLevel */
  risk?: Risk;
  /** short existing note (additives, unwanted) */
  note: string;
  matchedText?: string;
  /** absent when the health text has not been written yet */
  health?: HealthInfo;
  sources: string[];
}

export interface IngredientInfoResponse {
  query: string;
  matches: IngredientInfo[];
}

export interface ProductImage {
  url: string;
  /** "Přední strana", "Složení", "Nutriční hodnoty", "Obal" */
  label: string;
}

export interface NutritionPer100g {
  energyKcal?: number;
  fat?: number;
  saturatedFat?: number;
  carbs?: number;
  sugars?: number;
  fiber?: number;
  proteins?: number;
  salt?: number;
}

export type ProductSource = "off" | "obf" | "opf" | "photo" | "manual";

export interface ProductData {
  /** ean, or "photo:<hash>", or "manual:<slug>" */
  id: string;
  ean?: string;
  name: string;
  brand?: string;
  manufacturer?: string;
  category?: string;
  categoryTags?: string[];
  countries?: string[];
  quantity?: string;
  ingredientsText?: string;
  /** ingredient names in order, as parsed */
  ingredients?: string[];
  additives?: AdditiveInfo[];
  flagged?: FlaggedIngredient[];
  allergens?: string[];
  traces?: string[];
  nutrition?: NutritionPer100g;
  nutriScore?: "a" | "b" | "c" | "d" | "e";
  novaGroup?: 1 | 2 | 3 | 4;
  ecoScore?: string;
  labels?: string[];
  stores?: string[];
  imageUrl?: string;
  /** all package photos (front first); absent for photo/manual products */
  images?: ProductImage[];
  source: ProductSource;
  dataCompleteness: "full" | "partial" | "minimal";
  fetchedAt: string;
  /** the ingredient list on the label was only partly readable (covered by a price sticker etc.) */
  ingredientsPartial?: boolean;
  /** set when the ingredient list was found on the web by the AI insight, not on the label */
  compositionSource?: { url: string; title: string; market?: string };
}

export interface Reason {
  kind: "positive" | "negative" | "warning" | "neutral";
  text: string;
}

export interface ScoreBreakdown {
  composition?: number;
  manufacturer?: number;
  reviews?: number;
  sustainability?: number;
}

export interface Assessment {
  verdict: Verdict;
  /** 0–100, absent when verdict is "nevime" */
  score?: number;
  confidence: "high" | "medium" | "low";
  reasons: Reason[];
  breakdown: ScoreBreakdown;
  /** ids of hard rules that fired, e.g. "allergen:milk", "recall" */
  hardRules: string[];
  /** human-readable warnings derived from the user's profile */
  profileWarnings: string[];
  /** set when the AI insight moved the rule-based verdict */
  aiAdjusted?: { from: Verdict; to: Verdict };
  /** which humour labels fit the product ("alcohol": "Bolehlav" instead of "Nouzovka"); serious labels are shared */
  labelSet?: LabelSet;
}

export type LabelSet = "alcohol";

export type ManufacturerType =
  | "family"
  | "craft"
  | "regional"
  | "industrial"
  | "private-label"
  | "unknown";

export interface ManufacturerInfo {
  name: string;
  type: ManufacturerType;
  country?: string;
  owner?: string;
  summary: string;
  awards: string[];
  certifications: string[];
  /** false = orientační informace z modelu bez ověřených zdrojů */
  verified: boolean;
  sources: { title: string; url: string }[];
  updatedAt: string;
}

export interface Alternative {
  product: ProductData;
  assessment: Assessment;
  whyBetter: string;
}

export interface ProductResult {
  product: ProductData;
  assessment: Assessment;
  manufacturer?: ManufacturerInfo;
  alternatives?: Alternative[];
  timing: { ms: number; path: string };
  /** set when a supplementary photo was merged into a product already on screen */
  supplement?: {
    /** what the photo added, in Czech ("složení", "nutriční hodnoty"…); empty = nothing new */
    added: string[];
    /** id of the product it refines (history entry to replace) */
    replaces: string;
  };
}

export interface SearchCandidate {
  id: string;
  ean?: string;
  name: string;
  brand?: string;
  quantity?: string;
  imageUrl?: string;
  /** share of the query words found in name + brand (0–1); 1 = every word matched */
  match?: number;
}

// ---- AI insight (online research with web search) ----

/**
 * A dTest test page the web search returned for this product. dTest's terms
 * allow linking, not re-publishing results, so the app shows the title and
 * opens the page in the browser where the subscriber is logged in.
 */
export interface DtestRef {
  /** the test page, dTest press release or a media report about the test */
  url: string;
  title: string;
  /** year of the test when the public text says it */
  year?: string;
  /** publicly reported findings of the test (press release, media), never the paywalled ratings */
  summary?: string;
  /** the scanned product itself was named in the public text */
  productNamed?: boolean;
}

export interface InsightSource {
  title: string;
  url: string;
}

export interface InsightEvent {
  /** e.g. "2007", "2019–2021"; absent when unknown */
  year?: string;
  text: string;
  impact: "positive" | "negative" | "neutral";
  /** one of insight.sources; absent = the model's general knowledge */
  sourceUrl?: string;
}

export interface Insight {
  /** the AI's own verdict on the same scale */
  verdict: Verdict;
  /** one punchy line in the user's tone */
  headline: string;
  /** 2–4 sentences, a clear opinion */
  opinion: string;
  manufacturer: ManufacturerInfo;
  /** ownership changes, acquisitions, plant moves, brand history */
  history: InsightEvent[];
  recipeChange: { changed: "yes" | "no" | "unknown"; summary?: string; sourceUrl?: string };
  awards: InsightEvent[];
  /** recalls, Potraviny na pranýři, scandals – always sourced */
  issues: InsightEvent[];
  /** consumer tests (dTest, Warentest…) and reviews */
  reviews?: { summary: string; sourceUrl?: string };
  sources: InsightSource[];
  confidence: "high" | "medium" | "low";
  /** ingredient list + nutrition found online when the label/database had none */
  foundComposition?: InsightComposition;
  /** concrete better products sold in the user's countries (may be absent in older cached insights) */
  alternatives?: InsightAlternative[];
  /** how the alternatives were looked up (photos, links); older cached insights get re-enriched */
  enrichVersion?: number;
  /** AI suggestions dropped because they were not better than the product */
  alternativesDropped?: number;
  /** dTest test page found by the research (link only, see DtestRef) */
  dtest?: DtestRef;
  /** price vs. value, when the research found prices */
  value?: ValueAssessment;
  /** false when web search was unavailable and only model knowledge was used */
  webResearch: boolean;
  model: string;
  tone: Tone;
  generatedAt: string;
}

export interface InsightComposition {
  ingredientsText: string;
  nutrition?: NutritionPer100g;
  /** country/market the recipe applies to, e.g. "USA", "EU (Německo)" */
  market?: string;
  sourceUrl: string;
  sourceTitle: string;
}

export interface InsightAlternative {
  name: string;
  brand?: string;
  whyBetter: string;
  /** e.g. "Lidl, Kaufland", "řeznictví", "Rohlik.cz" */
  whereToBuy?: string;
  sourceUrl?: string;
  /** verdict of the alternative: from our rules when it was found in the product database, else the AI's estimate */
  verdict?: Verdict;
  score?: number;
  verdictSource?: "rules" | "ai";
  /** set when matched in the product database – the app can open the full result */
  ean?: string;
  /** package photo (product database or the retailer page) */
  imageUrl?: string;
  /** more package photos from the product database (front, ingredients, nutrition, packaging) */
  images?: ProductImage[];
}

/** Fast first opinion (no web research), shown while the deep insight runs. */
export interface QuickInsight {
  verdict: Verdict;
  headline: string;
  opinion: string;
  confidence: "high" | "medium" | "low";
  /** pages the quick web search actually returned */
  sources: InsightSource[];
  /** price vs. value, when the search found prices */
  value?: ValueAssessment;
  /** built on an earlier opinion after a supplementary photo (not a fresh start) */
  refined?: boolean;
  /** dTest test page found by the search (link only, see DtestRef) */
  dtest?: DtestRef;
  generatedAt: string;
}

export interface QuickInsightResponse {
  quick: QuickInsight;
  /** present only when the quick verdict replaced a rule verdict of "nevime" */
  assessment?: Assessment;
  cached: boolean;
  ms: number;
}

export interface InsightRequest {
  product: ProductData;
  assessment: Assessment;
  profile?: UserProfile;
  /** after a supplementary photo: refine this opinion instead of starting over */
  previousQuick?: QuickInsight;
  /** after a supplementary photo: reuse this research for the refined product (no new research) */
  previousInsight?: Insight;
}

export interface InsightResponse {
  insight: Insight;
  /** rule assessment combined with the insight */
  assessment: Assessment;
  /** present when the insight added data to the product (composition found online) */
  product?: ProductData;
  cached: boolean;
  ms: number;
}

// ---- Request bodies ----

export interface EanLookupRequest {
  ean: string;
  profile?: UserProfile;
}

export interface PhotoLookupRequest {
  /** base64 without data: prefix */
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  profile?: UserProfile;
  /** optional hint typed by the user */
  hint?: string;
  /** the product already on screen: the photo adds to it (back label, ingredients, front with the name…) */
  base?: ProductData;
}

export interface ManualLookupRequest {
  name: string;
  brand?: string;
  /** e.g. "řeznictví, uzená krkovice" */
  description?: string;
  profile?: UserProfile;
}

export interface SearchRequest {
  q: string;
  countries?: string[];
}

export interface ManufacturerRequest {
  name: string;
  brand?: string;
  country?: string;
}

export interface AlternativesRequest {
  productId: string;
  categoryTags: string[];
  countries: string[];
  stores: string[];
  profile?: UserProfile;
  /** score of the original product, used to filter "better" */
  minScore?: number;
}

// ---- comparison of 2–4 products (basket) ----

export interface CompareItem {
  product: ProductData;
  /** the assessment shown for the product (AI-adjusted when an opinion exists) */
  assessment: Assessment;
}

export interface CompareRankEntry {
  /** index into CompareRequest.items */
  index: number;
  /** 1 = best */
  place: number;
  verdict: Verdict;
  pros: string[];
  cons: string[];
  /** one sentence: why this place */
  note: string;
}

export interface CompareResult {
  /** yes = same kind of product; partly = related, ranking only indicative; no = different kinds, nothing ranked */
  comparable: "yes" | "partly" | "no";
  headline: string;
  summary: string;
  /** best first; empty when not comparable */
  ranking: CompareRankEntry[];
  winnerIndex?: number;
  sources: InsightSource[];
  /** quick = rules + short web check; deep = built on every product's full research */
  mode: "quick" | "deep";
  confidence: "high" | "medium" | "low";
  generatedAt: string;
}

export interface CompareRequest {
  items: CompareItem[];
  profile?: UserProfile;
}

export interface CompareResponse {
  result: CompareResult;
  cached: boolean;
  ms: number;
}

// ---- targeted alternatives research in one country ----

export interface AlternativesResearchRequest {
  product: ProductData;
  assessment: Assessment;
  /** ISO 3166-1 alpha-2, e.g. "cz" */
  country: string;
  profile?: UserProfile;
}

export interface AlternativesResearchResponse {
  country: string;
  /** the exact kind of product the alternatives were matched against */
  productType: string;
  alternatives: InsightAlternative[];
  /** suggestions dropped because they were not better than the product */
  droppedWorse?: number;
  sources: InsightSource[];
  confidence: "high" | "medium" | "low";
  generatedAt: string;
  cached: boolean;
  ms: number;
}
