import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { MobileAuth, SecretStorage } from "./auth";
import { SecureWriteJournal } from "./journal";
export const sha256 = (value: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
const base64url = (value: string) =>
  value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// Strict allowlist: never log a callback, URL, ticket, token or raw platform error.
export function browserDiagnostic(result: unknown, elapsedMs: number) {
  const value = result as { type?: unknown; error?: unknown } | null;
  const type = ["success", "cancel", "dismiss", "opened", "locked"].includes(
    String(value?.type),
  )
    ? String(value?.type)
    : "unknown";
  const match =
    typeof value?.error === "string"
      ? /WebAuthenticationSession(?:Error)? error ([123])\b/.exec(value.error)
      : null;
  return {
    event: "browser-result",
    type,
    platformCode: match ? Number(match[1]) : null,
    hasPlatformError:
      typeof value?.error === "string" && value.error.length > 0,
    elapsed:
      elapsedMs < 1000
        ? "under-one-second"
        : elapsedMs < 10000
          ? "one-to-ten-seconds"
          : "over-ten-seconds",
  };
}
export async function createNativeAuth(origin: string, redirect: string) {
  if (Platform.OS === "web" || !(await SecureStore.isAvailableAsync()))
    throw new Error("Native secure storage is required.");
  const namespace = "job-intel-" + (await sha256(origin)).slice(0, 24) + "-";
  const options = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  const store: SecretStorage = {
    get: (key) => SecureStore.getItemAsync(namespace + key, options),
    set: (key, value) =>
      SecureStore.setItemAsync(namespace + key, value, options),
    remove: (key) => SecureStore.deleteItemAsync(namespace + key, options),
  };
  const auth = new MobileAuth({
    origin,
    redirect,
    storage: store,
    browser: {
      open: async (url, callback) => {
        const started = Date.now();
        const result = await WebBrowser.openAuthSessionAsync(url, callback, {
          preferUniversalLinks: Platform.OS === "ios",
        });
        console.info(
          "JobIntelAuth",
          JSON.stringify(browserDiagnostic(result, Date.now() - started)),
        );
        return result;
      },
    },
    crypto: {
      random: async () => {
        const bytes = await Crypto.getRandomBytesAsync(32);
        return base64url(btoa(String.fromCharCode(...bytes)));
      },
      challenge: async (verifier) =>
        base64url(
          await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            verifier,
            { encoding: Crypto.CryptoEncoding.BASE64 },
          ),
        ),
    },
  });
  return { auth, journal: new SecureWriteJournal(store, auth.origin, sha256) };
}
