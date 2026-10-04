import type { ConfigContext } from "expo/config";
import configure from "../app.config";

const keys = [
  "EXPO_PUBLIC_TRACKER_API_ORIGIN",
  "EXPO_PUBLIC_TRACKER_MOBILE_REDIRECT",
] as const;
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const context = {
  config: { name: "Synthetic", slug: "synthetic" },
} as ConfigContext;
afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});
test("HTTPS native auth declares exact app-link and web-credential host associations", () => {
  process.env.EXPO_PUBLIC_TRACKER_API_ORIGIN = "https://tracker.example";
  process.env.EXPO_PUBLIC_TRACKER_MOBILE_REDIRECT =
    "https://tracker.example/auth/mobile/callback";
  expect(configure(context).ios?.associatedDomains).toEqual([
    "applinks:tracker.example",
    "webcredentials:tracker.example",
  ]);
});
test("association setup fails closed for a different host or callback query", () => {
  process.env.EXPO_PUBLIC_TRACKER_API_ORIGIN = "https://tracker.example";
  for (const callback of [
    "https://other.example/auth/mobile/callback",
    "https://tracker.example/auth/mobile/callback?code=synthetic",
  ]) {
    process.env.EXPO_PUBLIC_TRACKER_MOBILE_REDIRECT = callback;
    expect(() => configure(context)).toThrow("canonical HTTPS");
  }
});
