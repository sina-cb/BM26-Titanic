import { describe, expect, it } from "vitest";
import { reconcileIntent, type Intent } from "./intent";

// Helpers — concise constructors for the four equivalence classes of
// intents. `setAtMs` doesn't influence today's decision (kept for the
// future "fade after N seconds" UX) so we hard-code a fixed timestamp
// to keep test output stable in snapshots / diffs.
const FIXED_MS = 1_700_000_000_000;

function pending<T>(value: T): Intent<T> {
  return { value, pending: true, setAtMs: FIXED_MS };
}
function settled<T>(value: T): Intent<T> {
  return { value, pending: false, setAtMs: FIXED_MS };
}

describe("reconcileIntent", () => {
  it("returns undefined when there's no intent", () => {
    expect(reconcileIntent<string>(undefined, "anything")).toBeUndefined();
    expect(reconcileIntent<boolean>(undefined, null)).toBeUndefined();
  });

  it("keeps the intent when the engine value is null (no signal yet)", () => {
    const i = pending("rave");
    expect(reconcileIntent(i, null)).toBe(i);

    const s = settled(false);
    expect(reconcileIntent(s, null)).toBe(s);
  });

  it("drops the intent on exact match (pending OR settled)", () => {
    expect(reconcileIntent(pending("rave"), "rave")).toBeUndefined();
    expect(reconcileIntent(settled("rave"), "rave")).toBeUndefined();
    expect(reconcileIntent(pending(true), true)).toBeUndefined();
    expect(reconcileIntent(settled(0.42), 0.42)).toBeUndefined();
  });

  it("keeps a fresh (pending=true) intent when the engine disagrees", () => {
    // Operator tapped, bridge hasn't ACK'd. We're in the optimistic
    // window — keep showing what they picked even if the engine still
    // reports the old value (round-trip in flight).
    const i = pending("rave");
    expect(reconcileIntent(i, "ambient")).toBe(i);
  });

  it("drops a settled (pending=false) intent when the engine disagrees", () => {
    // This is the bug fix: bridge ACK'd ⇒ engine has heard us ⇒ any
    // mismatch from now on means a concurrent writer (CaptainPad)
    // beat us, OR the engine intentionally rejected our value. Drop
    // the optimistic overlay so the LIVE chip follows the engine,
    // not our stale tap.
    const i = settled("rave");
    expect(reconcileIntent(i, "ambient")).toBeUndefined();
  });

  it("uses strict equality (no type coercion)", () => {
    // We want a boolean intent of `true` to NOT match an engine value
    // of `1` (number) — the helper is generic on T and JS `===`
    // doesn't coerce. Cast the engine value as `any` to bypass the
    // generic check at the call site, mirroring what would happen if
    // someone fed a typed-loosely value in.
    const i = pending(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = reconcileIntent(i, 1 as any);
    // 1 !== true ⇒ mismatch; pending=true ⇒ keep.
    expect(out).toBe(i);
  });

  it("handles the full lifecycle end-to-end", () => {
    // Lifecycle for `activePattern`:
    //   t0: operator taps "rave"          → intent = pending("rave")
    //   t1: bridge ACK arrives            → markIntentResolved flips
    //                                       pending → false
    //   t2: engine PUB lands with pat/rave → match ⇒ drop
    let intent: Intent<string> | undefined = pending("rave");

    // While in flight, engine still reports OLD pattern.
    intent = reconcileIntent(intent, "ambient");
    expect(intent).toEqual(pending("rave")); // kept (optimistic)

    // Bridge ACK → pending=false (the store does this on its own;
    // we simulate the post-ACK shape here).
    intent = settled("rave");

    // Engine PUB arrives. Two scenarios:
    //   (a) Happy path: engine now reports our value → drop intent.
    expect(reconcileIntent(intent, "rave")).toBeUndefined();

    //   (b) Conflict path: CaptainPad raced us and engine reports
    //       a different value → also drop intent (engine wins).
    expect(reconcileIntent(intent, "afterhours")).toBeUndefined();
  });
});
