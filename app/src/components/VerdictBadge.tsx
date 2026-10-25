import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import type { LabelSet, Tone, Verdict } from "../api/types";
import { VERDICTS, verdictText } from "../api/verdicts";
import { useTone } from "../profile";
import { fontSize, radius, spacing } from "../theme";
import { ALCOHOL_SUBTITLES, NEVIME_HUMOR, VERDICT_SUBTITLES, WORKING_HUMOR, WORKING_SERIOUS, pickStable } from "../data/phrases";
import { useRotatingPhrase } from "../hooks/useRotatingPhrase";

interface Props {
  verdict: Verdict;
  /** hero = full-width block, compact = pill for lists, dot = emoji circle */
  size?: "hero" | "compact" | "dot";
  score?: number;
  /** defaults to the profile tone */
  tone?: Tone;
  /** compact only: max lines of the label (default 1) */
  lines?: number;
  /** "alcohol": the drinking scale ("Bolehlav" instead of "Nouzovka") in the humour tone */
  labelSet?: LabelSet;
  /** hero only: the AI is still working on a product the rules could not judge – show a rotating "working" phrase */
  working?: boolean;
  /** hero only: picks a stable "we don't know" phrase for this product */
  seed?: string;
}

const useNative = Platform.OS !== "web";

export function VerdictBadge({ verdict, size = "hero", score, tone, lines = 1, labelSet, working, seed }: Props) {
  const profileTone = useTone();
  const effectiveTone = tone ?? profileTone;
  const meta = VERDICTS[verdict] ?? VERDICTS.nevime;
  const text = verdictText(meta.key, effectiveTone, labelSet);

  if (size === "dot") {
    return (
      <View style={[styles.dot, { backgroundColor: meta.color }]} accessibilityLabel={text.label}>
        <Text style={styles.dotEmoji}>{meta.emoji}</Text>
      </View>
    );
  }

  if (size === "compact") {
    return (
      <View style={[styles.compact, { backgroundColor: meta.color }]} accessibilityLabel={text.label}>
        <Text style={styles.compactEmoji}>{meta.emoji}</Text>
        <Text style={[styles.compactText, { color: meta.textColor }]} numberOfLines={lines}>
          {text.label}
        </Text>
      </View>
    );
  }

  return <HeroBadge verdict={meta.key} score={score} tone={effectiveTone} labelSet={labelSet} working={working} seed={seed} />;
}

function HeroBadge({
  verdict,
  score,
  tone,
  labelSet,
  working,
  seed,
}: {
  verdict: Verdict;
  score?: number;
  tone: Tone;
  labelSet?: LabelSet;
  working?: boolean;
  seed?: string;
}) {
  const meta = VERDICTS[verdict];
  const unknown = verdict === "nevime";
  const phrase = useRotatingPhrase(tone === "serious" ? WORKING_SERIOUS : WORKING_HUMOR, !!working && unknown);
  const base =
    working && unknown
      ? phrase
      : unknown && tone !== "serious" && !labelSet
        ? pickStable(NEVIME_HUMOR, seed)
        : verdictText(verdict, tone, labelSet);
  // humour tone: the companion line is one of ten, picked at random and slowly rotating
  const pool =
    !unknown && tone !== "serious" ? (labelSet === "alcohol" ? ALCOHOL_SUBTITLES : VERDICT_SUBTITLES)[verdict as Exclude<Verdict, "nevime">] : [base.subtitle];
  const rotatingSubtitle = useRotatingPhrase(pool, pool.length > 1, 7000);
  const text = { label: base.label, subtitle: pool.length > 1 ? rotatingSubtitle : base.subtitle };
  const fade = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  // Short fade whenever the verdict changes (e.g. after the AI insight arrives).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    fade.setValue(0.2);
    Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: useNative }).start();
  }, [verdict, fade]);

  const lightText = meta.textColor.toUpperCase() === "#FFFFFF";
  const chipBg = lightText ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.12)";

  return (
    <View style={{ backgroundColor: meta.color }}>
      <Animated.View style={[styles.hero, { opacity: fade }]} accessibilityRole="header" accessibilityLabel={`${text.label}. ${text.subtitle}`}>
        <Text style={styles.heroEmoji}>{meta.emoji}</Text>
        <View style={styles.heroTextCol}>
          <Text style={[styles.heroLabel, { color: meta.textColor }]}>{text.label}</Text>
          <Text style={[styles.heroSub, { color: meta.textColor }]}>{text.subtitle}</Text>
          {typeof score === "number" && (
            <View style={[styles.scoreChip, { backgroundColor: chipBg }]}>
              <Text style={[styles.scoreText, { color: meta.textColor }]}>{Math.round(score)} / 100</Text>
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    minHeight: 120,
  },
  heroEmoji: { fontSize: 46, lineHeight: 58, marginRight: spacing.lg },
  heroTextCol: { flex: 1 },
  heroLabel: { fontSize: fontSize.xxl, lineHeight: 33, fontWeight: "800" },
  heroSub: { fontSize: fontSize.md, lineHeight: 21, marginTop: 4, opacity: 0.9 },
  scoreChip: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  scoreText: { fontSize: fontSize.sm, fontWeight: "800" },
  compact: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    maxWidth: 240,
  },
  compactEmoji: { fontSize: fontSize.sm, marginRight: 4 },
  compactText: { fontSize: fontSize.xs, fontWeight: "800", flexShrink: 1 },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  dotEmoji: { fontSize: 18 },
});
