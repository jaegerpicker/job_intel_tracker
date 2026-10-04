import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BoardProvider } from "../store";
export default function Layout() {
  return (
    <SafeAreaProvider>
      <BoardProvider>
        <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />
      </BoardProvider>
    </SafeAreaProvider>
  );
}
