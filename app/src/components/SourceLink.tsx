import React from "react";
import { Linking, Pressable, StyleSheet, Text } from "react-native";
import { fontSize, useTheme } from "../theme";

export function openUrl(url: string): void {
  Linking.openURL(url).catch(() => undefined);
}

/** "https://www.example.com/a/b" → "example.com" (no URL API: RN's URL lacks hostname). */
export function domainOf(url: string): string {
  return url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./i, "");
}

/** Small „zdroj ↗" link. Renders nothing without a url. */
export function SourceLink({ url, label = "zdroj ↗" }: { url?: string; label?: string }) {
  const t = useTheme();
  if (!url) return null;
  return (
    <Pressable onPress={() => openUrl(url)} hitSlop={8} accessibilityRole="link" accessibilityLabel={`Zdroj: ${domainOf(url)}`}>
      <Text style={[styles.link, { color: t.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 2 },
});
