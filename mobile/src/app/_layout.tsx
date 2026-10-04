import { Stack } from "expo-router";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { createRuntime } from "../runtime";
import { BoardProvider } from "../store";
import { LiveShell } from "../live-shell";
import { styles } from "../components";
const runtime = createRuntime({
  mode: process.env.EXPO_PUBLIC_TRACKER_MODE,
  origin: process.env.EXPO_PUBLIC_TRACKER_API_ORIGIN,
});
export default function Layout() {
  return (
    <RootLayout
      live={process.env.EXPO_PUBLIC_TRACKER_MODE === "live"}
      origin={process.env.EXPO_PUBLIC_TRACKER_API_ORIGIN}
      redirect={process.env.EXPO_PUBLIC_TRACKER_MOBILE_REDIRECT}
    />
  );
}
export function RootLayout({
  live,
  origin,
  redirect,
}: {
  live: boolean;
  origin?: string;
  redirect?: string;
}) {
  const screens = (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />
  );
  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={styles.root}
        edges={["top", "right", "bottom", "left"]}
        testID="app-safe-area"
      >
        {live && origin && redirect ? (
          <LiveShell origin={origin} redirect={redirect}>
            {screens}
          </LiveShell>
        ) : (
          <BoardProvider runtime={runtime}>{screens}</BoardProvider>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
