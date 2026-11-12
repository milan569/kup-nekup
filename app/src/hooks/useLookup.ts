import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import { ApiError, api, describeError, errorKindOf } from "../api/client";
import type { Assessment, Insight, ProductData, ProductResult, QuickInsight, UserProfile } from "../api/types";
import type { RootNavigation } from "../navigationTypes";
import { isUnknownCodeProduct } from "../core/scan";
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
  const [lastAction, setLastAction] = useState<(() => Promise<boolean>) | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
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
        if (!wait) return false;
        const until = Date.now() + 15000;
        while (inFlight.current && Date.now() < until) await new Promise((r) => setTimeout(r, 150));
        if (inFlight.current) return false;
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
          const prior = await findSimilar(result.product, profileRef.current.tone).catch(() => undefined);
          const params = prior
            ? { result: prior.result, insight: prior.insight, quick: prior.quick, reused: { at: prior.at, fresh: result } }
            : { result };
          if (optionsRef.current.push) navigation.push("Result", params);
          else navigation.navigate("Result", params);
        }
        return true;
      } catch (err) {
        if (handleError && handleError(err)) return false;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        setError(describeError(err));
        setErrorKind(errorKindOf(err));
        return false;
      } finally {
        setBusyText(null);
        inFlight.current = false;
      }
    },
    [navigation],
  );

  /** A shop's scale label is not an error: the caller shows a hint. */
  const inStoreHandler = useCallback(
    (ean: string) => (err: unknown) => {
      const onInStore = optionsRef.current.onInStoreCode;
      if (onInStore && err instanceof ApiError && err.code === "in_store_code") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        onInStore(ean);
        return true;
      }
      return false;
    },
    [],
  );

  const lookupEan = useCallback(
    async (ean: string, userInitiated = false) => {
      const action = () => run("Hledám produkt…", () => api.lookupEan({ ean, profile }), userInitiated, inStoreHandler(ean));
      setLastAction(() => action);
      return action();
    },
    [profile, run, inStoreHandler],
  );

  /**
   * A photo whose barcode was decoded on the device. The database answers
   * first (free). The label on the photo is read by AI only when the code is
   * unknown or a shop's scale label, and only when `readLabel` allows it.
   */
  const lookupCodeFromPhoto = useCallback(
    async (ean: string, uri: string, readLabel: boolean) => {
      const action = () =>
        run(
          "Hledám produkt…",
          async () => {
            let byCode: ProductResult | undefined;
            try {
              byCode = await api.lookupEan({ ean, profile });
            } catch (err) {
              if (!(readLabel && err instanceof ApiError && err.code === "in_store_code")) throw err;
            }
            if (byCode && (!readLabel || !isUnknownCodeProduct(byCode.product))) return byCode;
            setBusyText("Čtu etiketu…");
            try {
              const imageBase64 = await prepareLabelImage(uri);
              const read = await api.lookupPhoto({ imageBase64, mediaType: "image/jpeg", profile, ean });
              // the photo shows the code alone: the unknown-code result offers more (AI search by the code, adding a photo)
              return byCode && read.product.id === "photo:none" ? byCode : read;
            } catch (err) {
              if (byCode) return byCode;
              throw err;
            }
          },
          true,
          inStoreHandler(ean),
        );
      setLastAction(() => action);
      return action();
    },
    [profile, run, inStoreHandler],
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
      return action();
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
      return action();
    },
    [profile, run, navigation],
  );

  const lookupManual = useCallback(
    async (name: string, brand?: string, description?: string) => {
      const action = () => run("Posuzuji produkt…", () => api.lookupManual({ name, brand, description, profile }), true);
      setLastAction(() => action);
      return action();
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
    lookupCodeFromPhoto,
    lookupPhotoUri,
    lookupManual,
    supplementPhotoUri,
    inFlight,
  };
}
