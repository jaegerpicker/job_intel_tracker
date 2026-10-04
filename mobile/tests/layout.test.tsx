import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RootLayout } from "../src/app/_layout";
jest.mock("expo-router", () => {
  const { Text } = jest.requireActual("react-native");
  return { Stack: () => <Text>Routed board</Text> };
});
jest.mock("../src/live-shell", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    LiveShell: ({ children }: { children: React.ReactNode }) => (
      <>
        <Text>Owner session controls</Text>
        {children}
      </>
    ),
  };
});
jest.mock("../src/store", () => ({
  BoardProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);
test.each(["demo", "live", "locked"])(
  "root protects all screen chrome in %s configuration",
  (mode) => {
    render(
      <RootLayout
        live={mode !== "demo"}
        origin={mode === "live" ? "https://example.com" : undefined}
        redirect={
          mode === "live"
            ? "https://example.com/auth/mobile/callback"
            : undefined
        }
      />,
    );
    const frame = screen.UNSAFE_getByType(SafeAreaView);
    expect(frame.props.edges).toEqual(["top", "right", "bottom", "left"]);
    const content = frame
      .findAllByType(Text)
      .map((node) => node.props.children);
    expect(content).toContain("Routed board");
    if (mode === "live") expect(content).toContain("Owner session controls");
    else expect(content).not.toContain("Owner session controls");
  },
);
