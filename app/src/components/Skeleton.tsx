import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, View } from "react-native";
import { radius, spacing, useTheme } from "../theme";

/** Pulsing grey bars used while a slow request is running. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: Platform.OS !== "web" }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={{ opacity: pulse }}>
      {Array.from({ length: lines }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            { backgroundColor: t.cardAlt, width: i === 0 ? "70%" : i === lines - 1 ? "55%" : "100%", height: i === 0 ? 18 : 12 },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: radius.sm, marginBottom: spacing.sm },
});
