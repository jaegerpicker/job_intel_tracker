import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { MobileAuth, SecretStorage } from "./auth";
import { SecureWriteJournal } from "./journal";
import { ResearchOperation, validResearchOperation } from "./research";
export const sha256 = (value: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
const base64url = (value: string) =>
  value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function createNativeAuth(
  origin: string,
  redirect: string,
): Promise<{
  auth: MobileAuth;
  journal: SecureWriteJournal;
  researchJournal?: SecureWriteJournal<ResearchOperation>;
}> {
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
      open: (url, callback) =>
        WebBrowser.openAuthSessionAsync(url, callback, {
          preferUniversalLinks: Platform.OS === "ios",
        }),
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
  const researchStore: SecretStorage = {
    get: (key) => store.get("research-" + key),
    set: (key, value) => store.set("research-" + key, value),
    remove: (key) => store.remove("research-" + key),
  };
  return {
    auth,
    journal: new SecureWriteJournal(store, auth.origin, sha256),
    researchJournal: new SecureWriteJournal<ResearchOperation>(
      researchStore,
      auth.origin,
      sha256,
      validResearchOperation,
    ),
  };
}
