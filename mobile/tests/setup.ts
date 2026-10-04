import { TextEncoder, TextDecoder } from "node:util";
Object.assign(globalThis, {
  TextEncoder,
  TextDecoder,
  structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)),
});
jest.mock("expo-crypto", () => ({ randomUUID: () => `test-${Math.random()}` }));
jest.mock("expo-router", () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    dismissTo: jest.fn(),
  }),
  usePathname: jest.fn(() => "/"),
  useLocalSearchParams: jest.fn(() => ({})),
}));
