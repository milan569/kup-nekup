import { useIsFocused, useNavigation } from "@react-navigation/native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { ErrorBox } from "../components/ErrorBox";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { CollectBanner } from "../components/CollectBanner";
import { ScanVoter, pickScannedCode } from "../core/scan";
import { useLookup } from "../hooks/useLookup";
import type { RootNavigation } from "../navigationTypes";
import { useProfile } from "../profile";
import { fontSize, radius, spacing, useTheme } from "../theme";
import { barcodesInPhoto } from "../utils/barcodePhoto";
import {
  DEFAULT_ZOOM,
  cameraMountError,
  cameraStreamAlive,
  cameraVideoElement,
  onCameraTrackEnded,
  setCameraZoom,
  tuneCameraTrack,
  type ZoomRange,
} from "../utils/camera";
import { PermissionDeniedError, pickLabelFromLibrary, takeLabelPhoto } from "../utils/image";

const REPEAT_WINDOW_MS = 3000;
const IN_STORE_HINT = "To je kód z váhy obchodu (cena). Namiřte na kód výrobce, nebo vyfoťte etiketu.";
const IN_STORE_PHOTO = "Na fotce je jen kód z váhy obchodu (cena), ten výrobek neurčí. Vyfoťte kód výrobce. Etiketu bez kódu přečte AI po zadání Claude klíče.";
const NO_CODE_ON_PHOTO = "Na fotce jsem nenašel čárový kód. Vyfoťte ho znovu, ostře a celý. Etiketu bez kódu přečte AI po zadání Claude klíče.";
const DISTANCE_HINT = "15–20 cm od kódu, z blízka kamera nezaostří";
const WEB = Platform.OS === "web";
// the zoom chosen on this screen lasts for the session
let sessionZoom = DEFAULT_ZOOM;
// "Zapnout živý sken" on the photo-mode screen lasts until the app is closed
let liveForSession = false;

export function ScanScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootNavigation>();
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const { profile, hasClaudeKey, photoScan, setPhotoScan } = useProfile();
  const [liveOn, setLiveOn] = useState(liveForSession);
  // web only: single photos with the system camera instead of the live camera, which
  // an iPhone home-screen app has to ask permission for at every launch
  const photoMode = WEB && photoScan && !liveOn;
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // codes the server identified as in-store (scale/price) labels: answer locally next time
  const inStoreCodes = useRef(new Set<string>());
  // true while a still photo is being looked up: an in-store code then needs a lasting message, not the scanner's hint
  const photoFlow = useRef(false);

  const showHint = useCallback((text: string) => {
    setHint(text);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 3500);
  }, []);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  const onInStoreCode = useCallback(
    (ean: string) => {
      if (photoFlow.current) {
        setLocalError(IN_STORE_PHOTO);
        return;
      }
      inStoreCodes.current.add(ean);
      showHint(IN_STORE_HINT);
    },
    [showHint],
  );

  const lookup = useLookup(profile, { onInStoreCode });
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const lastScan = useRef<{ data: string; at: number } | null>(null);
  // a code counts after two agreeing reads: one blurred frame can decode to wrong digits
  const voter = useRef(new ScanVoter());
  const [capturing, setCapturing] = useState(false);
  // a still photo is being searched for a barcode (before any lookup starts)
  const [decoding, setDecoding] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // bumping the key mounts the camera again (after a failure, or when the stream died while the phone was locked)
  const [cameraKey, setCameraKey] = useState(0);
  // the web camera asks by itself; this remembers a refusal of that prompt
  const [webDenied, setWebDenied] = useState(false);
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [zoom, setZoom] = useState(sessionZoom);
  const needsRemount = useRef(false);
  const autoRemounts = useRef<number[]>([]);
  const unsubscribeEnded = useRef<(() => void) | null>(null);
  // the code that opened the last result: not again right after Zpět while the phone still points at it
  const ignoreCode = useRef<{ data: string; until: number } | null>(null);
  // true while the user takes a photo or picks one from the gallery: the
  // barcode scanner must not start lookups meanwhile (it used to swallow the photo)
  const userAction = useRef(false);

  const error = localError ?? lookup.error;
  // the scanner pauses while an error is shown, so the message cannot flicker away
  const scannerPaused = lookup.busy || capturing || decoding || !!error;

  const onBarcode = useCallback(
    (res: BarcodeScanningResult) => {
      const data = (res.data ?? "").trim();
      if (!data || lookup.inFlight.current || userAction.current) return;
      if (inStoreCodes.current.has(data)) {
        showHint(IN_STORE_HINT);
        return;
      }
      const now = Date.now();
      if (lastScan.current && lastScan.current.data === data && now - lastScan.current.at < REPEAT_WINDOW_MS) return;
      if (ignoreCode.current && ignoreCode.current.data === data && now < ignoreCode.current.until) return;
      if (!voter.current.read(data, now)) return;
      ignoreCode.current = null;
      lastScan.current = { data, at: now };
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      lookup.lookupEan(data);
    },
    [lookup, showHint],
  );

  useEffect(() => {
    // back on this screen: the barcode of the result just closed stays ignored for a moment
    if (isFocused && lastScan.current) ignoreCode.current = { data: lastScan.current.data, until: Date.now() + 5000 };
    if (!isFocused) {
      // the camera view is unmounted with the screen out of focus; its track is stopped, not ended
      unsubscribeEnded.current?.();
      unsubscribeEnded.current = null;
    }
    voter.current.reset();
  }, [isFocused]);

  // mounts the camera again after the browser ended the stream; gives up when that keeps happening
  const remountCamera = useCallback(() => {
    const now = Date.now();
    autoRemounts.current = autoRemounts.current.filter((at) => now - at < 60_000);
    if (autoRemounts.current.length >= 3) {
      setCameraError("Kamera se opakovaně zastavuje.");
      return;
    }
    autoRemounts.current.push(now);
    setCameraKey((k) => k + 1);
  }, []);

  useEffect(() => {
    // iOS pauses the camera stream of a web app while the phone is locked; usually it resumes by itself
    if (!WEB || typeof document === "undefined") return;
    let cancelled = false;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !isFocusedRef.current) return;
      // no live camera on screen (photo mode, refusal): nothing to revive, and nothing may ask for the camera
      if (!cameraVideoElement()) return;
      if (needsRemount.current) {
        needsRemount.current = false;
        remountCamera();
        return;
      }
      cameraStreamAlive(cameraVideoElement())
        .then((alive) => {
          if (!cancelled && !alive && isFocusedRef.current) remountCamera();
        })
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [remountCamera]);

  useEffect(() => () => unsubscribeEnded.current?.(), []);

  const onCameraReady = useCallback(() => {
    if (!WEB) return;
    // a moment after the first frame: the view applies its own settings right then
    setTimeout(() => {
      const video = cameraVideoElement();
      tuneCameraTrack(video, sessionZoom)
        .then((r) => {
          setZoomRange(r.range);
          setZoom(r.zoom);
        })
        .catch(() => undefined);
      unsubscribeEnded.current?.();
      const unsubscribe = onCameraTrackEnded(video, () => {
        unsubscribe();
        unsubscribeEnded.current = null;
        if (!isFocusedRef.current) return;
        if (typeof document !== "undefined" && document.visibilityState !== "visible") needsRemount.current = true;
        else remountCamera();
      });
      unsubscribeEnded.current = unsubscribe;
    }, 200);
  }, [remountCamera]);

  const onMountError = useCallback(
    (event: unknown) => {
      const { message, denied } = cameraMountError(event);
      if (WEB && denied) {
        setWebDenied(true);
        getPermission().catch(() => undefined);
        return;
      }
      setCameraError(message || "Kameru se nepodařilo spustit.");
    },
    [getPermission],
  );

  const toggleZoom = useCallback(() => {
    if (!zoomRange) return;
    const next = zoom > 1 ? 1 : DEFAULT_ZOOM;
    setCameraZoom(cameraVideoElement(), next, zoomRange)
      .then((applied) => {
        sessionZoom = applied;
        setZoom(applied);
      })
      .catch(() => undefined);
  }, [zoom, zoomRange]);

  const dismissError = useCallback(() => {
    setLocalError(null);
    lookup.clearError();
    lastScan.current = null;
  }, [lookup]);

  /**
   * A still photo from the system camera or the gallery. On the web its barcode is read on the
   * device first: free, and the database then answers as for a live scan. AI reads the label only
   * when there is no code, the code is unknown, or it is a shop's scale label.
   */
  const lookupFromPhoto = useCallback(
    async (uri: string) => {
      if (!WEB) {
        await lookup.lookupPhotoUri(uri);
        return;
      }
      setDecoding(true);
      let code: string | null = null;
      try {
        code = pickScannedCode(await barcodesInPhoto(uri));
      } finally {
        setDecoding(false);
      }
      photoFlow.current = true;
      try {
        if (code) await lookup.lookupCodeFromPhoto(code, uri, hasClaudeKey);
        else if (hasClaudeKey) await lookup.lookupPhotoUri(uri);
        else setLocalError(NO_CODE_ON_PHOTO);
      } finally {
        photoFlow.current = false;
      }
    },
    [lookup, hasClaudeKey],
  );

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || userAction.current) return;
    userAction.current = true;
    dismissError();
    setCapturing(true);
    try {
      // imageType matters on web only: the default PNG of a phone camera is tens of megabytes
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.85, imageType: "jpg" });
      if (pic?.uri) await lookup.lookupPhotoUri(pic.uri);
      else setLocalError("Fotku se nepodařilo pořídit. Zkuste to znovu.");
    } catch (err) {
      setLocalError(err instanceof Error && err.message ? err.message : "Fotku se nepodařilo pořídit.");
    } finally {
      setCapturing(false);
      userAction.current = false;
    }
  }, [lookup, dismissError]);

  // The system camera (on the web a file input with `capture`): no permission prompt, the phone's own autofocus.
  // Not guarded by `userAction`: an old iPhone never reports a cancelled camera, and the button must not stay dead.
  const takeSystemPhoto = useCallback(async () => {
    dismissError();
    try {
      const uri = await takeLabelPhoto();
      if (uri) await lookupFromPhoto(uri);
    } catch (err) {
      setLocalError(err instanceof Error && err.message ? err.message : "Fotku se nepodařilo pořídit.");
    }
  }, [lookupFromPhoto, dismissError]);

  const pickFromGallery = useCallback(async () => {
    if (userAction.current) return;
    userAction.current = true;
    dismissError();
    try {
      const uri = await pickLabelFromLibrary();
      if (uri) await lookupFromPhoto(uri);
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        setLocalError(err.message);
      } else {
        setLocalError(err instanceof Error && err.message ? err.message : "Fotku se nepodařilo načíst.");
      }
    } finally {
      userAction.current = false;
    }
  }, [lookupFromPhoto, dismissError]);

  const openKeySettings = useCallback(() => {
    dismissError();
    navigation.navigate("ClaudeKey");
  }, [navigation, dismissError]);

  const startLive = useCallback(() => {
    liveForSession = true;
    dismissError();
    setWebDenied(false);
    setCameraError(null);
    autoRemounts.current = [];
    setCameraKey((k) => k + 1);
    setLiveOn(true);
    getPermission().catch(() => undefined);
  }, [dismissError, getPermission]);

  const authError = !localError && lookup.errorKind === "auth";
  const lookupErrorBox = !error ? null : authError ? (
    <ErrorBox title="Chybí nebo neplatí Claude klíč" message={error} actionLabel="Zadat klíč" onAction={openKeySettings} onRetry={dismissError} retryLabel="Zavřít" />
  ) : (
    <ErrorBox
      message={error}
      actionLabel={!localError && lookup.retry ? "Zkusit znovu" : undefined}
      onAction={!localError && lookup.retry ? lookup.retry : undefined}
      onRetry={dismissError}
      retryLabel={localError ? "Rozumím" : "Zavřít"}
    />
  );
  const overlay = <LoadingOverlay visible={lookup.busy || decoding} text={decoding ? "Hledám čárový kód na fotce…" : lookup.busyText} />;

  if (!permission && !photoMode) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} />;
  }

  // On the web the camera itself asks: the browser prompt appears once, with no extra tap in between
  // (an iPhone home-screen app asks at every launch, so every tap saved counts). Native asks once, ever.
  const cameraAllowed = !!permission && (permission.granted || (WEB && permission.status !== "denied" && !webDenied));

  if (photoMode || (WEB && !cameraAllowed)) {
    // no live camera: by choice (Profil → Sken bez dotazu na kameru) or because the prompt was refused
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
        <CollectBanner />
        <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
          <Text style={[styles.h, { color: t.text }]}>{photoMode ? "Sken bez živé kamery" : "Živá kamera není povolená"}</Text>
          <Text style={[styles.p, { color: t.muted }]}>
            {photoMode
              ? "Vyfoťte čárový kód nebo etiketu fotoaparátem iPhonu. Na kameru se nic neptá a foťák si zaostří sám."
              : "Skenovat jde i bez ní: foťte fotoaparátem iPhonu, ten povolení nepotřebuje."}
          </Text>
          {lookupErrorBox}
          {hint ? <Text style={[styles.note, { color: t.text }]}>{hint}</Text> : null}
          <Button title="📷 Vyfotit kód nebo etiketu" onPress={takeSystemPhoto} />
          <Button title="Nahrát z galerie" variant="secondary" onPress={pickFromGallery} style={{ marginTop: spacing.sm }} />
          <Text style={[styles.note, { color: t.muted }]}>
            {hasClaudeKey
              ? "Kód z fotky přečte telefon sám a zdarma. Etiketu bez kódu přečte AI."
              : "Kód z fotky přečte telefon sám a zdarma. Etiketu bez kódu umí přečíst jen AI s Claude klíčem."}
          </Text>
          {photoMode ? (
            <>
              <Button title="Zapnout živý sken" variant="ghost" onPress={startLive} style={{ marginTop: spacing.lg }} />
              <Text style={[styles.note, { color: t.muted }]}>Živý sken čte kódy sám, bez focení. iPhone se před ním zeptá na kameru.</Text>
            </>
          ) : (
            <>
              <Button title="Zkusit živý sken znovu" variant="ghost" onPress={startLive} style={{ marginTop: spacing.lg }} />
              <Text style={[styles.note, { color: t.muted }]}>
                Když se iPhone už neptá, zavřete aplikaci v přepínači aplikací a otevřete ji znovu.
              </Text>
              <Button
                title="Vždy skenovat bez živé kamery"
                variant="ghost"
                onPress={() => {
                  liveForSession = false;
                  setLiveOn(false);
                  setPhotoScan(true).catch(() => undefined);
                }}
                style={{ marginTop: spacing.sm }}
              />
              <Text style={[styles.note, { color: t.muted }]}>Aplikace se pak na kameru neptá vůbec. Jde vrátit v Profilu.</Text>
            </>
          )}
        </ScrollView>
        {overlay}
      </SafeAreaView>
    );
  }

  if (!cameraAllowed) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
        <View style={styles.center}>
          <Text style={[styles.h, { color: t.text }]}>Potřebujeme kameru</Text>
          <Text style={[styles.p, { color: t.muted }]}>
            Kamera slouží ke čtení čárových kódů a k focení etiket. Nic se neukládá bez vašeho vědomí.
          </Text>
          {lookupErrorBox}
          {permission?.canAskAgain ? (
            <Button title="Povolit kameru" onPress={() => requestPermission()} />
          ) : (
            <Button title="Otevřít nastavení" onPress={() => Linking.openSettings().catch(() => undefined)} />
          )}
          <Button title="Nahrát fotku z galerie" variant="secondary" onPress={pickFromGallery} style={{ marginTop: spacing.sm }} />
          <Button title="Hledat podle názvu" variant="ghost" onPress={() => navigation.navigate("Tabs", { screen: "Search" })} style={{ marginTop: spacing.sm }} />
        </View>
        {overlay}
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: "#000" }]}>
      {isFocused && (
        <CameraView
          key={cameraKey}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          autofocus="on"
          barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
          onBarcodeScanned={scannerPaused ? undefined : onBarcode}
          onCameraReady={onCameraReady}
          onMountError={onMountError}
        />
      )}
      <SafeAreaView style={styles.overlay} edges={["top", "bottom"]} pointerEvents="box-none">
        <CollectBanner />
        <View style={styles.topHint}>
          <Text style={styles.hintText}>Namiřte na čárový kód</Text>
          <Text style={styles.hintSub}>{hint ?? `${DISTANCE_HINT} · ${hasClaudeKey ? "nebo vyfoťte etiketu se složením" : "bez Claude klíče jen čárový kód a pravidla"}`}</Text>
        </View>
        {zoomRange ? (
          <Pressable
            onPress={toggleZoom}
            style={[styles.zoomChip, { top: insets.top + spacing.sm }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Přiblížení ${zoom > 1 ? `${zoom}×` : "1×"}, klepnutím přepnete`}
          >
            <Text style={styles.zoomText}>{zoom > 1 ? `${zoom}×` : "1×"}</Text>
          </Pressable>
        ) : null}
        <View style={styles.bottom}>
          {cameraError ? (
            <ErrorBox
              title="Kamera nejde spustit"
              message={`${cameraError} Zavřete ostatní aplikace, které kameru používají, nebo nahrajte fotku z galerie.`}
              actionLabel="Zkusit znovu"
              onAction={() => {
                setCameraError(null);
                autoRemounts.current = [];
                setCameraKey((k) => k + 1);
              }}
              onRetry={() => setCameraError(null)}
              retryLabel="Zavřít"
            />
          ) : null}
          {lookupErrorBox}
          <Button title="Vyfotit etiketu" onPress={takePhoto} loading={capturing} style={styles.btn} />
          <Button title="Nahrát z galerie" variant="secondary" onPress={pickFromGallery} style={[styles.btn, { marginTop: spacing.sm }]} />
        </View>
      </SafeAreaView>
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  h: { fontSize: fontSize.xl, fontWeight: "800", marginBottom: spacing.sm, textAlign: "center" },
  p: { fontSize: fontSize.md, lineHeight: 22, marginBottom: spacing.lg, textAlign: "center" },
  note: { fontSize: fontSize.sm, lineHeight: 20, marginTop: spacing.sm, textAlign: "center" },
  overlay: { flex: 1, justifyContent: "space-between" },
  topHint: { alignItems: "center", paddingTop: spacing.lg, paddingHorizontal: spacing.xl },
  hintText: { color: "#FFFFFF", fontSize: fontSize.lg, fontWeight: "700", textShadowColor: "#000", textShadowRadius: 6 },
  hintSub: { color: "#FFFFFF", fontSize: fontSize.sm, opacity: 0.9, marginTop: 2, textAlign: "center", textShadowColor: "#000", textShadowRadius: 6 },
  zoomChip: {
    position: "absolute",
    right: spacing.lg,
    minWidth: 44,
    height: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomText: { color: "#FFFFFF", fontSize: fontSize.md, fontWeight: "700" },
  bottom: { padding: spacing.lg },
  btn: { marginHorizontal: 0 },
});
