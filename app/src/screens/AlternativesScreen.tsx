import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Card } from "../components/Card";
import { AlternativesSection } from "../features/AlternativesSection";
import type { RootStackParamList } from "../navigationTypes";
import { useProfile } from "../profile";
import { spacing, useTheme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Alternatives">;

export function AlternativesScreen({ route }: Props) {
  const t = useTheme();
  const { profile } = useProfile();
  const { result, aiAlternatives } = route.params;
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Card title="Lepší alternativy" subtitle={result.product.name}>
        <AlternativesSection result={result} profile={profile} active aiAlternatives={aiAlternatives} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ content: { paddingVertical: spacing.lg } });
