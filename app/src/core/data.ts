import additivesJson from "./data/additives.json";
import unwantedJson from "./data/unwanted.json";
import allergensJson from "./data/allergens.json";
import { sha1Hex } from "./hash";
import type { AdditiveInfo, Risk } from "./types";

/**
 * Reference tables (E-numbers, unwanted ingredients, allergens). They ship
 * inside the app bundle as static JSON, so nothing is read from disk.
 */

export interface AdditiveRecord extends AdditiveInfo {
  nameEn: string;
  aliases: string[];
}

export interface UnwantedRecord {
  key: string;
  label: string;
  severity: 1 | 2 | 3;
  note: string;
  patterns: string[];
}

export interface AllergenRecord {
  tag: string;
  label: string;
  patterns: string[];
}

export interface CompiledPattern<T> {
  record: T;
  regexes: RegExp[];
}

function compile<T extends { patterns: string[] }>(records: T[]): CompiledPattern<T>[] {
  return records.map((record) => ({
    record,
    regexes: record.patterns
      .map((p) => {
        try {
          return new RegExp(p, "iu");
        } catch {
          console.warn(`[data] bad regex skipped: ${p}`);
          return undefined;
        }
      })
      .filter((r): r is RegExp => r !== undefined),
  }));
}

/**
 * Bump when normalisation logic changes in a way that alters cached products
 * (derived additives / flagged ingredients are stored with the product).
 */
const NORMALIZE_VERSION = 3; // 3: products carry all package photos

export class ReferenceData {
  /** changes whenever a data file or the normalisation logic changes */
  readonly version: string;
  readonly additives: AdditiveRecord[];
  readonly unwanted: CompiledPattern<UnwantedRecord>[];
  readonly allergens: CompiledPattern<AllergenRecord>[];
  private byCode = new Map<string, AdditiveRecord>();
  private aliasIndex: { alias: string; record: AdditiveRecord }[] = [];

  constructor() {
    this.version = sha1Hex(
      String(NORMALIZE_VERSION) + JSON.stringify(additivesJson) + JSON.stringify(unwantedJson) + JSON.stringify(allergensJson),
    ).slice(0, 8);
    this.additives = additivesJson as unknown as AdditiveRecord[];
    this.unwanted = compile(unwantedJson as unknown as UnwantedRecord[]);
    this.allergens = compile(allergensJson as unknown as AllergenRecord[]);
    for (const a of this.additives) {
      this.byCode.set(normalizeCode(a.code), a);
      for (const alias of a.aliases ?? []) {
        if (alias.length >= 4) this.aliasIndex.push({ alias: alias.toLowerCase(), record: a });
      }
    }
    // longest alias first so "glutaman sodný" wins over "glutaman"
    this.aliasIndex.sort((x, y) => y.alias.length - x.alias.length);
  }

  /** Lookup by "E621", "e621", "en:e621", "E-621", "E 621" */
  additiveByCode(code: string): AdditiveRecord | undefined {
    return this.byCode.get(normalizeCode(code));
  }

  /** Find additives mentioned in free ingredient text (codes or names). */
  additivesInText(text: string): AdditiveRecord[] {
    const found = new Map<string, AdditiveRecord>();
    const lower = text.toLowerCase();
    for (const m of lower.matchAll(/\be[\s-]?(\d{3,4}[a-z]?)\b/g)) {
      const rec = this.byCode.get("e" + m[1]);
      if (rec) found.set(rec.code, rec);
    }
    for (const { alias, record } of this.aliasIndex) {
      if (found.has(record.code)) continue;
      if (lower.includes(alias)) found.set(record.code, record);
    }
    return [...found.values()];
  }

  /** `context`: the whole ingredient list when `text` is a single ingredient (meat-only fillers need it) */
  unwantedInText(text: string, context: string = text): { record: UnwantedRecord; matchedText: string }[] {
    const out: { record: UnwantedRecord; matchedText: string }[] = [];
    const isMeat = MEAT_CONTEXT.test(context);
    for (const { record, regexes } of this.unwanted) {
      // "sugar-first" only makes sense by position; scoring checks that itself
      if (record.key === "sugar-first") continue;
      // protein/starch "fillers" are a problem in meat products, not in biscuits
      if (MEAT_ONLY_KEYS.has(record.key) && !isMeat) continue;
      let hit: string | undefined;
      for (const re of regexes) {
        const all = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
        for (const m of text.matchAll(all)) {
          // "nitrates 1 mg/L" in a mineral water analysis is a measured content, not an added ingredient
          if (m[0] && !isMeasuredContent(text, (m.index ?? 0) + m[0].length)) {
            hit = m[0];
            break;
          }
        }
        if (hit) break;
      }
      if (hit) out.push({ record, matchedText: hit });
    }
    return out;
  }

  allergensInText(text: string): string[] {
    const tags: string[] = [];
    for (const { record, regexes } of this.allergens) {
      if (regexes.some((re) => re.test(text))) tags.push(record.tag);
    }
    return tags;
  }

  allergenLabel(tag: string): string {
    return this.allergens.find((a) => a.record.tag === tag)?.record.label ?? tag;
  }

  unwantedLabel(key: string): string {
    return this.unwanted.find((u) => u.record.key === key)?.record.label ?? key;
  }
}

/** A concentration right after a match ("dusičnany (NO3-): 1 mg/l", "nitrates < 2 mg/L"). */
const MEASURED = /^\s*(?:\([^)]{0,12}\))?\s*(?:[:=\-–]\s*)?[<≤]?\s*\d+(?:[.,]\d+)?\s*(?:mg|µg|μg|ug)\s*\/\s*(?:l|dm3|kg)(?![a-z])/i;
export function isMeasuredContent(text: string, end: number): boolean {
  return MEASURED.test(text.slice(end, end + 32));
}

const MEAT_ONLY_KEYS = new Set(["soy-protein-filler", "milk-protein-filler", "starch-filler"]);
const MEAT_CONTEXT =
  /(?<!\p{L})(vepřov|hověz|kuřec|krůt|drůbež|telec|jehněč|maso|masa|meat|pork|beef|chicken|fleisch|schwein|rind|meso|mesa|svinjsk|goveđ|pileć|месо|свињск|mięso|wieprzow|wołow|hús|sertés|carne|šunk|šunka|salám|klobás|párk|wurst|kobasic|кобасиц)/iu;

export function normalizeCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/^en:/, "")
    .replace(/[\s-]/g, "")
    .replace(/^e0*/, "e");
}

export function riskLabel(risk: Risk): string {
  return ["bez obav", "nízké riziko", "střední riziko", "vysoké riziko"][risk];
}

let shared: ReferenceData | undefined;
export function referenceData(): ReferenceData {
  if (!shared) shared = new ReferenceData();
  return shared;
}

/** Cache namespace for normalised products; changes with the data version. */
export function productNamespace(): string {
  return `product@${referenceData().version}`;
}
