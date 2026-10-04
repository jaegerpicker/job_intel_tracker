import React from "react";
import {
  AppState,
  AppStateStatus,
  Linking,
  Text,
  TextInput,
} from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { PrivacyShield, LiveShell } from "../src/live-shell";
import { MobileAuth } from "../src/auth";
import { SecureWriteJournal } from "../src/journal";
import { createNativeAuth } from "../src/native-auth";
import { fixtures } from "../src/demo";
import { prepareWrite } from "../src/domain";
import { createHash } from "node:crypto";
jest.mock("../src/native-auth", () => ({ createNativeAuth: jest.fn() }));
const originalAppState = Object.getOwnPropertyDescriptor(
  AppState,
  "currentState",
);
const originalFetch = global.fetch;
beforeEach(() => {
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "active",
  });
  jest
    .spyOn(AppState, "addEventListener")
    .mockReturnValue({ remove: jest.fn() });
  jest
    .spyOn(Linking, "addEventListener")
    .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<
      typeof Linking.addEventListener
    >);
  jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null);
});
afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});
afterAll(() => {
  if (originalAppState)
    Object.defineProperty(AppState, "currentState", originalAppState);
});
test("privacy cover preserves unsaved drafts across inactive and active transitions", async () => {
  let listener!: (state: AppStateStatus) => void;
  const subscribe = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, handler) => {
      listener = handler;
      return { remove: jest.fn() };
    });
  function Draft() {
    const [text, setText] = React.useState("");
    return (
      <TextInput
        accessibilityLabel="Unsaved draft"
        value={text}
        onChangeText={setText}
      />
    );
  }
  render(
    <PrivacyShield>
      <Draft />
    </PrivacyShield>,
  );
  fireEvent.changeText(
    screen.getByLabelText("Unsaved draft"),
    "Preserve synthetic interview notes",
  );
  await act(async () => {
    listener("inactive");
  });
  expect(screen.getByTestId("privacy-cover")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Unsaved draft")).toBeNull();
  await act(async () => {
    listener("background");
  });
  expect(screen.getByTestId("privacy-cover")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Unsaved draft")).toBeNull();
  await act(async () => {
    listener("active");
  });
  expect(screen.queryByTestId("privacy-cover")).toBeNull();
  expect(screen.getByLabelText("Unsaved draft").props.value).toBe(
    "Preserve synthetic interview notes",
  );
  subscribe.mockRestore();
});
test("restored operation requires explicit latest comparison before discard", async () => {
  const origin = "https://example.com";
  const values = new Map<string, string>();
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
  await storage.set(
    "owner-session",
    JSON.stringify({
      origin,
      token: "mobile_" + "t".repeat(43),
      expiresAt: Date.now() + 60000,
    }),
  );
  const auth = new MobileAuth({
    origin,
    redirect: origin + "/auth/mobile/callback",
    storage,
    crypto: { random: jest.fn(), challenge: jest.fn() },
    browser: { open: jest.fn() },
  });
  const journal = new SecureWriteJournal(storage, origin, async (value) =>
    createHash("sha256").update(value).digest("hex"),
  );
  await journal.put(
    prepareWrite(fixtures[0], { stage: "Offer" }, "synthetic-op"),
  );
  jest.mocked(createNativeAuth).mockResolvedValue({ auth, journal });
  const previous = global.fetch;
  global.fetch = jest.fn(
    async (url: URL | RequestInfo) =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).endsWith("/api/me") ? { actor: "owner" } : fixtures,
      }) as Response,
  ) as typeof fetch;
  render(
    <LiveShell origin={origin} redirect={origin + "/auth/mobile/callback"}>
      <Text>Board content</Text>
    </LiveShell>,
  );
  await screen.findByText("Review interrupted work");
  expect(
    screen.getByRole("button", { name: "Discard reviewed operation" }),
  ).toBeDisabled();
  await fireEvent.press(
    screen.getByRole("button", { name: "Compare latest record" }),
  );
  await screen.findByText("Latest server record");
  expect(
    screen.getByRole("button", { name: "Discard reviewed operation" }),
  ).toBeEnabled();
  await fireEvent.press(
    screen.getByRole("button", { name: "Discard reviewed operation" }),
  );
  await screen.findByText("Board content");
  expect(await journal.read()).toBeNull();
  global.fetch = previous;
});
