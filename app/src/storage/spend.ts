import { readJson, writeJson } from "./kv";

/**
 * Estimated AI spend of this device and a daily cap. Every Claude call
 * reports its usage (core/usage.ts); the estimate uses list prices, so it is
 * close but not the invoice. The cap is the last line of defence now that
 * there is no server: once today's estimate reaches it, AI features stop
 * until tomorrow (the barcode lookup and the rules keep working).
 */
export interface SpendState {
  /** estimated USD since `since` */
  usd: number;
  calls: number;
  since: string;
  /** local date YYYY-MM-DD the daily counters belong to */
  day: string;
  dayUsd: number;
  dayCalls: number;
  /** 0 = no cap */
  dailyCapUsd: number;
}

const KEY = "spend";
export const DEFAULT_DAILY_CAP_USD = 5;

let state: SpendState | undefined;
const listeners = new Set<(s: SpendState) => void>();

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fresh(): SpendState {
  return { usd: 0, calls: 0, since: new Date().toISOString(), day: today(), dayUsd: 0, dayCalls: 0, dailyCapUsd: DEFAULT_DAILY_CAP_USD };
}

function rollover(s: SpendState): SpendState {
  if (s.day === today()) return s;
  return { ...s, day: today(), dayUsd: 0, dayCalls: 0 };
}

export async function loadSpend(): Promise<SpendState> {
  const stored = await readJson<Partial<SpendState> | null>(KEY, null);
  state = rollover({ ...fresh(), ...(stored ?? {}) });
  return state;
}

/** The in-memory copy (undefined before loadSpend). */
export function currentSpend(): SpendState | undefined {
  if (state) state = rollover(state);
  return state;
}

async function persist(next: SpendState): Promise<void> {
  state = next;
  await writeJson(KEY, next);
  for (const fn of listeners) fn(next);
}

export async function addSpend(usd: number): Promise<void> {
  const s = rollover(state ?? (await loadSpend()));
  await persist({ ...s, usd: s.usd + usd, calls: s.calls + 1, dayUsd: s.dayUsd + usd, dayCalls: s.dayCalls + 1 });
}

export async function setDailyCap(usd: number): Promise<void> {
  const s = state ?? (await loadSpend());
  await persist({ ...s, dailyCapUsd: Math.max(0, usd) });
}

export async function resetSpend(): Promise<void> {
  const s = state ?? (await loadSpend());
  await persist({ ...fresh(), dailyCapUsd: s.dailyCapUsd });
}

export function onSpendChange(fn: (s: SpendState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** For core/usage.setSpendGuard: a message when today's estimate has reached the cap. */
export function spendGuardMessage(): string | undefined {
  const s = currentSpend();
  if (!s || s.dailyCapUsd <= 0 || s.dayUsd < s.dailyCapUsd) return undefined;
  return `Denní strop útraty za AI (${s.dailyCapUsd.toFixed(2)} USD) je dnes vyčerpán. Zvyšte ho v Profilu → Claude API klíč, nebo počkejte do zítřka. Čárový kód a pravidla fungují dál.`;
}

export function formatUsd(usd: number): string {
  return `${usd.toFixed(usd < 1 ? 3 : 2)} USD`;
}
