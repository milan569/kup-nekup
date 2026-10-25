import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, describeError } from "../api/client";
import type { SearchCandidate } from "../api/types";
import { Button } from "../components/Button";
import { ErrorBox } from "../components/ErrorBox";
import { InlineLoading, LoadingOverlay } from "../components/LoadingOverlay";
import { CollectBanner } from "../components/CollectBanner";
import { useLookup } from "../hooks/useLookup";
import type { RootNavigation } from "../navigationTypes";
import { useProfile } from "../profile";
import { fontSize, radius, spacing, useTheme } from "../theme";
import { PermissionDeniedError, pickLabelFromLibrary } from "../utils/image";

export function SearchScreen() {
  const t = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const { profile } = useProfile();
  const lookup = useLookup(profile);
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [searched, setSearched] = useState<string | null>(null);
  const [via, setVia] = useState<"off" | "ai" | "none" | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const seq = useRef(0);

  const typedEan = /^\d{8,14}$/.test(q.trim()) ? q.trim() : null;
  const canSearch = q.trim().length >= 2 && !typedEan;

  // Search runs on submit, not while typing: when the database is down the
  // fallback is a paid web search, and nobody wants to pay per keystroke.
  const runSearch = useCallback(async () => {
    const term = q.trim();
    if (term.length < 2 || /^\d{8,14}$/.test(term)) return;
    const mySeq = ++seq.current;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await api.search(term, profile.countries);
      if (mySeq !== seq.current) return;
      setCandidates(res.candidates);
      setVia(res.via);
      setSearched(term);
    } catch (err) {
      if (mySeq === seq.current) setSearchError(describeError(err));
    } finally {
      if (mySeq === seq.current) setSearching(false);
    }
  }, [q, profile.countries]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setCandidates([]);
      setSearched(null);
      setVia(undefined);
      setSearchError(null);
    }
  }, [q]);

  const pick = (c: SearchCandidate) => {
    if (c.ean) lookup.lookupEan(c.ean, true);
    else lookup.lookupManual(c.name, c.brand);
  };

  const pickFromGallery = async () => {
    setLocalError(null);
    try {
      const uri = await pickLabelFromLibrary();
      if (uri) await lookup.lookupPhotoUri(uri, q.trim() || undefined);
    } catch (err) {
      setLocalError(err instanceof PermissionDeniedError ? err.message : describeError(err));
    }
  };

  const error = localError ?? lookup.error;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <View style={styles.header}>
        <CollectBanner />
        <Text style={[styles.title, { color: t.text }]}>Hledat produkt</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Název produktu nebo čárový kód"
          placeholderTextColor={t.muted}
          autoCorrect={false}
          keyboardType="default"
          returnKeyType="search"
          clearButtonMode="while-editing"
          onSubmitEditing={runSearch}
          style={[styles.input, { backgroundColor: t.card, color: t.text, borderColor: t.border }]}
        />
        {canSearch ? <Button title="Hledat v databázi" compact onPress={runSearch} loading={searching} style={{ marginTop: spacing.sm }} /> : null}
      </View>

      {error ? (
        !localError && lookup.errorKind === "auth" ? (
          <ErrorBox
            title="Chybí nebo neplatí Claude klíč"
            message={error}
            actionLabel="Zadat klíč"
            onAction={() => {
              lookup.clearError();
              navigation.navigate("ClaudeKey");
            }}
            onRetry={lookup.clearError}
            retryLabel="Zavřít"
          />
        ) : (
          <ErrorBox
            message={error}
            actionLabel={!localError && lookup.retry ? "Zkusit znovu" : undefined}
            onAction={!localError && lookup.retry ? lookup.retry : undefined}
            onRetry={localError ? () => setLocalError(null) : lookup.clearError}
            retryLabel={localError ? "Rozumím" : "Zavřít"}
          />
        )
      ) : null}

      <FlatList
        data={candidates}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        ListHeaderComponent={
          <View>
            {typedEan && (
              <Pressable
                onPress={() => lookup.lookupEan(typedEan, true)}
                style={({ pressed }) => [styles.row, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.8 : 1 }]}
              >
                <View style={[styles.img, { backgroundColor: t.cardAlt, alignItems: "center", justifyContent: "center" }]}>
                  <Text style={{ fontSize: fontSize.xl }}>▌▌▌</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: t.text }]}>Vyhledat kód {typedEan}</Text>
                  <Text style={[styles.meta, { color: t.muted }]}>čárový kód zadaný ručně</Text>
                </View>
              </Pressable>
            )}
            {searching && <InlineLoading text="Hledám…" />}
            {searchError && <ErrorBox message={searchError} />}
            {!searching && via === "ai" && candidates.length > 0 && (
              <Text style={[styles.empty, { color: t.muted }]}>Databáze produktů neodpovídala, hledáno přes AI (asi 0,01 USD).</Text>
            )}
            {!searching && !typedEan && searched !== null && !searchError && candidates.length > 0 && (candidates[0]?.match ?? 1) < 0.99 && (
              <View style={[styles.noExact, { backgroundColor: t.card, borderColor: t.border }]}>
                <Text style={[styles.noExactTitle, { color: t.text }]}>Přesnou shodu jsme v databázi nenašli</Text>
                <Text style={[styles.noExactText, { color: t.muted }]}>
                  Níže jsou jen podobné názvy. Nejrychlejší je vyfotit etiketu; nebo nechte AI posoudit výrobek podle názvu.
                </Text>
                <Button
                  title={`🤖 Posoudit „${q.trim()}“ podle názvu (AI, asi 20 s)`}
                  variant="secondary"
                  compact
                  onPress={() => lookup.lookupManual(q.trim())}
                  disabled={lookup.busy}
                  style={{ marginTop: spacing.sm }}
                />
              </View>
            )}
            {!searching && !typedEan && searched !== null && candidates.length === 0 && !searchError && (
              <Text style={[styles.empty, { color: t.muted }]}>Nic jsme nenašli. Zkuste fotku etikety nebo ruční zadání.</Text>
            )}
            {!searching && !typedEan && searched === null && q.trim().length >= 2 && (
              <Text style={[styles.empty, { color: t.muted }]}>Stiskněte Hledat, nebo rovnou vyfoťte etiketu.</Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => pick(item)} style={({ pressed }) => [styles.row, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.8 : 1 }]}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.img} resizeMode="contain" />
            ) : (
              <View style={[styles.img, { backgroundColor: t.cardAlt }]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: t.text }]} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={[styles.meta, { color: t.muted }]} numberOfLines={1}>
                {[item.brand, item.quantity].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            <Button title="Nahrát z galerie" variant="secondary" onPress={pickFromGallery} />
            <Button
              title="Nenašli jste? Zadat ručně"
              variant="ghost"
              onPress={() => navigation.navigate("ManualEntry", { initialName: q.trim() || undefined })}
              style={{ marginTop: spacing.sm }}
            />
          </View>
        }
      />
      <LoadingOverlay visible={lookup.busy} text={lookup.busyText} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  noExact: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  noExactTitle: { fontSize: fontSize.md, fontWeight: "700" },
  noExactText: { fontSize: fontSize.sm, lineHeight: 20, marginTop: 2 },
  safe: { flex: 1 },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  title: { fontSize: fontSize.xxl, fontWeight: "800", marginBottom: spacing.md },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.lg,
  },
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
  img: { width: 48, height: 48, borderRadius: radius.sm, marginRight: spacing.md, backgroundColor: "#FFFFFF" },
  name: { fontSize: fontSize.md, fontWeight: "600" },
  meta: { fontSize: fontSize.sm, marginTop: 2 },
  empty: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.md },
  footer: { padding: spacing.lg },
});
