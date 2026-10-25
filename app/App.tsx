import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CompareProvider } from "./src/compare";
import { Navigation } from "./src/navigation";
import { ProfileProvider, useProfile } from "./src/profile";
import { useTheme } from "./src/theme";

function Root() {
  const t = useTheme();
  const { ready } = useProfile();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
        <ActivityIndicator size="large" color={t.primary} />
      </View>
    );
  }
  return <Navigation />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ProfileProvider>
        <CompareProvider>
          <Root />
          <StatusBar style="auto" />
        </CompareProvider>
      </ProfileProvider>
    </SafeAreaProvider>
  );
}
