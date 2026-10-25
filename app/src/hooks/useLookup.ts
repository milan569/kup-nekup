import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import { ApiError, api, describeError } from "../api/client";
import type { Assessment, Insight, ProductData, ProductResult, QuickInsight, UserProfile } from "../api/types";
import type { RootNavigation } from "../navigationTypes";
import { prepareLabelImage } from "../utils/image";
import { findSimilar } from "../storage/history";
import { useCompare } from "../compare";

export type LookupErrorKind = "auth" | "other";

export interface LookupOptions {
  /** server answered 422 code "in_store_code" (scale/price label): no error box, the caller shows a hint */
  onInStoreCode?: (ean: string) => void;
  /** push a new Result screen instead of navigate (used from a Result screen) */
  push?: boolean;
}

/** Shared lookup state machine used by the Scan and Search screens. */
export function useLookup(profile: UserProfile, options: LookupOptions = {}) {
  const navigation = useNavigation<RootNavigation>();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // "collecting": the result goes into the comparison basket, not to a result screen
  const compare = useCompare();
  const compareRef = useRef(compare);
  compareRef.current = compare;
  const [busyText, setBusyText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<LookupErrorKind | null>(null);
  const [lastAction, setLastAction] = useState<(() => Promise<void>) | null>(null);
  const inFlight = useRef(false);

  /**
   * `wait`: a user-initiated action (photo, gallery) must never be dropped
   * just because an automatic barcode lookup happens to be running – wait
   * for it to finish instead (max. 15 s).
   */
  const run = useCallback(
    async (
      text: string,
      job: () => Promise<ProductResult>,
      wait = false,
      handleError?: (err: unknown) => boolean,
      /** the new result replaces the current screen (a supplementary photo of the same product) */
      replace: false | ((result: ProductResult) => void) = false,
    ) => {
      if (inFlight.current) {
        if (!wait) return;
        const until = Date.now() + 15000;
        while (inFlight.current && Date.now() < until) await new Promise((r) => setTimeout(r, 150));
        if (inFlight.current) return;
      }
      inFlight.current = true;
      setError(null);
      setErrorKind(null);
      setBusyText(text);
      try {
        const result = await job();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        const basket = compareRef.current;
        if (basket.collecting) {
          basket.add(result);
          basket.setCollecting(false);
          navigation.navigate("Tabs", { screen: "Compare" });
        } else if (replace) replace(result);
        else {
          // analysed before (same name and brand, whatever the size): show the stored result, no new AI call
          const prior = await findSimilar(result.product).catch(() => undefined);
          const params = prior
            ? { result: prior.result, insight: prior.insight, quick: prior.quick, reused: { at: prior.at, fresh: result } }
            : { result };
          if (optionsRef.current.push) navigation.push("Result", params);
          else navigation.navigate("Result", params);
        }
      } catch (err) {
        if (handleError && handleError(err)) return;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        setError(describeError(err));
        setErrorKind(err instanceof ApiError && err.kind === "auth" ? "auth" : "other");
      } finally {
        setBusyText(null);
        inFlight.current = false;
      }
    },
    [navigation],
  );

  const lookupEan = useCallback(
    async (ean: string, userInitiated = false) => {
      const action = () =>
        run("Hledám produkt…", () => api.lookupEan({ ean, profile }), userInitiated, (err) => {
          const onInStore = optionsRef.current.onInStoreCode;
          if (onInStore && err instanceof ApiError && err.code === "in_store_code") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
            onInStore(ean);
            return true;
          }
          return false;
        });
      setLastAction(() => action);
      await action();
    },
    [profile, run],
  );

  const lookupPhotoUri = useCallback(
    async (uri: string, hint?: string) => {
      const action = () =>
        run(
          "Čtu etiketu…",
          async () => {
            const imageBase64 = await prepareLabelImage(uri);
            return api.lookupPhoto({ imageBase64, mediaType: "image/jpeg", profile, hint });
          },
          true,
        );
      setLastAction(() => action);
      await action();
    },
    [profile, run],
  );

  /** A further photo of the product on screen (back label, ingredients, front): merged on the server. */
  const supplementPhotoUri = useCallback(
    async (uri: string, base: ProductData, carry: { quick?: QuickInsight; insight?: Insight; assessment: Assessment }) => {
      const action = () =>
        run(
          "Čtu doplňkovou fotku…",
          async () => {
            const imageBase64 = await prepareLabelImage(uri);
            return api.lookupPhoto({ imageBase64, mediaType: "image/jpeg", profile, base });
          },
          true,
          undefined,
          (result) =>
            navigation.replace("Result", {
              result,
              refine: { added: result.supplement?.added ?? [], replaces: result.supplement?.replaces ?? base.id, ...carry },
            }),
        );
      setLastAction(() => action);
      await action();
    },
    [profile, run, navigation],
  );

  const lookupManual = useCallback(
    async (name: string, brand?: string, description?: string) => {
      const action = () => run("Posuzuji produkt…", () => api.lookupManual({ name, brand, description, profile }), true);
      setLastAction(() => action);
      await action();
    },
    [profile, run],
  );

  const retry = useCallback(async () => {
    if (lastAction) await lastAction();
  }, [lastAction]);

  const clearError = useCallback(() => {
    setError(null);
    setErrorKind(null);
  }, []);

  return {
    busy: busyText !== null,
    busyText: busyText ?? "",
    error,
    errorKind,
    clearError,
    retry: lastAction ? retry : undefined,
    lookupEan,
    lookupPhotoUri,
    lookupManual,
    supplementPhotoUri,
    inFlight,
  };
}
