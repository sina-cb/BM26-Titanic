import * as SecureStore from "expo-secure-store";

/**
 * DurableCounter implements persistent, crash-safe, and nonce-safe transmit
 * counters for PortWatch. It uses expo-secure-store to save counter bounds
 * in iOS Keychain/SecureStore.
 *
 * To avoid writing to storage on every single transmitted frame (which would
 * cause massive write latency and flash wear), it reserves a block of 1024
 * counters. If the app crashes, the remaining counters in the reserved block
 * are skipped (wasted) but NEVER reused, satisfying the AES-GCM nonce-safety
 * requirement.
 */
export class DurableCounter {
  private readonly storageKey: string;
  private currentCtr: number | null = null;
  private blockLimit: number | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(fingerprint: string, srcNodeId: number) {
    const srcHex = srcNodeId.toString(16).padStart(2, "0");
    this.storageKey = `portwatch.counter.${fingerprint}.${srcHex}`;
  }

  private async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = (async () => {
      try {
        const stored = await SecureStore.getItemAsync(this.storageKey);
        if (stored) {
          const limit = parseInt(stored, 10);
          if (!Number.isNaN(limit) && limit >= 0 && limit < 0x1000000000000) {
            this.currentCtr = limit;
            this.blockLimit = limit + 1024;
            await SecureStore.setItemAsync(this.storageKey, this.blockLimit.toString(), {
              keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            });
            return;
          }
        }
      } catch (e) {
        // SecureStore item might not exist or failed
      }

      // No valid stored counter -> seed a new 48-bit one.
      const r = new Uint8Array(6);
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        crypto.getRandomValues(r);
      } else {
        for (let i = 0; i < 6; i++) r[i] = Math.floor(Math.random() * 256);
      }
      const seed = (
        r[0] * 0x10000000000 +
        r[1] * 0x100000000 +
        r[2] * 0x1000000 +
        r[3] * 0x10000 +
        r[4] * 0x100 +
        r[5]
      ) % 0x1000000000000;

      this.currentCtr = seed;
      this.blockLimit = seed + 1024;
      await SecureStore.setItemAsync(this.storageKey, this.blockLimit.toString(), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    })();
    return this.initPromise;
  }

  async nextCounter(): Promise<number> {
    await this.initialize();

    if (this.currentCtr === null || this.blockLimit === null) {
      throw new Error("Counter failed to initialize");
    }

    if (this.currentCtr >= this.blockLimit) {
      // Current block exhausted, reserve the next block
      const newLimit = this.blockLimit + 1024;
      await SecureStore.setItemAsync(this.storageKey, newLimit.toString(), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      this.blockLimit = newLimit;
    }

    const ctr = this.currentCtr;
    this.currentCtr++;
    return ctr;
  }

  /** Retrieve the underlying storage key (useful for tests/debugging). */
  getStorageKey(): string {
    return this.storageKey;
  }
}
