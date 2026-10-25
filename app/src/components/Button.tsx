import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { fontSize, radius, spacing, useTheme } from "../theme";

interface Props {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export function Button({ title, onPress, variant = "primary", disabled, loading, style, compact }: Props) {
  const t = useTheme();
  const bg =
    variant === "primary"
      ? t.primary
      : variant === "danger"
        ? t.danger
        : variant === "secondary"
          ? t.cardAlt
          : "transparent";
  const color = variant === "primary" ? t.primaryText : variant === "danger" ? "#FFFFFF" : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        variant === "ghost" && { borderWidth: 1, borderColor: t.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.label, compact && styles.labelCompact, { color }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  compact: { minHeight: 40, paddingVertical: spacing.sm },
  label: { fontSize: fontSize.md, fontWeight: "700" },
  labelCompact: { fontSize: fontSize.sm },
});
