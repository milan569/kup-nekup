import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { fontSize, spacing } from "../theme";
import { Button } from "./Button";

interface State {
  error: Error | null;
}

/**
 * Last line of defence: a render error (a stale history entry, an unexpected
 * value from the AI) used to leave the web app as a blank white page with no
 * way out but clearing the site data. Now it shows a short message and a
 * button that renders the app again.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("[app] render failed:", error);
  }

  private reload = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.h}>Něco se pokazilo</Text>
        <Text style={styles.p}>
          Aplikace narazila na chybu při vykreslování. Načtěte ji znovu; když se to opakuje u jednoho výrobku, smažte ho v Historii (podržet
          prstem), případně smažte celou historii v Profilu.
        </Text>
        <Text style={styles.detail} numberOfLines={3}>
          {this.state.error.message}
        </Text>
        <Button title="Načíst znovu" onPress={this.reload} />
      </View>
    );
  }
}

// no theme hook in a class component: neutral colours that read in both modes
const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: spacing.xl, backgroundColor: "#F6F6F4" },
  h: { fontSize: fontSize.xl, fontWeight: "800", color: "#1B1B1B", marginBottom: spacing.sm, textAlign: "center" },
  p: { fontSize: fontSize.md, lineHeight: 22, color: "#1B1B1B", marginBottom: spacing.md, textAlign: "center" },
  detail: { fontSize: fontSize.xs, color: "#6B6B6B", marginBottom: spacing.lg, textAlign: "center" },
});
