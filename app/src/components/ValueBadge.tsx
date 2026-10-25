import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ValueAssessment } from "../api/types";
import { VALUE_VERDICTS, valueText } from "../api/verdicts";
import { useTone } from "../profile";
import { fontSize, spacing } from "../theme";
import { domainOf, openUrl } from "./SourceLink";

/**
 * Price against what you get, right under the quality verdict:
 * "💸 Vyhozený prachy" (overpriced) or "💰 Za ty prachy dobrý" (good value).
 * Fair price and unknown price show nothing.
 */
export function ValueBadge({ value }: { value?: ValueAssessment }) {
  const tone = useTone();
  if (!value || (value.verdict !== "vyhozene_prachy" && value.verdict !== "vyhodne")) return null;
  const meta = VALUE_VERDICTS[value.verdict];
  const text = valueText(value.verdict, tone);
  const color = meta.textColor;
  return (
    <View style={[styles.box, { backgroundColor: meta.color }]} accessibilityLabel={`${text.label}. ${value.reason}`}>
      <Text style={styles.emoji}>{meta.emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color }]}>{text.label}</Text>
        <Text style={[styles.subtitle, { color }]}>{text.subtitle}</Text>
        {value.reason ? <Text style={[styles.reason, { color }]}>{value.reason}</Text> : null}
        {value.cheaperOption ? (
          <Text style={[styles.reason, { color }]}>
            <Text style={{ fontWeight: "800" }}>{value.verdict === "vyhozene_prachy" ? "Levněji: " : "Pro srovnání: "}</Text>
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
