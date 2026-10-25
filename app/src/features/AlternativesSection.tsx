import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { api, describeError } from "../api/client";
import type { Alternative, AlternativesResearchResponse, InsightAlternative, ProductImage, ProductResult, UserProfile, Verdict } from "../api/types";
import { VERDICTS } from "../api/verdicts";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { ErrorBox } from "../components/ErrorBox";
import { InlineLoading } from "../components/LoadingOverlay";
import { PhotoViewer, photosOf } from "../components/PhotoViewer";
import { SourceLink, domainOf } from "../components/SourceLink";
import { VerdictBadge } from "../components/VerdictBadge";
import { COUNTRIES, countryLabel, storeLabel } from "../data/options";
import { useLookup } from "../hooks/useLookup";
import type { RootNavigation } from "../navigationTypes";
import { fontSize, radius, spacing, useTheme } from "../theme";

interface Props {
  /** the result as currently shown (its assessment.verdict is the comparison baseline) */
  result: ProductResult;
  profile: UserProfile;
  active: boolean;
  /** score of the displayed (possibly AI-adjusted) assessment; defaults to the result's */
  minScore?: number;
  /** suggestions from the deep AI research (not scanned products) */
  aiAlternatives?: InsightAlternative[];
  /** the deep research is running */
  aiLoading?: boolean;
  /** the deep research has not run (or failed) – tips would come from it */
  aiPending?: boolean;
  /** AI suggestions the server dropped because they were not better than this product */
  aiDropped?: number;
}

export function AlternativesSection({ result, profile, active, minScore, aiAlternatives, aiLoading, aiPending, aiDropped }: Props) {
  const t = useTheme();
  const navigation = useNavigation<RootNavigation>();
  // EAN of an AI tip → full lookup, pushed as a new Result screen
  const lookup = useLookup(profile, { push: true });
  const [store, setStore] = useState<string | null>(null);
  const [items, setItems] = useState<Alternative[] | null>(result.alternatives ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<{ images: ProductImage[]; title: string } | null>(null);
  // targeted research of the closest alternatives in one country
  const [country, setCountry] = useState<string>(profile.countries[0] ?? "cz");
  const [research, setResearch] = useState<AlternativesResearchResponse | null>(null);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const currentVerdict = result.assessment.verdict;
  const showPhotos = (images: ProductImage[], title: string) => (images.length ? () => setPhotos({ images, title }) : undefined);

  const load = useCallback(
    async (onlyStore: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.alternatives({
          productId: result.product.id,
          categoryTags: result.product.categoryTags ?? [],
          countries: profile.countries,
          stores: onlyStore ? [onlyStore] : profile.stores,
          profile,
          minScore: minScore ?? result.assessment.score,
        });
        setItems(res.alternatives);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setLoading(false);
      }
    },
    [profile, minScore, result.assessment.score, result.product.categoryTags, result.product.id],
  );

  useEffect(() => {
    if (active && items === null && !loading && !error) {
      load(store);
    }
  }, [active, items, loading, error, load, store]);

  // another country → the earlier research no longer applies
  useEffect(() => {
    setResearch(null);
    setResearchError(null);
  }, [country]);

  const pickStore = (key: string | null) => {
    setStore(key);
    load(key);
  };

  const runResearch = async () => {
    setResearching(true);
    setResearchError(null);
    try {
      setResearch(await api.alternativesResearch({ product: result.product, assessment: result.assessment, country, profile }));
    } catch (err) {
      setResearchError(describeError(err));
    } finally {
      setResearching(false);
    }
  };

  // every tip opens a full analysis in the app: by barcode when known, else by name (AI, ~20 s)
  const openTip = (tip: InsightAlternative) => {
    if (tip.ean) lookup.lookupEan(tip.ean, true);
    else lookup.lookupManual(tip.name, tip.brand);
  };

  const renderTip = (tip: InsightAlternative, key: string) => (
    <Pressable
      key={key}
      onPress={() => openTip(tip)}
      disabled={lookup.busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, { backgroundColor: t.cardAlt, opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={styles.head}>
        <Thumb uri={tip.imageUrl} count={photosOf(tip.images, tip.imageUrl).length} onPress={showPhotos(photosOf(tip.images, tip.imageUrl), tip.name)} />
        <View style={styles.middle}>
          <Text style={[styles.name, { color: t.text }]} numberOfLines={2}>
            {tip.name}
          </Text>
          {tip.brand ? (
            <Text style={[styles.brand, { color: t.muted }]} numberOfLines={1}>
              {tip.brand}
            </Text>
          ) : null}
          <View style={styles.badges}>
            {tip.verdict ? <VerdictBadge verdict={tip.verdict} size="compact" labelSet={result.assessment.labelSet} /> : null}
            <CompareChip alt={tip.verdict} current={currentVerdict} />
            {tip.verdict && tip.verdictSource === "ai" ? <Text style={[styles.estimate, { color: t.muted }]}>odhad AI</Text> : null}
          </View>
        </View>
      </View>
      <Text style={[styles.why, { color: t.text }]}>{tip.whyBetter}</Text>
      {tip.whereToBuy ? (
        <Text style={[styles.where, { color: t.text }]}>
          <Text style={{ fontWeight: "700" }}>Kde koupit: </Text>
          {tip.whereToBuy}
        </Text>
      ) : null}
      <View style={styles.links}>
        {tip.sourceUrl ? <SourceLink url={tip.sourceUrl} label={`${domainOf(tip.sourceUrl)} ↗`} /> : <SourceLink url={webSearchUrl(tip)} label="hledat na webu ↗" />}
      </View>
      <Text style={[styles.tapHint, { color: t.primary }]}>{tip.ean ? "Klepněte pro plný rozbor" : "Klepněte pro rozbor v aplikaci (AI, asi 20 s)"}</Text>
    </Pressable>
  );

  const tips = aiAlternatives ?? [];
  const hasTips = tips.length > 0;
  // the user's countries first, then the rest of the region
  const countryOptions = [...profile.countries.map((c) => COUNTRIES.find((o) => o.key === c) ?? { key: c, label: countryLabel(c) }), ...COUNTRIES.filter((o) => !profile.countries.includes(o.key))];

  return (
    <View>
      {lookup.busy && <InlineLoading text={lookup.busyText} />}
      {lookup.error && !lookup.busy && (
        <ErrorBox message={lookup.error} actionLabel={lookup.retry ? "Zkusit znovu" : undefined} onAction={lookup.retry} onRetry={lookup.clearError} retryLabel="Zavřít" />
      )}

      {hasTips && (
        <View style={styles.tipsBlock}>
          <Text style={[styles.label, { color: t.muted }]}>Tipy AI na lepší volbu</Text>
          {tips.map((tip, i) => renderTip(tip, "tip" + i))}
          {aiDropped ? (
            <Text style={[styles.dropped, { color: t.muted }]}>
              {aiDropped === 1 ? "1 návrh AI jsme vyřadili, nebyl lepší než tento výrobek." : `${aiDropped} návrhy AI jsme vyřadili, nebyly lepší než tento výrobek.`}
            </Text>
          ) : null}
        </View>
      )}
      {!hasTips && aiDropped ? (
        <Text style={[styles.pending, { color: t.muted }]}>Průzkum nenašel nic prokazatelně lepšího stejného druhu; návrhy stejné nebo horší úrovně jsme vyřadili.</Text>
      ) : null}
      {!hasTips && aiLoading && <InlineLoading text="Tipy AI s fotkami přijdou s důkladným průzkumem…" />}
      {!hasTips && aiPending && (
        <Text style={[styles.pending, { color: t.muted }]}>Tipy AI s fotkami přinese 🔎 Důkladný průzkum v kartě Posudek AI.</Text>
      )}

      {/* closest alternatives of the same kind in a chosen country */}
      <View style={[styles.researchBox, { borderColor: t.border }]}>
        <Text style={[styles.label, { color: t.muted }]}>Nejbližší alternativy v zemi</Text>
        <ChipRow>
          {countryOptions.map((c) => (
            <Chip key={c.key} label={c.label} selected={country === c.key} onPress={() => setCountry(c.key)} small />
          ))}
        </ChipRow>
        {!research && (
          <Button
            title={researching ? "Hledám…" : `🔎 Najít alternativy v zemi ${countryLabel(country)} (do 1 min)`}
            variant="secondary"
            compact
            onPress={runResearch}
            loading={researching}
            disabled={researching}
            style={{ marginTop: spacing.sm }}
          />
        )}
        {researching && <InlineLoading text={`Hledám výrobky přesně stejného druhu v zemi ${countryLabel(country)}…`} />}
        {researchError && !researching ? <ErrorBox message={researchError} onRetry={() => setResearchError(null)} retryLabel="Zavřít" /> : null}
        {research && (
          <View style={{ marginTop: spacing.sm }}>
            <Text style={[styles.productType, { color: t.muted }]}>
              Hledali jsme: <Text style={{ color: t.text, fontWeight: "700" }}>{research.productType}</Text> · {countryLabel(research.country)}
            </Text>
            {research.alternatives.length === 0 && (
              <Text style={[styles.pending, { color: t.muted }]}>
                {research.droppedWorse
                  ? `V zemi ${countryLabel(research.country)} jsme nenašli nic lepšího stejného druhu; ${research.droppedWorse} návrhů stejné nebo horší úrovně jsme vyřadili.`
                  : `V zemi ${countryLabel(research.country)} jsme nic přesně stejného druhu nenašli.`}
              </Text>
            )}
            {research.alternatives.length > 0 && research.droppedWorse ? (
              <Text style={[styles.dropped, { color: t.muted }]}>{research.droppedWorse} další návrhy jsme vyřadili, nebyly lepší než tento výrobek.</Text>
            ) : null}
            {research.alternatives.map((tip, i) => renderTip(tip, "res" + i))}
            {research.sources.length > 0 && (
              <View style={{ marginTop: spacing.xs }}>
                {research.sources.slice(0, 4).map((s) => (
                  <SourceLink key={s.url} url={s.url} label={`${s.title} ↗`} />
                ))}
              </View>
            )}
            <Text style={[styles.again, { color: t.muted }]} onPress={runResearch} suppressHighlighting>
              Hledat znovu
            </Text>
          </View>
        )}
      </View>

      {hasTips && (loading || !!error || (items?.length ?? 0) > 0) && <Text style={[styles.label, { color: t.muted }]}>Z databáze produktů</Text>}

      {profile.stores.length > 0 && (
        <View style={{ marginBottom: spacing.sm }}>
          <Text style={[styles.label, { color: t.muted }]}>Jsem teď v</Text>
          <ChipRow>
            <Chip label="kdekoli" selected={store === null} onPress={() => pickStore(null)} small />
            {profile.stores.map((s) => (
              <Chip key={s} label={storeLabel(s)} selected={store === s} onPress={() => pickStore(s)} small />
            ))}
          </ChipRow>
        </View>
      )}

      {loading && <InlineLoading text="Hledám lepší alternativy…" />}
      {error && !loading && <ErrorBox message={error} onRetry={() => load(store)} />}
      {!loading && !error && items && items.length === 0 && !hasTips && <EmptyState title="Zatím nemáme lepší alternativu v této kategorii." />}
      {!loading &&
        items?.map((alt) => (
          <Pressable
            key={alt.product.id}
            onPress={() =>
              navigation.push("Result", {
                result: { product: alt.product, assessment: alt.assessment, timing: result.timing },
                fromAlternative: true,
              })
            }
            style={({ pressed }) => [styles.card, { backgroundColor: t.cardAlt, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={styles.head}>
              <Thumb
                uri={alt.product.imageUrl}
                count={photosOf(alt.product.images, alt.product.imageUrl).length}
                onPress={showPhotos(photosOf(alt.product.images, alt.product.imageUrl), alt.product.name)}
              />
              <View style={styles.middle}>
                <Text style={[styles.name, { color: t.text }]} numberOfLines={2}>
                  {alt.product.name}
                </Text>
                {alt.product.brand ? (
                  <Text style={[styles.brand, { color: t.muted }]} numberOfLines={1}>
                    {alt.product.brand}
                  </Text>
                ) : null}
                <View style={styles.badges}>
                  <VerdictBadge verdict={alt.assessment.verdict} size="compact" labelSet={alt.assessment.labelSet} />
                  <CompareChip alt={alt.assessment.verdict} current={currentVerdict} />
                </View>
              </View>
            </View>
            <Text style={[styles.why, { color: t.text }]} numberOfLines={3}>
              {alt.whyBetter}
            </Text>
            {alt.product.stores && alt.product.stores.length > 0 && (
              <Text style={[styles.brand, { color: t.muted }]}>k dostání: {alt.product.stores.map(storeLabel).join(", ")}</Text>
            )}
          </Pressable>
        ))}
      <PhotoViewer visible={!!photos} images={photos?.images ?? []} title={photos?.title} onClose={() => setPhotos(null)} />
    </View>
  );
}

/** web search for a tip that has no product page yet */
function webSearchUrl(tip: InsightAlternative): string {
  return `https://www.google.com/search?q=${encodeURIComponent([tip.brand, tip.name].filter(Boolean).join(" "))}`;
}

/** Package photo; when tappable it opens the full-screen viewer (badge shows how many photos there are). */
function Thumb({ uri, onPress, count = 0 }: { uri?: string; onPress?: () => void; count?: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View style={[styles.thumb, styles.img, styles.placeholder, { backgroundColor: t.border }]}>
        <Ionicons name="image-outline" size={24} color={t.muted} />
      </View>
    );
  }
  const image = <Image source={{ uri }} style={styles.img} resizeMode="contain" onError={() => setFailed(true)} />;
  if (!onPress) return <View style={styles.thumb}>{image}</View>;
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="imagebutton" accessibilityLabel="Zvětšit fotku balení" style={({ pressed }) => [styles.thumb, { opacity: pressed ? 0.7 : 1 }]}>
      {image}
      <View style={styles.zoomBadge}>
        <Ionicons name={count > 1 ? "images-outline" : "expand-outline"} size={11} color="#FFFFFF" />
        {count > 1 ? <Text style={styles.zoomText}>{count}</Text> : null}
      </View>
    </Pressable>
  );
}

/** „lepší / podobná / horší" compared with the verdict currently shown for the scanned product. */
function CompareChip({ alt, current }: { alt?: Verdict; current: Verdict }) {
  if (!alt || alt === "nevime" || current === "nevime") return null;
  const diff = VERDICTS[alt].rank - VERDICTS[current].rank;
  const { label, bg } = diff > 0 ? { label: "lepší", bg: "#2E7D32" } : diff < 0 ? { label: "horší", bg: "#C62828" } : { label: "podobná", bg: "#757575" };
  return (
    <View style={[styles.compare, { backgroundColor: bg }]}>
      <Text style={styles.compareText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.xs },
  card: { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  head: { flexDirection: "row", alignItems: "flex-start" },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  thumb: { marginRight: spacing.md },
  img: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: "#FFFFFF" },
  zoomBadge: {
    position: "absolute",
    right: 3,
    bottom: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  zoomText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  placeholder: { alignItems: "center", justifyContent: "center" },
  middle: { flex: 1 },
  name: { fontSize: fontSize.md, fontWeight: "700" },
  brand: { fontSize: fontSize.xs, marginTop: 2 },
  why: { fontSize: fontSize.sm, marginTop: spacing.xs, lineHeight: 20 },
  where: { fontSize: fontSize.sm, marginTop: spacing.xs, lineHeight: 20 },
  tapHint: { fontSize: fontSize.xs, fontWeight: "700", marginTop: spacing.xs },
  links: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.xs },
  estimate: { fontSize: fontSize.xs },
  compare: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  compareText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "800" },
  tipsBlock: { marginBottom: spacing.md },
  pending: { fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing.md },
  researchBox: { borderWidth: 1, borderStyle: "dashed", borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  productType: { fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing.sm },
  dropped: { fontSize: fontSize.xs, lineHeight: 18, marginTop: spacing.xs },
  again: { fontSize: fontSize.sm, fontWeight: "700", textAlign: "center", marginTop: spacing.sm, textDecorationLine: "underline" },
});
