import { Alert, Platform } from "react-native";

/**
 * A destructive confirmation that works everywhere: the native alert on
 * the phone, the browser's confirm dialog on web (react-native-web's Alert
 * is a silent no-op).
 */
export function confirmDestructive(title: string, message: string, confirmLabel: string, onConfirm: () => void): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Zrušit", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}
