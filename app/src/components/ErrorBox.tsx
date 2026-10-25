import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { fontSize, radius, spacing, useTheme } from "../theme";
import { Button } from "./Button";

interface Props {
  message: string;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** optional second action, e.g. "Nastavení serveru" */
  actionLabel?: string;
  onAction?: () => void;
}

export function ErrorBox({ message, title, onRetry, retryLabel = "Zkusit znovu", actionLabel, onAction }: Props) {
  const t = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: t.dangerBg, borderColor: t.danger }]}>
      {title ? <Text style={[styles.title, { color: t.text }]}>{title}</Text> : null}
      <Text style={[styles.text, { color: t.text }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Button title={actionLabel} variant="danger" compact onPress={onAction} style={{ marginTop: spacing.md }} />
      ) : null}
      {onRetry ? (
        <Button title={retryLabel} variant={actionLabel ? "ghost" : "danger"} compact onPress={onRetry} style={{ marginTop: spacing.sm }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.lg,
    margin: spacing.lg,
  },
  title: { fontSize: fontSize.lg, fontWeight: "800", marginBottom: spacing.xs },
  text: { fontSize: fontSize.md, lineHeight: 22 },
});
