import type { AdditiveInfo, FlaggedIngredient, InsightComposition, NutritionPer100g, ProductData } from "./types";
import { referenceData } from "./data";

/** Split an ingredient list into top-level items (commas outside brackets). */
export function splitIngredients(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    const decimalComma = ch === "," && /\d/.test(chars[i - 1] ?? "") && /\d/.test(chars[i + 1] ?? "");
    const sentenceEnd = ch === "." && depth === 0 && /\s/.test(chars[i + 1] ?? "") && /\p{Lu}/u.test(chars[i + 2] ?? "");
    if (((ch === "," || ch === ";") && depth === 0 && !decimalComma) || sentenceEnd) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim().replace(/\.$/, ""));
  return out.map((s) => s.replace(/^(složení|ingredients|sastojci|sastav|zutaten|состав|skład)\s*:\s*/iu, ""));
}

export interface IngredientAnalysis {
  ingredients: string[];
  additives: AdditiveInfo[];
  flagged: FlaggedIngredient[];
  allergens: string[];
}

/**
 * Derive additives, unwanted ingredients and allergens from free ingredient
 * text. `matchText` may contain several language versions joined together;
 * `displayText` is what gets split into the ingredient list.
 */
export function analyzeIngredients(displayText: string, matchText: string = displayText): IngredientAnalysis {
  const ref = referenceData();
  const additives = ref.additivesInText(matchText).map((a) => ({
    code: a.code,
    name: a.name,
    category: a.category,
    risk: a.risk,
    note: a.note,
    sources: a.sources,
  }));
  const flagged = ref.unwantedInText(matchText).map(({ record, matchedText }) => ({
    key: record.key,
    label: record.label,
    severity: record.severity,
    note: record.note,
    matchedText,
  }));
  return { ingredients: splitIngredients(displayText), additives, flagged, allergens: ref.allergensInText(matchText) };
}

function hasNutrition(n?: NutritionPer100g): boolean {
  return !!n && Object.values(n).some((v) => v !== undefined);
}

/**
 * Add an ingredient list found online to a product that had none.
 * Label or database data always wins: a product that already has an
 * ingredient list is returned unchanged.
 */
export function applyFoundComposition(product: ProductData, comp: InsightComposition): ProductData {
  // a complete list from the label wins; a partly covered one may be replaced by the full list found online
  if (product.ingredientsText?.trim() && !product.ingredientsPartial) return product;
  const a = analyzeIngredients(comp.ingredientsText);
  const nutrition = hasNutrition(product.nutrition) ? product.nutrition : hasNutrition(comp.nutrition) ? comp.nutrition : undefined;
  return {
    ...product,
    ingredientsText: comp.ingredientsText,
    ingredients: a.ingredients,
    additives: a.additives,
    flagged: a.flagged,
    allergens: [...new Set([...(product.allergens ?? []), ...a.allergens])],
    nutrition,
    dataCompleteness: nutrition ? "full" : "partial",
    ingredientsPartial: false,
    compositionSource: { url: comp.sourceUrl, title: comp.sourceTitle, market: comp.market },
  };
}
