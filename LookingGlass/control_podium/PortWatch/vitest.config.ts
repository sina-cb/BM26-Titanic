import { defineConfig } from "vitest/config";

// Vitest runs in plain Node — the `@react-native-async-storage/async-storage`
// package only ships a native module that loads at runtime on iOS/Android,
// so importing it in tests fails on `NativeModules.RNCAsyncStorage` lookup.
// We swap it for an in-memory stub via `setupFiles`. See
// `./src/_test/setup.ts` for the stub implementation.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/_test/setup.ts"],
  },
});
