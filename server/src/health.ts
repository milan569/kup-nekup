import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCode, referenceData, type AdditiveRecord } from "./data.js";
import { additiveCoversFlag } from "./scoring.js";
import type { HealthInfo, IngredientInfo } from "./types.js";

/**
 * Health impact texts for additives, unwanted ingredients and common
 * ingredients. Written once (server/data/health/*.json) so a tap in the app
 * costs nothing: no AI call, just a lookup.
 *
 * File rows: { id, excess, occasional, occasionalLevel, limit, groups, sources }
 *  - id "E250"            → additive
 *  - id with `patterns`   → common ingredient (also label, category)
 *  - any other id         → unwanted.json key
 */

const here = dirname(fileURLToPath(import.meta.url));
const HEALTH_DIR = join(here, "..", "data", "health");
const MAX_MATCHES = 6;

interface IngredientRecord {
  id: string;
  label: string;
  category: string;
  patterns: string[];
}

interface CompiledIngredient {
  record: IngredientRecord;
  health: HealthInfo;
  regexes: RegExp[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function toHealth(row: Record<string, unknown>): HealthInfo | undefined {
  const level = row.occasionalLevel;
  const excess = str(row.excess);
  const occasional = str(row.occasional);
  if (!excess || !occasional || (level !== 0 && level !== 1 && level !== 2 && level !== 3)) return undefined;
  const sources = Array.isArray(row.sources)
    ? row.sources.filter((u): u is string => typeof u === "string" && /^https:\/\//i.test(u))
    : [];
  return { excess, occasional, occasionalLevel: level, limit: str(row.limit), groups: str(row.groups), sources };
}

export class HealthData {
  private additives = new Map<string, HealthInfo>();
  private unwanted = new Map<string, HealthInfo>();
  readonly ingredients: CompiledIngredient[] = [];

  constructor(dir: string = HEALTH_DIR) {
    if (!existsSync(dir)) {
      console.warn("[health] data/health not found, tapping an ingredient shows only the short note");
      return;
    }
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      let rows: unknown;
      try {
        rows = JSON.parse(readFileSync(join(dir, file), "utf8"));
      } catch (err) {
        console.warn(`[health] ${file} could not be parsed: ${(err as Error).message}`);
        continue;
      }
      if (!Array.isArray(rows)) continue;
      for (const row of rows as Record<string, unknown>[]) {
        const id = str(row?.id);
        const health = row && toHealth(row);
        if (!id || !health) continue;
        if (Array.isArray(row.patterns)) {
          const regexes = (row.patterns as unknown[])
            .filter((p): p is string => typeof p === "string")
            .map((p) => {
              try {
                return new RegExp(p, "iu");
              } catch {
                console.warn(`[health] bad regex skipped (${id}): ${p}`);
                return undefined;
              }
            })
            .filter((r): r is RegExp => r !== undefined);
          if (!regexes.length) continue;
          this.ingredients.push({
            record: { id, label: str(row.label) || id, category: str(row.category), patterns: row.patterns as string[] },
            health,
            regexes,
          });
        } else if (/^e\s*-?\d{3,4}[a-z]?$/i.test(id)) {
          this.additives.set(normalizeCode(id), health);
        } else {
          this.unwanted.set(id, health);
        }
      }
    }
  }

  additive(code: string): HealthInfo | undefined {
    return this.additives.get(normalizeCode(code));
  }

  unwantedHealth(key: string): HealthInfo | undefined {
    return this.unwanted.get(key);
  }

  ingredient(id: string): CompiledIngredient | undefined {
    return this.ingredients.find((i) => i.record.id === id);
  }

  counts(): { additives: number; unwanted: number; ingredients: number } {
    return { additives: this.additives.size, unwanted: this.unwanted.size, ingredients: this.ingredients.length };
  }
}

let shared: HealthData | undefined;
export function healthData(): HealthData {
  if (!shared) shared = new HealthData();
  return shared;
}

function uniq(urls: string[]): string[] {
  return [...new Set(urls)];
}

function additiveInfo(a: AdditiveRecord, h: HealthData): IngredientInfo {
  const health = h.additive(a.code);
  return {
    kind: "additive",
    id: a.code,
    title: `${a.code} ${a.name}`,
    category: a.category,
    risk: a.risk,
    note: a.note,
    health,
    sources: uniq([...(health?.sources ?? []), ...(a.sources ?? [])]),
  };
}

/** Where an additive is mentioned in lower-case text (code first, then the longest alias). */
function additiveSpan(lower: string, a: AdditiveRecord): [number, number] | undefined {
  const digits = normalizeCode(a.code).slice(1);
  const m = new RegExp(`(?<![a-z0-9])e[\\s-]?0*${digits}(?![0-9a-z])`, "i").exec(lower);
  if (m) return [m.index, m.index + m[0].length];
  const aliases = [a.name, ...(a.aliases ?? [])].map((x) => x.toLowerCase()).sort((x, y) => y.length - x.length);
  for (const alias of aliases) {
    if (alias.length < 4) continue;
    const i = lower.indexOf(alias);
    if (i >= 0) return [i, i + alias.length];
  }
  return undefined;
}

function weight(x: IngredientInfo): number {
  return Math.max(x.risk ?? 0, x.health?.occasionalLevel ?? 0);
}

/**
 * Everything worth explaining in one tapped ingredient, worst first.
 * "dusitanová solicí směs (sůl, E250)" → E250 dusitan sodný, sůl.
 * `context` is the whole ingredient list (meat-only fillers depend on it).
 */
export function ingredientInfo(text: string, context: string = text): IngredientInfo[] {
  const ref = referenceData();
  const h = healthData();
  const q = text.replace(/_/g, "").trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const out: { info: IngredientInfo; pos: number }[] = [];
  const spans: [number, number][] = [];
  const overlaps = (s: number, e: number) => spans.some(([a, b]) => s < b && a < e);

  const additives = ref.additivesInText(q);
  for (const a of additives) {
    const span = additiveSpan(lower, a);
    if (span) spans.push(span);
    out.push({ info: additiveInfo(a, h), pos: span?.[0] ?? 0 });
  }

  for (const { record, matchedText } of ref.unwantedInText(q, context.replace(/_/g, ""))) {
    // "dusitanová solicí směs (E250)": E250 already explains the nitrite
    if (additiveCoversFlag(record.key, additives)) continue;
    const pos = lower.indexOf(matchedText.toLowerCase());
    if (pos >= 0) spans.push([pos, pos + matchedText.length]);
    const health = h.unwantedHealth(record.key);
    out.push({
      info: {
        kind: "unwanted",
        id: record.key,
        title: record.label,
        category: "složka, na kterou si dát pozor",
        risk: record.severity,
        note: record.note,
        matchedText,
        health,
        sources: health?.sources ?? [],
      },
      pos: Math.max(0, pos),
    });
  }

  const candidates: { c: CompiledIngredient; start: number; end: number; text: string }[] = [];
  for (const c of h.ingredients) {
    for (const re of c.regexes) {
      const m = re.exec(q);
      if (m && m[0].length > 0) {
        candidates.push({ c, start: m.index, end: m.index + m[0].length, text: m[0] });
        break;
      }
    }
  }
  // the longest match wins ("sušené mléko" over "mléko"); nothing inside an additive or unwanted match
  candidates.sort((x, y) => y.end - y.start - (x.end - x.start) || x.start - y.start);
  for (const cand of candidates) {
    if (overlaps(cand.start, cand.end)) continue;
    spans.push([cand.start, cand.end]);
    out.push({
      info: {
        kind: "ingredient",
        id: cand.c.record.id,
        title: cand.c.record.label,
        category: cand.c.record.category,
        note: "",
        matchedText: cand.text,
        health: cand.c.health,
        sources: cand.c.health.sources,
      },
      pos: cand.start,
    });
  }

  return out
    .sort((x, y) => weight(y.info) - weight(x.info) || x.pos - y.pos)
    .slice(0, MAX_MATCHES)
    .map((x) => x.info);
}

/** Direct lookup: "additive:E250", "unwanted:palm-oil", "ingredient:sugar". */
export function ingredientInfoByRef(refId: string): IngredientInfo[] {
  const [kind, ...rest] = refId.split(":");
  const id = rest.join(":").trim();
  if (!id) return [];
  const h = healthData();
  const ref = referenceData();
  if (kind === "additive") {
    const a = ref.additiveByCode(id);
    return a ? [additiveInfo(a, h)] : [];
  }
  if (kind === "unwanted") {
    const u = ref.unwanted.find((x) => x.record.key === id)?.record;
    if (!u) return [];
    const health = h.unwantedHealth(u.key);
    return [
      {
        kind: "unwanted",
        id: u.key,
        title: u.label,
        category: "složka, na kterou si dát pozor",
        risk: u.severity,
        note: u.note,
        health,
        sources: health?.sources ?? [],
      },
    ];
  }
  if (kind === "ingredient") {
    const c = h.ingredient(id);
    return c
      ? [{ kind: "ingredient", id, title: c.record.label, category: c.record.category, note: "", health: c.health, sources: c.health.sources }]
      : [];
  }
  return [];
}

/** 0 = nothing known, 1–3 = worst additive risk or unwanted-flag severity inside one ingredient. */
export function itemSeverity(item: string, context: string = item): number {
  const ref = referenceData();
  const q = item.replace(/_/g, "");
  let s = 0;
  for (const a of ref.additivesInText(q)) s = Math.max(s, a.risk);
  for (const { record } of ref.unwantedInText(q, context.replace(/_/g, ""))) s = Math.max(s, record.severity);
  return s;
}
