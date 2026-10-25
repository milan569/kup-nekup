import { useFocusEffect, useNavigation } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { verdictText } from "../api/verdicts";
import { Chip, ChipRow } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { VerdictBadge } from "../components/VerdictBadge";
import type { RootNavigation } from "../navigationTypes";
import { useTone } from "../profile";
import { loadComparisons, removeComparison, type ComparisonEntry } from "../storage/comparisons";
import { loadFavorites, loadHistory, removeFromHistory, type HistoryEntry } from "../storage/history";
import { fontSize, radius, spacing, useTheme } from "../theme";
import { confirmDestructive } from "../utils/confirm";

/** Products and comparisons in one timeline, newest first. */
type Row = { kind: "product"; id: string; at: string; entry: HistoryEntry } | { kind: "comparison"; id: string; at: string; entry: ComparisonEntry };

export function HistoryScreen() {
  const t = useTheme();
  const tone = useTone();
  const navigation = useNavigation<RootNavigation>();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonEntry[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "saved" | "comparisons">("all");

  const reload = useCallback(async () => {
    const [h, c, f] = await Promise.all([loadHistory(), loadComparisons(), loadFavorites()]);
    setEntries(h);
    setComparisons(c);
    setFavorites(f);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      ...entries.map((e): Row => ({ kind: "product", id: e.id, at: e.at, entry: e })),
      ...comparisons.map((e): Row => ({ kind: "comparison", id: e.id, at: e.at, entry: e })),
    ];
    all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    if (filter === "saved") return all.filter((r) => favorites.includes(r.id));
    if (filter === "comparisons") return all.filter((r) => r.kind === "comparison");
    return all;
  }, [entries, comparisons, favorites, filter]);

  const confirmDelete = (row: Row) => {
    const title = row.kind === "product" ? row.entry.result.product.name : comparisonTitle(row.entry);
    confirmDestructive("Smazat z historie?", title, "Smazat", async () => {
      if (row.kind === "product") await removeFromHistory(row.id);
      else await removeComparison(row.id);
      reload();
    });
  };

  const open = (row: Row) => {
    if (row.kind === "product") {
      navigation.navigate("Result", { result: row.entry.result, insight: row.entry.insight, quick: row.entry.quick });
    } else {
      navigation.navigate("Tabs", { screen: "Compare", params: { comparisonId: row.id } });
    }
  };

  const empty =
    filter === "saved"
      ? { title: "Nic uloženého", text: "Uložte výrobek nebo porovnání tlačítkem Uložit." }
      : filter === "comparisons"
        ? { title: "Zatím žádné porovnání", text: "Porovnejte dva výrobky na záložce Porovnat." }
        : { title: "Zatím žádné skeny", text: "Naskenujte první produkt na záložce Sken." };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.text }]}>Historie</Text>
        <ChipRow>
          <Chip label="Vše" selected={filter === "all"} onPress={() => setFilter("all")} />
          <Chip label="Uložené" selected={filter === "saved"} onPress={() => setFilter("saved")} />
          <Chip label="Porovnání" selected={filter === "comparisons"} onPress={() => setFilter("comparisons")} />
        </ChipRow>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        ListEmptyComponent={<EmptyState title={empty.title} text={empty.text} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            onLongPress={() => confirmDelete(item)}
            style={({ pressed }) => [styles.row, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.8 : 1 }]}
          >
            {item.kind === "product" ? (
              <ProductRow entry={item.entry} tone={tone} />
            ) : (
              <ComparisonRow entry={item.entry} tone={tone} />
            )}
            {favorites.includes(item.id) && <Text style={{ color: t.warning, fontSize: fontSize.lg }}>★</Text>}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function ProductRow({ entry, tone }: { entry: HistoryEntry; tone: ReturnType<typeof useTone> }) {
  const t = useTheme();
  const a = entry.result.assessment;
  return (
    <>
      <VerdictBadge verdict={a.verdict} size="dot" labelSet={a.labelSet} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>
          {(entry.insight?.value ?? entry.quick?.value)?.verdict === "vyhozene_prachy" ? "💸 " : ""}
          {entry.result.product.name}
        </Text>
        <Text style={[styles.meta, { color: t.muted }]} numberOfLines={1}>
          {[entry.result.product.brand, verdictText(a.verdict, tone, a.labelSet).label, formatDate(entry.at)].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </>
  );
}

function comparisonTitle(entry: ComparisonEntry): string {
  return entry.items.map((r) => r.product.name).join(" vs ");
}

function ComparisonRow({ entry, tone }: { entry: ComparisonEntry; tone: ReturnType<typeof useTone> }) {
  const t = useTheme();
  const result = entry.deep ?? entry.quick;
  const winner = result?.winnerIndex !== undefined ? entry.items[result.winnerIndex] : undefined;
  const meta =
    result?.comparable === "no"
      ? "nesrovnatelné"
      : winner
        ? `vítěz: ${winner.product.name} (${verdictText(result!.ranking[0]?.verdict ?? winner.assessment.verdict, tone, winner.assessment.labelSet).label})`
        : "porovnání";
  return (
    <>
      <View style={[styles.cmpIcon, { backgroundColor: t.cardAlt }]}>
        <Text style={{ fontSize: 18 }}>⚖️</Text>
      </View>
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={[styles.name, { color: t.text }]} numberOfLines={2}>
          {comparisonTitle(entry)}
        </Text>
        <Text style={[styles.meta, { color: t.muted }]} numberOfLines={2}>
          {[result?.headline ? result.headline : meta, result?.headline ? meta : undefined, formatDate(entry.at)].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { padding: spacing.lg, paddingBottom: 0 },
  title: { fontSize: fontSize.xxl, fontWeight: "800", marginBottom: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  cmpIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  name: { fontSize: fontSize.md, fontWeight: "600" },
  meta: { fontSize: fontSize.sm, marginTop: 2 },
});
