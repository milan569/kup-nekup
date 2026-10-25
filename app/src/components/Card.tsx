import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { fontSize, radius, spacing, useTheme } from "../theme";

interface Props {
  title?: string;
  subtitle?: string;
  expandable?: boolean;
  initiallyOpen?: boolean;
  onOpen?: () => void;
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ title, subtitle, expandable, initiallyOpen = true, onOpen, right, children, style }: Props) {
  const t = useTheme();
  const [open, setOpen] = useState(expandable ? initiallyOpen : true);

  const toggle = () => {
    if (!expandable) return;
    const next = !open;
    setOpen(next);
    if (next && onOpen) onOpen();
  };

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>
      {title && (
        <Pressable
          onPress={toggle}
          disabled={!expandable}
          accessibilityRole={expandable ? "button" : undefined}
          style={styles.header}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.text }]}>{title}</Text>
            {subtitle ? <Text style={[styles.subtitle, { color: t.muted }]}>{subtitle}</Text> : null}
          </View>
          {right}
          {expandable && <Text style={[styles.chevron, { color: t.muted }]}>{open ? "▲" : "▼"}</Text>}
        </Pressable>
      )}
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
  title: { fontSize: fontSize.lg, fontWeight: "700" },
  subtitle: { fontSize: fontSize.sm, marginTop: 2 },
  chevron: { fontSize: fontSize.sm, marginLeft: spacing.sm },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});
