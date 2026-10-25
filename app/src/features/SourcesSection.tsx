import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { InsightSource } from "../api/types";
import { domainOf, openUrl } from "../components/SourceLink";
import { fontSize, radius, spacing, useTheme } from "../theme";

export function SourcesSection({ sources }: { sources: InsightSource[] }) {
  const t = useTheme();
  if (!sources.length) {
    return <Text style={[styles.muted, { color: t.muted }]}>Posudek nemá žádné webové zdroje.</Text>;
  }
  return (
    <View>
      {sources.map((s, i) => (
        <Pressable
          key={s.url + i}
          onPress={() => openUrl(s.url)}
          accessibilityRole="link"
          style={({ pressed }) => [styles.row, { backgroundColor: t.cardAlt, opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>
              {s.title || domainOf(s.url)}
            </Text>
            <Text style={[styles.domain, { color: t.muted }]} numberOfLines={1}>
              {domainOf(s.url)}
            </Text>
          </View>
          <Text style={[styles.arrow, { color: t.primary }]}>↗</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: fontSize.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 52,
  },
  title: { fontSize: fontSize.sm, fontWeight: "600" },
  domain: { fontSize: fontSize.xs, marginTop: 2 },
  arrow: { fontSize: fontSize.lg, fontWeight: "800", marginLeft: spacing.sm },
});
