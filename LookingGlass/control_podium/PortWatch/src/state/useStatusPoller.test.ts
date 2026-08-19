import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStatusPoller } from "./useStatusPoller";

// Stub link with a controllable round-trip delay. Tests record every
// call so we can assert poll cadence + the in-flight skip behavior.
function makeLinkStub(roundTripMs = 50) {
  const calls: Array<{ at: number; arg: string | undefined }> = [];
  const sendOp = vi.fn(async (op: { arg?: string }) => {
    calls.push({ at: Date.now(), arg: op?.arg });
    await new Promise((r) => setTimeout(r, roundTripMs));
    return {
      request: null,
      reply: { typ: "rep", arg: "dn/0,pat/x", src: 1, dst: 10, seq: 0 },
      rttMs: roundTripMs,
      timedOut: false,
      requestLine: "stub",
      replyLine: "stub",
    } as any;
  });
  return { link: { sendOp }, calls };
}

describe("createStatusPoller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires the first poll synchronously on start (no interval wait)", async () => {
    const { link, calls } = makeLinkStub();
    const ctl = createStatusPoller(link as any, {
      intervalMs: 5000,
      timeoutMs: 6000,
    });
    ctl.start();
    // Let the sendOp resolve (50ms stub delay).
    await vi.advanceTimersByTimeAsync(60);
    expect(calls.length).toBe(1);
    expect(calls[0].arg).toBe("engine/status");
    ctl.stop();
  });

  it("fires once per interval after the first poll", async () => {
    const { link, calls } = makeLinkStub();
    const ctl = createStatusPoller(link as any, {
      intervalMs: 5000,
      timeoutMs: 6000,
    });
    ctl.start();
    await vi.advanceTimersByTimeAsync(60); // first poll
    expect(calls.length).toBe(1);

    await vi.advanceTimersByTimeAsync(5000); // tick 1
    expect(calls.length).toBe(2);

    await vi.advanceTimersByTimeAsync(15_000); // ticks 2, 3, 4
    expect(calls.length).toBe(5);
    ctl.stop();
  });

  it("skips ticks while a previous poll is still in flight", async () => {
    // Round-trip 8s > interval 5s — the t=5s tick should be skipped.
    const { link, calls } = makeLinkStub(8000);
    const ctl = createStatusPoller(link as any, {
      intervalMs: 5000,
      timeoutMs: 10_000,
    });
    ctl.start();

    await vi.advanceTimersByTimeAsync(100); // first poll fires
    expect(calls.length).toBe(1);
    expect(ctl.isInFlight()).toBe(true);

    await vi.advanceTimersByTimeAsync(5000); // tick 1 skipped (in flight)
    expect(calls.length).toBe(1);

    await vi.advanceTimersByTimeAsync(3000); // first poll resolves at ~t=8.1s
    expect(ctl.isInFlight()).toBe(false);
    expect(calls.length).toBe(1); // tick 2 hasn't happened yet

    await vi.advanceTimersByTimeAsync(2000); // tick 2 at ~t=10.1s
    expect(calls.length).toBe(2);
    ctl.stop();
  });

  it("stop() cancels future ticks and clears the interval", async () => {
    const { link, calls } = makeLinkStub();
    const ctl = createStatusPoller(link as any, {
      intervalMs: 5000,
      timeoutMs: 6000,
    });
    ctl.start();
    await vi.advanceTimersByTimeAsync(60);
    expect(calls.length).toBe(1);
    ctl.stop();
    await vi.advanceTimersByTimeAsync(30_000); // 6 intervals — none should fire
    expect(calls.length).toBe(1);
  });

  it("does nothing when link is null", async () => {
    const ctl = createStatusPoller(null, { intervalMs: 5000, timeoutMs: 6000 });
    ctl.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ctl.isInFlight()).toBe(false);
    ctl.stop();
  });

  it("swallows sendOp failures and keeps polling", async () => {
    const { link, calls } = makeLinkStub();
    link.sendOp = vi.fn(async (op: { arg?: string }) => {
      calls.push({ at: Date.now(), arg: op?.arg });
      throw new Error("LoRa timeout");
    });
    const ctl = createStatusPoller(link as any, {
      intervalMs: 5000,
      timeoutMs: 6000,
    });
    ctl.start();
    await vi.advanceTimersByTimeAsync(60); // first call throws — silently
    expect(calls.length).toBe(1);
    expect(ctl.isInFlight()).toBe(false); // cleared in `finally`

    await vi.advanceTimersByTimeAsync(5000); // next tick still runs
    expect(calls.length).toBe(2);
    ctl.stop();
  });

  it("guards against double-start", async () => {
    const { link, calls } = makeLinkStub();
    const ctl = createStatusPoller(link as any, {
      intervalMs: 5000,
      timeoutMs: 6000,
    });
    ctl.start();
    ctl.start(); // second start is a no-op (no extra interval)
    await vi.advanceTimersByTimeAsync(15_100);
    // 1 immediate + 3 ticks = 4 polls, NOT 8.
    expect(calls.length).toBe(4);
    ctl.stop();
  });
});
