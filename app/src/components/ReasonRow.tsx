import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Reason } from "../api/types";
import { fontSize, spacing, useTheme } from "../theme";

export function ReasonRow({ reason }: { reason: Reason }) {
  const t = useTheme();
  const icon =
    reason.kind === "positive" ? "✓" : reason.kind === "negative" ? "✕" : reason.kind === "warning" ? "⚠" : "•";
  const color =
    reason.kind === "positive"
      ? t.success
      : reason.kind === "negative"
        ? t.danger
        : reason.kind === "warning"
          ? t.warning
          : t.muted;
  return (
    <View style={styles.row}>
      <Text style={[styles.icon, { color }]}>{icon}</Text>
      <Text style={[styles.text, { color: t.text }]}>{reason.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: spacing.xs },
  icon: { width: 24, fontSize: fontSize.lg, fontWeight: "800", lineHeight: 24 },
  text: { flex: 1, fontSize: fontSize.md, lineHeight: 24 },
});
