import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../api/client";
import type { NutritionPer100g, ProductData } from "../api/types";
import { Chip, ChipRow } from "../components/Chip";
import { IngredientSheet, type IngredientQuery } from "../components/IngredientSheet";
import { domainOf, openUrl } from "../components/SourceLink";
import { allergenLabel } from "../data/options";
import { fontSize, novaColors, nutriScoreColors, radius, riskColors, spacing, useTheme } from "../theme";
import { looksCzech } from "../utils/lang";

interface CzechComposition {
  text: string;
  items: IngredientItem[];
}

// translations of the same list are reused while the app runs (the server caches them for good)
const czechMemo = new Map<string, CzechComposition>();

const NUTRITION_ROWS: { key: keyof NutritionPer100g; label: string; unit: string }[] = [
  { key: "energyKcal", label: "Energie", unit: "kcal" },
  { key: "fat", label: "Tuky", unit: "g" },
  { key: "saturatedFat", label: "z toho nasycené", unit: "g" },
  { key: "carbs", label: "Sacharidy", unit: "g" },
  { key: "sugars", label: "z toho cukry", unit: "g" },
  { key: "fiber", label: "Vláknina", unit: "g" },
  { key: "proteins", label: "Bílkoviny", unit: "g" },
  { key: "salt", label: "Sůl", unit: "g" },
];

export function CompositionSection({ product }: { product: ProductData }) {
  const t = useTheme();
  const additives = product.additives ?? [];
  const flagged = product.flagged ?? [];
  const allergens = product.allergens ?? [];
  const traces = product.traces ?? [];
  const nutrition = product.nutrition;
  const nutritionRows = nutrition ? NUTRITION_ROWS.filter((r) => typeof nutrition[r.key] === "number") : [];
  const hasAnything =
    product.ingredientsText || additives.length || flagged.length || allergens.length || nutritionRows.length;

  const [query, setQuery] = useState<IngredientQuery | null>(null);
  const originalItems = useMemo(() => ingredientItems(product), [product]);
  const originalText = product.ingredientsText?.replace(/_/g, "") ?? "";

  // foreign lists (Serbian, English, German…) are shown in Czech; the original is one tap away
  const foreign = !!originalText && !looksCzech(originalText);
  const [czech, setCzech] = useState<CzechComposition | null>(() => (foreign ? czechMemo.get(originalText) ?? null : null));
  const [czechState, setCzechState] = useState<"idle" | "loading" | "error">("idle");
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => {
    if (!foreign) {
      setCzech(null);
      return;
    }
    const known = czechMemo.get(originalText);
    if (known) {
      setCzech(known);
      return;
    }
    let cancelled = false;
    setCzechState("loading");
    api
      .translateIngredients({ text: product.ingredientsText ?? originalText })
      .then((res) => {
        const value = { text: res.text.replace(/_/g, ""), items: res.items };
        czechMemo.set(originalText, value);
        if (cancelled) return;
        setCzech(value);
        setCzechState("idle");
      })
      .catch(() => {
        if (!cancelled) setCzechState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [foreign, originalText, product.ingredientsText]);

  const showCzech = !!czech && !showOriginal;
  const items = showCzech ? czech.items : originalItems;
  const context = showCzech ? czech.text : originalText;

  const webSource = product.compositionSource;
  const sourceBox = webSource ? (
    <View style={[styles.sourceBox, { borderColor: "#1565C0", backgroundColor: t.dark ? "rgba(100,160,255,0.14)" : "rgba(21,101,192,0.08)" }]}>
      <Text style={[styles.sourceTitle, { color: t.text }]}>🌐 Složení dohledané na webu</Text>
      <Text style={[styles.sourceText, { color: t.text }]}>
        {webSource.market ? `Platí pro trh: ${webSource.market}. ` : ""}Na obalu u nás se může lišit.
      </Text>
      <Text
        style={[styles.sourceLink, { color: t.primary }]}
        onPress={() => openUrl(webSource.url)}
        accessibilityRole="link"
        suppressHighlighting
      >
        {(webSource.title || domainOf(webSource.url)) + " ↗"}
      </Text>
    </View>
  ) : null;

  if (!hasAnything) {
    return (
      <View>
        {sourceBox}
        <Text style={[styles.muted, { color: t.muted }]}>Složení zatím neznáme. Zkuste vyfotit etiketu.</Text>
      </View>
    );
  }

  return (
    <View>
      {sourceBox}
      {(product.nutriScore || product.novaGroup) && (
        <ChipRow>
          {product.nutriScore && (
            <Chip label={`Nutri-Score ${product.nutriScore.toUpperCase()}`} bg={nutriScoreColors[product.nutriScore]} color="#FFFFFF" />
          )}
          {product.novaGroup && (
            <Chip
              label={`NOVA ${product.novaGroup} · ${novaLabel(product.novaGroup)}`}
              bg={novaColors[product.novaGroup]}
              color={product.novaGroup === 2 ? "#1B1B1B" : "#FFFFFF"}
            />
          )}
        </ChipRow>
      )}

      {items.length > 0 ? (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>
            {showCzech ? "Složení · přeloženo do češtiny · klepněte na složku" : "Složení · klepněte na složku"}
          </Text>
          {foreign && czechState === "loading" && !czech ? (
            <Text style={[styles.hint, { color: t.muted, marginTop: 0, marginBottom: spacing.xs }]}>Překládám do češtiny…</Text>
          ) : null}
          {foreign && czechState === "error" && !czech ? (
            <Text style={[styles.hint, { color: t.muted, marginTop: 0, marginBottom: spacing.xs }]}>Překlad se nepovedl, ukazuji originál.</Text>
          ) : null}
          <Text style={[styles.body, { color: t.text }]}>
            {items.map((it, i) => (
              <React.Fragment key={i}>
                <Text
                  onPress={() => setQuery({ title: it.text, q: it.text, context })}
                  accessibilityRole="button"
                  style={[
                    styles.tapItem,
                    { textDecorationColor: t.muted },
                    it.severity > 0 && { color: severityColor(it.severity as 1 | 2 | 3), fontWeight: "700" },
                  ]}
                >
                  {it.text}
                </Text>
                {i < items.length - 1 ? ", " : ""}
              </React.Fragment>
            ))}
          </Text>
          <Text style={[styles.hint, { color: t.muted }]}>
            Barevně je to, na co si dát pozor. Klepnutím zjistíte, co složka dělá s tělem a jestli vadí jednou za čas.
          </Text>
          {czech ? (
            <Text
              style={[styles.toggle, { color: t.primary }]}
              onPress={() => setShowOriginal((v) => !v)}
              accessibilityRole="button"
              suppressHighlighting
            >
              {showOriginal ? "Ukázat český překlad" : "Ukázat originál z etikety"}
            </Text>
          ) : null}
        </View>
      ) : null}

      {additives.length > 0 && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Aditiva ({additives.length}) · klepněte pro detail</Text>
          <ChipRow>
            {additives.map((a) => (
              <Chip
                key={a.code}
                label={`${a.code} ${a.name}`}
                bg={riskColors[a.risk].bg}
                color={riskColors[a.risk].text}
                onPress={() => setQuery({ title: `${a.code} ${a.name}`, ref: `additive:${a.code}` })}
              />
            ))}
          </ChipRow>
        </View>
      )}

      {flagged.length > 0 && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Na co si dát pozor · klepněte pro detail</Text>
          {flagged.map((f) => (
            <Pressable
              key={f.key + f.matchedText}
              onPress={() => setQuery({ title: f.label, ref: `unwanted:${f.key}` })}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.flag,
                { backgroundColor: t.cardAlt, borderLeftColor: severityColor(f.severity), opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Text style={[styles.flagTitle, { color: t.text }]}>{f.label} ›</Text>
              <Text style={[styles.flagNote, { color: t.muted }]}>{f.note}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {(allergens.length > 0 || traces.length > 0) && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Alergeny</Text>
          <ChipRow>
            {allergens.map((a) => (
              <Chip key={"a" + a} label={allergenLabel(a)} bg={t.dangerBg} color={t.text} small />
            ))}
            {traces.map((a) => (
              <Chip key={"t" + a} label={`stopy: ${allergenLabel(a)}`} small />
            ))}
          </ChipRow>
        </View>
      )}

      <IngredientSheet query={query} onClose={() => setQuery(null)} />

      {nutritionRows.length > 0 && nutrition && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Nutriční hodnoty na 100 g</Text>
          <View style={[styles.table, { borderColor: t.border }]}>
            {nutritionRows.map((r, i) => (
              <View key={r.key} style={[styles.tr, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <Text style={[styles.td, { color: t.text }]}>{r.label}</Text>
                <Text style={[styles.tdValue, { color: t.text }]}>
                  {formatNumber(nutrition[r.key] as number)} {r.unit}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

/** Top-level ingredients as printed (sub-ingredients stay inside their parentheses). */
export function splitIngredientText(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    const decimalComma = ch === "," && /\d/.test(chars[i - 1] ?? "") && /\d/.test(chars[i + 1] ?? "");
    const sentenceEnd = ch === "." && depth === 0 && /\s/.test(chars[i + 1] ?? "") && /\p{Lu}/u.test(chars[i + 2] ?? "");
    if (((ch === "," || ch === ";") && depth === 0 && !decimalComma) || sentenceEnd) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim().replace(/\.$/, ""));
  return out.map((x) => x.replace(/^(složení|ingredients|sastojci|sastav|zutaten|состав|skład)\s*:\s*/iu, ""));
}

interface IngredientItem {
  text: string;
  /** 0 = nothing known, 1–3 = worst additive risk or flag severity inside */
  severity: number;
}

function ingredientItems(product: ProductData): IngredientItem[] {
  const raw = product.ingredientsText ? splitIngredientText(product.ingredientsText.replace(/_/g, "")) : product.ingredients ?? [];
  return raw.filter(Boolean).map((text) => ({ text, severity: itemSeverity(text, product) }));
}

function itemSeverity(text: string, product: ProductData): number {
  const lower = text.toLowerCase();
  let s = 0;
  for (const f of product.flagged ?? []) {
    if (f.matchedText && lower.includes(f.matchedText.toLowerCase())) s = Math.max(s, f.severity);
  }
  for (const a of product.additives ?? []) {
    const digits = a.code.toLowerCase().replace(/^e/, "");
    const byCode = new RegExp(`(^|[^a-z0-9])e[\\s-]?${digits}(?![0-9a-z])`, "i").test(lower);
    if (byCode || (a.name.length >= 4 && lower.includes(a.name.toLowerCase()))) s = Math.max(s, a.risk);
  }
  return s;
}

function novaLabel(g: number): string {
  return g === 1 ? "minimálně zpracované" : g === 2 ? "kuchyňské suroviny" : g === 3 ? "zpracované" : "ultra-zpracované";
}

function severityColor(s: 1 | 2 | 3): string {
  return s === 3 ? "#C62828" : s === 2 ? "#EF6C00" : "#F9A825";
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

const styles = StyleSheet.create({
  muted: { fontSize: fontSize.md, lineHeight: 22 },
  sourceBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  sourceTitle: { fontSize: fontSize.md, fontWeight: "800", marginBottom: spacing.xs },
  sourceText: { fontSize: fontSize.sm, lineHeight: 20 },
  sourceLink: { fontSize: fontSize.sm, fontWeight: "700", marginTop: spacing.xs },
  block: { marginTop: spacing.md },
  label: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.xs },
  body: { fontSize: fontSize.md, lineHeight: 24 },
  tapItem: { textDecorationLine: "underline", textDecorationStyle: "dotted" },
  hint: { fontSize: fontSize.xs, lineHeight: 18, marginTop: spacing.xs },
  toggle: { fontSize: fontSize.sm, fontWeight: "700", marginTop: spacing.sm },
  flag: {
    borderLeftWidth: 4,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  flagTitle: { fontSize: fontSize.md, fontWeight: "700" },
  flagNote: { fontSize: fontSize.sm, marginTop: 2, lineHeight: 20 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: "hidden" },
  tr: { flexDirection: "row", paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  td: { flex: 1, fontSize: fontSize.sm },
  tdValue: { fontSize: fontSize.sm, fontWeight: "600" },
});
