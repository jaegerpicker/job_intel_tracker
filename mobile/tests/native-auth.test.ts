import { Platform } from "react-native";
import { createNativeAuth } from "../src/native-auth";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only-unlocked",
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(),
  WebBrowserResultType: { CANCEL: "cancel" },
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  CryptoEncoding: { BASE64: "base64" },
  digestStringAsync: jest.fn(async () => "a".repeat(64)),
  getRandomBytesAsync: jest.fn(async () => new Uint8Array(32)),
}));
test("native secrets use device-only unlocked Keychain options and origin namespace", async () => {
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  try {
    const value = await createNativeAuth(
      "https://example.com",
      "https://example.com/auth/mobile/callback",
    );
    await value.auth.restore();
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
      "job-intel-" + "a".repeat(24) + "-owner-session",
      { keychainAccessible: "device-only-unlocked" },
    );
    await value.auth.logout(() => value.journal.purge());
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "job-intel-" + "a".repeat(24) + "-owner-logout",
      "1",
      { keychainAccessible: "device-only-unlocked" },
    );
  } finally {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: original,
    });
  }
});
test("web platform cannot substitute plaintext browser storage", async () => {
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
  try {
    await expect(
      createNativeAuth(
        "https://example.com",
        "https://example.com/auth/mobile/callback",
      ),
    ).rejects.toThrow("Native secure storage");
  } finally {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: original,
    });
  }
});

test("iOS authentication explicitly selects the claimed HTTPS callback API", async () => {
  const original = Platform.OS;
  const originalFetch = global.fetch;
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  jest
    .mocked(Crypto.digestStringAsync)
    .mockImplementation(async (_kind, _value, options) =>
      options?.encoding === Crypto.CryptoEncoding.BASE64
        ? "A".repeat(43) + "="
        : "a".repeat(64),
    );
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      authorization_url:
        "https://example.com/auth/mobile/authorize?ticket=" + "t".repeat(43),
      expires_at: Date.now() / 1000 + 120,
    }),
  })) as unknown as typeof fetch;
  jest
    .mocked(WebBrowser.openAuthSessionAsync)
    .mockResolvedValue({ type: WebBrowser.WebBrowserResultType.CANCEL });
  try {
    const { auth } = await createNativeAuth(
      "https://example.com",
      "https://example.com/auth/mobile/callback",
    );
    await auth.signIn();
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      expect.stringContaining("/auth/mobile/authorize?ticket="),
      "https://example.com/auth/mobile/callback",
      { preferUniversalLinks: true },
    );
  } finally {
    global.fetch = originalFetch;
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: original,
    });
  }
});
