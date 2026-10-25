import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useEffect, useState } from "react";
import { Alert, Image, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { describeError } from "../api/client";
import { ErrorBox } from "../components/ErrorBox";
import { useLookup } from "../hooks/useLookup";
import { pickLabelFromLibrary, takeLabelPhoto } from "../utils/image";
import { verdictText } from "../api/verdicts";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip, ChipRow } from "../components/Chip";
import { InlineLoading } from "../components/LoadingOverlay";
import { PhotoViewer, photosOf } from "../components/PhotoViewer";
import { ReasonRow } from "../components/ReasonRow";
import { useCompare } from "../compare";
import { DtestRow } from "../components/DtestRow";
import { ValueBadge } from "../components/ValueBadge";
import { VerdictBadge } from "../components/VerdictBadge";
import { AlternativesSection } from "../features/AlternativesSection";
import { CompositionSection } from "../features/CompositionSection";
import { HistorySection, historySubtitle } from "../features/HistorySection";
import { InsightSection } from "../features/InsightSection";
import { ManufacturerSection, ManufacturerView } from "../features/ManufacturerSection";
import { SourcesSection } from "../features/SourcesSection";
import { useInsight } from "../hooks/useInsight";
import type { RootStackParamList } from "../navigationTypes";
import { useProfile, useTone } from "../profile";
import { addReport, loadFavorites, toggleFavorite } from "../storage/history";
import { confidenceLabels, fontSize, radius, sourceLabels, spacing, useTheme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Result">;

export function ResultScreen({ route, navigation }: Props) {
  const t = useTheme();
  const tone = useTone();
  const { profile } = useProfile();
  const { result, insight: initialInsight, quick: initialQuick, fromAlternative, refine, reused } = route.params;
  const ai = useInsight(result, profile, { auto: !fromAlternative, initial: initialInsight, initialQuick, refine });
  // product may be replaced by the insight (composition found online)
  const product = ai.product;
  const shownResult = ai.shownResult;
  const assessment = ai.assessment;
  const insight = ai.insight;

  const [favorite, setFavorite] = useState(false);
  const [alternativesActive, setAlternativesActive] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const compare = useCompare();
  const inBasket = compare.has(product.id);
  // the basket shows the latest verdict (AI opinions arrive after the product was added)
  useEffect(() => {
    if (inBasket) compare.update(ai.shownResult);
  }, [inBasket, ai.shownResult, compare]);
  const toCompare = () => {
    if (!inBasket) compare.add(ai.shownResult);
    navigation.navigate("Tabs", { screen: "Compare" });
  };
  // a further photo of the same product (back label, ingredients, front with the name)
  const supplement = useLookup(profile);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const addPhoto = async (from: "camera" | "library") => {
    setPhotoError(null);
    try {
      const uri = from === "camera" ? await takeLabelPhoto() : await pickLabelFromLibrary();
      if (uri) await supplement.supplementPhotoUri(uri, ai.product, { quick: ai.quick, insight: ai.insight, assessment: ai.assessment });
    } catch (err) {
      setPhotoError(describeError(err));
    }
  };
  const choosePhoto = () => {
    if (Platform.OS === "web") {
      addPhoto("library");
      return;
    }
    Alert.alert("Doplnit fotku", "Vyfoťte další stranu obalu: zadní etiketu se složením, přední stranu s názvem nebo tabulku živin.", [
      { text: "Vyfotit", onPress: () => addPhoto("camera") },
      { text: "Vybrat z galerie", onPress: () => addPhoto("library") },
      { text: "Zrušit", style: "cancel" },
    ]);
  };
  const needsMore = assessment.verdict === "nevime" || !ai.product.ingredientsText || ai.product.dataCompleteness !== "full";
  const photos = photosOf(product.images, product.imageUrl);
  const [reportText, setReportText] = useState("");
  const [reportSaved, setReportSaved] = useState(false);

  useEffect(() => {
    loadFavorites().then((f) => setFavorite(f.includes(product.id)));
  }, [product.id]);

  useEffect(() => {
    navigation.setOptions({ title: product.name.length > 28 ? product.name.slice(0, 28) + "…" : product.name });
  }, [navigation, product.name]);

  const share = () => {
    const v = verdictText(assessment.verdict, tone, assessment.labelSet);
    const detail = insight?.headline ?? assessment.reasons.slice(0, 2).map((r) => r.text).join(" ");
    Share.share({ message: `${product.name} – ${v.label}. ${detail}`.trim() }).catch(() => undefined);
  };

  const saveReport = async () => {
    if (!reportText.trim()) return;
    await addReport({ productId: product.id, productName: product.name, text: reportText.trim(), at: new Date().toISOString() });
    setReportSaved(true);
    setReportText("");
    setTimeout(() => {
      setReportOpen(false);
      setReportSaved(false);
    }, 1200);
  };

  const sustainabilityFlags = (product.flagged ?? []).filter((f) => f.key === "palm-oil");
  const manufacturerFromResult = result.manufacturer;

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <VerdictBadge
          verdict={assessment.verdict}
          score={assessment.score}
          labelSet={assessment.labelSet}
          working={ai.quickStatus === "loading" || ai.status === "loading"}
          seed={product.id}
        />
        {reused ? (
          <View style={[styles.reusedBox, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
            <Text style={[styles.reusedText, { color: t.text }]}>
              🔁 Tenhle výrobek už jsme hodnotili {formatReusedDate(reused.at)}. Ukazujeme uložený výsledek, nic se znovu neplatí.
            </Text>
            <Button
              title="Analyzovat znovu"
              variant="secondary"
              compact
              onPress={() => navigation.replace("Result", { result: reused.fresh })}
              style={{ marginTop: spacing.sm }}
            />
          </View>
        ) : null}
        <ValueBadge value={ai.insight?.value ?? ai.quick?.value} />
        {assessment.aiAdjusted && (
          <Text style={[styles.adjusted, { color: t.muted, backgroundColor: t.cardAlt }]}>
            Pravidla: {verdictText(assessment.aiAdjusted.from, tone, assessment.labelSet).label} → s posudkem AI:{" "}
            <Text style={{ fontWeight: "800", color: t.text }}>{verdictText(assessment.aiAdjusted.to, tone, assessment.labelSet).label}</Text>
          </Text>
        )}

        <View style={styles.headerBlock}>
          {product.imageUrl ? (
            <Pressable
              onPress={() => setPhotosOpen(true)}
              accessibilityRole="imagebutton"
              accessibilityLabel="Zvětšit fotky balení"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Image source={{ uri: product.imageUrl }} style={styles.image} resizeMode="contain" />
              <View style={styles.photoBadge}>
                <Ionicons name={photos.length > 1 ? "images-outline" : "expand-outline"} size={12} color="#FFFFFF" />
                {photos.length > 1 ? <Text style={styles.photoBadgeText}>{photos.length}</Text> : null}
              </View>
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: t.text }]}>{product.name}</Text>
            {product.brand ? <Text style={[styles.meta, { color: t.muted }]}>{product.brand}</Text> : null}
            {product.manufacturer && product.manufacturer !== product.brand ? (
              <Text style={[styles.meta, { color: t.muted }]}>výrobce: {product.manufacturer}</Text>
            ) : null}
            {product.quantity ? <Text style={[styles.meta, { color: t.muted }]}>{product.quantity}</Text> : null}
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.lg }}>
          <ChipRow>
            <Chip label={confidenceLabels[assessment.confidence]} small />
            <Chip label={sourceLabels[product.source]} small />
            {product.category && /\p{L}/u.test(product.category) ? <Chip label={product.category} small /> : null}
          </ChipRow>
          <Button
            title={needsMore ? "📷 Doplnit fotku: zadní strana, složení, název" : "📷 Doplnit další fotku obalu"}
            variant={needsMore ? "primary" : "secondary"}
            onPress={choosePhoto}
            disabled={supplement.busy}
            loading={supplement.busy}
            compact
            style={{ marginTop: spacing.sm }}
          />
          <Button
            title={inBasket ? "✓ V porovnání · otevřít" : "⚖️ Porovnat s jiným výrobkem"}
            variant="secondary"
            onPress={toCompare}
            compact
            style={{ marginTop: spacing.sm }}
          />
          {supplement.busy ? <InlineLoading text={supplement.busyText} /> : null}
          {supplement.error || photoError ? (
            <ErrorBox
              message={supplement.error ?? photoError ?? ""}
              onRetry={() => {
                supplement.clearError();
                setPhotoError(null);
              }}
              retryLabel="Zavřít"
            />
          ) : null}
        </View>

        {assessment.profileWarnings.length > 0 && (
          <View style={[styles.warnBox, { backgroundColor: t.dangerBg, borderColor: t.danger }]}>
            {assessment.profileWarnings.map((w) => (
              <Text key={w} style={[styles.warnText, { color: t.text }]}>
                ⚠ {w}
              </Text>
            ))}
          </View>
        )}

        <Card title="Posudek AI" expandable initiallyOpen={!fromAlternative || !!initialInsight || !!initialQuick} onOpen={ai.ensureQuick}>
          <DtestRow product={product} found={ai.insight?.dtest ?? ai.quick?.dtest} />
          <InsightSection
            tone={tone}
            labelSet={assessment.labelSet}
            quickStatus={ai.quickStatus}
            quick={ai.quick}
            quickError={ai.quickError}
            onRetryQuick={ai.loadQuick}
            deepStatus={ai.status}
            insight={insight}
            deepError={ai.error}
            meta={ai.meta}
            onStartDeep={ai.loadDeep}
          />
        </Card>

        <Card title="Důvody">
          {assessment.reasons.length === 0 ? (
            <Text style={{ color: t.muted, fontSize: fontSize.md }}>Bez konkrétních důvodů.</Text>
          ) : (
            assessment.reasons.map((r, i) => <ReasonRow key={i} reason={r} />)
          )}
        </Card>

        <Card title="Složení" expandable initiallyOpen>
          <CompositionSection product={product} />
        </Card>

        <Card title="Historie a receptura" subtitle={historySubtitle(insight)} expandable initiallyOpen={false}>
          <HistorySection status={ai.status} insight={insight} onStartDeep={ai.loadDeep} />
        </Card>

        <Card title="Výrobce" expandable initiallyOpen={false}>
          {insight ? (
            <ManufacturerView info={insight.manufacturer} />
          ) : ai.status === "error" ? (
            <ManufacturerSection result={shownResult} active />
          ) : manufacturerFromResult ? (
            <>
              <ManufacturerView info={manufacturerFromResult} />
              {ai.status === "loading" && <InlineLoading text="Důkladný průzkum doplní další informace…" />}
            </>
          ) : ai.status === "loading" ? (
            <InlineLoading text="Výrobce prověřuje důkladný průzkum…" />
          ) : (
            <>
              <Text style={[styles.body, { color: t.muted }]}>Majitele, historii a ocenění výrobce přinese důkladný průzkum.</Text>
              <Button title="🔎 Spustit důkladný průzkum" variant="secondary" compact onPress={ai.loadDeep} />
            </>
          )}
          <Button
            title="Otevřít na celou obrazovku"
            variant="ghost"
            compact
            onPress={() => navigation.navigate("Manufacturer", { result: shownResult, manufacturer: insight?.manufacturer ?? manufacturerFromResult })}
            style={{ marginTop: spacing.md }}
          />
        </Card>

        <Card title="Alternativy" expandable initiallyOpen={false} onOpen={() => setAlternativesActive(true)}>
          <AlternativesSection
            result={shownResult}
            profile={profile}
            active={alternativesActive}
            minScore={assessment.score}
            aiAlternatives={insight?.alternatives}
            aiDropped={insight?.alternativesDropped}
            aiLoading={ai.status === "loading"}
            aiPending={ai.status === "idle" || ai.status === "error"}
          />
          <Button
            title="Otevřít na celou obrazovku"
            variant="ghost"
            compact
            onPress={() => navigation.navigate("Alternatives", { result: shownResult, aiAlternatives: insight?.alternatives })}
            style={{ marginTop: spacing.md }}
          />
        </Card>

        {profile.showSustainability && (
          <Card title="Udržitelnost" expandable initiallyOpen={false}>
            {product.ecoScore ? <Text style={[styles.body, { color: t.text }]}>Eco-Score: {product.ecoScore.toUpperCase()}</Text> : null}
            {product.labels && product.labels.length > 0 ? (
              <ChipRow>
                {product.labels.map((l) => (
                  <Chip key={l} label={l} small />
                ))}
              </ChipRow>
            ) : null}
            {sustainabilityFlags.map((f) => (
              <Text key={f.key} style={[styles.body, { color: t.text }]}>
                ⚠ {f.label}: {f.note}
              </Text>
            ))}
            {!product.ecoScore && !(product.labels && product.labels.length) && sustainabilityFlags.length === 0 && (
              <Text style={[styles.body, { color: t.muted }]}>Zatím nemáme údaje o udržitelnosti.</Text>
            )}
          </Card>
        )}

        {insight && insight.sources.length > 0 && (
          <Card title="Zdroje" subtitle={`${insight.sources.length} odkazů`} expandable initiallyOpen={false}>
            <SourcesSection sources={insight.sources} />
          </Card>
        )}

        <View style={styles.actions}>
          <Button
            title={favorite ? "Uloženo ✓" : "Uložit"}
            variant={favorite ? "secondary" : "primary"}
            onPress={async () => setFavorite(await toggleFavorite(product.id))}
            style={styles.action}
          />
          <Button title="Sdílet" variant="secondary" onPress={share} style={styles.action} />
          <Button title="Nahlásit chybu" variant="ghost" onPress={() => setReportOpen(true)} style={styles.action} />
        </View>
        <Text style={[styles.timing, { color: t.muted }]}>
          {result.timing.path} · {result.timing.ms} ms · není zdravotní rada
        </Text>
      </ScrollView>

      <PhotoViewer visible={photosOpen} images={photos} title={product.name} onClose={() => setPhotosOpen(false)} />

      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <Pressable style={[styles.backdrop, { backgroundColor: t.overlay }]} onPress={() => setReportOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: t.card }]} onPress={() => undefined}>
            <Text style={[styles.sheetTitle, { color: t.text }]}>Co je špatně?</Text>
            {reportSaved ? (
              <Text style={[styles.body, { color: t.success }]}>Uloženo, odešleme ve fázi 1.</Text>
            ) : (
              <>
                <TextInput
                  value={reportText}
                  onChangeText={setReportText}
                  placeholder="např. špatné složení, jiný výrobce…"
                  placeholderTextColor={t.muted}
                  multiline
                  style={[styles.input, { backgroundColor: t.cardAlt, color: t.text, borderColor: t.border }]}
                />
                <Button title="Uložit hlášení" onPress={saveReport} disabled={!reportText.trim()} />
                <Button title="Zrušit" variant="ghost" onPress={() => setReportOpen(false)} style={{ marginTop: spacing.sm }} />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function formatReusedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

const styles = StyleSheet.create({
  reusedBox: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  reusedText: { fontSize: fontSize.sm, lineHeight: 20 },
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xxl },
  adjusted: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    textAlign: "center",
  },
  headerBlock: { flexDirection: "row", padding: spacing.lg, alignItems: "center" },
  image: { width: 84, height: 84, borderRadius: radius.md, marginRight: spacing.lg, backgroundColor: "#FFFFFF" },
  photoBadge: {
    position: "absolute",
    right: spacing.lg + 4,
    bottom: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  photoBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  name: { fontSize: fontSize.xl, fontWeight: "800" },
  meta: { fontSize: fontSize.sm, marginTop: 2 },
  warnBox: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  warnText: { fontSize: fontSize.md, fontWeight: "700", lineHeight: 24 },
  body: { fontSize: fontSize.md, lineHeight: 22, marginBottom: spacing.sm },
  actions: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  action: { marginBottom: spacing.sm },
  timing: { textAlign: "center", fontSize: fontSize.xs, marginTop: spacing.sm },
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: "700", marginBottom: spacing.md },
  input: {
    minHeight: 100,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    fontSize: fontSize.md,
    textAlignVertical: "top",
    marginBottom: spacing.md,
  },
});
