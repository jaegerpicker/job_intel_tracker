import { Platform } from "react-native";
import { createNativeAuth } from "../src/native-auth";
import * as SecureStore from "expo-secure-store";
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only-unlocked",
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
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
