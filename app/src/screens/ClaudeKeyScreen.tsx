import React, { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api, describeError, keyFormatProblem } from "../api/client";
import { Button } from "../components/Button";
import { MODEL } from "../core/config";
import { useProfile } from "../profile";
import { DEFAULT_DAILY_CAP_USD, currentSpend, formatUsd, onSpendChange, resetSpend, setDailyCap, type SpendState } from "../storage/spend";
import { confirmDestructive } from "../utils/confirm";
import { fontSize, radius, spacing, useTheme } from "../theme";

const CONSOLE_KEYS_URL = "https://platform.claude.com/settings/keys";

/**
 * The Claude API key lives only on this device. The screen also shows the
 * estimated spend and the daily cap, the only cost guard without a server.
 */
export function ClaudeKeyScreen() {
  const t = useTheme();
  const { claudeKey, setClaudeKey } = useProfile();
  const [key, setKey] = useState(claudeKey);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [spend, setSpend] = useState<SpendState | undefined>(currentSpend());
  const [cap, setCap] = useState(String(currentSpend()?.dailyCapUsd ?? DEFAULT_DAILY_CAP_USD));

  useEffect(() => onSpendChange(setSpend), []);

  const trimmed = key.trim();
  const stored = !!claudeKey;

  const saveAndTest = async () => {
    setStatus(null);
    const problem = keyFormatProblem(trimmed);
    if (problem) {
      setStatus({ ok: false, text: `✕ Klíč nevypadá správně: ${problem}.` });
      return;
    }
    setBusy(true);
    try {
      await setClaudeKey(trimmed);
      const res = await api.testKey(trimmed);
      setStatus({ ok: true, text: `✓ Klíč platí a je uložen jen v tomto zařízení. Model ${res.model} je dostupný.` });
    } catch (err) {
      setStatus({ ok: false, text: `✕ ${describeError(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    confirmDestructive("Smazat klíč?", "Fotky etiket, posudky AI a překlady přestanou fungovat, dokud klíč nezadáte znovu.", "Smazat", () => {
      void setClaudeKey("");
      setKey("");
      setStatus(null);
    });

  const saveCap = async () => {
    const n = Number(cap.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;
    await setDailyCap(n);
  };

  const inputStyle = [styles.input, { backgroundColor: t.card, color: t.text, borderColor: t.border }];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.label, { color: t.muted }]}>Claude API klíč</Text>
      <TextInput
        value={key}
        onChangeText={setKey}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        secureTextEntry={!show}
        placeholder="sk-ant-…"
        placeholderTextColor={t.muted}
        style={[inputStyle, styles.mono]}
      />
      <View style={styles.row}>
        <Button title={show ? "Skrýt" : "Zobrazit"} variant="ghost" compact onPress={() => setShow((v) => !v)} />
        <Button title="Otevřít Claude Console" variant="ghost" compact onPress={() => Linking.openURL(CONSOLE_KEYS_URL).catch(() => undefined)} style={{ marginLeft: spacing.sm }} />
      </View>
      <Text style={[styles.hint, { color: t.muted }]}>
        V Claude Console (Keys & access → Create key) vytvořte klíč třeba „Kup-nekup iPhone“, zkopírujte ho a vložte sem. Klíč zůstává jen v tomto
        zařízení a posílá se výhradně na api.anthropic.com. Kdykoli ho můžete v Console zrušit.
      </Text>

      <Button title="Uložit a otestovat" onPress={saveAndTest} loading={busy} disabled={!trimmed} />
      {stored ? <Button title="Smazat klíč z tohoto zařízení" variant="ghost" onPress={remove} style={{ marginTop: spacing.sm }} /> : null}

      {status && (
        <View style={[styles.result, { backgroundColor: status.ok ? t.card : t.dangerBg, borderColor: status.ok ? t.success : t.danger }]}>
          <Text style={[styles.resultLine, { color: t.text }]}>{status.text}</Text>
        </View>
      )}

      <Text style={[styles.label, { color: t.muted, marginTop: spacing.xl }]}>Útrata za AI (odhad)</Text>
      <View style={[styles.result, { backgroundColor: t.card, borderColor: t.border, marginTop: 0 }]}>
        <Text style={[styles.resultLine, { color: t.text }]}>
          Od {spend ? new Date(spend.since).toLocaleDateString("cs-CZ") : "–"}: {formatUsd(spend?.usd ?? 0)} ({spend?.calls ?? 0} dotazů)
        </Text>
        <Text style={[styles.resultLine, { color: t.text }]}>
          Dnes: {formatUsd(spend?.dayUsd ?? 0)} ({spend?.dayCalls ?? 0} dotazů)
        </Text>
        <Text style={[styles.hint, { color: t.muted, marginTop: spacing.xs, marginBottom: 0 }]}>
          Počítáno z ceníku Claude podle skutečně spotřebovaných tokenů a vyhledávání; přesnou částku ukazuje Claude Console. Dotazy na {MODEL}.
        </Text>
      </View>

      <Text style={[styles.label, { color: t.muted, marginTop: spacing.lg }]}>Denní strop (USD)</Text>
      <View style={styles.row}>
        <TextInput
          value={cap}
          onChangeText={setCap}
          keyboardType="decimal-pad"
          onBlur={saveCap}
          onSubmitEditing={saveCap}
          style={[inputStyle, { flex: 1, marginBottom: 0 }]}
          placeholder="5"
          placeholderTextColor={t.muted}
        />
        <Button title="Uložit" variant="secondary" compact onPress={saveCap} style={{ marginLeft: spacing.sm }} />
      </View>
      <Text style={[styles.hint, { color: t.muted, marginTop: spacing.xs }]}>
        Po dosažení stropu se AI funkce do půlnoci zastaví; čárový kód a pravidla fungují dál. 0 = bez stropu. Měsíční limit nastavte také v Claude
        Console (Billing), ten platí pro všechny vaše klíče.
      </Text>
      <Button
        title="Vynulovat počítadlo"
        variant="ghost"
        compact
        onPress={() => confirmDestructive("Vynulovat počítadlo?", "Odhad útraty začne znovu od nuly, strop zůstane.", "Vynulovat", () => void resetSpend())}
        style={{ marginTop: spacing.sm }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  label: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.xs },
  hint: { fontSize: fontSize.xs, lineHeight: 18, marginTop: spacing.xs, marginBottom: spacing.lg },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.lg, fontSize: fontSize.md, marginBottom: spacing.sm },
  mono: { letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", marginBottom: spacing.xs },
  result: { marginTop: spacing.lg, borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  resultLine: { fontSize: fontSize.md, lineHeight: 26 },
});
