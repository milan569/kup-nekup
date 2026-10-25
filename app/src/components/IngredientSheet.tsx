import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, describeError } from "../api/client";
import type { HealthInfo, IngredientInfo, Risk, Tone } from "../api/types";
import { useTone } from "../profile";
import { fontSize, radius, riskColors, riskLabels, spacing, useTheme } from "../theme";
import { Button } from "./Button";
import { domainOf, openUrl } from "./SourceLink";

/** What the user tapped: free ingredient text, or a direct reference such as "additive:E250". */
export interface IngredientQuery {
  title: string;
  q?: string;
  ref?: string;
  /** the whole ingredient list (meat-only fillers depend on it) */
  context?: string;
}

type Level = HealthInfo["occasionalLevel"];

const LEVEL_TEXT: Record<Tone, Record<Level, string>> = {
  humor: {
    0: "Pohoda, žer klidně",
    1: "Občas tě to nezabije",
    2: "Jednou za uherský rok",
    3: "Na tohle se vyser",
  },
  serious: {
    0: "V pořádku i pravidelně",
    1: "Občas nevadí, denně omezit",
    2: "Jen výjimečně",
    3: "Raději vůbec",
  },
};

const HEADINGS: Record<Tone, { occasional: string; excess: string; limit: string; groups: string }> = {
  humor: {
    occasional: "Jednou za čas",
    excess: "Když to přežereš",
    limit: "Kolik je ještě OK",
    groups: "Pozor hlavně",
  },
  serious: {
    occasional: "Při občasné konzumaci",
    excess: "Při nadměrné konzumaci",
    limit: "Doporučený limit",
    groups: "Zvýšené riziko pro",
  },
};

export function levelText(level: Level, tone: Tone): string {
  return LEVEL_TEXT[tone][level];
}

// answers don't change between taps; keep them for the session
const memo = new Map<string, IngredientInfo[]>();

interface Props {
  query: IngredientQuery | null;
  onClose: () => void;
}

export function IngredientSheet({ query, onClose }: Props) {
  const t = useTheme();
  const tone = useTone();
  const [matches, setMatches] = useState<IngredientInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!query) return;
    const key = query.ref ?? `q:${query.q ?? ""}|${query.context ?? ""}`;
    const known = memo.get(key);
    setError(null);
    if (known) {
      setMatches(known);
      return;
    }
    setMatches(null);
    let cancelled = false;
    api
      .ingredientInfo({ q: query.q, ref: query.ref, context: query.context?.slice(0, 4000) })
      .then((res) => {
        memo.set(key, res.matches);
        if (!cancelled) setMatches(res.matches);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [query, attempt]);

  const worst = (matches ?? []).reduce<number>((m, x) => Math.max(m, x.health?.occasionalLevel ?? x.risk ?? 0), -1);
  const barColor = worst >= 0 ? riskColors[worst as Risk] : { bg: t.cardAlt, text: t.text };

  return (
    <Modal visible={!!query} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: t.overlay }]} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: t.card }]} onPress={() => undefined}>
          <View style={[styles.bar, { backgroundColor: barColor.bg }]}>
            <Text style={[styles.barTitle, { color: barColor.text }]} numberOfLines={3}>
              {query?.title ?? ""}
            </Text>
            {worst >= 0 && matches?.some((m) => m.health) ? (
              <Text style={[styles.barSub, { color: barColor.text }]}>
                {HEADINGS[tone].occasional}: {levelText(worst as Level, tone)}
              </Text>
            ) : null}
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {!matches && !error && (
              <View style={styles.loading}>
                <ActivityIndicator color={t.primary} />
                <Text style={[styles.muted, { color: t.muted }]}>Hledám v databázi složek…</Text>
              </View>
            )}
            {error && (
              <View>
                <Text style={[styles.text, { color: t.text }]}>{error}</Text>
                <View style={{ marginTop: spacing.md }}>
                  <Button title="Zkusit znovu" variant="secondary" onPress={() => setAttempt((a) => a + 1)} />
                </View>
              </View>
            )}
            {matches && matches.length === 0 && (
              <Text style={[styles.text, { color: t.text }]}>
                {tone === "humor"
                  ? "Tohle v naší databázi zatím nemáme. Není to žádné aditivum ani známý průšvih, takže nejspíš obyčejná surovina."
                  : "Tuto složku v databázi zatím nemáme. Nejde o aditivum ani o složku, na kterou upozorňujeme, takže jde nejspíš o běžnou surovinu."}
              </Text>
            )}
            {matches?.map((m) => (
              <MatchCard key={`${m.kind}:${m.id}`} m={m} tone={tone} single={matches.length === 1} />
            ))}
            {matches && matches.length > 0 && (
              <Text style={[styles.disclaimer, { color: t.muted }]}>
                Vychází z hodnocení EFSA, WHO a odborné literatury. Není to zdravotní rada.
              </Text>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Button title="Zavřít" variant="secondary" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MatchCard({ m, tone, single }: { m: IngredientInfo; tone: Tone; single: boolean }) {
  const t = useTheme();
  const h = m.health;
  const heads = HEADINGS[tone];
  const risk = m.risk !== undefined ? riskColors[m.risk] : undefined;
  return (
    <View style={[styles.card, !single && { backgroundColor: t.cardAlt, padding: spacing.md }]}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: t.text }]}>{m.title}</Text>
          {m.category ? <Text style={[styles.muted, { color: t.muted }]}>{m.category}</Text> : null}
        </View>
        {risk && m.risk !== undefined ? (
          <View style={[styles.pill, { backgroundColor: risk.bg }]}>
            <Text style={[styles.pillText, { color: risk.text }]}>{riskLabels[m.risk]}</Text>
          </View>
        ) : null}
      </View>

      {m.note ? <Text style={[styles.text, { color: t.text }]}>{m.note}</Text> : null}

      {h ? (
        <>
          <Section title={heads.occasional}>
            <View style={[styles.pill, styles.levelPill, { backgroundColor: riskColors[h.occasionalLevel].bg }]}>
              <Text style={[styles.pillText, { color: riskColors[h.occasionalLevel].text }]}>{levelText(h.occasionalLevel, tone)}</Text>
            </View>
            <Text style={[styles.text, { color: t.text }]}>{h.occasional}</Text>
          </Section>
          <Section title={heads.excess}>
            <Text style={[styles.text, { color: t.text }]}>{h.excess}</Text>
          </Section>
          {h.limit ? (
            <Section title={heads.limit}>
              <Text style={[styles.text, { color: t.text }]}>{h.limit}</Text>
            </Section>
          ) : null}
          {h.groups ? (
            <Section title={heads.groups}>
              <Text style={[styles.text, { color: t.text }]}>{h.groups}</Text>
            </Section>
          ) : null}
        </>
      ) : (
        <Text style={[styles.muted, { color: t.muted, marginTop: spacing.sm }]}>Podrobný vliv na zdraví u této složky ještě doplníme.</Text>
      )}

      {m.sources.length > 0 && (
        <View style={{ marginTop: spacing.sm }}>
          {m.sources.slice(0, 3).map((url) => (
            <Text key={url} style={[styles.source, { color: t.primary }]} onPress={() => openUrl(url)} suppressHighlighting>
              {domainOf(url)} ↗
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: t.muted }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "88%", overflow: "hidden" },
  bar: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  barTitle: { fontSize: fontSize.lg, fontWeight: "800" },
  barSub: { fontSize: fontSize.sm, fontWeight: "700", marginTop: 2 },
  body: { padding: spacing.lg, gap: spacing.md },
  loading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  card: { borderRadius: radius.md },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginBottom: spacing.xs },
  name: { fontSize: fontSize.lg, fontWeight: "800" },
  muted: { fontSize: fontSize.sm, lineHeight: 20 },
  text: { fontSize: fontSize.md, lineHeight: 23 },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, alignSelf: "flex-start" },
  levelPill: { marginBottom: spacing.xs },
  pillText: { fontSize: fontSize.xs, fontWeight: "800" },
  section: { marginTop: spacing.md },
  sectionTitle: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.xs, fontWeight: "700" },
  source: { fontSize: fontSize.sm, fontWeight: "700", paddingVertical: 2 },
  disclaimer: { fontSize: fontSize.xs, lineHeight: 18 },
  footer: { padding: spacing.lg, paddingTop: spacing.sm },
});
