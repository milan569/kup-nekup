import { ImageManipulator, SaveFormat, manipulateAsync } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

/**
 * Claude reads images up to about 1568 px on the long side; anything larger is
 * downscaled by the API anyway. 1024 px was too small for dense labels (small
 * nutrition tables), so we send the most the model can use.
 */
const MAX_LONG_EDGE = 1568;
const JPEG_QUALITY = 0.82;

function resizeFor(width: number, height: number): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= MAX_LONG_EDGE) return null;
  return width >= height ? { width: MAX_LONG_EDGE } : { height: MAX_LONG_EDGE };
}

/** Long edge ≤ 1568 px, JPEG 0.82, base64 without the data: prefix. */
export async function prepareLabelImage(uri: string): Promise<string> {
  try {
    const original = await ImageManipulator.manipulate(uri).renderAsync();
    const resize = resizeFor(original.width, original.height);
    const context = ImageManipulator.manipulate(uri);
    const ref = resize ? await context.resize(resize).renderAsync() : original;
    const result = await ref.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
    if (result.base64) return stripPrefix(result.base64);
  } catch {
    // fall through to the legacy API
  }
  const probe = await manipulateAsync(uri, [], {});
  const resize = resizeFor(probe.width, probe.height);
  const legacy = await manipulateAsync(uri, resize ? [{ resize }] : [], {
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!legacy.base64) throw new Error("Nepodařilo se připravit fotku.");
  return stripPrefix(legacy.base64);
}

function stripPrefix(b64: string): string {
  const idx = b64.indexOf("base64,");
  return idx >= 0 ? b64.slice(idx + 7) : b64;
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

/** Opens the system camera for one photo. Resolves with a local uri, or null when the user cancelled. */
export async function takeLabelPhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new PermissionDeniedError("Aplikace nemá přístup ke kameře. Povolte ho v Nastavení.");
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
  if (res.canceled || !res.assets?.length) return null;
  return res.assets[0].uri;
}

/** Opens the photo library. Resolves with a local uri, or null when the user cancelled. */
export async function pickLabelFromLibrary(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new PermissionDeniedError("Aplikace nemá přístup ke galerii. Povolte ho v Nastavení.");
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  if (res.canceled || !res.assets?.length) return null;
  return res.assets[0].uri;
}
