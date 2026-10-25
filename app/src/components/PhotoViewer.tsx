import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ProductImage } from "../api/types";
import { fontSize, radius, spacing } from "../theme";

/**
 * Open Food Facts serves photos as …/front_cs.12.400.jpg; the same name with
 * ".full.jpg" is the original upload. Other hosts are shown as they are.
 */
export function fullSizeUrl(url: string): string {
  return /openfoodfacts\.(org|net)\//i.test(url) ? url.replace(/\.(100|200|400)\.jpg$/i, ".full.jpg") : url;
}

/** images to show for a product or tip: all package photos, or at least the one thumbnail */
export function photosOf(images: ProductImage[] | undefined, imageUrl: string | undefined): ProductImage[] {
  if (images?.length) return images;
  return imageUrl ? [{ url: imageUrl, label: "Balení" }] : [];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  images: ProductImage[];
  title?: string;
  startIndex?: number;
}

/** Full-screen photos: swipe between them, pinch to zoom (iOS). */
export function PhotoViewer({ visible, onClose, images, title, startIndex = 0 }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(startIndex);
  const pager = useRef<React.ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    if (!visible) return;
    setIndex(startIndex);
    // jump to the tapped photo once the pager has laid out
    const t = setTimeout(() => pager.current?.scrollTo({ x: startIndex * width, animated: false }), 0);
    return () => clearTimeout(t);
  }, [visible, startIndex, width]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)));
  };

  const pageHeight = height - insets.top - insets.bottom - 120;
  const current = images[index];

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} supportedOrientations={["portrait", "landscape"]}>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title ?? ""}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Zavřít fotky" style={styles.close}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
        </View>

        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          onScrollEndDrag={Platform.OS === "web" ? onScrollEnd : undefined}
          style={{ flex: 1 }}
        >
          {images.map((img) => (
            <View key={img.url} style={{ width, height: pageHeight }}>
              <ZoomablePhoto url={img.url} width={width} height={pageHeight} />
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.label}>
            {current?.label ?? ""}
            {images.length > 1 ? `  ·  ${index + 1} / ${images.length}` : ""}
          </Text>
          {images.length > 1 && (
            <View style={styles.dots}>
              {images.map((img, i) => (
                <View key={img.url} style={[styles.dot, i === index && styles.dotActive]} />
              ))}
            </View>
          )}
          <Text style={styles.hint}>
            {Platform.OS === "ios" ? "Roztažením prstů přiblížíte" : ""}
            {Platform.OS === "ios" && images.length > 1 ? " · " : ""}
            {images.length > 1 ? "přejetím další fotka" : ""}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

function ZoomablePhoto({ url, width, height }: { url: string; width: number; height: number }) {
  const full = fullSizeUrl(url);
  const [fullLoaded, setFullLoaded] = useState(full === url);
  const [fullFailed, setFullFailed] = useState(false);
  const box = { width, height };
  return (
    <ScrollView
      style={box}
      contentContainerStyle={[box, styles.center]}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      bouncesZoom
    >
      {/* the small photo shows at once, the original fades in over it */}
      <Image source={{ uri: url }} style={[box, StyleSheet.absoluteFill]} resizeMode="contain" />
      {full !== url && !fullFailed && (
        <Image
          source={{ uri: full }}
          style={[box, StyleSheet.absoluteFill, { opacity: fullLoaded ? 1 : 0 }]}
          resizeMode="contain"
          onLoad={() => setFullLoaded(true)}
          onError={() => setFullFailed(true)}
        />
      )}
      {!fullLoaded && !fullFailed && <ActivityIndicator color="#FFFFFF" style={styles.spinner} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  title: { flex: 1, color: "#FFFFFF", fontSize: fontSize.md, fontWeight: "700" },
  close: { padding: spacing.xs, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.15)" },
  center: { alignItems: "center", justifyContent: "center" },
  spinner: { position: "absolute", bottom: spacing.lg, alignSelf: "center" },
  footer: { alignItems: "center", paddingVertical: spacing.sm, gap: spacing.xs },
  label: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "700" },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotActive: { backgroundColor: "#FFFFFF" },
  hint: { color: "rgba(255,255,255,0.6)", fontSize: fontSize.xs },
});
