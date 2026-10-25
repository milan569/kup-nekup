import { useColorScheme } from "react-native";
import type { ManufacturerType, ProductSource, Risk } from "./api/types";

export interface Theme {
  dark: boolean;
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primaryText: string;
  danger: string;
  dangerBg: string;
  success: string;
  warning: string;
  overlay: string;
}

const light: Theme = {
  dark: false,
  bg: "#F6F6F4",
  card: "#FFFFFF",
  cardAlt: "#F0F0EC",
  text: "#1B1B1B",
  muted: "#6B6B6B",
  border: "#E2E2DE",
  primary: "#1F6F43",
  primaryText: "#FFFFFF",
  danger: "#C62828",
  dangerBg: "#FDECEA",
  success: "#2E7D32",
  warning: "#EF6C00",
  overlay: "rgba(0,0,0,0.55)",
};

const dark: Theme = {
  dark: true,
  bg: "#121212",
  card: "#1E1E1E",
  cardAlt: "#262626",
  text: "#F2F2F2",
  muted: "#A3A3A3",
  border: "#333333",
  primary: "#4CAF6E",
  primaryText: "#0B0B0B",
  danger: "#EF5350",
  dangerBg: "#3A1E1E",
  success: "#66BB6A",
  warning: "#FFA726",
  overlay: "rgba(0,0,0,0.7)",
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === "dark" ? dark : light;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const fontSize = { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28, hero: 34 } as const;

export const riskColors: Record<Risk, { bg: string; text: string }> = {
  0: { bg: "#2E7D32", text: "#FFFFFF" },
  1: { bg: "#F9A825", text: "#1B1B1B" },
  2: { bg: "#EF6C00", text: "#FFFFFF" },
  3: { bg: "#C62828", text: "#FFFFFF" },
};

export const riskLabels: Record<Risk, string> = {
  0: "bez obav",
  1: "nízké riziko",
  2: "střední riziko",
  3: "vysoké riziko",
};

export const confidenceLabels = {
  high: "jistota: vysoká",
  medium: "jistota: střední",
  low: "jistota: nízká",
} as const;

export const sourceLabels: Record<ProductSource, string> = {
  off: "Open Food Facts",
  obf: "Open Beauty Facts",
  opf: "Open Products Facts",
  photo: "z fotky etikety",
  manual: "ruční zadání",
};

export const manufacturerTypeLabels: Record<ManufacturerType, string> = {
  family: "rodinná firma",
  craft: "řemeslná výroba",
  regional: "regionální výrobce",
  industrial: "průmyslový zpracovatel",
  "private-label": "privátní značka řetězce",
  unknown: "neznámé",
};

export const nutriScoreColors: Record<string, string> = {
  a: "#038141",
  b: "#85BB2F",
  c: "#FECB02",
  d: "#EE8100",
  e: "#E63E11",
};

export const novaColors: Record<number, string> = {
  1: "#00AA00",
  2: "#FFCC00",
  3: "#FF6600",
  4: "#FF0000",
};
