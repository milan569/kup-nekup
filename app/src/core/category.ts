import type { ProductData, Reason, Verdict } from "./types";
import { isBetter } from "./verdicts";

/**
 * Category-specific expert rules for the product groups the user buys most:
 * cured meats, dairy, sweets/chocolate, plus regional quality marks.
 * Pure functions on the ingredient text – no network.
 */

export type CategoryKind = "meat" | "dairy" | "sweets" | "alcohol" | "coffee" | "tea" | "spice" | "other";

/**
 * Judged by quality, reviews and reputation – not by health scores (the user's
 * rule): alcohol harms equally in every bottle; coffee, tea and spices are
 * eaten in small amounts, so Nutri-Score / NOVA say nothing about them.
 */
export const QUALITY_FIRST: ReadonlySet<CategoryKind> = new Set(["alcohol", "coffee", "tea", "spice"]);

/** beer also covers alcohol-free beer: it is judged by the same craft rules */
export type AlcoholKind = "beer" | "wine" | "cider" | "spirit" | "liqueur" | "other";

export interface CategoryResult {
  kind: CategoryKind;
  delta: number;
  reasons: Reason[];
  cap?: Verdict;
  /** risk rules (e.g. "alcohol-energy"): kept in Assessment.hardRules, so the AI never improves the verdict */
  riskRules?: string[];
  /** parsed facts, useful for the AI prompt and for tests */
  facts: { meatPercent?: number; cocoaPercent?: number };
}

const MEAT_TAGS = /^en:(meats|prepared-meats|sausages|hams|salamis|cured-meats|frankfurters|cooked-sausages|dry-sausages|bacons|pates|meat-based-products|poultry-meats|smoked-meats)/;
const DAIRY_TAGS = /^en:(dairies|yogurts|cheeses|milks|butters|creams|fermented-milk-products|cottage-cheeses|quarks|kefirs|dairy-desserts|cream-cheeses)/;
const SWEETS_TAGS = /^en:(confectioneries|chocolates|candies|biscuits-and-cakes|sweet-snacks|bonbons|wafers|chocolate-candies|cocoa-and-its-products|biscuits|cakes|bars|sweet-spreads)/;

const MEAT_NAME =
  /(salám|šunk|párk|klobás|uzenin|uzen[éý]|slanin|paštik|špekáč|vuřt|tlačenk|jitrnic|kabanos|klobas|kobasic|pršut|sudžuk|kulen|salama|šunka|hrenovk|vysočin|gothaj|lovecký|poličan|herkules|uherák|čabajk|sekaná|kuřecí prsa|krůtí prsa|jerky|biltong|carne seca|sušen\p{L}* (hovězí|maso)|suho meso|suvo meso|pastrami|bresaola|кобасиц|шунк|салам|wurst|schinken|speck|trockenfleisch)/iu;
// whole nouns only: "Máslové sušenky" or "Mléčná čokoláda" are sweets, not dairy
const DAIRY_NAME =
  /(?<!\p{L})(jogurt\p{L}{0,2}|sýr[yuůe]?|syr|tvaroh\p{L}{0,2}|máslo|másla|maslo|mléko|mléka|mleko|smetan[ay]?|kefír\p{L}{0,2}|kefir|podmáslí|zákys|skyr|cottage|mozzarell\p{L}*|eidam|gouda|niva|hermelín|sir|maslac|mlijeko|kajmak|скут|сир|млеко|јогурт|quark|joghurt|käse|butter|milk)(?!\p{L})/iu;
const SWEETS_NAME = /(čokolád|cokolad|bonbon|oplatk|sušenk|susenk|tyčink|keks|napolitank|bombon|čokolada|chocolate|schokolade|piškot|perník|dort|tatrank|horalk|fidork|kakaov|praline|lízát|žvýkačk|gumov|haribo|wafer|waffel|keksi|чоколад|бомбон)/iu;

// alcoholic drinks: judged by craft and reputation, not by Nutri-Score/NOVA (see alcoholRules)
const ALCOHOL_TAGS = /^en:(alcoholic-beverages|beers|lagers|ales|wheat-beers|stouts|porters|pilsners|craft-beers|non-alcoholic-beers|wines|red-wines|white-wines|rose-wines|sparkling-wines|champagnes|proseccos|fortified-wines|ciders|spirits|distilled-spirits|rums|whiskies|whiskys|scotch-whiskies|vodkas|gins|brandies|fruit-brandies|cognacs|tequilas|liqueurs|meads)/;
const BEER = /(?<!\p{L})(pivo|piva|pivko|ležák\p{L}*|výčepní|pils\p{L}*|lager|pale ale|ipa|apa|stout|porter|weizen\p{L}*|bier|beer|birra|пиво|radler)(?!\p{L})/iu;
const WINE = /(?<!\p{L})(víno|vína|vino|vina|wine|wein|sekt|prosecco|šampaňsk\p{L}*|champagne|cava|vranac|krstač|frankovk\p{L}*|ryzlink\p{L}*|veltlín\p{L}*|merlot|cabernet|chardonnay|sauvignon|вино)(?!\p{L})/iu;
const CIDER = /(?<!\p{L})(cider|cidre|jablečné víno|mošt alkoholick\p{L}*)(?!\p{L})/iu;
const LIQUEUR = /(?<!\p{L})(likér\p{L}*|liker|liqueur|likör|becherovk\p{L}*|jägermeister|fernet\p{L}*|amaro|vaječný koňak|medovin\p{L}*|pelinkovac|ликер)(?!\p{L})/iu;
const SPIRIT = /(?<!\p{L})(rum|whisk(?:e)?y|bourbon|scotch|vodk\p{L}*|gin|slivovic\p{L}*|borovičk\p{L}*|hruškovic\p{L}*|meruňkovic\p{L}*|pálenk\p{L}*|destilát|rakij\p{L}*|rakia|lozovač\p{L}*|šljivovic\p{L}*|travaric\p{L}*|vinjak|brandy|koňak|cognac|armagnac|tequila|mezcal|tuzemák|absint\p{L}*|grappa|ouzo|ракиј\p{L}*|вињак|водк\p{L}*)(?!\p{L})/iu;
const ABV = /\d+(?:[.,]\d+)?\s*%\s*(?:vol|obj|alc)/i;
// "vinný ocet", "rumové pralinky", "pivní klobása" are not drinks
const NOT_A_DRINK = /(ocet|octa|vinegar|sirće|ocat|essig|pralin|bonbon|čokolád|cokolad|chocolate|dort|zmrzlin|omáčk|sauce|aroma|příchu|kuličk|pečiv|sušenk|oplatk|tyčink|klobás|klobas|sýr|hořčic|marinád|bonbón|kandit)/iu;

function looksLikeDrink(name: string): boolean {
  if (NOT_A_DRINK.test(name)) return false;
  return ABV.test(name) || BEER.test(name) || WINE.test(name) || CIDER.test(name) || LIQUEUR.test(name) || SPIRIT.test(name);
}

export function alcoholKind(p: ProductData): AlcoholKind {
  const tags = (p.categoryTags ?? []).join(" ");
  const name = `${p.name} ${p.category ?? ""}`;
  if (/en:liqueurs|en:meads/.test(tags) || LIQUEUR.test(name)) return "liqueur";
  if (/en:ciders/.test(tags) || CIDER.test(name)) return "cider";
  if (/en:(beers|lagers|ales|wheat-beers|stouts|porters|pilsners|craft-beers|non-alcoholic-beers)/.test(tags) || BEER.test(name)) return "beer";
  if (/en:(wines|red-wines|white-wines|rose-wines|sparkling-wines|champagnes|proseccos|fortified-wines)/.test(tags) || WINE.test(name)) return "wine";
  if (/en:(spirits|distilled-spirits|rums|whiskies|whiskys|scotch-whiskies|vodkas|gins|brandies|fruit-brandies|cognacs|tequilas)/.test(tags) || SPIRIT.test(name)) return "spirit";
  return "other";
}

// coffee, tea, spices – only the plain products; sweetened drinks keep the normal rules
const COFFEE_TAGS = /^en:(coffees|ground-coffees|coffee-beans|roasted-coffees|instant-coffees|coffee-capsules|coffee-pods|espresso-coffees)/;
const TEA_TAGS = /^en:(teas|green-teas|black-teas|white-teas|herbal-teas|herbal-tea-bags|infusions|tea-bags|fruit-teas|rooibos|mate|matcha|oolong-teas)/;
const SPICE_TAGS = /^en:(spices|herbs|dried-herbs|spice-mixes|ground-spices|black-peppers|paprika-powders|cinnamon|curry-powders|seasoning-mixes)/;
const COFFEE_NAME = /(?<!\p{L})(káva|kávy|kafe|kava|kafa|coffee|kaffee|caffè|caffe|espresso|arabi[ck]a|robusta|кафа|кофе)(?!\p{L})/iu;
const TEA_NAME = /(?<!\p{L})(čaj\p{L}*|caj|tea|tee|thé|чај|rooibos|maté|matcha|sencha|oolong|pu-?erh|earl grey|darjeeling|assam)(?!\p{L})/iu;
const SPICE_NAME =
  /(?<!\p{L})(koření|kořenící směs|pepř\p{L}*|mletá paprika|paprika (?:sladká|pálivá|uzená|mletá)|aleva paprika|kmín\p{L}*|skořice|hřebíček|muškátov\p{L}*|nové koření|bobkový list|majoránk\p{L}*|oregano|origano|bazalk\p{L}*|tymián|rozmarýn|kurkum\p{L}*|chilli|chili|kari|curry|garam masala|začin\p{L}*|biber|cimet|vegeta|gewürz\p{L}*|pfeffer|zimt|spices?|seasoning|black pepper)(?!\p{L})/iu;
// ready meals, sauces and snacks named after a spice are not spices
const NOT_A_SPICE = /(omáčk|sauce|soße|kečup|ketchup|con carne|polévk|marinád|dresink|majonéz|hořčic|olej|ocet|chips|brambůrk|krekr|pečiv|sýr|salám|klobás|tyčink|čokolád|sušenk|oplatk|bonbon|zmrzlin|jogurt|nudle|instantní jídlo)/iu;
// "Ledový čaj", "3v1", "cappuccino ze sáčku" are sweetened drinks, not coffee or tea
const SWEET_DRINK = /(ledov\p{L}* čaj|iced? tea|eistee|ledeni čaj|nestea|fuze|3\s?v\s?1|3\s?in\s?1|2\s?v\s?1|cappuccino|latte|frapp|instantní nápoj|ready to drink|limonád)/iu;
const SWEET_INGREDIENT = /(?<!\p{L})(cukr\p{L}*|sugar|zucker|šećer|glukóz\p{L}*|glucose|sirup|syrup|fruktóz\p{L}*|smetan\p{L}*|mléko|mléčn\p{L}*|mleko|milk|creamer|rostlinn\p{L}* tuk|palm\p{L}*)(?!\p{L})/iu;

function qualityFirstKind(p: ProductData, byTags: boolean): "coffee" | "tea" | "spice" | undefined {
  const tags = p.categoryTags ?? [];
  const name = `${p.name} ${p.category ?? ""}`;
  let kind: "coffee" | "tea" | "spice" | undefined;
  if (byTags) {
    if (tags.some((t) => COFFEE_TAGS.test(t))) kind = "coffee";
    else if (tags.some((t) => TEA_TAGS.test(t))) kind = "tea";
    else if (tags.some((t) => SPICE_TAGS.test(t))) kind = "spice";
  } else if (COFFEE_NAME.test(name)) kind = "coffee";
  else if (TEA_NAME.test(name)) kind = "tea";
  else if (SPICE_NAME.test(name) && !NOT_A_SPICE.test(name)) kind = "spice";
  if (!kind) return undefined;
  if (kind !== "spice" && (SWEET_DRINK.test(name) || SWEET_INGREDIENT.test(p.ingredientsText ?? ""))) return undefined;
  return kind;
}

const LOW_NUTRISCORE_TAGS = /^en:(butters|cheeses|fats|animal-fats|vegetable-oils|olive-oils|extra-virgin-olive-oils|honeys|nuts|ghee|clarified-butters|lards)/;
const LOW_NUTRISCORE_NAME = /(?<!\p{L})(máslo|másla|přepuštěn|ghí|ghee|sýr|eidam|gouda|parmazán|ementál|olej|olivový|med|ořech|sádlo|maslac|sir|maslinovo|ulje|butter|käse|cheese|honey|honig)(?!\p{L})/iu;

/**
 * Foods whose Nutri-Score is low by nature (pure fat, cheese, honey, nuts,
 * cured meat). Nutri-Score says "eat less", not "low quality", so for these
 * it only lightly affects the verdict.
 */
export function nutriScoreInherentlyLow(p: ProductData): boolean {
  if ((p.categoryTags ?? []).some((t) => LOW_NUTRISCORE_TAGS.test(t))) return true;
  return LOW_NUTRISCORE_NAME.test(`${p.name} ${p.category ?? ""}`) || detectCategory(p) === "meat";
}

export function detectCategory(p: ProductData): CategoryKind {
  const tags = p.categoryTags ?? [];
  if (tags.some((t) => ALCOHOL_TAGS.test(t))) return "alcohol";
  if (tags.some((t) => MEAT_TAGS.test(t))) return "meat";
  if (tags.some((t) => DAIRY_TAGS.test(t))) return "dairy";
  if (tags.some((t) => SWEETS_TAGS.test(t))) return "sweets";
  const tagged = qualityFirstKind(p, true);
  if (tagged) return tagged;
  const name = `${p.name} ${p.category ?? ""}`;
  if (looksLikeDrink(name)) return "alcohol";
  if (MEAT_NAME.test(name)) return "meat";
  if (DAIRY_NAME.test(name)) return "dairy";
  if (SWEETS_NAME.test(name)) return "sweets";
  return qualityFirstKind(p, false) ?? "other";
}

/** Split an ingredient list into top-level items (commas outside brackets). */
export function topLevelItems(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim().replace(/\.$/, ""));
  return out;
}

const MEAT_WORD = /(maso|masa|mäso|meso|mięso|meat|fleisch|carne|месо|vepřov|hověz|kuřec|krůtí|drůbež|telecí|jehněčí|svinjsk|goveđ|pileć|schwein|rind|pork|beef|chicken|turkey|bůčk|plec|kýt|krkovic|panenk|slanin)/iu;
const PERCENT = /(\d{1,3}(?:[.,]\d+)?)\s*%/u;

/**
 * Meat content in % from QUID declarations:
 *  - "vepřové maso 80 %, hovězí maso 10 %" → 90
 *  - "Na 100 g výrobku bylo použito 120 g masa" / "vyrobeno ze 130 g masa" → 100 (capped)
 */
export function parseMeatPercent(text: string): number | undefined {
  const per100 = /(\d{2,3})\s*g\s+(?:\p{L}+\s+){0,2}(?:masa|mäsa|mesa|meat|fleisch)/iu.exec(text);
  if (per100 && /100\s*g/.test(text)) {
    const g = Number(per100[1]);
    if (g >= 30 && g <= 250) return Math.min(100, g);
  }
  let sum = 0;
  let found = false;
  for (const item of topLevelItems(text)) {
    const head = item.split("(")[0] ?? item;
    if (!MEAT_WORD.test(head)) continue;
    if (/strojně|separ|mechanically|kůž|kůže|koža|sádl|tuk|vývar|extrakt|aroma|bílkovin|protein|kolagen/iu.test(head)) continue;
    const m = PERCENT.exec(head);
    if (m) {
      sum += Number(m[1]!.replace(",", "."));
      found = true;
    }
  }
  return found ? Math.min(100, Math.round(sum)) : undefined;
}

export function parseCocoaPercent(text: string): number | undefined {
  const m =
    /kakaov[áé]\s+sušin[ay]?\s*(?:min(?:imálně|\.)?\s*)?:?\s*(\d{1,3})\s*%/iu.exec(text) ??
    /(?:cocoa|kakao)\s*(?:solids|anteil|masse)?\s*(?:min(?:imum|\.)?\s*)?:?\s*(\d{1,3})\s*%/iu.exec(text) ??
    /kakaová\s+hmota\s*(\d{1,3})\s*%/iu.exec(text);
  return m ? Number(m[1]) : undefined;
}

const QUALITY_LABEL = /(klasa|regionalni-potravina|regional-food|ceska-chutovka|chutna-hezky-jihocesky|pdo|pgi|tsg|protected-designation|protected-geographical|traditional-speciality|zarucena-tradicni-specialita|chop|chzo|zts|vyrobeno-v-ceske-republice)/;

export function categoryRules(p: ProductData): CategoryResult {
  const kind = detectCategory(p);
  const text = p.ingredientsText ?? "";
  const lower = text.toLowerCase();
  const reasons: Reason[] = [];
  const facts: CategoryResult["facts"] = {};
  let delta = 0;
  let cap: Verdict | undefined;
  const items = text ? topLevelItems(text) : [];

  // quality and origin marks apply to every category
  const labels = (p.labels ?? []).map((l) => l.toLowerCase());
  const quality = labels.find((l) => QUALITY_LABEL.test(l));
  if (quality) {
    delta += 5;
    reasons.push({ kind: "positive", text: `Značka kvality nebo původu: ${quality.replace(/-/g, " ")}.` });
  }

  if (!text) return { kind, delta, reasons, cap, facts };

  if (kind === "alcohol") {
    const a = alcoholRules(p, text, items);
    return { kind, delta: delta + a.delta, reasons: [...reasons, ...a.reasons], cap: a.cap, riskRules: a.riskRules, facts };
  }
  if (kind === "coffee" || kind === "tea" || kind === "spice") {
    const q = kind === "coffee" ? coffeeRules(p, text) : kind === "tea" ? teaRules(p, text, items) : spiceRules(p, text, items);
    return { kind, delta: delta + q.delta, reasons: [...reasons, ...q.reasons], cap: q.cap, facts };
  }

  if (kind === "meat") {
    const firstItem = items[0]?.toLowerCase() ?? "";
    if (/strojně\s+odděl|separát|mechanically\s+separated|separatorenfleisch|mehanički\s+otkošten/iu.test(firstItem)) {
      delta -= 20;
      cap = "nekupuj";
      reasons.push({ kind: "negative", text: "Hlavní složkou je strojně oddělené maso (separát) – mleté zbytky z kostí." });
    }
    // "čisté svalové bílkoviny 16 %", "masné bílkoviny 16 %", Serbian/Montenegrin "proteina mesa 16%", "proteini mesa"
    const protein =
      /(?:(?:čist\p{L}*\s+)?(?:svalov|masn)\p{L}*\s+bílkovin\p{L}*|protein\p{L}*\s+mes\p{L}*|bjelančevin\p{L}*\s+mes\p{L}*|белан\p{L}*\s+мес\p{L}*)\s*:?\s*(?:min\.?|minimálně|najmanje)?\s*(\d{1,2}(?:[.,]\d+)?)\s*%/iu.exec(text);
    if (protein) {
      const v = Number(protein[1]!.replace(",", "."));
      if (v >= 16) {
        delta += 4;
        reasons.push({ kind: "positive", text: `Vysoký obsah čistých svalových bílkovin (${v} %).` });
      } else if (v < 12) {
        delta -= 4;
        reasons.push({ kind: "negative", text: `Málo čistých svalových bílkovin (${v} %).` });
      }
    }
    const meat = parseMeatPercent(text);
    facts.meatPercent = meat;
    if (meat === undefined) {
      delta -= 4;
      reasons.push({ kind: "negative", text: "Podíl masa není na obalu uveden – u masného výrobku podezřelé." });
    } else if (meat >= 90) {
      delta += 6;
      reasons.push({ kind: "positive", text: `Vysoký podíl masa (${meat} %).` });
    } else if (meat >= 70) {
      reasons.push({ kind: "neutral", text: `Podíl masa ${meat} %.` });
    } else if (meat >= 50) {
      delta -= 8;
      reasons.push({ kind: "negative", text: `Nízký podíl masa (${meat} %) – zbytek tvoří voda, tuk a plnidla.` });
    } else {
      delta -= 16;
      cap = "radsi_ne";
      reasons.push({ kind: "negative", text: `Masa jen ${meat} % – víc náhražka než uzenina.` });
    }
    const second = items[1]?.toLowerCase() ?? "";
    // brine in a 95 % ham is fine; water right after a modest meat share is not
    if ((meat === undefined || meat < 90) && /^(pitná\s+)?voda|^water|^wasser|^voda/.test(second)) {
      delta -= 5;
      reasons.push({ kind: "negative", text: "Voda hned na druhém místě složení – nastavované maso." });
    }
    if (/(vepřov\p{L}*|hovězí|drůbež\p{L}*)\s+kůž|kolagen|bravčov\p{L}*\s+kož/iu.test(lower)) {
      delta -= 4;
      reasons.push({ kind: "negative", text: "Obsahuje kůže nebo kolagen jako levné plnidlo." });
    }
  }

  if (kind === "dairy") {
    const name = p.name.toLowerCase();
    const first = items[0]?.toLowerCase() ?? "";
    if (first && !/(mléko|mleko|mlieko|smetan|milk|milch|mlijeko|млеко|syrovátk|tvaroh|sýr|máslo|kultur|jogurt)/iu.test(first)) {
      delta -= 5;
      reasons.push({ kind: "negative", text: "Mléko ani smetana nejsou na prvním místě složení." });
    }
    if (/jogurt|joghurt|yog|kefír|kefir|zákys|skyr/iu.test(name)) {
      if (/(modifikovan\p{L}*\s+)?škrob|želatin|pektin|e440|e14\d\d|guar|e412|karagenan|e407|xanthan|e415/iu.test(lower)) {
        delta -= 6;
        reasons.push({ kind: "negative", text: "Zahušťovadla v jogurtu – poctivý jogurt je nepotřebuje." });
      }
      if (/(?<!\p{L})(cukr|sugar|zucker|šećer|glukóz)/iu.test(lower)) {
        delta -= 4;
        reasons.push({ kind: "negative", text: "Přidaný cukr." });
      }
    }
    if (/máslo|maslo|butter|maslac/iu.test(name) && !/pomazánk|arašíd|kakaov|bylink/iu.test(name)) {
      if (/rostlinn\p{L}*\s+(tuk|olej)|palm|řepkov|slunečnic|vegetable\s+(fat|oil)|pflanzen/iu.test(lower)) {
        delta -= 15;
        cap = "radsi_ne";
        reasons.push({ kind: "negative", text: "Tvrdí, že je to máslo, ale obsahuje rostlinné tuky." });
      }
    }
    if (/rostlinn\p{L}*\s+tuk|vegetable\s+fat|palm/iu.test(lower) && !/máslo|butter/iu.test(name)) {
      delta -= 6;
      reasons.push({ kind: "negative", text: "Mléčný výrobek s rostlinným tukem – levnější náhražka mléčného tuku." });
    }
  }

  if (kind === "sweets") {
    if (!p.nutrition && !p.nutriScore) {
      delta -= 10;
      reasons.push({ kind: "neutral", text: "Sladkost bez nutričních údajů – počítáme s vysokým obsahem cukru." });
    }
    const cocoa = parseCocoaPercent(text);
    facts.cocoaPercent = cocoa;
    if (cocoa !== undefined) {
      if (cocoa >= 70) {
        delta += 4;
        reasons.push({ kind: "positive", text: `Vysoký podíl kakaa (${cocoa} %).` });
      } else if (cocoa < 30 && /čokolád|chocolate|schokolade|čokolada/iu.test(p.name)) {
        delta -= 4;
        reasons.push({ kind: "negative", text: `Málo kakaa (${cocoa} %).` });
      }
    }
    if (/(kakaov|čokoládov|chocolate[- ]flavou?red|cocoa|kakao)\p{L}*\s+polev|polev\p{L}*\s+(s\s+)?kaka/iu.test(lower)) {
      delta -= 8;
      reasons.push({ kind: "negative", text: "Kakaová poleva místo čokolády – levná náhražka." });
    }
    if (/rostlinn\p{L}*\s+tuk|vegetable\s+fat|pflanzenfett|biljn\p{L}*\s+mast|bambuck|shea|illipe/iu.test(lower)) {
      delta -= 6;
      reasons.push({ kind: "negative", text: "Rostlinné tuky místo kakaového másla nebo másla." });
    }
    // real butter (not cocoa or peanut butter) is a good sign in biscuits and pastry
    const withoutFakeButters = lower.replace(/(kakaov|arašídov|ořechov|cocoa|peanut|kakao|shea)\p{L}*\s*(máslo|másla|butter)/giu, "");
    if (/(?<!\p{L})(máslo|másla|máslový\s+tuk|butter|maslac|maslo)(?!\p{L})/iu.test(withoutFakeButters)) {
      delta += 3;
      reasons.push({ kind: "positive", text: "Obsahuje skutečné máslo." });
    }
  }

  return { kind, delta, reasons, cap, facts };
}

// ---- alcoholic drinks ----
// Alcohol harms health at any dose and equally in every bottle, so it does not
// separate good from bad. What does: honest production (malt vs. syrup, real
// distillate vs. neutral spirit with flavouring), origin marks, reputation and
// reviews (the AI). Health counts only for genuinely risky products.

function stricter(a: Verdict | undefined, b: Verdict): Verdict {
  return a && !isBetter(a, b) ? a : b;
}

const BEER_PURE_ITEM =
  /(voda|water|wasser|вода|slad|malt|ječ|jecm|pšeni|wheat|weizen|gerste|chmel|hop|hopfen|hmelj|хмељ|kvasn|kvasin|yeast|hefe|kvasac|квасац|ovesn|oat|hafer|žit|rye|roggen|ječam|pšenic)/iu;
const ALLERGEN_NOTE = /(obsahuje|může obsahovat|contains|enthält|sadrži|lepek|gluten)/iu;

export function alcoholRules(
  p: ProductData,
  text: string,
  items: string[],
): { delta: number; reasons: Reason[]; cap?: Verdict; riskRules: string[] } {
  const lower = text.toLowerCase();
  const sub = alcoholKind(p);
  const reasons: Reason[] = [];
  const riskRules: string[] = [];
  let delta = 0;
  let cap: Verdict | undefined;

  // the risky mix: stimulants hide drunkenness (EFSA, WHO warn about alcohol + energy drinks)
  if (/(kofein|caffeine|koffein|taurin|guaran|гуаран|кофеин)/iu.test(lower)) {
    delta -= 15;
    cap = stricter(cap, "radsi_ne");
    riskRules.push("alcohol-energy");
    reasons.push({ kind: "warning", text: "Alkohol s kofeinem nebo jinými povzbuzujícími látkami: povzbuzení maskuje opilost a svádí pít víc. Rizikový mix." });
  }

  if (sub === "beer") {
    const adjunct = /(?<!\p{L})(glukóz\p{L}*|glukoz\p{L}*|glucose|kukuři\p{L}*|kukuruz\p{L}*|maize|corn|mais|rýž\p{L}*|riž\p{L}*|rice|reis|cukr\p{L}*|šećer|sugar|zucker|sirup|syrup|škrob\p{L}*|starch|stärke)/iu.exec(lower);
    const relevant = items.filter((i) => !ALLERGEN_NOTE.test(i));
    if (adjunct) {
      delta -= 10;
      cap = stricter(cap, "jsou_lepsi");
      reasons.push({ kind: "negative", text: `Pivo s náhražkou sladu (${adjunct[0]}) – levnější a lehčí, ne poctivé pivo.` });
    } else if (relevant.length >= 2 && relevant.every((i) => BEER_PURE_ITEM.test(i))) {
      delta += 8;
      reasons.push({ kind: "positive", text: "Poctivé pivo jen z vody, sladu, chmele a kvasnic." });
    }
    if (/(chmelov\p{L}*\s+extrakt|hop\s+extract|hopfenextrakt|ekstrakt\s+hmelj\p{L}*)/iu.test(lower)) {
      delta -= 2;
      reasons.push({ kind: "neutral", text: "Chmelový extrakt místo (nebo vedle) hlávkového chmele." });
    } else if (/(chmelov\p{L}*\s+výrob\p{L}*|chmelov\p{L}*\s+produkt\p{L}*|hop\s+products|hopfenprodukte)/iu.test(lower)) {
      delta -= 1;
      reasons.push({ kind: "neutral", text: "„Chmelové výrobky“ bývají granule nebo extrakt, ne hlávkový chmel." });
    }
    if (/(e\s?150|karamel|caramel|barvivo|colou?r|farbstoff|boja)/iu.test(lower)) {
      delta -= 6;
      reasons.push({ kind: "negative", text: "Pivo obarvené (karamel) – barva nemusí být ze sladu." });
    }
  } else if (sub === "spirit") {
    const neutralSpirit = /(líh|etanol|ethanol|alkohol\s+zemědělského|alcohol\s+of\s+agricultural|ethylalkohol|agraralkohol|etilni\s+alkohol|etil\s+alkohol|rafinovan\p{L}*\s+alkohol)/iu.test(lower);
    const doctored = /(?<!\p{L})(cukr\p{L}*|sugar|zucker|šećer|karamel\p{L}*|caramel|e\s?150[a-d]?|aroma\p{L}*|flavou?r\p{L}*|příchu\p{L}*|boja)(?!\p{L})/iu.exec(lower);
    if (neutralSpirit && doctored) {
      delta -= 15;
      cap = stricter(cap, "kup_jestli_musis");
      reasons.push({ kind: "negative", text: "Lihovina z čistého líhu a aromatu, ne pravý destilát (typicky tuzemák nebo levná „brandy“)." });
    } else if (doctored) {
      delta -= 8;
      reasons.push({ kind: "negative", text: `Destilát dochucený nebo obarvený (${doctored[0]}).` });
    }
  } else if (sub === "wine" || sub === "cider") {
    if (/(aromatizovan\p{L}*|aroma|příchu\p{L}*|flavou?r\p{L}*|aromatisiert)/iu.test(lower)) {
      delta -= 10;
      cap = stricter(cap, "jsou_lepsi");
      reasons.push({ kind: "negative", text: "Aromatizované víno nebo vinný nápoj, ne čisté víno." });
    }
    if (sub === "cider" && /(koncentrát|concentrate|konzentrat|koncentrat)/iu.test(lower)) {
      delta -= 6;
      reasons.push({ kind: "negative", text: "Cider z koncentrátu, ne z čerstvé šťávy." });
    }
  }

  if (/(?<!\p{L})(ovocn\p{L}*\s+destilát|pravá\s+slivovice|voćn\p{L}*\s+rakij\p{L}*|single\s+malt|docg?|aoc|aop|igt|voc|dop|pozdní\s+sběr|výběr\s+z\s+hroznů|kabinetní)(?!\p{L})/iu.test(`${p.name} ${text}`)) {
    delta += 5;
    reasons.push({ kind: "positive", text: "Označení původu nebo pravého destilátu." });
  }
  return { delta, reasons, cap, riskRules };
}

/** "Poklad" for coffee, tea, spices and drinks: at least one craft merit and nothing to object to. */
export function qualityTreasure(p: ProductData): boolean {
  const cat = categoryRules(p);
  return cat.reasons.some((r) => r.kind === "positive") && cat.reasons.every((r) => r.kind === "positive");
}

/** Flags that make no sense for this kind of product ("alcohol in sweets" on a bottle of rum). */
export function relevantFlags(p: ProductData): ProductData {
  if (detectCategory(p) !== "alcohol") return p;
  return {
    ...p,
    flagged: p.flagged?.filter((f) => f.key !== "alcohol-in-sweets"),
    // ethanol (E1510) is the drink itself
    additives: p.additives?.filter((a) => !/^E1510$/i.test(a.code)),
  };
}

// ---- coffee, tea, spices: quality of the product itself ----

interface QualityResult {
  delta: number;
  reasons: Reason[];
  cap?: Verdict;
}

const FLAVOURED = /(?<!\p{L})(aroma|aromat\p{L}*izovan\p{L}*|aromatisiert|aromen|příchu\p{L}*|flavou?r(?:ing|ed|s)?|prirodn\p{L}* arom\p{L}*)(?!\p{L})/iu;
const ORIGIN = /(?<!\p{L})(etiopi\p{L}*|ethiopia|yirgacheffe|sidamo|kolumbi\p{L}*|colombia|brazíli\p{L}*|brazil|guatemal\p{L}*|kostarik\p{L}*|costa rica|keni\p{L}*|kenya|honduras|peru|indi\p{L}*|india|sumatr\p{L}*|jáva|java|darjeeling|assam|nilgiri|ceylon|cejlon\p{L}*|yunnan|fujian|japon\p{L}*|japan|uji|single origin)(?!\p{L})/iu;

export function coffeeRules(p: ProductData, text: string): QualityResult {
  const all = `${p.name} ${text}`;
  const reasons: Reason[] = [];
  let delta = 0;
  let cap: Verdict | undefined;
  if (/100\s*%\s*arabi[ck]\p{L}*|arabi[ck]\p{L}*\s*100\s*%|pure arabica|čistá arabika/iu.test(all)) {
    delta += 5;
    reasons.push({ kind: "positive", text: "100 % arabika." });
  } else if (/robusta/iu.test(all)) {
    reasons.push({ kind: "neutral", text: "Směs s robustou: hořčí, víc kofeinu, levnější zrno." });
  }
  if (/(?<!\p{L})(zrnkov\p{L}*|zrna|zrno|beans?|bohnen?|u zrnu|zrnu)(?!\p{L})/iu.test(all)) {
    delta += 3;
    reasons.push({ kind: "positive", text: "Zrnková káva: po čerstvém namletí chutná nejlíp." });
  }
  if (ORIGIN.test(all)) {
    delta += 3;
    reasons.push({ kind: "positive", text: "Uvedený původ zrn." });
  }
  if (FLAVOURED.test(text)) {
    delta -= 8;
    cap = "jsou_lepsi";
    reasons.push({ kind: "negative", text: "Aromatizovaná káva: aroma přebíjí (a často maskuje) chuť samotných zrn." });
  }
  if (/(cikork\p{L}*|čekank\p{L}*|chicory|zichorie|cikorij\p{L}*|pražen\p{L}* (?:žito|ječmen|obilí)|melta|kávovin\p{L}*)/iu.test(all)) {
    delta -= 5;
    reasons.push({ kind: "negative", text: "Káva naředěná náhražkou (cikorka, pražené obilí)." });
  }
  if (/(?<!\p{L})(instantní|instant|rozpustn\p{L}*|löslich|nes)(?!\p{L})/iu.test(all)) {
    delta -= 3;
    cap = cap ?? "urcite_kup";
    reasons.push({ kind: "neutral", text: "Instantní káva: pohodlná, chuťově slabší než čerstvě mletá." });
  }
  return { delta, reasons, cap };
}

export function teaRules(p: ProductData, text: string, items: string[]): QualityResult {
  const all = `${p.name} ${text}`;
  const reasons: Reason[] = [];
  let delta = 0;
  let cap: Verdict | undefined;
  if (/(?<!\p{L})(sypan\p{L}*|loose|lose|rasut\p{L}*|listov\p{L}*|celé lístky|whole leaf)(?!\p{L})/iu.test(all)) {
    delta += 4;
    reasons.push({ kind: "positive", text: "Sypaný čaj z celých lístků." });
  } else if (/(?<!\p{L})(fannings|dust|prach)(?!\p{L})/iu.test(all)) {
    delta -= 3;
    reasons.push({ kind: "neutral", text: "Drobný čajový prach (fannings/dust) v sáčcích – chuťově slabší." });
  }
  if (ORIGIN.test(all)) {
    delta += 3;
    reasons.push({ kind: "positive", text: "Uvedený původ čaje." });
  }
  if (FLAVOURED.test(text)) {
    delta -= 6;
    reasons.push({ kind: "negative", text: "Aromatizovaný čaj: chuť dodává aroma, ne čaj nebo ovoce." });
  }
  // fruit tea that is mostly hibiscus and apple, with the named fruit in traces
  const first = (items[0] ?? "").toLowerCase();
  if (/(ibišek|ibisk|hibisk|hibiscus|jablk|jabuk|apple|apfel|šípk|šipak|hagebutt)/iu.test(first)) {
    const smallFruit = items.slice(1).some((i) => /(\d{1,2}(?:[.,]\d+)?)\s*%/.test(i) && Number(/(\d{1,2}(?:[.,]\d+)?)\s*%/.exec(i)![1]!.replace(",", ".")) <= 5);
    if (smallFruit) {
      delta -= 4;
      reasons.push({ kind: "negative", text: "Ovocný čaj hlavně z ibišku, jablka nebo šípku; ovoce z názvu jen pár procent." });
    }
  }
  if (/(?<!\p{L})(sen[ay]|senna|sennes\p{L}*|list senny|sennesblätter)(?!\p{L})/iu.test(text)) {
    delta -= 8;
    cap = "jsou_lepsi";
    reasons.push({ kind: "warning", text: "Obsahuje senu: silně projímavá, jen krátkodobě (časté v „detox“ a „štíhlících“ čajích)." });
  }
  return { delta, reasons, cap };
}

export function spiceRules(p: ProductData, text: string, items: string[]): QualityResult {
  const reasons: Reason[] = [];
  let delta = 0;
  let cap: Verdict | undefined;
  const SALT = /(?<!\p{L})(sůl|soli|so|salt|salz|morsk\p{L}* sůl|jedlá sůl|kuhinjsk\p{L}* so)(?!\p{L})/iu;
  const first = items[0] ?? "";
  if (SALT.test(first)) {
    delta -= 15;
    cap = "kup_jestli_musis";
    reasons.push({ kind: "negative", text: "Kořenicí směs, která je hlavně sůl." });
  } else if (SALT.test(text)) {
    delta -= 4;
    reasons.push({ kind: "neutral", text: "Směs obsahuje i sůl." });
  }
  const filler = /(?<!\p{L})(maltodextrin\p{L}*|škrob\p{L}*|starch|stärke|dextróz\p{L}*|dextrose|cukr\p{L}*|sugar|zucker|šećer|mouk\p{L}*|flour|mehl|brašn\p{L}*|laktóz\p{L}*|syrovátk\p{L}*)(?!\p{L})/iu.exec(text);
  if (filler) {
    delta -= 6;
    reasons.push({ kind: "negative", text: `Plnidlo v koření (${filler[0]}) ředí to, za co platíte.` });
  }
  if (/(glutam\p{L}*|inosin\p{L}*|guanyl\p{L}*|ribonukleotid\p{L}*|e\s?6(2[0-9]|3[0-5])|zvýrazňovač\p{L}* chuti|pojačivač\p{L}* (?:ukusa|okusa)|geschmacksverstärker|flavou?r enhancer)/iu.test(text)) {
    delta -= 8;
    cap = cap ?? "jsou_lepsi";
    reasons.push({ kind: "negative", text: "Zvýrazňovač chuti (glutamát, inosinát) místo skutečného koření." });
  }
  if (/(barvivo|colou?r|farbstoff|boja|e\s?1[0-6]\d)/iu.test(text)) {
    delta -= 8;
    reasons.push({ kind: "negative", text: "Koření obarvené barvivem (u papriky a kurkumy znak horší suroviny)." });
  }
  if (/(?<!\p{L})(kasi[ea]|cassia|čínsk\p{L}* skořic\p{L}*|cinnamomum cassia|indonésk\p{L}* skořic\p{L}*)(?!\p{L})/iu.test(`${p.name} ${text}`)) {
    delta -= 3;
    reasons.push({
      kind: "warning",
      text: "Kasie (čínská skořice) obsahuje kumarin: ve větším množství zatěžuje játra, u dětí opatrně. Cejlonská skořice je bezpečnější.",
    });
  }
  const clean = items.length > 0 && items.length <= 3 && !filler && !SALT.test(text) && !FLAVOURED.test(text) && !/barvivo|e\s?\d{3}/iu.test(text);
  if (clean) {
    delta += 6;
    reasons.push({ kind: "positive", text: "Čisté koření bez soli a plnidel." });
  }
  return { delta, reasons, cap };
}
