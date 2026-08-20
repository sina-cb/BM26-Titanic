// titanicLink.test.ts — verifies the single-flight TX manager.
//
// The captain firmware's BLE→LoRa queue overflows on a slow link if
// multiple sendOp() callers fire concurrently. TitanicLink must
// serialize every BLE write through one chain. Tests pin that.

import { describe, it, expect, beforeEach } from "vitest";
import { TitanicLink } from "./titanicLink";
import { Codec } from "../crypto/codec";
import type { BleClient } from "../ble/client";

// Minimal fake BleClient. Tracks every writeFrame() call with its
// timestamp so the test can assert ordering / non-overlap.
function makeFakeBle(opts: { writeDelayMs?: number } = {}): BleClient & {
  writes: { line: string; startMs: number; endMs: number }[];
  inFlight: number;
  peakInFlight: number;
} {
  const writes: { line: string; startMs: number; endMs: number }[] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  const delayMs = opts.writeDelayMs ?? 30;
  const fake = {
    writes,
    inFlight,
    peakInFlight,
    writeFrame: async (line: string): Promise<void> => {
      const startMs = Date.now();
      inFlight++;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      // Mirror the field back onto the object so the test can read it.
      (fake as { inFlight: number; peakInFlight: number }).inFlight = inFlight;
      (fake as { inFlight: number; peakInFlight: number }).peakInFlight = peakInFlight;
      await new Promise((r) => setTimeout(r, delayMs));
      inFlight--;
      (fake as { inFlight: number }).inFlight = inFlight;
      writes.push({ line, startMs, endMs: Date.now() });
    },
  } as unknown as BleClient & {
    writes: { line: string; startMs: number; endMs: number }[];
    inFlight: number;
    peakInFlight: number;
  };
  return fake;
}

describe("TitanicLink — single-flight TX manager", () => {
  let codec: Codec;
  beforeEach(() => {
    // 16-byte dev key. Any deterministic value works for the test;
    // we never round-trip through a real bridge here.
    const key = new Uint8Array(16).fill(0x42);
    codec = new Codec(key);
  });

  it("serializes concurrent sendOp() calls so BLE writes never overlap", async () => {
    const ble = makeFakeBle({ writeDelayMs: 50 });
    const link = new TitanicLink(codec, ble, { interFrameGapMs: 0 });

    // Fire 5 sendOps in parallel. None will get a reply (no fake bridge)
    // so they'll all time out, but we only care about the WRITE order.
    const promises = Array.from({ length: 5 }, (_, i) =>
      link.sendOp({ id: `q${i}`, label: `q${i}`, kind: "qry", arg: `q${i}` }, { timeoutMs: 200 }),
    );
    await Promise.all(promises);

    expect(ble.writes.length).toBe(5);
    expect(ble.peakInFlight).toBe(1); // never two on the wire at once

    // Writes must be strictly sequential — write[i].endMs <= write[i+1].startMs
    for (let i = 0; i < ble.writes.length - 1; i++) {
      expect(ble.writes[i + 1].startMs).toBeGreaterThanOrEqual(
        ble.writes[i].endMs,
      );
    }
  });

  it("enforces the inter-frame gap between consecutive sendOps", async () => {
    const ble = makeFakeBle({ writeDelayMs: 10 });
    const gapMs = 100;
    const link = new TitanicLink(codec, ble, { interFrameGapMs: gapMs });

    await Promise.all([
      link.sendOp({ id: "a", label: "a", kind: "qry", arg: "a" }, { timeoutMs: 200 }),
      link.sendOp({ id: "b", label: "b", kind: "qry", arg: "b" }, { timeoutMs: 200 }),
    ]);

    expect(ble.writes.length).toBe(2);
    const gap = ble.writes[1].startMs - ble.writes[0].endMs;
    // Allow generous tolerance for setTimeout jitter in test runners
    // (Node's setTimeout has ~10 ms slack under load).
    expect(gap).toBeGreaterThanOrEqual(gapMs - 20);
  });

  it("one failed write does not poison the chain — subsequent sends still run", async () => {
    const writes: string[] = [];
    let throwOnce = true;
    const ble = {
      writeFrame: async (line: string): Promise<void> => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error("BLE characteristic unavailable");
        }
        await new Promise((r) => setTimeout(r, 5));
        writes.push(line);
      },
    } as unknown as BleClient;
    const link = new TitanicLink(codec, ble, { interFrameGapMs: 0 });

    const p1 = link.sendOp({ id: "fails", label: "fails", kind: "qry", arg: "fails" }, { timeoutMs: 100 });
    const p2 = link.sendOp({ id: "ok", label: "ok", kind: "qry", arg: "ok" }, { timeoutMs: 100 });

    await expect(p1).rejects.toThrow(/BLE characteristic unavailable/);
    await p2; // should resolve (will time out waiting for reply, but should not throw)
    expect(writes.length).toBe(1);
  });

  it("setLoraProfile serializes against concurrent sendOp through the same chain", async () => {
    // Regression: an earlier version of setLoraProfile bypassed the
    // TX chain "because *CFG is rare and latency-critical". That
    // caused operator-side profile taps landing mid-pattern-fetch
    // to corrupt the captain firmware's BLE ring queue. Now both
    // share _txChain and never overlap on the BLE characteristic.
    const ble = makeFakeBle({ writeDelayMs: 40 });
    const link = new TitanicLink(codec, ble, { interFrameGapMs: 0 });

    const a = link.sendOp(
      { id: "qry", label: "qry", kind: "qry", arg: "engine/status" },
      { timeoutMs: 100 },
    );
    const b = link.setLoraProfile("test_bench");
    const c = link.sendOp(
      { id: "qry2", label: "qry2", kind: "qry", arg: "params" },
      { timeoutMs: 100 },
    );
    await Promise.all([a, b, c]);

    expect(ble.writes.length).toBe(3);
    // Never two on the wire concurrently.
    expect(ble.peakInFlight).toBe(1);
    // Strict ordering — including the plaintext *CFG line in the
    // middle of two v2 frames.
    for (let i = 0; i < ble.writes.length - 1; i++) {
      expect(ble.writes[i + 1].startMs).toBeGreaterThanOrEqual(
        ble.writes[i].endMs,
      );
    }
    // The *CFG line is the only one starting with "*CFG ".
    const cfgWrites = ble.writes.filter((w) => w.line.startsWith("*CFG "));
    expect(cfgWrites.length).toBe(1);
    expect(cfgWrites[0].line).toMatch(/^\*CFG name=test_bench t=\d+\n$/);
  });

  it("queueDepth + peakQueueDepth track concurrent callers", async () => {
    const ble = makeFakeBle({ writeDelayMs: 30 });
    const link = new TitanicLink(codec, ble, { interFrameGapMs: 0 });

    expect(link.queueDepth).toBe(0);
    expect(link.peakQueueDepth).toBe(0);

    const ps = Array.from({ length: 4 }, (_, i) =>
      link.sendOp({ id: `q${i}`, label: `q${i}`, kind: "qry", arg: `q${i}` }, { timeoutMs: 200 }),
    );
    // Give the synchronous part of sendOp() time to increment.
    await new Promise((r) => setTimeout(r, 0));
    expect(link.queueDepth).toBeGreaterThan(1);
    expect(link.peakQueueDepth).toBeGreaterThanOrEqual(link.queueDepth);

    await Promise.all(ps);
    expect(link.queueDepth).toBe(0);
    expect(link.peakQueueDepth).toBe(4);
  });
});
