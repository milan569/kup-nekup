import { useIsFocused, useNavigation } from "@react-navigation/native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { ErrorBox } from "../components/ErrorBox";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { CollectBanner } from "../components/CollectBanner";
import { useLookup } from "../hooks/useLookup";
import type { RootNavigation } from "../navigationTypes";
import { useProfile } from "../profile";
import { fontSize, spacing, useTheme } from "../theme";
import { PermissionDeniedError, pickLabelFromLibrary } from "../utils/image";

const REPEAT_WINDOW_MS = 3000;
const IN_STORE_HINT = "To je kód z váhy obchodu (cena). Namiřte na kód výrobce, nebo vyfoťte etiketu.";

export function ScanScreen() {
  const t = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const isFocused = useIsFocused();
  const { profile, hasClaudeKey } = useProfile();
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // codes the server identified as in-store (scale/price) labels: answer locally next time
  const inStoreCodes = useRef(new Set<string>());

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
      inStoreCodes.current.add(ean);
      showHint(IN_STORE_HINT);
    },
    [showHint],
  );

  const lookup = useLookup(profile, { onInStoreCode });
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const lastScan = useRef<{ data: string; at: number } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  // true while the user takes a photo or picks one from the gallery: the
  // barcode scanner must not start lookups meanwhile (it used to swallow the photo)
  const userAction = useRef(false);

  const error = localError ?? lookup.error;
  // the scanner pauses while an error is shown, so the message cannot flicker away
  const scannerPaused = lookup.busy || capturing || !!error;

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
      lastScan.current = { data, at: now };
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      lookup.lookupEan(data);
    },
    [lookup, showHint],
  );

  const dismissError = useCallback(() => {
    setLocalError(null);
    lookup.clearError();
    lastScan.current = null;
  }, [lookup]);

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

  const pickFromGallery = useCallback(async () => {
    if (userAction.current) return;
    userAction.current = true;
    dismissError();
    try {
      const uri = await pickLabelFromLibrary();
      if (uri) await lookup.lookupPhotoUri(uri);
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        setLocalError(err.message);
      } else {
        setLocalError(err instanceof Error && err.message ? err.message : "Fotku se nepodařilo načíst.");
      }
    } finally {
      userAction.current = false;
    }
  }, [lookup, dismissError]);

  const openKeySettings = useCallback(() => {
    dismissError();
    navigation.navigate("ClaudeKey");
  }, [navigation, dismissError]);

  if (!permission) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
        <View style={styles.center}>
          <Text style={[styles.h, { color: t.text }]}>Potřebujeme kameru</Text>
          <Text style={[styles.p, { color: t.muted }]}>
            Kamera slouží ke čtení čárových kódů a k focení etiket. Nic se neukládá bez vašeho vědomí.
          </Text>
          {permission.canAskAgain ? (
            <Button title="Povolit kameru" onPress={() => requestPermission()} />
          ) : Platform.OS === "web" ? (
            <Text style={[styles.p, { color: t.muted }]}>
              Kamera je pro tuto stránku zakázaná. Na iPhonu ji povolte v Nastavení → Safari → Kamera (u aplikace na ploše v Nastavení → Kup / Nekup), pak
              aplikaci znovu otevřete.
            </Text>
          ) : (
            <Button title="Otevřít nastavení" onPress={() => Linking.openSettings().catch(() => undefined)} />
          )}
          <Button title="Nahrát fotku z galerie" variant="secondary" onPress={pickFromGallery} style={{ marginTop: spacing.sm }} />
          <Button title="Hledat podle názvu" variant="ghost" onPress={() => navigation.navigate("Tabs", { screen: "Search" })} style={{ marginTop: spacing.sm }} />
        </View>
        <LoadingOverlay visible={lookup.busy} text={lookup.busyText} />
      </SafeAreaView>
    );
  }

  const authError = !localError && lookup.errorKind === "auth";

  return (
    <View style={[styles.safe, { backgroundColor: "#000" }]}>
      {isFocused && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
          onBarcodeScanned={scannerPaused ? undefined : onBarcode}
        />
      )}
      <SafeAreaView style={styles.overlay} edges={["top", "bottom"]} pointerEvents="box-none">
        <CollectBanner />
        <View style={styles.topHint}>
          <Text style={styles.hintText}>Namiřte na čárový kód</Text>
          <Text style={styles.hintSub}>{hint ?? (hasClaudeKey ? "nebo vyfoťte etiketu se složením" : "bez Claude klíče funguje jen čárový kód a pravidla")}</Text>
        </View>
        <View style={styles.bottom}>
          {error ? (
            authError ? (
              <ErrorBox
                title="Chybí nebo neplatí Claude klíč"
                message={error}
                actionLabel="Zadat klíč"
                onAction={openKeySettings}
                onRetry={dismissError}
                retryLabel="Zavřít"
              />
            ) : (
              <ErrorBox
                message={error}
                actionLabel={!localError && lookup.retry ? "Zkusit znovu" : undefined}
                onAction={!localError && lookup.retry ? lookup.retry : undefined}
                onRetry={dismissError}
                retryLabel={localError ? "Rozumím" : "Zavřít"}
              />
            )
          ) : null}
          <Button title="Vyfotit etiketu" onPress={takePhoto} loading={capturing} style={styles.btn} />
          <Button title="Nahrát z galerie" variant="secondary" onPress={pickFromGallery} style={[styles.btn, { marginTop: spacing.sm }]} />
        </View>
      </SafeAreaView>
      <LoadingOverlay visible={lookup.busy} text={lookup.busyText} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, justifyContent: "center", padding: spacing.xl },
  h: { fontSize: fontSize.xl, fontWeight: "800", marginBottom: spacing.sm, textAlign: "center" },
  p: { fontSize: fontSize.md, lineHeight: 22, marginBottom: spacing.lg, textAlign: "center" },
  overlay: { flex: 1, justifyContent: "space-between" },
  topHint: { alignItems: "center", paddingTop: spacing.lg },
  hintText: { color: "#FFFFFF", fontSize: fontSize.lg, fontWeight: "700", textShadowColor: "#000", textShadowRadius: 6 },
  hintSub: { color: "#FFFFFF", fontSize: fontSize.sm, opacity: 0.9, marginTop: 2, textShadowColor: "#000", textShadowRadius: 6 },
  bottom: { padding: spacing.lg },
  btn: { marginHorizontal: 0 },
});
