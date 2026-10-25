import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Insight, InsightSource, QuickInsight, Tone, LabelSet } from "../api/types";
import { WORKING_HUMOR, WORKING_SERIOUS } from "../data/phrases";
import { useRotatingPhrase } from "../hooks/useRotatingPhrase";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBox } from "../components/ErrorBox";
import { Skeleton } from "../components/Skeleton";
import { SourceLink, domainOf } from "../components/SourceLink";
import { VerdictBadge } from "../components/VerdictBadge";
import type { InsightStatus } from "../hooks/useInsight";
import { confidenceLabels, fontSize, radius, spacing, useTheme } from "../theme";

const DEEP_LINES: Record<Tone, string[]> = {
  humor: ["Pátrám, jestli to dřív nebylo lepší…", "Čtu staré recenze…", "Prověřuji majitele…", "Slídím po složení a lepších kouscích…"],
  serious: ["Vyhledávám informace o výrobci…", "Ověřuji historii receptury…", "Hledám složení a lepší alternativy…"],
};

interface Props {
  tone: Tone;
  /** the scanned product's label set ("alcohol": drinking scale) */
  labelSet?: LabelSet;
  // quick
  quickStatus: InsightStatus;
  quick?: QuickInsight;
  quickError: string | null;
  onRetryQuick: () => void;
  // deep
  deepStatus: InsightStatus;
  insight?: Insight;
  deepError: string | null;
  meta: { cached: boolean; ms: number } | null;
  onStartDeep: () => void;
}

/** Content of the „Posudek AI" card: quick opinion first, deep research on a button. */
export function InsightSection(props: Props) {
  const { tone, labelSet, quickStatus, quick, quickError, onRetryQuick, deepStatus, insight, deepError, meta, onStartDeep } = props;
  const t = useTheme();
  // the waiting line rotates through the funny phrases so a 15-second wait does not feel stuck
  const working = useRotatingPhrase(tone === "serious" ? WORKING_SERIOUS : WORKING_HUMOR, quickStatus === "loading");

  // Deep research done → it replaces the quick opinion, no button.
  if (deepStatus === "done" && insight) {
    return <DeepOpinion insight={insight} meta={meta} tone={tone} labelSet={labelSet} />;
  }

  return (
    <View>
      {quickStatus === "loading" && (
        <View>
          <Skeleton lines={3} />
          <Text style={[styles.status, { color: t.text }]}>{`${working.label} ${working.subtitle}`}</Text>
        </View>
      )}
      {quickStatus === "error" && (
        <ErrorBox message={quickError ?? "Rychlý názor se nepodařilo načíst."} onRetry={onRetryQuick} />
      )}
      {quickStatus === "idle" && (
        <Text style={[styles.muted, { color: t.muted }]}>Rychlý názor AI se načte po otevření této karty.</Text>
      )}
      {quickStatus === "done" && quick && <QuickOpinion quick={quick} tone={tone} labelSet={labelSet} />}

      <View style={[styles.divider, { backgroundColor: t.border }]} />
      <DeepAction status={deepStatus} error={deepError} tone={tone} onStart={onStartDeep} />
    </View>
  );
}

function QuickOpinion({ quick, tone, labelSet }: { quick: QuickInsight; tone: Tone; labelSet?: LabelSet }) {
  const t = useTheme();
  const n = quick.sources.length;
  return (
    <View>
      <Text style={[styles.headline, { color: t.text }]}>{quick.headline}</Text>
      <Text style={[styles.opinion, { color: t.text }]}>{quick.opinion}</Text>
      <View style={styles.verdictRow}>
        <VerdictBadge verdict={quick.verdict} size="compact" tone={tone} labelSet={labelSet} />
        <View style={{ width: spacing.sm }} />
        <Chip label={confidenceLabels[quick.confidence]} small style={{ marginBottom: 0 }} />
      </View>
      <Text style={[styles.footer, { color: t.muted }]}>
        {quick.refined ? "Rychlý názor · upřesněno po doplnění fotky" : "Rychlý názor"}
        {n > 0 ? ` · ověřeno na webu · ${n} ${plural(n, "zdroj", "zdroje", "zdrojů")}` : " · bez webového ověření"}
      </Text>
      {n > 0 && <SourceList sources={quick.sources} />}
    </View>
  );
}

function SourceList({ sources }: { sources: InsightSource[] }) {
  return (
    <View style={styles.sources}>
      {sources.map((s, i) => (
        <View key={s.url + i} style={{ marginRight: spacing.md }}>
          <SourceLink url={s.url} label={`${shorten(s.title || domainOf(s.url), 42)} ↗`} />
        </View>
      ))}
    </View>
  );
}

function DeepAction({ status, error, tone, onStart }: { status: InsightStatus; error: string | null; tone: Tone; onStart: () => void }) {
  const t = useTheme();
  if (status === "loading") return <DeepProgress tone={tone} />;
  if (status === "error") {
    return <ErrorBox title="Důkladný průzkum se nepovedl" message={error ?? "Zkuste to prosím znovu."} onRetry={onStart} />;
  }
  return (
    <Pressable
      onPress={onStart}
      accessibilityRole="button"
      style={({ pressed }) => [styles.deepBtn, { borderColor: t.primary, backgroundColor: t.cardAlt, opacity: pressed ? 0.8 : 1 }]}
    >
      <Text style={[styles.deepTitle, { color: t.primary }]}>🔎 Důkladný průzkum (1–2 min)</Text>
      <Text style={[styles.deepDesc, { color: t.muted }]}>Historie značky, změny receptury, kauzy, testy a lepší alternativy s fotkami.</Text>
    </Pressable>
  );
}

function DeepProgress({ tone }: { tone: Tone }) {
  const t = useTheme();
  const lines = DEEP_LINES[tone];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIdx((i) => (i + 1) % lines.length), 2500);
    return () => clearInterval(timer);
  }, [lines.length]);

  return (
    <View style={[styles.deepBtn, { borderColor: t.border, backgroundColor: t.cardAlt }]}>
      <View style={styles.progressRow}>
        <ActivityIndicator color={t.primary} />
        <Text style={[styles.status, { color: t.text, marginTop: 0, marginLeft: spacing.md, flex: 1 }]}>{lines[idx % lines.length]}</Text>
      </View>
      <Text style={[styles.deepDesc, { color: t.muted }]}>Důkladný průzkum trvá 1–2 minuty. Verdikt z pravidel platí hned.</Text>
    </View>
  );
}

function DeepOpinion({ insight, meta, tone, labelSet }: { insight: Insight; meta: { cached: boolean; ms: number } | null; tone: Tone; labelSet?: LabelSet }) {
  const t = useTheme();
  return (
    <View>
      <Text style={[styles.headline, { color: t.text }]}>{insight.headline}</Text>
      <Text style={[styles.opinion, { color: t.text }]}>{insight.opinion}</Text>
      <View style={styles.verdictRow}>
        <Text style={[styles.verdictLabel, { color: t.muted }]}>Verdikt AI</Text>
        <VerdictBadge verdict={insight.verdict} size="compact" tone={tone} labelSet={labelSet} />
      </View>
      <ChipRow>
        <Chip label={confidenceLabels[insight.confidence]} small />
        {insight.webResearch && insight.sources.length > 0 ? <Chip label={`${insight.sources.length} zdrojů z webu`} small /> : null}
      </ChipRow>
      {!insight.webResearch && (
        <Text style={[styles.note, { color: t.muted }]}>Bez webového průzkumu – jen znalosti modelu.</Text>
      )}
      <Text style={[styles.footer, { color: t.muted }]}>
        {[
          "Důkladný průzkum",
          insight.model,
          meta ? (meta.cached ? "z mezipaměti" : `${(meta.ms / 1000).toFixed(1).replace(".", ",")} s`) : formatDate(insight.generatedAt),
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </View>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

function shorten(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("cs-CZ");
  } catch {
    return iso.slice(0, 10);
  }
}

const styles = StyleSheet.create({
  headline: { fontSize: fontSize.lg, fontWeight: "800", lineHeight: 24, marginBottom: spacing.sm },
  opinion: { fontSize: fontSize.md, lineHeight: 23 },
  verdictRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: spacing.md, marginBottom: spacing.sm },
  verdictLabel: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginRight: spacing.sm },
  note: { fontSize: fontSize.sm, fontStyle: "italic", marginBottom: spacing.xs },
  footer: { fontSize: fontSize.xs, marginTop: spacing.xs },
  sources: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.xs },
  status: { fontSize: fontSize.md, fontWeight: "600", marginTop: spacing.xs },
  muted: { fontSize: fontSize.sm, lineHeight: 20, marginTop: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.lg },
  deepBtn: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, minHeight: 64 },
  deepTitle: { fontSize: fontSize.md, fontWeight: "800" },
  deepDesc: { fontSize: fontSize.sm, lineHeight: 20, marginTop: spacing.xs },
  progressRow: { flexDirection: "row", alignItems: "center" },
});
