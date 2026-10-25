import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStackParamList, TabParamList } from "./navigationTypes";
import { useProfile } from "./profile";
import { useCompare } from "./compare";
import { AlternativesScreen } from "./screens/AlternativesScreen";
import { CompareScreen } from "./screens/CompareScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { ManualEntryScreen } from "./screens/ManualEntryScreen";
import { ManufacturerScreen } from "./screens/ManufacturerScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { ScanScreen } from "./screens/ScanScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { ClaudeKeyScreen } from "./screens/ClaudeKeyScreen";
import { useTheme } from "./theme";

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const TAB_ICONS: Record<keyof TabParamList, { active: IconName; inactive: IconName }> = {
  Scan: { active: "scan", inactive: "scan-outline" },
  Search: { active: "search", inactive: "search-outline" },
  Compare: { active: "git-compare", inactive: "git-compare-outline" },
  History: { active: "time", inactive: "time-outline" },
  Profile: { active: "person", inactive: "person-outline" },
};

const TAB_BAR_CONTENT_HEIGHT = 56;

function Tabs() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const basket = useCompare().items.length;
  // Web and iPhones with a home button report 0 – keep a minimum padding so labels are not clipped.
  const bottomPad = Math.max(insets.bottom, 8);
  return (
    <Tab.Navigator
      safeAreaInsets={{ bottom: bottomPad }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: {
          backgroundColor: t.card,
          borderTopColor: t.border,
          height: TAB_BAR_CONTENT_HEIGHT + bottomPad,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600", lineHeight: 16 },
        tabBarIcon: ({ color, size, focused }) => {
          const icons = TAB_ICONS[route.name];
          return <Ionicons name={focused ? icons.active : icons.inactive} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Scan" component={ScanScreen} options={{ title: "Sken" }} />
      <Tab.Screen name="Search" component={SearchScreen} options={{ title: "Hledat" }} />
      <Tab.Screen name="Compare" component={CompareScreen} options={{ title: "Porovnat", tabBarBadge: basket || undefined }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: "Historie" }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: "Profil" }} />
    </Tab.Navigator>
  );
}

export function Navigation() {
  const t = useTheme();
  const { hasProfile } = useProfile();
  const navTheme = t.dark
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: t.bg, card: t.card, text: t.text, border: t.border, primary: t.primary } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: t.bg, card: t.card, text: t.text, border: t.border, primary: t.primary } };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName={hasProfile ? "Tabs" : "Onboarding"}
        screenOptions={{ headerBackTitle: "Zpět", headerTintColor: t.primary, headerTitleStyle: { color: t.text } }}
      >
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Result" component={ResultScreen} options={{ title: "Výsledek" }} />
        <Stack.Screen name="Manufacturer" component={ManufacturerScreen} options={{ title: "Výrobce" }} />
        <Stack.Screen name="Alternatives" component={AlternativesScreen} options={{ title: "Alternativy" }} />
        <Stack.Screen name="ManualEntry" component={ManualEntryScreen} options={{ title: "Ruční zadání" }} />
        <Stack.Screen name="ClaudeKey" component={ClaudeKeyScreen} options={{ title: "Claude API klíč" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
