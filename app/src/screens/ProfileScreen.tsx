import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { UserProfile } from "../api/types";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { SectionTitle, ToggleRow } from "../components/ToggleRow";
import { ALLERGENS, AVOID, COUNTRIES, DIETS, STORES_BY_COUNTRY, countryLabel } from "../data/options";
import type { RootNavigation } from "../navigationTypes";
import { useProfile } from "../profile";
import { clearHistory } from "../storage/history";
import { fontSize, spacing, useTheme } from "../theme";
import { APP_VERSION } from "../version";

type ListKey = keyof Pick<UserProfile, "countries" | "stores" | "allergens" | "diets" | "avoid">;

export function ProfileScreen() {
  const t = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const { profile, updateProfile } = useProfile();

  const toggle = (key: ListKey, value: string) => {
    const list = profile[key];
    const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    if (key === "countries" && next.length === 0) return;
    updateProfile({ [key]: next } as Partial<UserProfile>);
  };

  const confirmClear = () => {
    Alert.alert("Smazat historii?", "Smaže všechny skeny i uložené produkty.", [
      { text: "Zrušit", style: "cancel" },
      { text: "Smazat", style: "destructive", onPress: () => clearHistory() },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: t.text }]}>Profil</Text>

        <SectionTitle>Země, kde nakupuji</SectionTitle>
        <ChipRow>
          {COUNTRIES.map((c) => (
            <Chip key={c.key} label={c.label} selected={profile.countries.includes(c.key)} onPress={() => toggle("countries", c.key)} />
          ))}
        </ChipRow>

        <SectionTitle>Řetězce</SectionTitle>
        {profile.countries.map((country) => {
          const stores = STORES_BY_COUNTRY[country];
          if (!stores) return null;
          return (
            <View key={country} style={{ marginBottom: spacing.sm }}>
              <Text style={[styles.sub, { color: t.muted }]}>{countryLabel(country)}</Text>
              <ChipRow>
                {stores.map((s) => (
                  <Chip key={country + s.key} label={s.label} selected={profile.stores.includes(s.key)} onPress={() => toggle("stores", s.key)} />
                ))}
              </ChipRow>
            </View>
          );
        })}

        <SectionTitle>Alergie a intolerance</SectionTitle>
        {ALLERGENS.map((a) => (
          <ToggleRow key={a.key} label={a.label} value={profile.allergens.includes(a.key)} onChange={() => toggle("allergens", a.key)} />
        ))}

        <SectionTitle>Diety</SectionTitle>
        {DIETS.map((d) => (
          <ToggleRow key={d.key} label={d.label} value={profile.diets.includes(d.key)} onChange={() => toggle("diets", d.key)} />
        ))}

        <SectionTitle>Čemu se chci vyhnout</SectionTitle>
        {AVOID.map((a) => (
          <ToggleRow key={a.key} label={a.label} value={profile.avoid.includes(a.key)} onChange={() => toggle("avoid", a.key)} />
        ))}

        <SectionTitle>Zobrazení</SectionTitle>
        <ToggleRow
          label="Slušný režim"
          hint="Vypne vtipné názvy verdiktů, např. pro sdílení."
          value={profile.tone === "serious"}
          onChange={(v) => updateProfile({ tone: v ? "serious" : "humor" })}
        />
        <ToggleRow label="Zobrazovat udržitelnost" value={profile.showSustainability} onChange={(v) => updateProfile({ showSustainability: v })} />

        <SectionTitle>Aplikace</SectionTitle>
        <Button title="Nastavení serveru" variant="secondary" onPress={() => navigation.navigate("ServerSettings")} />
        <Button title="Smazat historii" variant="ghost" onPress={confirmClear} style={{ marginTop: spacing.sm }} />
        <Text style={[styles.version, { color: t.muted }]}>Kup / Nekup {APP_VERSION} · verdikt není zdravotní rada</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontSize: fontSize.xxl, fontWeight: "800" },
  sub: { fontSize: fontSize.sm, marginBottom: spacing.xs },
  version: { textAlign: "center", fontSize: fontSize.xs, marginTop: spacing.xl },
});
