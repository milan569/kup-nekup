import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Insight, InsightEvent } from "../api/types";
import { Button } from "../components/Button";
import { InlineLoading } from "../components/LoadingOverlay";
import { SourceLink } from "../components/SourceLink";
import type { InsightStatus } from "../hooks/useInsight";
import { fontSize, radius, spacing, useTheme } from "../theme";

const IMPACT_COLORS: Record<InsightEvent["impact"], string> = {
  positive: "#2E7D32",
  negative: "#C62828",
  neutral: "#9E9E9E",
};

/** Subtitle for the collapsed card, e.g. „4 události · receptura se změnila". */
export function historySubtitle(insight?: Insight): string | undefined {
  if (!insight) return undefined;
  const parts: string[] = [];
  if (insight.history.length) parts.push(`${insight.history.length} ${plural(insight.history.length, "událost", "události", "událostí")}`);
  if (insight.recipeChange.changed === "yes") parts.push("receptura se změnila");
  if (insight.issues.length) parts.push(`${insight.issues.length} ${plural(insight.issues.length, "problém", "problémy", "problémů")}`);
  if (insight.awards.length) parts.push(`${insight.awards.length} ${plural(insight.awards.length, "ocenění", "ocenění", "ocenění")}`);
  return parts.length ? parts.join(" · ") : undefined;
}

function plural(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

export function HistorySection({ status, insight, onStartDeep }: { status: InsightStatus; insight?: Insight; onStartDeep?: () => void }) {
  const t = useTheme();

  if (status === "loading") return <InlineLoading text="Probíhá důkladný průzkum…" />;
  if (!insight) {
    return (
      <View>
        <Text style={[styles.muted, { color: t.muted, marginBottom: spacing.md }]}>
          {status === "error"
            ? "Důkladný průzkum se nepovedl, historii produktu zatím neznáme."
            : "Historii značky, změny receptury, kauzy a testy přinese důkladný průzkum."}
        </Text>
        {onStartDeep && (
          <Button title={status === "error" ? "Zkusit znovu" : "🔎 Spustit důkladný průzkum"} variant="secondary" compact onPress={onStartDeep} />
        )}
      </View>
    );
  }

  const { history, recipeChange, issues, awards, reviews } = insight;
  const empty = !history.length && recipeChange.changed === "unknown" && !issues.length && !awards.length && !reviews;

  return (
    <View>
      {empty && <Text style={[styles.muted, { color: t.muted }]}>O historii produktu jsme nic nenašli.</Text>}

      {history.length > 0 && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Historie</Text>
          {history.map((e, i) => (
            <View key={i} style={styles.tlRow}>
              <View style={styles.tlRail}>
                <View style={[styles.tlDot, { backgroundColor: IMPACT_COLORS[e.impact] }]} />
                {i < history.length - 1 && <View style={[styles.tlLine, { backgroundColor: t.border }]} />}
              </View>
              <View style={styles.tlBody}>
                <Text style={[styles.text, { color: t.text }]}>
                  {e.year ? <Text style={{ fontWeight: "800" }}>{e.year} </Text> : null}
                  {e.text}
                </Text>
                <SourceLink url={e.sourceUrl} />
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.block}>
        {recipeChange.changed === "yes" ? (
          <View style={[styles.box, { backgroundColor: "rgba(239,108,0,0.12)", borderColor: "#EF6C00" }]}>
            <Text style={[styles.boxTitle, { color: t.text }]}>⚠ Receptura se změnila</Text>
            {recipeChange.summary ? <Text style={[styles.text, { color: t.text }]}>{recipeChange.summary}</Text> : null}
            <SourceLink url={recipeChange.sourceUrl} />
          </View>
        ) : recipeChange.changed === "no" ? (
          <View>
            <Text style={[styles.text, { color: t.text }]}>✓ Receptura se podle dostupných zdrojů neměnila.</Text>
            {recipeChange.summary ? <Text style={[styles.muted, { color: t.muted }]}>{recipeChange.summary}</Text> : null}
            <SourceLink url={recipeChange.sourceUrl} />
          </View>
        ) : (
          <Text style={[styles.muted, { color: t.muted }]}>O změně receptury nevíme.</Text>
        )}
      </View>

      {issues.length > 0 && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Problémy a stažení z trhu</Text>
          {issues.map((e, i) => (
            <EventRow key={i} event={e} icon="✕" color="#C62828" />
          ))}
        </View>
      )}

      {awards.length > 0 && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Ocenění</Text>
          {awards.map((e, i) => (
            <EventRow key={i} event={e} icon="🏅" color="#2E7D32" />
          ))}
        </View>
      )}

      {reviews && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Testy a recenze</Text>
          <Text style={[styles.text, { color: t.text }]}>{reviews.summary}</Text>
          <SourceLink url={reviews.sourceUrl} />
        </View>
      )}
    </View>
  );
}

function EventRow({ event, icon, color }: { event: InsightEvent; icon: string; color: string }) {
  const t = useTheme();
  return (
    <View style={[styles.eventRow, { borderLeftColor: color, backgroundColor: t.cardAlt }]}>
      <Text style={[styles.text, { color: t.text }]}>
        <Text style={{ color, fontWeight: "800" }}>{icon} </Text>
        {event.year ? <Text style={{ fontWeight: "800" }}>{event.year} </Text> : null}
        {event.text}
      </Text>
      <SourceLink url={event.sourceUrl} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.md },
  label: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm },
  text: { fontSize: fontSize.md, lineHeight: 22 },
  muted: { fontSize: fontSize.sm, lineHeight: 20 },
  tlRow: { flexDirection: "row" },
  tlRail: { width: 22, alignItems: "center" },
  tlDot: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  tlLine: { width: 2, flex: 1, marginTop: 2 },
  tlBody: { flex: 1, paddingBottom: spacing.md, paddingLeft: spacing.xs },
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  boxTitle: { fontSize: fontSize.md, fontWeight: "800", marginBottom: spacing.xs },
  eventRow: {
    borderLeftWidth: 4,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
});
