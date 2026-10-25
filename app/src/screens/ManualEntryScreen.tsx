import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { ErrorBox } from "../components/ErrorBox";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { CollectBanner } from "../components/CollectBanner";
import { useLookup } from "../hooks/useLookup";
import type { RootStackParamList } from "../navigationTypes";
import { useProfile } from "../profile";
import { fontSize, radius, spacing, useTheme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ManualEntry">;

export function ManualEntryScreen({ route }: Props) {
  const t = useTheme();
  const { profile } = useProfile();
  const lookup = useLookup(profile);
  const [name, setName] = useState(route.params?.initialName ?? "");
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");

  const canSubmit = name.trim().length >= 2 && !lookup.busy;

  const submit = () => {
    if (!canSubmit) return;
    lookup.lookupManual(name.trim(), brand.trim() || undefined, description.trim() || undefined);
  };

  const inputStyle = [styles.input, { backgroundColor: t.card, color: t.text, borderColor: t.border }];

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: t.bg }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <CollectBanner />
        <Text style={[styles.p, { color: t.muted }]}>
          Hodí se tam, kde není čárový kód: řeznictví, pekárna, trh. Čím víc napíšete, tím přesnější bude posouzení.
        </Text>
        <Text style={[styles.label, { color: t.muted }]}>Název produktu *</Text>
        <TextInput value={name} onChangeText={setName} placeholder="např. uzená krkovice" placeholderTextColor={t.muted} style={inputStyle} />
        <Text style={[styles.label, { color: t.muted }]}>Výrobce nebo značka</Text>
        <TextInput value={brand} onChangeText={setBrand} placeholder="např. Řeznictví Novák" placeholderTextColor={t.muted} style={inputStyle} />
        <Text style={[styles.label, { color: t.muted }]}>Popis</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="např. řeznictví, složení z cedulky: vepřové maso, sůl, koření…"
          placeholderTextColor={t.muted}
          multiline
          style={[...inputStyle, styles.multiline]}
        />
        {lookup.error ? <ErrorBox message={lookup.error} onRetry={lookup.retry} /> : null}
        <View style={{ marginTop: spacing.lg }}>
          <Button title="Posoudit" onPress={submit} disabled={!canSubmit} />
        </View>
      </ScrollView>
      <LoadingOverlay visible={lookup.busy} text={lookup.busyText} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  p: { fontSize: fontSize.md, lineHeight: 22, marginBottom: spacing.md },
  label: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.lg, fontSize: fontSize.md },
  multiline: { minHeight: 110, textAlignVertical: "top", paddingTop: spacing.md },
});
