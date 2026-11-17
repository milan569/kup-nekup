import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ValueAssessment, Verdict } from "../api/types";
import { valueBadge } from "../api/verdicts";
import { useTone } from "../profile";
import { fontSize, spacing } from "../theme";
import { domainOf, openUrl } from "./SourceLink";

/**
 * Price against what you get, right under the quality verdict:
 * "💸 Vyhozený prachy" (overpriced), "💰 Za ty prachy dobrý" (good value on a
 * product worth buying) or "🪙 Levný, to jo" (a low price on a poor product).
 * Fair price and unknown price show nothing. The wording follows the quality
 * verdict above it, so the two never contradict each other.
 */
export function ValueBadge({ value, quality }: { value?: ValueAssessment; quality: Verdict }) {
  const tone = useTone();
  const badge = valueBadge(value?.verdict, quality, tone);
  if (!value || !badge) return null;
  const color = badge.textColor;
  return (
    <View style={[styles.box, { backgroundColor: badge.color }]} accessibilityLabel={`${badge.text.label}. ${value.reason}`}>
      <Text style={styles.emoji}>{badge.emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color }]}>{badge.text.label}</Text>
        <Text style={[styles.subtitle, { color }]}>{badge.text.subtitle}</Text>
        {value.reason ? <Text style={[styles.reason, { color }]}>{value.reason}</Text> : null}
        {value.cheaperOption ? (
          <Text style={[styles.reason, { color }]}>
            <Text style={{ fontWeight: "800" }}>{badge.kind === "vyhozene_prachy" ? "Levněji: " : "Pro srovnání: "}</Text>
            {value.cheaperOption}
          </Text>
        ) : null}
        {value.sourceUrl ? (
          <Text
            style={[styles.link, { color }]}
            onPress={() => openUrl(value.sourceUrl!)}
            accessibilityRole="link"
            suppressHighlighting
          >
            cena: {domainOf(value.sourceUrl)} ↗
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  emoji: { fontSize: 30, lineHeight: 36 },
  label: { fontSize: fontSize.lg, fontWeight: "900" },
  subtitle: { fontSize: fontSize.sm, fontWeight: "600", marginTop: 1, opacity: 0.95 },
  reason: { fontSize: fontSize.sm, lineHeight: 20, marginTop: spacing.xs },
  link: { fontSize: fontSize.sm, fontWeight: "800", marginTop: spacing.xs, textDecorationLine: "underline" },
});
