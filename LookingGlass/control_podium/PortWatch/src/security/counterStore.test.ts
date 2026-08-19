import { describe, it, expect, beforeEach, vi } from "vitest";
import { DurableCounter } from "./counterStore";
import * as SecureStore from "expo-secure-store";

describe("DurableCounter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset our mock SecureStore in-memory map
    const mockSecureStore = SecureStore as any;
    if (mockSecureStore.getItemAsync && mockSecureStore.setItemAsync) {
      // Find the mocked memory map from vitest setup
      // We can just clear the storage by calling deleteItemAsync on known keys
      // or clear whatever the mock has. Since we mocked it dynamically,
      // let's look at the mocked functions or simply recreate/reinitialize.
    }
  });

  it("first install seeds a random 48-bit counter and reserves 1024-step block", async () => {
    const counter = new DurableCounter("key1", 0x0a);
    const key = counter.getStorageKey();

    const ctr1 = await counter.nextCounter();
    expect(ctr1).toBeGreaterThanOrEqual(0);
    expect(ctr1).toBeLessThan(0x1000000000000);

    // SecureStore should have stored the blockLimit (seed + 1024)
    const stored = await SecureStore.getItemAsync(key);
    expect(stored).not.toBeNull();
    const storedLimit = parseInt(stored!, 10);
    expect(storedLimit).toBe(ctr1 + 1024);

    const ctr2 = await counter.nextCounter();
    expect(ctr2).toBe(ctr1 + 1);
  });

  it("resumes above the previously reserved block limit on subsequent instantiation (app restart safety)", async () => {
    const fingerprint = "key_fingerprint_abc";
    const src = 0x0a;

    const counter1 = new DurableCounter(fingerprint, src);
    const firstVal = await counter1.nextCounter();

    // Verify block limit was set to firstVal + 1024
    const key = counter1.getStorageKey();
    const storedAfter1 = await SecureStore.getItemAsync(key);
    const limit1 = parseInt(storedAfter1!, 10);
    expect(limit1).toBe(firstVal + 1024);

    // Now instantiate a second counter representing an app restart
    const counter2 = new DurableCounter(fingerprint, src);
    const secondVal = await counter2.nextCounter();

    // Should resume EXACTLY at limit1
    expect(secondVal).toBe(limit1);

    // Storage should now be updated to limit1 + 1024
    const storedAfter2 = await SecureStore.getItemAsync(key);
    const limit2 = parseInt(storedAfter2!, 10);
    expect(limit2).toBe(limit1 + 1024);
  });

  it("creates separate namespaces for different key fingerprints", async () => {
    const counterA = new DurableCounter("fingerprintA", 0x0a);
    const counterB = new DurableCounter("fingerprintB", 0x0a);

    expect(counterA.getStorageKey()).not.toBe(counterB.getStorageKey());
  });

  it("creates separate namespaces for different source node IDs", async () => {
    const counterA = new DurableCounter("fingerprintX", 0x0a);
    const counterB = new DurableCounter("fingerprintX", 0x0b);

    expect(counterA.getStorageKey()).not.toBe(counterB.getStorageKey());
  });

  it("automatically reserves a new block when the current block is exhausted", async () => {
    const counter = new DurableCounter("exhaust_key", 0x0c);
    const startVal = await counter.nextCounter();

    // Fast-forward our currentCtr to just before the block limit
    // By access of internal fields (for testing)
    (counter as any).currentCtr = (counter as any).blockLimit - 1;

    // Next call should succeed normally
    const beforeLimit = await counter.nextCounter();
    expect(beforeLimit).toBe((counter as any).blockLimit - 1);

    // Call after that should exceed blockLimit, triggering a new block reservation
    const limit = (counter as any).blockLimit;
    const nextBlockStart = await counter.nextCounter();
    expect(nextBlockStart).toBe(limit);

    // SecureStore should now store limit + 1024
    const stored = await SecureStore.getItemAsync(counter.getStorageKey());
    expect(parseInt(stored!, 10)).toBe(limit + 1024);
  });
});
