import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { fontSize, radius, spacing, useTheme } from "../theme";

export function LoadingOverlay({ visible, text }: { visible: boolean; text: string }) {
  const t = useTheme();
  if (!visible) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: t.overlay }]} pointerEvents="auto">
      <View style={[styles.box, { backgroundColor: t.card }]}>
        <ActivityIndicator size="large" color={t.primary} />
        <Text style={[styles.text, { color: t.text }]}>{text}</Text>
      </View>
    </View>
  );
}

export function InlineLoading({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={styles.inline}>
      <ActivityIndicator color={t.primary} />
      <Text style={[styles.inlineText, { color: t.muted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", zIndex: 10 },
  box: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.lg,
    alignItems: "center",
    minWidth: 220,
  },
  text: { marginTop: spacing.md, fontSize: fontSize.md, fontWeight: "600", textAlign: "center" },
  inline: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md },
  inlineText: { marginLeft: spacing.md, fontSize: fontSize.sm },
});
