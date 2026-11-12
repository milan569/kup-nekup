import { scanFromURLAsync, type BarcodeType } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";
import { imageSize } from "./image";

const TYPES: BarcodeType[] = ["ean13", "ean8", "upc_a", "upc_e"];
/**
 * Long edges tried in turn. 3000 px keeps the detail of a small code on a
 * 12 MP photo and stays below Safari's canvas limit; the smaller copy
 * forgives blur and noise that break the first pass.
 */
const EDGES = [3000, 1400];

async function scaled(uri: string, width: number, height: number, edge: number): Promise<string> {
  if (Math.max(width, height) <= edge) return uri;
  const ref = await ImageManipulator.manipulate(uri)
    .resize(width >= height ? { width: edge } : { height: edge })
    .renderAsync();
  return (await ref.saveAsync({ compress: 0.92, format: SaveFormat.JPEG })).uri;
}

/**
 * Barcodes on a still photo, decoded on the device: free, and exact where
 * the digits a model reads off a picture are not. Web only (the same decoder
 * as the live scanner). Never throws: no code, or no decoder, is an empty list.
 */
export async function barcodesInPhoto(uri: string): Promise<string[]> {
  if (Platform.OS !== "web") return [];
  try {
    const { width, height } = await imageSize(uri);
    let last = "";
    for (const edge of EDGES) {
      const source = await scaled(uri, width, height, edge);
      // a small photo: the second pass would decode the same pixels
      if (source === last) continue;
      last = source;
      const found = await scanFromURLAsync(source, TYPES);
      const codes = found.map((b) => (b.data ?? "").trim()).filter(Boolean);
      if (codes.length) return codes;
    }
  } catch {
    // an unreadable file or a decoder that failed to load: the caller falls back to reading the label
  }
  return [];
}
