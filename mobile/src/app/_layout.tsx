import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { createRuntime } from "../runtime";
import { BoardProvider } from "../store";
const runtime = createRuntime({
  mode: process.env.EXPO_PUBLIC_TRACKER_MODE,
  origin: process.env.EXPO_PUBLIC_TRACKER_API_ORIGIN,
});
export default function Layout() {
  return (
    <SafeAreaProvider>
      <BoardProvider runtime={runtime}>
        <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />
      </BoardProvider>
    </SafeAreaProvider>
  );
}
