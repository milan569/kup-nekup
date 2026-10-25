import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_COMPARE, useCompare } from "../compare";
import type { RootNavigation } from "../navigationTypes";
import { fontSize, radius, spacing } from "../theme";

/** Shown on the scan, search and manual-entry screens while a product is being added to the comparison. */
export function CollectBanner() {
  const { collecting, setCollecting, items } = useCompare();
  const navigation = useNavigation<RootNavigation>();
  if (!collecting) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        ⚖️ Přidáváte výrobek do porovnání ({items.length}/{MAX_COMPARE})
      </Text>
      <Pressable
        onPress={() => {
          setCollecting(false);
          navigation.navigate("Tabs", { screen: "Compare" });
        }}
        hitSlop={8}
        accessibilityRole="button"
      >
        <Text style={styles.cancel}>Zrušit</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#1F6F43",
  },
  text: { flex: 1, color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "700" },
  cancel: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "800", textDecorationLine: "underline" },
});
