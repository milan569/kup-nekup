import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api, describeError } from "../api/client";
import type { ManufacturerInfo, ProductResult } from "../api/types";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBox } from "../components/ErrorBox";
import { InlineLoading } from "../components/LoadingOverlay";
import { SourceLink, domainOf } from "../components/SourceLink";
import { countryLabel } from "../data/options";
import { fontSize, manufacturerTypeLabels, spacing, useTheme } from "../theme";

/** Presentational view of a manufacturer (from the AI insight or the fallback endpoint). */
export function ManufacturerView({ info }: { info: ManufacturerInfo }) {
  const t = useTheme();
  return (
    <View>
      <Text style={[styles.name, { color: t.text }]}>{info.name}</Text>
      <ChipRow>
        <Chip label={manufacturerTypeLabels[info.type] ?? info.type} small />
        {info.country ? <Chip label={countryLabel(info.country.toLowerCase())} small /> : null}
        {info.verified ? (
          <Chip label="Ověřeno ze zdrojů" small bg="#2E7D32" color="#FFFFFF" />
        ) : (
          <Chip label="Orientační" small bg={t.cardAlt} color={t.muted} />
        )}
      </ChipRow>
      {!info.verified && (
        <Text style={[styles.hint, { color: t.muted }]}>Informace bez ověřených zdrojů, berte je orientačně.</Text>
      )}
      {info.owner ? (
        <Text style={[styles.body, { color: t.text }]}>
          <Text style={{ fontWeight: "700" }}>Vlastník: </Text>
          {info.owner}
        </Text>
      ) : null}
      {info.summary ? <Text style={[styles.body, { color: t.text }]}>{info.summary}</Text> : null}
      {info.awards.length > 0 && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Ocenění</Text>
          {info.awards.map((a) => (
            <Text key={a} style={[styles.li, { color: t.text }]}>
              🏅 {a}
            </Text>
          ))}
        </View>
      )}
      {info.certifications.length > 0 && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Certifikace</Text>
          <ChipRow>
            {info.certifications.map((c) => (
              <Chip key={c} label={c} small />
            ))}
          </ChipRow>
        </View>
      )}
      {info.sources.length > 0 && (
        <View style={styles.block}>
          <Text style={[styles.label, { color: t.muted }]}>Zdroje</Text>
          {info.sources.map((s) => (
            <View key={s.url} style={{ paddingVertical: 2 }}>
              <SourceLink url={s.url} label={`${s.title || domainOf(s.url)} ↗`} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

interface Props {
  result: ProductResult;
  /** load when true */
  active: boolean;
}

/** Fallback: fetches /api/manufacturer (used when the AI insight is unavailable). */
export function ManufacturerSection({ result, active }: Props) {
  const t = useTheme();
  const { product } = result;
  const name = product.manufacturer ?? product.brand;
  const [info, setInfo] = useState<ManufacturerInfo | null>(result.manufacturer ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.manufacturer({
        name,
        brand: product.brand,
        country: product.countries?.[0],
      });
      setInfo(res);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [name, product.brand, product.countries]);

  useEffect(() => {
    if (active && !info && !loading && !error && name) {
      load();
    }
  }, [active, info, loading, error, name, load]);

  if (!name) {
    return <Text style={[styles.muted, { color: t.muted }]}>Výrobce ani značku zatím neznáme.</Text>;
  }
  if (loading) return <InlineLoading text="Zjišťuji informace o výrobci…" />;
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!info) return <Text style={[styles.muted, { color: t.muted }]}>Informace se načtou po otevření karty.</Text>;
  return <ManufacturerView info={info} />;
}

const styles = StyleSheet.create({
  muted: { fontSize: fontSize.md, lineHeight: 22 },
  name: { fontSize: fontSize.lg, fontWeight: "700", marginBottom: spacing.sm },
  hint: { fontSize: fontSize.xs, lineHeight: 18, marginBottom: spacing.sm },
  body: { fontSize: fontSize.md, lineHeight: 22, marginTop: spacing.sm },
  block: { marginTop: spacing.md },
  label: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.xs },
  li: { fontSize: fontSize.md, lineHeight: 24 },
});
