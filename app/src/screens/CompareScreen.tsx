import { Ionicons } from "@expo/vector-icons";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import React, { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, describeError } from "../api/client";
import type { CompareResult, ProductResult } from "../api/types";
import { MAX_COMPARE, useCompare } from "../compare";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBox } from "../components/ErrorBox";
import { InlineLoading, LoadingOverlay } from "../components/LoadingOverlay";
import { SourceLink } from "../components/SourceLink";
import { VerdictBadge } from "../components/VerdictBadge";
import { useLookup } from "../hooks/useLookup";
import type { RootNavigation, TabParamList } from "../navigationTypes";
import { useProfile } from "../profile";
import { loadFavorites, loadHistory, toggleFavorite, type HistoryEntry } from "../storage/history";
import { comparisonId, findComparison, saveComparison } from "../storage/comparisons";
import { fontSize, radius, spacing, useTheme } from "../theme";
import { pickLabelFromLibrary } from "../utils/image";

const MEDALS = ["🥇", "🥈", "🥉", "4."];
const COMPARABLE: Record<CompareResult["comparable"], { label: string; bg: string }> = {
  yes: { label: "Srovnatelné", bg: "#2E7D32" },
  partly: { label: "Jen orientačně srovnatelné", bg: "#EF6C00" },
  no: { label: "Nesrovnatelné", bg: "#757575" },
};

/**
 * Compare 2–4 products from the basket: a quick verdict first (rules + a short
 * web check), the deep comparison on a button (full research of every product).
 */
export function CompareScreen() {
  const t = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const tabNavigation = useNavigation<BottomTabNavigationProp<TabParamList, "Compare">>();
  const route = useRoute<RouteProp<TabParamList, "Compare">>();
  const { profile } = useProfile();
  const compare = useCompare();
  const lookup = useLookup(profile);
  const [quick, setQuick] = useState<CompareResult | null>(null);
  const [deep, setDeep] = useState<CompareResult | null>(null);
  const [running, setRunning] = useState<"quick" | "deep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [saved, setSaved] = useState(false);

  // a changed basket means another comparison: show the stored one when it exists
  const basketKey = compare.items.map((r) => r.product.id).join("|");
  const entryId = comparisonId(compare.items);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    findComparison(entryId).then((e) => {
      if (cancelled) return;
      setQuick(e?.quick ?? null);
      setDeep(e?.deep ?? null);
    });
    loadFavorites().then((f) => {
      if (!cancelled) setSaved(f.includes(entryId));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basketKey]);

  // opened from History: the basket becomes that comparison
  const reopenId = route.params?.comparisonId;
  useEffect(() => {
    if (!reopenId) return;
    findComparison(reopenId).then((e) => {
      if (e) compare.replaceAll(e.items);
      tabNavigation.setParams({ comparisonId: undefined });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopenId]);

  const payload = () => ({ items: compare.items.map((r) => ({ product: r.product, assessment: r.assessment })), profile });

  /** every comparison lands in History; the star marks it as saved */
  const persist = (q: CompareResult | null, d: CompareResult | null) =>
    saveComparison({ id: entryId, at: new Date().toISOString(), items: compare.items, quick: q ?? undefined, deep: d ?? undefined });

  const toggleSaved = async () => {
    await persist(quick, deep);
    setSaved(await toggleFavorite(entryId));
  };

  const runQuick = async () => {
    setRunning("quick");
    setError(null);
    try {
      const r = (await api.compareQuick(payload())).result;
      setQuick(r);
      await persist(r, deep);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setRunning(null);
    }
  };

  const runDeep = async () => {
    setRunning("deep");
    setError(null);
    try {
      const r = (await api.compare(payload())).result;
      setDeep(r);
      await persist(quick, r);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setRunning(null);
    }
  };

  const collectVia = (where: "Scan" | "ManualEntry") => {
    compare.setCollecting(true);
    if (where === "Scan") navigation.navigate("Tabs", { screen: "Scan" });
    else navigation.navigate("ManualEntry");
  };

  const fromGallery = async () => {
    try {
      const uri = await pickLabelFromLibrary();
      if (!uri) return;
      compare.setCollecting(true);
      await lookup.lookupPhotoUri(uri);
    } catch (err) {
      compare.setCollecting(false);
      setError(describeError(err));
    }
  };

  const openHistory = async () => {
    setHistory(await loadHistory());
    setHistoryOpen(true);
  };

  const full = compare.items.length >= MAX_COMPARE;
  const result = deep ?? quick;
  const byIndex = (i: number): ProductResult | undefined => compare.items[i];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.h, { color: t.text }]}>Porovnat výrobky</Text>
        <Text style={[styles.p, { color: t.muted }]}>
          Přidejte 2 až {MAX_COMPARE} výrobky a zjistěte, který z nich je lepší a proč. Nebo jestli se vůbec dají srovnat.
        </Text>

        {compare.items.map((r, i) => (
          <View key={r.product.id} style={[styles.item, { backgroundColor: t.card, borderColor: result?.winnerIndex === i ? "#2E7D32" : t.border }]}>
            {r.product.imageUrl ? (
              <Image source={{ uri: r.product.imageUrl }} style={styles.thumb} resizeMode="contain" />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: t.border }]}>
                <Ionicons name="image-outline" size={20} color={t.muted} />
              </View>
            )}
            <Pressable style={{ flex: 1 }} onPress={() => navigation.navigate("Result", { result: r, fromAlternative: true })}>
              <Text style={[styles.name, { color: t.text }]} numberOfLines={2}>
                {i + 1}. {r.product.name}
              </Text>
              {r.product.brand ? (
                <Text style={[styles.brand, { color: t.muted }]} numberOfLines={1}>
                  {r.product.brand}
                </Text>
              ) : null}
              <View style={{ marginTop: spacing.xs, alignSelf: "flex-start" }}>
                <VerdictBadge verdict={r.assessment.verdict} size="compact" labelSet={r.assessment.labelSet} />
              </View>
            </Pressable>
            <Pressable onPress={() => compare.remove(r.product.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Odebrat z porovnání">
              <Ionicons name="close-circle" size={24} color={t.muted} />
            </Pressable>
          </View>
        ))}

        {!full && (
          <View style={[styles.addBox, { borderColor: t.border }]}>
            <Text style={[styles.label, { color: t.muted }]}>
              {compare.items.length ? "Přidat další výrobek" : "Přidat výrobek"}
            </Text>
            <View style={styles.addRow}>
              <AddButton icon="scan-outline" label="Naskenovat" onPress={() => collectVia("Scan")} />
              <AddButton icon="camera-outline" label="Vyfotit" onPress={() => collectVia("Scan")} />
              <AddButton icon="images-outline" label="Galerie" onPress={fromGallery} />
              <AddButton icon="create-outline" label="Zadat" onPress={() => collectVia("ManualEntry")} />
              <AddButton icon="time-outline" label="Historie" onPress={openHistory} />
            </View>
          </View>
        )}

        {compare.items.length >= 2 && !result && (
          <Button
            title={running === "quick" ? "Porovnávám…" : "⚖️ Porovnat (rychle, 10–20 s)"}
            onPress={runQuick}
            loading={running === "quick"}
            disabled={running !== null}
            style={{ marginTop: spacing.lg }}
          />
        )}
        {compare.items.length === 1 && <Text style={[styles.hint, { color: t.muted }]}>Přidejte ještě aspoň jeden výrobek.</Text>}
        {compare.items.length >= 2 && (
          <Text style={[styles.clear, { color: t.muted }]} onPress={compare.clear} suppressHighlighting>
            Vyprázdnit porovnání
          </Text>
        )}

        {running === "quick" && <InlineLoading text="Rychlé porovnání podle složení, pravidel a krátkého ověření na webu…" />}
        {running === "deep" && <InlineLoading text="Důkladné porovnání: průzkum každého výrobku a srovnání. Zabere 1–3 minuty…" />}
        {error && !running ? <ErrorBox message={error} onRetry={() => setError(null)} retryLabel="Zavřít" /> : null}

        {result && (
          <View style={[styles.result, { backgroundColor: t.card, borderColor: t.border }]}>
            <ChipRow>
              <Chip label={COMPARABLE[result.comparable].label} bg={COMPARABLE[result.comparable].bg} color="#FFFFFF" small />
              <Chip label={result.mode === "deep" ? "důkladné porovnání" : "rychlé porovnání"} small />
            </ChipRow>
            <Text style={[styles.headline, { color: t.text }]}>{result.headline}</Text>
            <Text style={[styles.summary, { color: t.text }]}>{result.summary}</Text>

            {result.ranking.map((entry) => {
              const r = byIndex(entry.index);
              if (!r) return null;
              const winner = entry.index === result.winnerIndex;
              return (
                <View key={entry.index} style={[styles.rank, { backgroundColor: t.cardAlt, borderColor: winner ? "#2E7D32" : "transparent" }]}>
                  <View style={styles.rankHead}>
                    <Text style={styles.medal}>{MEDALS[entry.place - 1] ?? `${entry.place}.`}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, { color: t.text }]} numberOfLines={2}>
                        {r.product.name}
                        {r.product.brand ? ` · ${r.product.brand}` : ""}
                      </Text>
                      <View style={{ marginTop: spacing.xs, alignSelf: "flex-start" }}>
                        <VerdictBadge verdict={entry.verdict} size="compact" labelSet={r.assessment.labelSet} />
                      </View>
                    </View>
                  </View>
                  {entry.pros.map((x) => (
                    <Text key={"p" + x} style={[styles.line, { color: t.text }]}>
                      <Text style={{ color: "#2E7D32", fontWeight: "800" }}>✓ </Text>
                      {x}
                    </Text>
                  ))}
                  {entry.cons.map((x) => (
                    <Text key={"c" + x} style={[styles.line, { color: t.text }]}>
                      <Text style={{ color: "#C62828", fontWeight: "800" }}>✕ </Text>
                      {x}
                    </Text>
                  ))}
                  {entry.note ? <Text style={[styles.note, { color: t.muted }]}>{entry.note}</Text> : null}
                </View>
              );
            })}

            {result.sources.length > 0 && (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={[styles.label, { color: t.muted }]}>Zdroje</Text>
                {result.sources.slice(0, 6).map((s) => (
                  <SourceLink key={s.url} url={s.url} label={`${s.title} ↗`} />
                ))}
              </View>
            )}

            <Button
              title={saved ? "★ Uloženo v oblíbených" : "☆ Uložit porovnání"}
              variant="secondary"
              compact
              onPress={toggleSaved}
              style={{ marginTop: spacing.md }}
            />

            {!deep && result.comparable !== "no" && (
              <Pressable
                onPress={runDeep}
                disabled={running !== null}
                style={({ pressed }) => [styles.deepBtn, { borderColor: t.primary, opacity: pressed || running ? 0.7 : 1 }]}
              >
                <Text style={[styles.deepTitle, { color: t.primary }]}>🔎 Důkladné porovnání (1–3 min)</Text>
                <Text style={[styles.deepSub, { color: t.muted }]}>
                  Průzkum každého výrobku na webu: historie, změny receptury, testy, cena. Dražší než rychlé porovnání.
                </Text>
              </Pressable>
            )}
            {quick && !deep && (
              <Text style={[styles.clear, { color: t.muted }]} onPress={runQuick} suppressHighlighting>
                Spustit rychlé porovnání znovu
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={historyOpen} transparent animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <Pressable style={[styles.backdrop, { backgroundColor: t.overlay }]} onPress={() => setHistoryOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: t.card }]} onPress={() => undefined}>
            <Text style={[styles.sheetTitle, { color: t.text }]}>Z historie</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {history.length === 0 && <Text style={[styles.p, { color: t.muted }]}>Historie je zatím prázdná.</Text>}
              {history.map((e) => {
                const inBasket = compare.has(e.result.product.id);
                return (
                  <Pressable
                    key={e.id}
                    disabled={inBasket || full}
                    onPress={() => {
                      compare.add(e.result);
                      setHistoryOpen(false);
                    }}
                    style={({ pressed }) => [styles.histRow, { borderColor: t.border, opacity: inBasket ? 0.4 : pressed ? 0.7 : 1 }]}
                  >
                    <VerdictBadge verdict={e.result.assessment.verdict} size="dot" labelSet={e.result.assessment.labelSet} />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>
                        {e.result.product.name}
                      </Text>
                      {e.result.product.brand ? (
                        <Text style={[styles.brand, { color: t.muted }]} numberOfLines={1}>
                          {e.result.product.brand}
                        </Text>
                      ) : null}
                    </View>
                    {inBasket ? <Ionicons name="checkmark-circle" size={20} color={t.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ padding: spacing.lg }}>
              <Button title="Zavřít" variant="secondary" onPress={() => setHistoryOpen(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <LoadingOverlay visible={lookup.busy} text={lookup.busyText} />
    </SafeAreaView>
  );
}

function AddButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.addBtn, { backgroundColor: t.cardAlt, opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={22} color={t.primary} />
      <Text style={[styles.addLabel, { color: t.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  h: { fontSize: fontSize.xxl, fontWeight: "800", marginBottom: spacing.xs },
  p: { fontSize: fontSize.md, lineHeight: 22, marginBottom: spacing.lg },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 2, marginBottom: spacing.sm },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: "#FFFFFF" },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  name: { fontSize: fontSize.md, fontWeight: "700" },
  brand: { fontSize: fontSize.xs, marginTop: 2 },
  addBox: { borderWidth: 1, borderStyle: "dashed", borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  label: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm },
  addRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  addBtn: { alignItems: "center", justifyContent: "center", width: 72, paddingVertical: spacing.sm, borderRadius: radius.sm, gap: 4 },
  addLabel: { fontSize: fontSize.xs, fontWeight: "700" },
  hint: { fontSize: fontSize.sm, marginTop: spacing.md, textAlign: "center" },
  clear: { fontSize: fontSize.sm, fontWeight: "700", textAlign: "center", marginTop: spacing.md, textDecorationLine: "underline" },
  result: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  headline: { fontSize: fontSize.lg, fontWeight: "800", marginTop: spacing.sm },
  summary: { fontSize: fontSize.md, lineHeight: 23, marginTop: spacing.sm, marginBottom: spacing.md },
  rank: { borderRadius: radius.md, borderWidth: 2, padding: spacing.md, marginBottom: spacing.sm },
  rankHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginBottom: spacing.xs },
  medal: { fontSize: 22, lineHeight: 28 },
  line: { fontSize: fontSize.sm, lineHeight: 20, marginTop: 2 },
  note: { fontSize: fontSize.sm, lineHeight: 20, marginTop: spacing.xs, fontStyle: "italic" },
  deepBtn: { borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  deepTitle: { fontSize: fontSize.md, fontWeight: "800" },
  deepSub: { fontSize: fontSize.sm, lineHeight: 20, marginTop: 2 },
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "85%", overflow: "hidden", paddingTop: spacing.lg },
  sheetTitle: { fontSize: fontSize.xl, fontWeight: "800", paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  histRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
});
