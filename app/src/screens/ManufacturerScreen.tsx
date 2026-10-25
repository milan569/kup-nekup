import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Card } from "../components/Card";
import { ManufacturerSection, ManufacturerView } from "../features/ManufacturerSection";
import type { RootStackParamList } from "../navigationTypes";
import { spacing, useTheme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Manufacturer">;

export function ManufacturerScreen({ route }: Props) {
  const t = useTheme();
  const { result, manufacturer } = route.params;
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Card title={manufacturer?.name ?? result.product.manufacturer ?? result.product.brand ?? "Výrobce"}>
        {manufacturer ? <ManufacturerView info={manufacturer} /> : <ManufacturerSection result={result} active />}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ content: { paddingVertical: spacing.lg } });
