import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ApiError, api, describeError, getAppToken, getBaseUrl, normalizeToken, setAppToken, setBaseUrl, type HealthResponse } from "../api/client";
import { Button } from "../components/Button";
import { saveSettings } from "../storage/settings";
import { fontSize, radius, spacing, useTheme } from "../theme";

type TokenStatus = "ok" | "not-required" | "rejected" | "unknown";

export function ServerSettingsScreen() {
  const t = useTheme();
  const [url, setUrl] = useState(getBaseUrl());
  const [token, setToken] = useState(getAppToken());
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalizedUrl = url.trim().replace(/\/+$/, "");
  const normalizedToken = normalizeToken(token);

  /** Always saves first, then checks the server and the token for real. */
  const saveAndTest = async () => {
    setBusy(true);
    setError(null);
    setHealth(null);
    setTokenStatus(null);
    setBaseUrl(normalizedUrl);
    setAppToken(normalizedToken);
    setToken(normalizedToken);
    await saveSettings({ apiUrl: normalizedUrl, appToken: normalizedToken });
    try {
      setHealth(await api.health(normalizedUrl, normalizedToken));
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
      return;
    }
    try {
      const res = await api.authCheck(normalizedUrl, normalizedToken);
      setTokenStatus(res.tokenRequired ? "ok" : "not-required");
    } catch (err) {
      if (err instanceof ApiError && err.kind === "auth") setTokenStatus("rejected");
      else if (err instanceof ApiError && err.status === 404) setTokenStatus("unknown"); // older server without the check
      else setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: t.card, color: t.text, borderColor: t.border }];
  const allGood = health?.ok && (tokenStatus === "ok" || tokenStatus === "not-required");

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.label, { color: t.muted }]}>Adresa serveru</Text>
      <TextInput
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardType="url"
        placeholder="https://kup-nekup-….fly.dev"
        placeholderTextColor={t.muted}
        style={inputStyle}
      />
      <Text style={[styles.hint, { color: t.muted }]}>Online server, nebo doma adresa počítače, např. http://192.168.1.10:8787.</Text>

      <Text style={[styles.label, { color: t.muted }]}>Přístupový klíč</Text>
      <TextInput
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        textContentType="none"
        keyboardType="ascii-capable"
        placeholder="kupnekup-xxxx-xxxx-xxxx-xxxx"
        placeholderTextColor={t.muted}
        style={[inputStyle, styles.mono]}
      />
      <Text style={[styles.hint, { color: t.muted }]}>
        Opište ho ze souboru server/.env.fly (řádek APP_TOKEN). Na velkých písmenech a mezerách nezáleží. Pro server doma nechte prázdné.
      </Text>

      <Button title="Uložit a otestovat" onPress={saveAndTest} loading={busy} disabled={!normalizedUrl} />

      {health && (
        <View style={[styles.result, { backgroundColor: t.card, borderColor: allGood ? t.success : t.danger }]}>
          <Text style={[styles.resultLine, { color: t.text }]}>{health.ok ? "✓ Server je dostupný" : "✕ Server hlásí problém"}</Text>
          <Text style={[styles.resultLine, { color: t.text }]}>
            {tokenStatus === "ok"
              ? "✓ Přístupový klíč platí"
              : tokenStatus === "not-required"
                ? "✓ Server klíč nevyžaduje"
                : tokenStatus === "rejected"
                  ? normalizedToken
                    ? "✕ Přístupový klíč nesedí – zkontrolujte ho znak po znaku"
                    : "✕ Server vyžaduje přístupový klíč – vyplňte ho výše"
                  : tokenStatus === "unknown"
                    ? "? Klíč nelze ověřit (starší verze serveru)"
                    : ""}
          </Text>
          <Text style={[styles.resultLine, { color: t.text }]}>
            {health.hasKey ? "✓ AI na serveru je zapnutá" : "✕ Serveru chybí Claude klíč – fotky etiket a posudek AI nepůjdou"}
          </Text>
          {allGood ? <Text style={[styles.resultLine, { color: t.success, fontWeight: "700" }]}>Uloženo. Můžete skenovat.</Text> : null}
        </View>
      )}
      {error && (
        <View style={[styles.result, { backgroundColor: t.dangerBg, borderColor: t.danger }]}>
          <Text style={[styles.resultLine, { color: t.text }]}>{error}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  label: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.xs },
  hint: { fontSize: fontSize.xs, lineHeight: 18, marginTop: -spacing.sm, marginBottom: spacing.lg },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.lg, fontSize: fontSize.md, marginBottom: spacing.md },
  mono: { fontFamily: "Menlo", letterSpacing: 0.5 },
  result: { marginTop: spacing.lg, borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  resultLine: { fontSize: fontSize.md, lineHeight: 26 },
});
