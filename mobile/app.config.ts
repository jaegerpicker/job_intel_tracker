import type { ConfigContext, ExpoConfig } from "expo/config";
// Public link configuration only. Domain files/signing still require operator approval.
export default ({ config }: ConfigContext): ExpoConfig => {
  const callback = process.env.EXPO_PUBLIC_TRACKER_MOBILE_REDIRECT;
  if (!callback) return config as ExpoConfig;
  const url = new URL(callback);
  const api = new URL(process.env.EXPO_PUBLIC_TRACKER_API_ORIGIN ?? "");
  if (
    url.protocol !== "https:" ||
    url.origin !== api.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/auth/mobile/callback"
  )
    throw new Error("Use the canonical HTTPS API-origin mobile callback.");
  return {
    ...config,
    ios: { ...config.ios, associatedDomains: [`applinks:${url.hostname}`] },
    android: {
      ...config.android,
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          category: ["BROWSABLE", "DEFAULT"],
          data: [
            {
              scheme: "https",
              host: url.hostname,
              path: "/auth/mobile/callback",
            },
          ],
        },
      ],
    },
  } as ExpoConfig;
};
