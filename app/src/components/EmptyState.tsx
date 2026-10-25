import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { fontSize, spacing, useTheme } from "../theme";
import { Button } from "./Button";

interface Props {
  title: string;
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, text, actionLabel, onAction }: Props) {
  const t = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      {text ? <Text style={[styles.text, { color: t.muted }]}>{text}</Text> : null}
      {actionLabel && onAction && <Button title={actionLabel} onPress={onAction} style={{ marginTop: spacing.lg, alignSelf: "stretch" }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", padding: spacing.xl },
  title: { fontSize: fontSize.lg, fontWeight: "700", textAlign: "center" },
  text: { fontSize: fontSize.md, textAlign: "center", marginTop: spacing.sm, lineHeight: 22 },
});
