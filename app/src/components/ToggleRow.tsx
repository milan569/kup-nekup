import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { fontSize, spacing, useTheme } from "../theme";

export function ToggleRow({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: t.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: t.text }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.primary }} />
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={[styles.section, { color: t.muted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: fontSize.md },
  hint: { fontSize: fontSize.xs, marginTop: 2 },
  section: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
});
