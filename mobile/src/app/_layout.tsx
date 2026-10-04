import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { createRuntime } from "../runtime";
import { BoardProvider } from "../store";
import { LiveShell } from "../live-shell";
const runtime = createRuntime({
  mode: process.env.EXPO_PUBLIC_TRACKER_MODE,
  origin: process.env.EXPO_PUBLIC_TRACKER_API_ORIGIN,
});
export default function Layout() {
  const screens = (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />
  );
  const live = process.env.EXPO_PUBLIC_TRACKER_MODE === "live";
  const origin = process.env.EXPO_PUBLIC_TRACKER_API_ORIGIN;
  const redirect = process.env.EXPO_PUBLIC_TRACKER_MOBILE_REDIRECT;
  return (
    <SafeAreaProvider>
      {live && origin && redirect ? (
        <LiveShell origin={origin} redirect={redirect}>
          {screens}
        </LiveShell>
      ) : (
        <BoardProvider runtime={runtime}>{screens}</BoardProvider>
      )}
    </SafeAreaProvider>
  );
}
