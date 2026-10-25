import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutAnimation, Platform } from "react-native";
import { api, describeError } from "../api/client";
import type { Assessment, Insight, ProductData, ProductResult, QuickInsight, UserProfile } from "../api/types";
import type { RefineParams } from "../navigationTypes";
import { addToHistory, updateHistoryInsight, updateHistoryQuick } from "../storage/history";

export type InsightStatus = "idle" | "loading" | "done" | "error";

interface Options {
  /** start the quick opinion right after mount */
  auto: boolean;
  /** deep insight already known (reopened from history) */
  initial?: Insight;
  /** quick opinion already known (reopened from history) */
  initialQuick?: QuickInsight;
  /** a supplementary photo refined this product: refine the earlier opinions instead of starting over */
  refine?: RefineParams;
}

function animate(): void {
  if (Platform.OS === "ios") LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

/**
 * AI opinions for one result:
 * - quick (10–20 s, automatic) – first opinion with a short web check,
 * - deep (1–2 min, on a button) – history, recipe changes, issues, alternatives.
 * Keeps the displayed assessment and product in sync and stores everything in history.
 */
export function useInsight(result: ProductResult, profile: UserProfile, opts: Options) {
  // deep
  const [status, setStatus] = useState<InsightStatus>(opts.initial ? "done" : "idle");
  const [insight, setInsight] = useState<Insight | undefined>(opts.initial);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ cached: boolean; ms: number } | null>(null);
  // quick
  const [quickStatus, setQuickStatus] = useState<InsightStatus>(opts.initialQuick ? "done" : "idle");
  const [quick, setQuick] = useState<QuickInsight | undefined>(opts.initialQuick);
  const [quickError, setQuickError] = useState<string | null>(null);
  // shown data
  const [assessment, setAssessment] = useState<Assessment>(result.assessment);
  const [product, setProduct] = useState<ProductData>(result.product);

  const deepInFlight = useRef(false);
  const quickInFlight = useRef(false);
  const deepDone = useRef(!!opts.initial);
  const mounted = useRef(true);
  const historyWrite = useRef<Promise<void>>(Promise.resolve());
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const loadQuick = useCallback(async (previousQuick?: QuickInsight) => {
    if (quickInFlight.current) return;
    quickInFlight.current = true;
    setQuickStatus("loading");
    setQuickError(null);
    try {
      const res = await api.quickInsight({ product: result.product, assessment: result.assessment, profile: profileRef.current, previousQuick });
      await historyWrite.current;
      await updateHistoryQuick(result, res.quick, deepDone.current ? undefined : res.assessment);
      if (!mounted.current) return;
      animate();
      setQuick(res.quick);
      // the deep insight, once there, owns the assessment
      if (res.assessment && !deepDone.current) setAssessment(res.assessment);
      setQuickStatus("done");
    } catch (err) {
      if (!mounted.current) return;
      setQuickError(describeError(err));
      setQuickStatus("error");
    } finally {
      quickInFlight.current = false;
    }
  }, [result]);

  const loadDeep = useCallback(async (previousInsight?: Insight) => {
    if (deepInFlight.current) return;
    deepInFlight.current = true;
    setStatus("loading");
    setError(null);
    try {
      const res = await api.insight({ product: result.product, assessment: result.assessment, profile: profileRef.current, previousInsight });
      deepDone.current = true;
      // Persist even if the user already left the screen.
      await historyWrite.current;
      await updateHistoryInsight(result, res.assessment, res.insight, res.product);
      if (!mounted.current) return;
      animate();
      setInsight(res.insight);
      setAssessment(res.assessment);
      if (res.product) setProduct(res.product);
      setMeta({ cached: res.cached, ms: res.ms });
      setStatus("done");
    } catch (err) {
      if (!mounted.current) return;
      setError(describeError(err));
      setStatus("error");
    } finally {
      deepInFlight.current = false;
    }
  }, [result]);

  useEffect(() => {
    mounted.current = true;
    const refine = opts.refine;
    if (refine) {
      const photoNote = result.assessment.reasons.find((r) => r.text.startsWith("📷"));
      if (refine.added.length === 0) {
        // nothing new on the photo: keep the opinions and the verdict as they were
        const kept: Assessment = photoNote ? { ...refine.assessment, reasons: [photoNote, ...refine.assessment.reasons].slice(0, 7) } : refine.assessment;
        setAssessment(kept);
        if (refine.quick) {
          setQuick(refine.quick);
          setQuickStatus("done");
        }
        if (refine.insight) {
          setInsight(refine.insight);
          setStatus("done");
          deepDone.current = true;
        }
        historyWrite.current = addToHistory({ ...result, assessment: kept }, refine.insight, refine.quick, refine.replaces);
      } else {
        historyWrite.current = addToHistory(result, undefined, undefined, refine.replaces);
        // new data: refine the earlier opinions (the server reuses the research, no new charge)
        if (refine.quick) {
          setQuick(refine.quick);
          loadQuick(refine.quick);
        } else if (opts.auto) {
          loadQuick();
        }
        if (refine.insight) {
          setInsight(refine.insight);
          loadDeep(refine.insight);
        }
      }
    } else {
      historyWrite.current = addToHistory(result, opts.initial, opts.initialQuick);
      if (opts.auto && !opts.initial && !opts.initialQuick) loadQuick();
    }
    return () => {
      mounted.current = false;
    };
    // Runs once per result on purpose: options are read at mount time only.
  }, [result]);

  /** Load the quick opinion when the user opens the AI card and nothing is known yet. */
  const ensureQuick = useCallback(() => {
    if (quickStatus === "idle" && status !== "done") loadQuick();
  }, [quickStatus, status, loadQuick]);
  const retryQuick = useCallback(() => loadQuick(), [loadQuick]);
  const startDeep = useCallback(() => loadDeep(), [loadDeep]);

  /** The result as it should be shown now (product and assessment possibly updated by the AI). */
  const shownResult = useMemo<ProductResult>(() => ({ ...result, product, assessment }), [result, product, assessment]);

  return {
    // deep
    status,
    insight,
    error,
    meta,
    loadDeep: startDeep,
    // quick
    quickStatus,
    quick,
    quickError,
    loadQuick: retryQuick,
    ensureQuick,
    // shown
    assessment,
    product,
    shownResult,
  };
}
