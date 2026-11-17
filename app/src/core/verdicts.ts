// Verdict scale shared between server and app.
// Keep in sync with app/src/api/verdicts.ts (copy verbatim; the app imports "./types").
import type { LabelSet, Tone, ValueVerdict, Verdict } from "./types";

export interface VerdictText {
  label: string;
  subtitle: string;
}

export interface VerdictMeta {
  key: Verdict;
  /** 7 = best … 1 = worst, 0 = unknown */
  rank: number;
  emoji: string;
  /** badge background */
  color: string;
  /** text on the badge */
  textColor: string;
  /** inclusive score band; undefined for "nevime" */
  minScore?: number;
  maxScore?: number;
  humor: VerdictText;
  serious: VerdictText;
}

export const VERDICTS: Record<Verdict, VerdictMeta> = {
  poklad: {
    key: "poklad",
    rank: 7,
    emoji: "💎",
    color: "#00695C",
    textColor: "#FFFFFF",
    minScore: 88,
    maxScore: 100,
    humor: { label: "Poklad z regálu!", subtitle: "Poctivá práce bez keců. Ber, dokud to mají." },
    serious: { label: "Výborná volba", subtitle: "Čisté složení, poctivý produkt." },
  },
  urcite_kup: {
    key: "urcite_kup",
    rank: 6,
    emoji: "👍",
    color: "#2E7D32",
    textColor: "#FFFFFF",
    minScore: 74,
    maxScore: 87,
    humor: { label: "Ber a neřeš", subtitle: "Žádné triky, žádný šmejd. Klidně dvakrát." },
    serious: { label: "Určitě kup", subtitle: "Kvalitní volba." },
  },
  jsou_lepsi: {
    key: "jsou_lepsi",
    rank: 5,
    emoji: "🙂",
    color: "#F9A825",
    textColor: "#1A1A1A",
    minScore: 60,
    maxScore: 73,
    humor: { label: "Ujde to", subtitle: "Žádná tragédie, ale o regál vedle mají lepší." },
    serious: { label: "Nic proti, ale jsou lepší", subtitle: "V pořádku, existují lepší alternativy." },
  },
  kup_jestli_musis: {
    key: "kup_jestli_musis",
    rank: 4,
    emoji: "😐",
    color: "#EF6C00",
    textColor: "#FFFFFF",
    minScore: 46,
    maxScore: 59,
    humor: { label: "Nouzovka", subtitle: "Hlady nechcípneš, ale radost z toho mít nebudeš." },
    serious: { label: "Kup, jestli musíš", subtitle: "Průmyslový výrobek, hledejte lepší." },
  },
  radsi_ne: {
    key: "radsi_ne",
    rank: 3,
    emoji: "🧪",
    color: "#D84315",
    textColor: "#FFFFFF",
    minScore: 32,
    maxScore: 45,
    humor: { label: "Chemický šmejd", subtitle: "Víc laboratoř než kuchyně. Nech to tam." },
    serious: { label: "Raději ne", subtitle: "Výrazné nedostatky ve složení." },
  },
  nekupuj: {
    key: "nekupuj",
    rank: 2,
    emoji: "⛔",
    color: "#C62828",
    textColor: "#FFFFFF",
    minScore: 16,
    maxScore: 31,
    humor: { label: "Šizená prasárna", subtitle: "Ošizené jak prase. Ruce pryč!" },
    serious: { label: "Nekupuj!", subtitle: "Závažné nedostatky." },
  },
  sracka: {
    key: "sracka",
    rank: 1,
    emoji: "💩",
    color: "#4E342E",
    textColor: "#FFFFFF",
    minScore: 0,
    maxScore: 15,
    humor: { label: "Naprostá sračka", subtitle: "Tohle by nežral ani hladovej pes. Utíkej!" },
    serious: { label: "Naprosto nevhodné", subtitle: "Nejhorší kategorie." },
  },
  nevime: {
    key: "nevime",
    rank: 0,
    emoji: "❓",
    color: "#616161",
    textColor: "#FFFFFF",
    humor: { label: "Hovno víme", subtitle: "Vyfoť etiketu a rozlouskneme to." },
    serious: { label: "Nevíme", subtitle: "Chybí údaje, vyfoťte etiketu." },
  },
};

/** worst → best, without "nevime" */
/** Price/value badges shown next to the quality verdict ("ok" and "nevime" show nothing). */
export interface ValueMeta {
  emoji: string;
  color: string;
  textColor: string;
  humor: VerdictText;
  serious: VerdictText;
}

export const VALUE_VERDICTS: Record<Exclude<ValueVerdict, "ok" | "nevime">, ValueMeta> = {
  vyhozene_prachy: {
    emoji: "💸",
    color: "#6A1B9A",
    textColor: "#FFFFFF",
    humor: { label: "Vyhozený prachy", subtitle: "Platíš za značku a reklamu, ne za to, co je uvnitř." },
    serious: { label: "Předražené", subtitle: "Stejnou kvalitu seženete výrazně levněji." },
  },
  vyhodne: {
    emoji: "💰",
    color: "#00695C",
    textColor: "#FFFFFF",
    humor: { label: "Za ty prachy dobrý", subtitle: "Poctivá věc za rozumnou cenu." },
    serious: { label: "Výhodná koupě", subtitle: "Dobrý poměr ceny a kvality." },
  },
};

export function valueText(v: keyof typeof VALUE_VERDICTS, tone: Tone = "humor"): VerdictText {
  return VALUE_VERDICTS[v][tone === "serious" ? "serious" : "humor"];
}

/** What the price badge says once the quality verdict is known. */
export interface ValueBadgeView {
  /** "levne" = a low price on a product that earns no praise: poor quality, or quality unknown */
  kind: "vyhozene_prachy" | "vyhodne" | "levne";
  emoji: string;
  color: string;
  textColor: string;
  text: VerdictText;
}

const CHEAP: ValueMeta = {
  emoji: "🪙",
  color: "#455A64",
  textColor: "#FFFFFF",
  humor: { label: "Levný, to jo", subtitle: "Stojí málo, protože za moc nestojí." },
  serious: { label: "Nízká cena", subtitle: "Cena nevyvažuje slabou kvalitu." },
};
const CHEAP_UNKNOWN: Record<"humor" | "serious", VerdictText> = {
  humor: { label: "Levný, to jo", subtitle: "Cena dobrá. Co je uvnitř, zatím nevíme." },
  serious: { label: "Nízká cena", subtitle: "Kvalitu zatím nelze posoudit." },
};
const GOOD_VALUE_AVERAGE: Record<"humor" | "serious", VerdictText> = {
  humor: { label: "Za ty prachy dobrý", subtitle: "Žádný zázrak, ale cena sedí." },
  serious: { label: "Výhodná koupě", subtitle: "Průměrná kvalita za příznivou cenu." },
};

/**
 * The price badge that fits the quality verdict on the same screen.
 * "Za ty prachy dobrý – poctivá věc" praises the product, so it needs one worth
 * buying; next to "Chemický šmejd" it was a contradiction. A low price on a poor
 * product, or on one whose quality is unknown, is shown as just that: cheap.
 */
export function valueBadge(value: ValueVerdict | undefined, quality: Verdict, tone: Tone = "humor"): ValueBadgeView | null {
  const t = tone === "serious" ? "serious" : "humor";
  if (value === "vyhozene_prachy") {
    const m = VALUE_VERDICTS.vyhozene_prachy;
    return { kind: "vyhozene_prachy", emoji: m.emoji, color: m.color, textColor: m.textColor, text: m[t] };
  }
  if (value !== "vyhodne") return null;
  const rank = VERDICTS[quality]?.rank ?? 0;
  if (rank >= VERDICTS.jsou_lepsi.rank) {
    const m = VALUE_VERDICTS.vyhodne;
    return { kind: "vyhodne", emoji: m.emoji, color: m.color, textColor: m.textColor, text: rank > VERDICTS.jsou_lepsi.rank ? m[t] : GOOD_VALUE_AVERAGE[t] };
  }
  return { kind: "levne", emoji: CHEAP.emoji, color: CHEAP.color, textColor: CHEAP.textColor, text: rank === 0 ? CHEAP_UNKNOWN[t] : CHEAP[t] };
}

/** an overpriced product can be at most "jsou lepší": the same thing cheaper is the better buy */
export const VALUE_CAP: Verdict = "jsou_lepsi";

export const VERDICT_SCALE: Verdict[] = ["sracka", "nekupuj", "radsi_ne", "kup_jestli_musis", "jsou_lepsi", "urcite_kup", "poklad"];

/** Humour labels for drink: "Nouzovka – hlady nechcípneš" makes no sense on a bottle of rum. */
export const ALCOHOL_HUMOR: Record<Verdict, VerdictText> = {
  poklad: { label: "Nektar bohů", subtitle: "Tohle se neleje, tohle se vychutnává. Ber, dokud to mají." },
  urcite_kup: { label: "Dobrej chlast", subtitle: "Poctivě vyrobený, chutná a ráno z něj hlava nebolí." },
  jsou_lepsi: { label: "Dá se vypít", subtitle: "Žádná tragédie, ale za stejný prachy ti nalejou lepší." },
  kup_jestli_musis: { label: "Slabej odvar", subtitle: "Patok na žízeň. Když není nic lepšího, přežiješ to." },
  radsi_ne: { label: "Bolehlav", subtitle: "Líh, aroma a cukr. Ráno ti to spočítá." },
  nekupuj: { label: "Šizený chcanky", subtitle: "Ošizené jak prase. Ruce pryč!" },
  sracka: { label: "Technickej líh", subtitle: "Na čištění oken ano, do huby ne. Utíkej!" },
  nevime: { label: "Hovno víme", subtitle: "Vyfoť etiketu a zjistíme, co to leješ." },
};

const LABEL_SETS: Record<LabelSet, Record<Verdict, VerdictText>> = { alcohol: ALCOHOL_HUMOR };

export function verdictText(v: Verdict, tone: Tone = "humor", labelSet?: LabelSet): VerdictText {
  // a stored verdict from an older version may be unknown: never crash the list, show "nevíme"
  const base = VERDICTS[v] ?? VERDICTS.nevime;
  if (tone !== "serious" && labelSet && LABEL_SETS[labelSet]) return LABEL_SETS[labelSet][v] ?? base.humor;
  return base[tone];
}

export function verdictFromScore(score: number): Verdict {
  for (const v of [...VERDICT_SCALE].reverse()) {
    if (score >= (VERDICTS[v].minScore ?? 0)) return v;
  }
  return "sracka";
}

/** true when a is strictly better than b */
export function isBetter(a: Verdict, b: Verdict): boolean {
  return VERDICTS[a].rank > VERDICTS[b].rank;
}
