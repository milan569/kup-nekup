import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DtestRef, ProductData } from "../api/types";
import { fontSize, radius, spacing, useTheme } from "../theme";
import { domainOf, openUrl } from "./SourceLink";

/**
 * dTest (Czech consumer tests). Their terms allow linking but not copying the
 * paywalled ratings, so the row shows what is public: whether dTest tested this
 * kind of product recently, the year and the publicly reported findings, with
 * the source. Tapping opens the source; a second link opens dTest itself,
 * where subscribers are logged in and see the ratings.
 */
export function dtestSearchUrl(product: ProductData): string {
  const q = [product.brand, product.name].filter(Boolean).join(" ").trim() || product.name;
  return `https://www.dtest.cz/search?q=${encodeURIComponent(q)}`;
}

const isDtest = (url: string) => /(^|\.)dtest\.(cz|sk)$/i.test(domainOf(url));

export function DtestRow({ product, found }: { product: ProductData; found?: DtestRef }) {
  const t = useTheme();
  // most products (and nearly all foreign ones) have no dTest test: say nothing then
  if (!found) return null;
  const searchUrl = dtestSearchUrl(product);
  const url = found?.url ?? searchUrl;
  const title = found ? `Testováno${found.year ? ` (${found.year})` : ""}: ${found.title}` : "Hledat výsledky testu";
  return (
    <View style={[styles.box, { backgroundColor: t.cardAlt, borderColor: found ? "#C62828" : t.border }]}>
      <Pressable
        onPress={() => openUrl(url)}
        accessibilityRole="link"
        accessibilityLabel={found ? `Otevřít: ${found.title}` : "Hledat výrobek v dTestu"}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}
      >
        <Text style={styles.logo}>dTest</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: t.text }]} numberOfLines={3}>
            {title}
          </Text>
          {found?.summary ? (
            <Text style={[styles.summary, { color: t.text }]}>{found.summary}</Text>
          ) : found ? null : (
            <Text style={[styles.sub, { color: t.muted }]}>Otevře dtest.cz; předplatitelé po přihlášení uvidí hodnocení.</Text>
          )}
          {found ? (
            <Text style={[styles.sub, { color: t.muted }]}>
              {found.productNamed ? "Tento výrobek je v testu jmenovaný. " : ""}
              Zdroj: {domainOf(found.url)}
            </Text>
          ) : null}
        </View>
        <Ionicons name="open-outline" size={18} color={t.muted} />
      </Pressable>
      {found && !isDtest(found.url) ? (
        <Text style={[styles.link, { color: t.primary }]} onPress={() => openUrl(searchUrl)} accessibilityRole="link" suppressHighlighting>
          Otevřít na dtest.cz (hodnocení pro předplatitele) ↗
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  logo: { fontSize: fontSize.md, fontWeight: "900", color: "#C62828", letterSpacing: -0.5, marginTop: 1 },
  title: { fontSize: fontSize.sm, fontWeight: "700" },
  summary: { fontSize: fontSize.sm, lineHeight: 20, marginTop: spacing.xs },
  sub: { fontSize: fontSize.xs, lineHeight: 16, marginTop: spacing.xs },
  link: { fontSize: fontSize.xs, fontWeight: "700", marginTop: spacing.sm },
});
