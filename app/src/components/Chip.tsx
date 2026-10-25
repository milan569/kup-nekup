import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { fontSize, radius, spacing, useTheme } from "../theme";

interface Props {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  bg?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}

export function Chip({ label, onPress, selected, bg, color, style, small }: Props) {
  const t = useTheme();
  const background = bg ?? (selected ? t.primary : t.cardAlt);
  const textColor = color ?? (selected ? t.primaryText : t.text);
  const content = (
    <Text style={[styles.text, small && styles.textSmall, { color: textColor }]} numberOfLines={2}>
      {label}
    </Text>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: !!selected }}
        style={({ pressed }) => [
          styles.chip,
          small && styles.chipSmall,
          { backgroundColor: background, opacity: pressed ? 0.75 : 1 },
          style,
        ]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.chip, small && styles.chipSmall, { backgroundColor: background }, style]}>{content}</View>;
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    minHeight: 40,
    justifyContent: "center",
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipSmall: { minHeight: 30, paddingVertical: 4, paddingHorizontal: spacing.sm },
  text: { fontSize: fontSize.sm, fontWeight: "600" },
  textSmall: { fontSize: fontSize.xs },
  row: { flexDirection: "row", flexWrap: "wrap" },
});
