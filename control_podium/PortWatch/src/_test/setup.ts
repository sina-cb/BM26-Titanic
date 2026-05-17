// Vitest setup — runs before every test file.
//
// We mock `@react-native-async-storage/async-storage` with an in-memory
// stub so the store's `persistedCache` integration can be exercised
// without a native module. The store hooks call AsyncStorage to
// fire-and-forget persist changes; tests don't assert on persistence
// side-effects (those are integration-level concerns), they only need
// AsyncStorage's calls to not throw and to return well-formed promises.

import { vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const memory = new Map<string, string>();
  const api = {
    async getItem(key: string): Promise<string | null> {
      return memory.has(key) ? (memory.get(key) as string) : null;
    },
    async setItem(key: string, value: string): Promise<void> {
      memory.set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      memory.delete(key);
    },
    async multiGet(keys: string[]): Promise<[string, string | null][]> {
      return keys.map((k) => [k, memory.has(k) ? (memory.get(k) as string) : null]);
    },
    async multiSet(pairs: [string, string][]): Promise<void> {
      for (const [k, v] of pairs) memory.set(k, v);
    },
    async multiRemove(keys: string[]): Promise<void> {
      for (const k of keys) memory.delete(k);
    },
    async clear(): Promise<void> {
      memory.clear();
    },
    async getAllKeys(): Promise<string[]> {
      return Array.from(memory.keys());
    },
  };
  return {
    default: api,
    ...api,
  };
});
