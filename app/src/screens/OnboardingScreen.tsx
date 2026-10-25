import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EMPTY_PROFILE, type UserProfile } from "../api/types";
import { VERDICTS, verdictText } from "../api/verdicts";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { SectionTitle, ToggleRow } from "../components/ToggleRow";
import { ALLERGENS, COUNTRIES, DIETS, STORES_BY_COUNTRY } from "../data/options";
import type { RootStackParamList } from "../navigationTypes";
import { useProfile } from "../profile";
import { fontSize, spacing, useTheme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Onboarding">;

export function OnboardingScreen({ navigation }: Props) {
  const t = useTheme();
  const { replaceProfile } = useProfile();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<UserProfile>({ ...EMPTY_PROFILE, countries: ["cz"], stores: [] });

  const toggleIn = (key: keyof Pick<UserProfile, "countries" | "stores" | "allergens" | "diets">, value: string) => {
    setDraft((d) => {
      const list = d[key];
      const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
      return { ...d, [key]: next };
    });
  };

  const finish = async () => {
    await replaceProfile({ ...draft, countries: draft.countries.length ? draft.countries : ["cz"] });
    navigation.replace("Tabs");
  };

  const storeOptions = draft.countries.flatMap((c) => (STORES_BY_COUNTRY[c] ?? []).map((s) => ({ ...s, country: c })));
  const uniqueStores = storeOptions.filter((s, i) => storeOptions.findIndex((x) => x.key === s.key) === i);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.step, { color: t.muted }]}>Krok {step + 1} ze 3</Text>

        {step === 0 && (
          <View>
            <Text style={[styles.h1, { color: t.text }]}>Kup / Nekup</Text>
            <Text style={[styles.p, { color: t.text }]}>
              Naskenujte čárový kód, vyfoťte etiketu nebo napište název. Během pár sekund dostanete jasný verdikt: složení,
              výrobce a lepší alternativy.
            </Text>
            <Text style={[styles.p, { color: t.muted }]}>
              Verdikt je spotřebitelský názor založený na veřejných datech a není zdravotní radou.
            </Text>
          </View>
        )}

        {step === 1 && (
          <View>
            <Text style={[styles.h1, { color: t.text }]}>Kde nakupujete?</Text>
            <SectionTitle>Země</SectionTitle>
            <ChipRow>
              {COUNTRIES.map((c) => (
                <Chip key={c.key} label={c.label} selected={draft.countries.includes(c.key)} onPress={() => toggleIn("countries", c.key)} />
              ))}
            </ChipRow>
            <SectionTitle>Řetězce</SectionTitle>
            {uniqueStores.length === 0 ? (
              <Text style={[styles.p, { color: t.muted }]}>Pro zvolené země zatím nemáme seznam řetězců.</Text>
            ) : (
              <ChipRow>
                {uniqueStores.map((s) => (
                  <Chip key={s.key} label={s.label} selected={draft.stores.includes(s.key)} onPress={() => toggleIn("stores", s.key)} />
                ))}
              </ChipRow>
            )}
          </View>
        )}

        {step === 2 && (
          <View>
            <Text style={[styles.h1, { color: t.text }]}>Alergie a diety</Text>
            <Text style={[styles.p, { color: t.muted }]}>
              Alergen z vašeho profilu znamená vždy {VERDICTS.nekupuj.emoji} „{verdictText("nekupuj", draft.tone ?? "humor").label}“.
            </Text>
            <SectionTitle>Alergeny</SectionTitle>
            {ALLERGENS.map((a) => (
              <ToggleRow key={a.key} label={a.label} value={draft.allergens.includes(a.key)} onChange={() => toggleIn("allergens", a.key)} />
            ))}
            <SectionTitle>Diety</SectionTitle>
            {DIETS.map((d) => (
              <ToggleRow key={d.key} label={d.label} value={draft.diets.includes(d.key)} onChange={() => toggleIn("diets", d.key)} />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: t.border, backgroundColor: t.bg }]}>
        {step < 2 ? (
          <>
            <Button title="Pokračovat" onPress={() => setStep(step + 1)} />
            <Button title="Přeskočit" variant="ghost" onPress={finish} style={{ marginTop: spacing.sm }} />
          </>
        ) : (
          <>
            <Button title="Hotovo" onPress={finish} />
            <Button title="Zpět" variant="ghost" onPress={() => setStep(step - 1)} style={{ marginTop: spacing.sm }} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  step: { fontSize: fontSize.sm, marginBottom: spacing.sm },
  h1: { fontSize: fontSize.xxl, fontWeight: "800", marginBottom: spacing.md },
  p: { fontSize: fontSize.md, lineHeight: 24, marginBottom: spacing.md },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
