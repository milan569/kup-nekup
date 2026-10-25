import type {
  Assessment,
  ProductData,
  Reason,
  ScoreBreakdown,
  UserProfile,
  Verdict,
} from "./types.js";
import { EMPTY_PROFILE } from "./types.js";
import { referenceData } from "./data.js";
import { VERDICTS, isBetter, verdictFromScore } from "./verdicts.js";
import { QUALITY_FIRST, categoryRules, detectCategory, nutriScoreInherentlyLow, qualityTreasure, topLevelItems } from "./category.js";

export { verdictFromScore };

/**
 * Deterministic scoring engine. No network, no model – runs in microseconds
 * so the verdict can be shown before anything else loads.
 *
 * Target weights (ZADANI.md §5): composition 40 %, manufacturer 25 %,
 * reviews 20 %, sustainability 15 %. In phase 0 the manufacturer score is only
 * a heuristic and reviews do not exist yet, so composition carries the verdict.
 * Raise the manufacturer weight once it is backed by verified sources.
 */

const WEIGHTS = { composition: 0.75, manufacturer: 0.1, sustainability: 0.15 };

/** the worse of two caps wins */
function tighten(current: Verdict | undefined, next: Verdict): Verdict {
  if (!current) return next;
  return isBetter(current, next) ? next : current;
}

const PRIVATE_LABELS = [
  "pilos", "milbona", "freshona", "dulano", "solevita", "cien", "crivit", "lidl", "chef select", "vemondo", "favorina", "alesto", "bellarom", "tastino", "baresa", "w5",
  "k-classic", "k classic", "kaufland", "k-bio", "k-take it veggie", "k-favourites", "k-free",
  "albert", "nature's promise", "natures promise", "albert quality", "albert excellent",
  "clever", "billa", "ja! natürlich", "billa bio", "spar", "s-budget", "s budget", "spar natur pur",
  "tesco", "tesco finest", "tesco value", "f&f",
  "penny", "boni", "karlova koruna", "řezníkův talíř", "reznikuv talir", "penny bio",
  "globus", "korrekt",
  "voli", "idea", "mega market", "hdl", "aroma",
  "maxi", "k plus", "premia",
  "konzum", "k plus", "plodine", "spar vital", "despar",
  "ja!", "gut & günstig", "gut und günstig", "edeka", "rewe", "rewe beste wahl", "aldi", "hofer", "milsani", "zurück zum ursprung", "bio bio",
];

const SUGAR_WORDS = /^(cukr|sugar|zucker|šećer|secer|šecer|sećer|шећер|cukier|zucchero|sucre|azúcar|cukor|třtinov[ýá] cukr|glukózov[ýá] sirup|glucose syrup|glukózo-fruktózov[ýá] sirup)/iu;

export interface ScoreOptions {
  /** overrides the heuristic manufacturer score (0–100) */
  manufacturerScore?: number;
  /** overrides confidence */
  confidence?: Assessment["confidence"];
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Czech plural: 1 přísada, 2–4 přísady, 5+ přísad */
export function ingredientsWord(n: number): string {
  if (n === 1) return "přísada";
  if (n >= 2 && n <= 4) return "přísady";
  return "přísad";
}

function joinCodes(codes: string[], max = 4): string {
  const shown = codes.slice(0, max).join(", ");
  return codes.length > max ? `${shown} a další` : shown;
}

export function isPrivateLabel(brand?: string, manufacturer?: string): boolean {
  const b = (brand ?? "").toLowerCase().trim();
  const m = (manufacturer ?? "").toLowerCase().trim();
  return PRIVATE_LABELS.some((pl) => b === pl || m === pl || b.startsWith(pl + " ") || m.startsWith(pl + " "));
}

function hasIngredientInfo(p: ProductData): boolean {
  return !!(p.ingredientsText && p.ingredientsText.trim().length > 0) || (p.ingredients?.length ?? 0) > 0;
}

function hasAnyData(p: ProductData): boolean {
  return hasIngredientInfo(p) || !!p.nutrition || !!p.nutriScore || !!p.novaGroup || (p.additives?.length ?? 0) > 0;
}

/**
 * Number of ingredients including those nested in compound ingredients
 * ("sirup KOFO® (cukr, voda, barvivo E150d, …)" counts every item inside).
 */
export function ingredientCount(p: ProductData): number {
  const text = p.ingredientsText?.trim();
  if (!text) return p.ingredients?.length ?? 0;
  const items = text
    .replace(/\.\s*$/, "")
    .split(/[,;()[\]]/)
    .map((s) => s.replace(/^[\s:–-]+|[\s:–-]+$/g, ""))
    // drop empties and group labels like "kyselina:" left behind
    .filter((s) => s.length > 1 && !/^\d+([.,]\d+)?\s*%$/.test(s));
  return Math.max(items.length, p.ingredients?.length ?? 0);
}

/** Name of the first or second top-level item that is a preparation starting with sugar, e.g. "ovocné složky 18 %". */
export function sugarLedPreparation(p: ProductData): string | undefined {
  if (!p.ingredientsText) return undefined;
  for (const item of topLevelItems(p.ingredientsText).slice(0, 2)) {
    const m = /^([^(]+)\(([^)]*)/.exec(item);
    if (!m) continue;
    const inner = m[2]!.split(/[,;]/)[0]?.trim() ?? "";
    if (SUGAR_WORDS.test(inner)) return m[1]!.trim().replace(/[:\s]+$/, "");
  }
  return undefined;
}

function secondIngredient(p: ProductData): string | undefined {
  if (p.ingredients && p.ingredients.length > 1) return p.ingredients[1];
  if (!p.ingredientsText) return undefined;
  return p.ingredientsText.split(/[,;(]/)[1]?.trim();
}

function firstIngredient(p: ProductData): string | undefined {
  if (p.ingredients && p.ingredients.length > 0) return p.ingredients[0];
  if (!p.ingredientsText) return undefined;
  return p.ingredientsText.split(/[,;(]/)[0]?.trim();
}

// ---- profile "avoid" groups ----
// The app offers a short list of things to avoid; each maps to several
// unwanted.json keys and/or E-number ranges.

export const AVOID_LABELS: Record<string, string> = {
  "palm-oil": "palmový olej",
  sweeteners: "sladidla",
  colours: "barviva",
  flavours: "aromata",
  msg: "glutamát",
  nitrites: "dusitany",
  hfcs: "glukózo-fruktózový sirup",
  "hydrogenated-fats": "ztužené tuky",
};

const AVOID_FLAG_KEYS: Record<string, string[]> = {
  "palm-oil": ["palm-oil"],
  sweeteners: ["sweeteners-generic"],
  colours: ["artificial-colours", "azo-warning-phrase", "caramel-colour", "titanium-dioxide"],
  flavours: ["flavouring-unspecified", "artificial-flavouring", "smoke-flavouring"],
  msg: ["msg-named"],
  nitrites: ["nitrites-nitrates"],
  hfcs: ["glucose-fructose-syrup"],
  "hydrogenated-fats": ["hydrogenated-fat", "partially-hydrogenated-fat"],
};

function eNumber(code: string): number | undefined {
  const m = /^e(\d{3,4})/i.exec(code.trim());
  return m ? Number(m[1]) : undefined;
}

const AVOID_E_RANGES: Record<string, (n: number) => boolean> = {
  sweeteners: (n) => n === 420 || n === 421 || (n >= 950 && n <= 969),
  colours: (n) => n >= 100 && n <= 199,
  msg: (n) => n >= 620 && n <= 625,
  nitrites: (n) => n >= 249 && n <= 252,
};

/** unwanted.json keys that name substances which also have E-numbers */
const FLAG_E_RANGES: Record<string, (n: number) => boolean> = {
  "nitrites-nitrates": (n) => n >= 249 && n <= 252,
  phosphates: (n) => (n >= 338 && n <= 343) || (n >= 450 && n <= 452),
  "sulphites-named": (n) => n >= 220 && n <= 228,
  "benzoates-named": (n) => n >= 210 && n <= 213,
  "bha-bht": (n) => n === 320 || n === 321,
  "titanium-dioxide": (n) => n === 171,
  carrageenan: (n) => n === 407,
  "msg-named": (n) => n >= 620 && n <= 625,
  "caramel-colour": (n) => n === 150,
};

export function additiveCoversFlag(flagKey: string, additives: { code: string }[]): boolean {
  const inRange = FLAG_E_RANGES[flagKey];
  if (!inRange) return false;
  return additives.some((a) => {
    const n = eNumber(a.code);
    return n !== undefined && inRange(n);
  });
}

export function avoidKeyForFlag(flagKey: string, avoid: string[]): string | undefined {
  return avoid.find((a) => a === flagKey || (AVOID_FLAG_KEYS[a] ?? []).includes(flagKey));
}

export function avoidKeyForAdditive(code: string, category: string, avoid: string[]): string | undefined {
  const n = eNumber(code);
  return avoid.find((a) => {
    const inRange = n !== undefined && AVOID_E_RANGES[a]?.(n);
    const byCategory = a === "sweeteners" && /sladid/i.test(category);
    return inRange || byCategory;
  });
}

// ---- hard rules ----

function applyHardRules(p: ProductData, profile: UserProfile): { rules: string[]; warnings: string[]; traceWarnings: string[] } {
  const ref = referenceData();
  const rules: string[] = [];
  const warnings: string[] = [];
  const traceWarnings: string[] = [];
  const allergens = new Set(p.allergens ?? []);
  const traces = new Set(p.traces ?? []);
  const labels = new Set(p.labels ?? []);

  const wanted = new Set(profile.allergens);
  if (profile.diets.includes("gluten-free")) wanted.add("gluten");
  if (profile.diets.includes("lactose-free")) wanted.add("milk");

  for (const tag of wanted) {
    if (allergens.has(tag)) {
      rules.push(`allergen:${tag}`);
      warnings.push(`Obsahuje ${ref.allergenLabel(tag)} – podle vašeho profilu nevhodné.`);
    } else if (traces.has(tag)) {
      traceWarnings.push(`Může obsahovat stopy: ${ref.allergenLabel(tag)}.`);
    }
  }

  if (profile.diets.includes("vegan")) {
    if (labels.has("analysis:non-vegan") || allergens.has("milk") || allergens.has("eggs")) {
      rules.push("diet:vegan");
      warnings.push("Není veganské.");
    }
  } else if (profile.diets.includes("vegetarian")) {
    if (labels.has("analysis:non-vegetarian")) {
      rules.push("diet:vegetarian");
      warnings.push("Není vegetariánské.");
    }
  }

  return { rules, warnings, traceWarnings };
}

// ---- composition ----

interface ComponentResult {
  score: number;
  reasons: Reason[];
  /** caps the final verdict, e.g. "kup_jestli_musis" */
  cap?: Verdict;
  profileWarnings: string[];
  /** risk rules from the category (alcohol + energy…); the AI may not improve them */
  riskRules?: string[];
}

function scoreComposition(p: ProductData, profile: UserProfile): ComponentResult {
  let score = 100;
  const reasons: Reason[] = [];
  const profileWarnings: string[] = [];
  let cap: Verdict | undefined;

  // Without an ingredient list we cannot see additives or fillers – start lower.
  if (!hasIngredientInfo(p)) {
    score = 80;
    cap = tighten(cap, "jsou_lepsi"); // never a top verdict without having seen the composition
    reasons.push({ kind: "neutral", text: "Složení není v databázi, hodnotíme jen nutriční údaje. Vyfoťte etiketu pro přesnější verdikt." });
  }

  // Cured meats are compared mainly with each other: nearly all are NOVA 4,
  // salty (Nutri-Score D/E) and cured with nitrite, so those general penalties
  // are softened and the differences (meat %, fillers) decide – see category.ts.
  const isMeat = detectCategory(p) === "meat";
  // Alcoholic drinks: alcohol harms equally in every bottle, so health scores
  // (Nutri-Score, NOVA – every distillate is "NOVA 4") do not separate good from
  // bad. Craft and origin rules in category.ts and the AI's reviews decide.
  const isAlcohol = detectCategory(p) === "alcohol";
  // coffee, tea, spices: also judged by quality, not by health scores
  const qualityFirst = QUALITY_FIRST.has(detectCategory(p));
  // butter, cheese, oils, honey, nuts, cured meat: low Nutri-Score by nature
  const lowNutriByNature = nutriScoreInherentlyLow(p);

  // additives
  const additives = (p.additives ?? []).map((a) =>
    isMeat && a.risk === 3 && /^E25[0-2]$|^E249$/i.test(a.code)
      ? { ...a, risk: 2 as const }
      : // sulphites belong to wine, CO2 to beer; asthma is a profile matter
        isAlcohol && /^E2(2[0-8]|90)$/i.test(a.code)
        ? { ...a, risk: 0 as const }
        : a,
  )
    // ethanol (E1510) is the drink itself, not an additive of it
    .filter((a) => !(isAlcohol && /^E1510$/i.test(a.code)));
  const byRisk = (r: number) => additives.filter((a) => a.risk === r);
  const high = byRisk(3);
  const medium = byRisk(2);
  const low = byRisk(1);
  let additivePenalty = high.length * 18 + medium.length * 8 + low.length * 3;
  additivePenalty = Math.min(additivePenalty, 60);
  score -= additivePenalty;
  if (high.length) {
    reasons.push({
      kind: "negative",
      text: `${high.length === 1 ? "Aditivum" : "Aditiva"} s vysokým rizikem: ${joinCodes(high.map((a) => `${a.code} (${a.name})`), 3)}.`,
    });
    cap = tighten(cap, high.length >= 2 ? "radsi_ne" : "kup_jestli_musis");
  }
  // titanium dioxide is banned in EU food since 2022 (Reg. (EU) 2022/63)
  if (additives.some((a) => /^E171$/i.test(a.code))) {
    reasons.push({ kind: "warning", text: "Obsahuje E171 (oxid titaničitý), v EU v potravinách zakázaný od roku 2022." });
    cap = tighten(cap, "nekupuj");
  }
  if (medium.length) {
    reasons.push({
      kind: "negative",
      text: `${medium.length === 1 ? "Aditivum" : `${medium.length} aditiva`} se středním rizikem: ${joinCodes(medium.map((a) => a.code))}.`,
    });
  }
  if (low.length && !high.length && !medium.length) {
    reasons.push({ kind: "neutral", text: `Obsahuje jen aditiva s nízkým rizikem (${joinCodes(low.map((a) => a.code))}).` });
  }
  if (additives.length === 0 && hasIngredientInfo(p)) {
    reasons.push({ kind: "positive", text: "Bez přídatných látek (E-čísel)." });
    score += 3;
  }

  // processing level
  if (qualityFirst) {
    // not applicable: distillation makes every spirit "ultra-processed", spices are eaten by the pinch
  } else if (p.novaGroup === 4 && isMeat) {
    score -= 5;
    reasons.push({ kind: "neutral", text: "Průmyslově zpracované (NOVA 4) – u uzenin běžné." });
  } else if (p.novaGroup === 4) {
    score -= 15;
    cap = tighten(cap, "jsou_lepsi"); // ultra-processed is never a top pick
    reasons.push({ kind: "negative", text: "Vysoce průmyslově zpracovaná potravina (NOVA 4)." });
  } else if (p.novaGroup === 3) {
    score -= 5;
  } else if (p.novaGroup === 1) {
    score += 4;
    reasons.push({ kind: "positive", text: "Nezpracovaná nebo minimálně zpracovaná potravina (NOVA 1)." });
  }

  // nutrition
  if (isAlcohol) {
    // only the genuinely risky part: a lot of sugar on top of the alcohol (sweet liqueurs, alcopops)
    const sugars = p.nutrition?.sugars;
    if (sugars !== undefined && sugars > 25) {
      score -= 6;
      reasons.push({ kind: "warning", text: `Hodně cukru navíc k alkoholu (${sugars} g/100 ml).` });
    }
  } else if (qualityFirst) {
    // coffee, tea, spices: per-100-g nutrition says nothing about a cup or a pinch
  } else if (p.nutriScore) {
    const delta = lowNutriByNature ? { a: 5, b: 0, c: -3, d: -6, e: -10 }[p.nutriScore] : { a: 5, b: 0, c: -5, d: -14, e: -28 }[p.nutriScore];
    score += delta;
    if (p.nutriScore === "a" || p.nutriScore === "b") {
      reasons.push({ kind: "positive", text: `Nutri-Score ${p.nutriScore.toUpperCase()}.` });
    } else if (p.nutriScore === "d") {
      reasons.push({ kind: lowNutriByNature ? "neutral" : "negative", text: lowNutriByNature ? "Nutri-Score D – u tohoto druhu potravin dané složením, o kvalitě neříká mnoho." : "Nutri-Score D – nutričně slabé." });
    } else if (p.nutriScore === "e") {
      if (lowNutriByNature) {
        reasons.push({ kind: "neutral", text: "Nutri-Score E – u tohoto druhu potravin (tuk, sýr, med, uzenina) běžné. Jezte s mírou, o kvalitě to neříká mnoho." });
      } else {
        reasons.push({ kind: "negative", text: "Nutri-Score E – nejhorší nutriční kategorie." });
        // the worst nutrition class is never "nothing against it"
        cap = tighten(cap, "kup_jestli_musis");
      }
    }
  } else if (p.nutrition) {
    const n = p.nutrition;
    const issues: string[] = [];
    if (n.sugars !== undefined) {
      if (n.sugars > 40) { score -= 18; issues.push(`extrémně mnoho cukru (${n.sugars} g/100 g)`); cap = tighten(cap, "kup_jestli_musis"); }
      else if (n.sugars > 22.5) { score -= 10; issues.push(`hodně cukru (${n.sugars} g/100 g)`); }
      else if (n.sugars > 10) { score -= 4; }
    }
    if (n.salt !== undefined) {
      if (n.salt > 1.5) { score -= 10; issues.push(`hodně soli (${n.salt} g/100 g)`); }
      else if (n.salt > 0.8) { score -= 4; }
    }
    if (n.saturatedFat !== undefined) {
      if (n.saturatedFat > 5) { score -= 8; issues.push(`hodně nasycených tuků (${n.saturatedFat} g/100 g)`); }
      else if (n.saturatedFat > 2.5) { score -= 3; }
    }
    if (n.fiber !== undefined && n.fiber >= 3) score += 3;
    if (n.proteins !== undefined && n.proteins >= 8) score += 3;
    if (issues.length) reasons.push({ kind: "negative", text: `Nutričně: ${issues.join(", ")}.` });
  }

  // profile-aware low-sugar diet
  if (profile.diets.includes("low-sugar") && p.nutrition?.sugars !== undefined && p.nutrition.sugars > 10) {
    profileWarnings.push(`Obsahuje ${p.nutrition.sugars} g cukru na 100 g – chcete málo cukru.`);
    cap = tighten(cap, "jsou_lepsi");
  }

  // unwanted ingredients
  const avoidHits = new Set<string>();
  for (const f of p.flagged ?? []) {
    if (f.key === "sugar-first") continue; // handled by position check below
    if (isAlcohol && f.key === "alcohol-in-sweets") continue; // alcohol in a drink is no surprise
    // the same substance already scored as an E-number (e.g. "dusitan sodný" = E250)
    // must not be penalised twice – keep only the explanation
    const alreadyScored = additiveCoversFlag(f.key, additives);
    if (!alreadyScored) score -= { 1: 2, 2: 6, 3: 12 }[f.severity];
    const avoidKey = avoidKeyForFlag(f.key, profile.avoid);
    if (avoidKey) {
      avoidHits.add(avoidKey);
      continue; // reported once per avoid group below
    }
    // e.g. mechanically separated meat, cheese analogue
    if (f.severity === 3 && !alreadyScored) cap = tighten(cap, "radsi_ne");
    // industrially hardened fat is never "určitě kup" (Romantic mešavina case: 74 points with hydrogenated fat)
    if (f.key === "hydrogenated-fat") cap = tighten(cap, "jsou_lepsi");
    // labels are nominative ("sójová bílkovina jako plnidlo"), so lead with them
    if (f.severity >= 2) {
      reasons.push({ kind: "negative", text: `${capitalize(f.label)}: ${f.note}` });
    } else {
      reasons.push({ kind: "neutral", text: `Ve složení: ${f.label}.` });
    }
  }
  for (const a of p.additives ?? []) {
    const avoidKey = avoidKeyForAdditive(a.code, a.category, profile.avoid);
    if (avoidKey) avoidHits.add(avoidKey);
  }
  for (const key of avoidHits) {
    score -= 5;
    profileWarnings.push(`Obsahuje ${AVOID_LABELS[key] ?? key}, čemuž se chcete vyhnout.`);
  }
  if (avoidHits.size > 0) cap = tighten(cap, avoidHits.size >= 2 ? "kup_jestli_musis" : "jsou_lepsi");

  // sugar high up in the ingredient list
  const first = firstIngredient(p);
  const kind = detectCategory(p);
  if (qualityFirst) {
    // sugar in liqueurs is expected; in spirits and spice mixes the craft rules judge it
  } else if (first && SUGAR_WORDS.test(first)) {
    score -= 8;
    reasons.push({ kind: "negative", text: "Cukr je první (nejzastoupenější) přísada." });
  } else if (kind !== "sweets") {
    const second = secondIngredient(p);
    if (second && SUGAR_WORDS.test(second)) {
      score -= 8;
      reasons.push({ kind: "negative", text: "Cukr je hned druhá nejzastoupenější přísada – u slaného výrobku zbytečně moc." });
    } else {
      // "ovocná složka 18 % (cukr, jahody 30 %…)": the sugar hides inside a preparation
      const hidden = sugarLedPreparation(p);
      if (hidden) {
        score -= 8;
        reasons.push({ kind: "negative", text: `Cukr je první složkou ${hidden} – schovaný v závorce, ale je ho tam nejvíc.` });
      }
    }
  }
  // savoury foods (meat, cheese, …) should not need much sugar
  const sugars = p.nutrition?.sugars;
  if (sugars !== undefined && kind !== "sweets" && kind !== "dairy" && !qualityFirst) {
    if (isMeat && sugars > 10) {
      score -= 10;
      reasons.push({ kind: "negative", text: `Na masný výrobek hodně cukru (${sugars} g/100 g).` });
    } else if (!isMeat && sugars > 15 && !p.nutriScore) {
      score -= 4;
    }
  }

  // length of ingredient list
  const count = ingredientCount(p);
  const cleanList = additives.every((a) => a.risk === 0) && (p.flagged ?? []).every((f) => f.key === "sugar-first");
  if (count > 20) {
    score -= 6;
    reasons.push({ kind: "negative", text: `Dlouhé složení (${count} ${ingredientsWord(count)}).` });
  } else if (count > 12) {
    score -= 3;
  } else if (count > 0 && count <= 5 && cleanList) {
    score += 4;
    reasons.push({ kind: "positive", text: `Krátké a srozumitelné složení (${count} ${ingredientsWord(count)}).` });
  }

  // category expert rules (meat content, real butter, cocoa glaze, quality marks…)
  const cat = categoryRules(p);
  score += cat.delta;
  reasons.push(...cat.reasons);
  if (cat.cap) cap = tighten(cap, cat.cap);

  // labels
  const labels = new Set((p.labels ?? []).map((l) => l.toLowerCase()));
  if (labels.has("organic") || labels.has("eu-organic") || labels.has("bio") || labels.has("en-organic")) {
    score += 4;
    reasons.push({ kind: "positive", text: "Bio / ekologické zemědělství." });
  }
  if (labels.has("no-additives") || labels.has("no-preservatives")) {
    score += 3;
  }

  return { score: clamp(score), reasons, cap, profileWarnings, riskRules: cat.riskRules };
}

// ---- manufacturer (phase 0 heuristic) ----

function scoreManufacturer(p: ProductData, override?: number): ComponentResult {
  const reasons: Reason[] = [];
  if (override !== undefined) return { score: clamp(override), reasons, profileWarnings: [] };
  if (isPrivateLabel(p.brand, p.manufacturer)) {
    reasons.push({ kind: "neutral", text: "Privátní značka řetězce – výrobce není na obalu zřejmý." });
    return { score: 45, reasons, profileWarnings: [] };
  }
  const labels = new Set((p.labels ?? []).map((l) => l.toLowerCase()));
  let score = 60;
  for (const l of labels) {
    // quality/origin marks are reported by the category rules; awards here
    if (/klasa|regionalni-potravina|regionální|ceska-chutovka/.test(l)) {
      score += 15;
      break;
    }
    if (/great-taste|dlg|superior-taste|monde-selection/.test(l)) {
      score += 15;
      reasons.push({ kind: "positive", text: `Ocenění: ${l.replace(/-/g, " ")}.` });
      break;
    }
  }
  return { score: clamp(score), reasons, profileWarnings: [] };
}

// ---- sustainability ----

function scoreSustainability(p: ProductData): ComponentResult | undefined {
  const reasons: Reason[] = [];
  let score: number | undefined;
  if (p.ecoScore) {
    score = { a: 90, b: 75, c: 55, d: 35, e: 20 }[p.ecoScore];
  }
  const labels = new Set((p.labels ?? []).map((l) => l.toLowerCase()));
  const palm = (p.flagged ?? []).some((f) => f.key === "palm-oil");
  if (palm) score = (score ?? 60) - 15;
  if (labels.has("fairtrade") || labels.has("fair-trade")) {
    score = (score ?? 60) + 10;
    reasons.push({ kind: "positive", text: "Fairtrade." });
  }
  if (labels.has("organic") || labels.has("eu-organic")) score = (score ?? 60) + 10;
  if (score === undefined) return undefined;
  return { score: clamp(score), reasons, profileWarnings: [] };
}

// ---- verdict ----

function applyCap(v: Verdict, cap?: Verdict): Verdict {
  if (!cap) return v;
  return isBetter(v, cap) ? cap : v;
}

/** "Poklad" is reserved for products with nothing at all to criticise. */
function qualifiesAsTreasure(p: ProductData): boolean {
  if (!hasIngredientInfo(p) || p.dataCompleteness !== "full") return false;
  // a list copied from an e-shop (often shortened, another market) is not the label
  if (p.compositionSource) return false;
  if ((p.additives ?? []).some((a) => a.risk >= 1)) return false;
  if ((p.flagged ?? []).some((f) => f.severity >= 2)) return false;
  if (QUALITY_FIRST.has(detectCategory(p))) return qualityTreasure(p); // judged by craft, not by NOVA / Nutri-Score
  if (p.novaGroup !== undefined && p.novaGroup > 2) return false;
  if (p.nutriScore !== undefined && !["a", "b"].includes(p.nutriScore)) return false;
  return true;
}

/** Clamp a score into the band of the (possibly capped) verdict. */
export function scoreForVerdict(total: number, verdict: Verdict): number {
  const meta = VERDICTS[verdict];
  return Math.max(meta.minScore ?? 0, Math.min(total, meta.maxScore ?? 100));
}

function weightedAverage(parts: { score?: number; weight: number }[]): number {
  let sum = 0;
  let w = 0;
  for (const part of parts) {
    if (part.score === undefined) continue;
    sum += part.score * part.weight;
    w += part.weight;
  }
  return w === 0 ? 0 : sum / w;
}

export function assess(product: ProductData, profile: UserProfile = EMPTY_PROFILE, opts: ScoreOptions = {}): Assessment {
  const a = assessInner(product, profile, opts);
  return detectCategory(product) === "alcohol" ? { ...a, labelSet: "alcohol" } : a;
}

function assessInner(product: ProductData, profile: UserProfile, opts: ScoreOptions): Assessment {
  const hard = applyHardRules(product, profile);

  if (!hasAnyData(product)) {
    return {
      verdict: "nevime",
      confidence: "low",
      reasons: [
        {
          kind: "neutral",
          text:
            product.source === "photo"
              ? "Z fotky se nepodařilo přečíst složení ani nutriční údaje. Zkuste ostřejší záběr na složení."
              : "Databáze nemá složení ani nutriční údaje tohoto produktu. Vyfoťte etiketu.",
        },
      ],
      breakdown: {},
      hardRules: hard.rules,
      profileWarnings: [...hard.warnings, ...hard.traceWarnings],
    };
  }

  const composition = scoreComposition(product, profile);
  const manufacturer = scoreManufacturer(product, opts.manufacturerScore);
  const sustainability = profile.showSustainability ? scoreSustainability(product) : undefined;

  const breakdown: ScoreBreakdown = {
    composition: Math.round(composition.score),
    manufacturer: Math.round(manufacturer.score),
    sustainability: sustainability ? Math.round(sustainability.score) : undefined,
  };

  const total = Math.round(
    weightedAverage([
      { score: composition.score, weight: WEIGHTS.composition },
      { score: manufacturer.score, weight: WEIGHTS.manufacturer },
      { score: sustainability?.score, weight: WEIGHTS.sustainability },
    ]),
  );

  let verdict = verdictFromScore(total);
  verdict = applyCap(verdict, composition.cap);
  if (verdict === "poklad" && !qualifiesAsTreasure(product)) verdict = "urcite_kup";
  // an allergen or diet conflict always means "don't buy", whatever the quality
  if (hard.rules.length) verdict = applyCap(verdict, "nekupuj");
  // keep the shown score consistent with the final verdict band
  const score = scoreForVerdict(total, verdict);

  const warnings: Reason[] = [...hard.warnings, ...composition.profileWarnings].map((text) => ({ kind: "warning", text }));
  const negatives = [...composition.reasons, ...manufacturer.reasons, ...(sustainability?.reasons ?? [])].filter((r) => r.kind === "negative" || r.kind === "warning");
  const positives = [...composition.reasons, ...manufacturer.reasons, ...(sustainability?.reasons ?? [])].filter((r) => r.kind === "positive");
  const neutrals = [...composition.reasons, ...manufacturer.reasons].filter((r) => r.kind === "neutral");
  const reasons = [...warnings, ...negatives, ...positives, ...neutrals].slice(0, 7);

  // Without an ingredient list a "fine" verdict would be a guess – say so
  // honestly and let the photo or the AI insight decide. Clearly bad
  // nutrition still gets its (capped) verdict.
  if (!hasIngredientInfo(product) && hard.rules.length === 0 && VERDICTS[verdict].rank >= VERDICTS.jsou_lepsi.rank) {
    return {
      verdict: "nevime",
      confidence: "low",
      reasons: [
        { kind: "neutral" as const, text: "Složení chybí, takže pravidla nemohou poctivě soudit. Vyfoťte etiketu se složením, nebo počkejte na posudek AI." },
        ...reasons.filter((r) => !/Složení není v databázi/.test(r.text)),
      ].slice(0, 7),
      breakdown,
      hardRules: [],
      profileWarnings: [...composition.profileWarnings, ...hard.traceWarnings],
    };
  }

  let confidence: Assessment["confidence"] =
    opts.confidence ??
    (product.source === "manual"
      ? "low"
      : product.dataCompleteness === "full"
        ? product.source === "photo"
          ? "medium"
          : "high"
        : product.dataCompleteness === "partial"
          ? "medium"
          : "low");
  if (hard.rules.length) confidence = "high";

  return {
    verdict,
    score,
    confidence,
    reasons,
    breakdown,
    hardRules: [...hard.rules, ...(composition.riskRules ?? [])],
    profileWarnings: [...hard.warnings, ...composition.profileWarnings, ...hard.traceWarnings],
  };
}
