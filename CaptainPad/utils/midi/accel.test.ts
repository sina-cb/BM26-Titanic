import { describe, it, expect } from 'vitest';

import {
  gainForRate, TickAccelerator,
  ACCEL_GAIN_MIN, ACCEL_GAIN_MAX, ACCEL_HALF_RATE, ACCEL_IDLE_RESET_MS,
} from './accel';
import { DEFAULT_RELATIVE_STEPS } from './profile';

/** Raw unit travel of ONE detent (a ±1 relative code) — profile steps[0]. */
const S = DEFAULT_RELATIVE_STEPS[0];

/** Run a constant-rate tick train through a fresh accelerator: `n` ticks of
 *  `delta`, `dtMs` apart, starting at `t0`. Returns the per-tick effective
 *  deltas. */
function run(acc: TickAccelerator, n: number, delta: number, dtMs: number, t0 = 0): number[] {
  const effs: number[] = [];
  for (let i = 0; i < n; i += 1) effs.push(acc.applyTick(delta, t0 + i * dtMs));
  return effs;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('DEFAULT_RELATIVE_STEPS (coupling with the per-tick velocity gain)', () => {
  it('is LINEAR in the relative count — the speed curve lives in accel.ts only', () => {
    // A superlinear triple here would re-stack a stepped firmware-threshold
    // acceleration on top of the continuous host curve (the round-2 bug).
    const [a, b, c] = DEFAULT_RELATIVE_STEPS;
    expect(b).toBeCloseTo(2 * a, 10);
    expect(c).toBeCloseTo(3 * a, 10);
  });
});

describe('gainForRate (smooth bounded Hill curve of the turn rate)', () => {
  it('is GAIN_MIN at rest and for non-positive rates', () => {
    expect(gainForRate(0)).toBe(ACCEL_GAIN_MIN);
    expect(gainForRate(-1)).toBe(ACCEL_GAIN_MIN);
  });

  it('sits exactly halfway at ACCEL_HALF_RATE', () => {
    expect(gainForRate(ACCEL_HALF_RATE)).toBeCloseTo((ACCEL_GAIN_MIN + ACCEL_GAIN_MAX) / 2, 10);
  });

  it('is strictly monotonic and bounded by [GAIN_MIN, GAIN_MAX] — no kinks, no cap plateau jump', () => {
    let prev = ACCEL_GAIN_MIN;
    for (let rate = 0.001; rate <= 5; rate += 0.001) {
      const g = gainForRate(rate);
      expect(g).toBeGreaterThan(prev);
      expect(g).toBeLessThan(ACCEL_GAIN_MAX); // saturates smoothly, never reaches
      prev = g;
    }
  });

  it('approaches GAIN_MAX for a very fast rate', () => {
    expect(gainForRate(50)).toBeGreaterThan(ACCEL_GAIN_MAX * 0.98);
  });
});

describe('TickAccelerator — feel anchors', () => {
  it('an isolated slow detent lands in the 0.002–0.003 precision target', () => {
    const eff = new TickAccelerator().applyTick(S, 1000);
    expect(eff).toBeCloseTo(S * ACCEL_GAIN_MIN, 10);
    expect(eff).toBeGreaterThanOrEqual(0.002);
    expect(eff).toBeLessThanOrEqual(0.003);
  });

  it('a slow crawl (4 det/s) stays sub-detent-precise on every tick', () => {
    const effs = run(new TickAccelerator(), 8, S, 250);
    for (const e of effs) {
      expect(e).toBeGreaterThanOrEqual(0.002);
      expect(e).toBeLessThanOrEqual(0.004);
    }
  });

  it('a hard flick (real saturated +17 codes at high rate) sweeps the FULL range', () => {
    // Ground truth: a hard sustained spin is a stream of value 81 = +17 (the
    // firmware multiplier's ceiling) every ~2-10 ms. Raw travel per message is
    // 17 × S = 0.085. 8 such messages 5 ms apart ≈ a hard flick — it must reach
    // (and legitimately exceed, the manager clamps to 1) the full 0..1 range.
    // The modest host gain keeps this bounded — no runaway blow-up.
    const effs = run(new TickAccelerator(), 8, 17 * S, 5);
    expect(sum(effs)).toBeGreaterThanOrEqual(1.0); // reaches the ends
    expect(sum(effs)).toBeLessThanOrEqual(3.0);    // bounded — modest gain, no runaway
  });

  it('a SHORT wrist flick sweeps most of the range (round-4 fast-attack)', () => {
    // A quick wrist snap: a handful of moderate-code ticks. 8 messages of a +4
    // code (raw 4S), 15 ms apart ≈ a real short flick. Fast attack + the raw
    // magnitude must sweep a large fraction of range, NOT crawl at precision.
    const effs = run(new TickAccelerator(), 8, 4 * S, 15);
    expect(sum(effs)).toBeGreaterThanOrEqual(0.35);
  });

  it('a fast flick sweeps FAR more than the same MESSAGES turned slowly', () => {
    // The whole point of acceleration: fast must dwarf slow. Fast = the large
    // firmware codes at speed (raw 6S); slow = the same message COUNT of single
    // slow detents (raw S) at a lazy cadence.
    const fast = sum(run(new TickAccelerator(), 12, 6 * S, 15));
    const slow = sum(run(new TickAccelerator(), 12, S, 250));
    expect(fast / slow).toBeGreaterThan(10);
  });

  it('output rate rises strictly monotonically with the physical turn rate', () => {
    const totals = [5, 10, 20, 40, 80, 160].map((cps) =>
      sum(run(new TickAccelerator(), cps, S, 1000 / cps)), // 1 s at cps counts/s
    );
    for (let i = 1; i < totals.length; i += 1) expect(totals[i]).toBeGreaterThan(totals[i - 1]);
  });

  it('zero delta is returned unchanged and does not disturb the estimator', () => {
    const acc = new TickAccelerator();
    expect(acc.applyTick(0, 0)).toBe(0);
    expect(acc.applyTick(S, 0)).toBeCloseTo(S * ACCEL_GAIN_MIN, 10); // still a fresh gesture
  });

  it('preserves sign in both regimes (fine CCW detent, fast CCW spin)', () => {
    expect(new TickAccelerator().applyTick(-S, 0)).toBeCloseTo(-S * ACCEL_GAIN_MIN, 10);
    const effs = run(new TickAccelerator(), 30, -2 * S, 10);
    for (const e of effs) expect(e).toBeLessThan(0);
  });
});

describe('TickAccelerator — dynamics (the round-4 smoothness + seed properties)', () => {
  it('PROPERTY: constant tick rate in → constant per-tick output out, regardless of bucket phase', () => {
    // The round-2 bug: gain was computed from a 33 ms bucket's SUM, so the
    // same physical rate produced per-window outputs alternating ~3.5× with
    // bucket population (1 vs 2 ticks). Round 3+ gains each tick from the
    // continuous rate estimate, so windowing is a plain partition of equal
    // per-tick contributions — for EVERY bucket phase. (At constant rate attack
    // and release converge to the SAME steady state, so asymmetry is invisible
    // here.)
    const WINDOW_MS = 33;
    const DT_MS = 22; // ≈45.45 ticks/s — deliberately incommensurate with 33 ms
    const effs = run(new TickAccelerator(), 120, S, DT_MS); // ~2.6 s train
    // (a) After the EMA settles (geometric convergence — allow ~1e-6 slack),
    // every tick contributes the SAME amount...
    const ref = effs[effs.length - 1];
    for (const e of effs.slice(50)) expect(e).toBeCloseTo(ref, 6);
    // ... and that amount is the steady-state rate through the curve.
    expect(ref).toBeCloseTo(S * gainForRate(S / (DT_MS / 1000)), 9);
    // (b) For every bucket phase, each settled window's output is exactly
    // (ticks in window) × the constant per-tick contribution, and the total
    // is phase-invariant — windowing cannot distort the value trajectory.
    const totals: number[] = [];
    for (let phase = 0; phase < WINDOW_MS; phase += 5) {
      const windows = new Map<number, { sum: number; n: number }>();
      effs.forEach((e, i) => {
        const w = Math.floor((i * DT_MS + phase) / WINDOW_MS);
        const slot = windows.get(w) ?? { sum: 0, n: 0 };
        slot.sum += e;
        slot.n += 1;
        windows.set(w, slot);
      });
      for (const [w, slot] of windows) {
        if (w * WINDOW_MS < 50 * DT_MS) continue; // skip the EMA ramp-in
        expect(slot.sum).toBeCloseTo(slot.n * ref, 6);
      }
      totals.push(sum([...windows.values()].map((s) => s.sum)));
    }
    for (const t of totals) expect(t).toBeCloseTo(totals[0], 12);
  });

  it('the SAME physical rate produces the same output rate across firmware code classes', () => {
    // 60 counts/s arrives either as 60 msg/s of ±1 or 30 msg/s of ±2 (the
    // firmware packs counts at speed). Round 2 jumped ~3.4× at that
    // reclassification; now the two trains must land within a few percent.
    const asOnes = sum(run(new TickAccelerator(), 60, S, 1000 / 60));
    const asTwos = sum(run(new TickAccelerator(), 30, 2 * S, 1000 / 30));
    expect(asTwos / asOnes).toBeGreaterThan(0.9);
    expect(asTwos / asOnes).toBeLessThan(1.1);
  });

  it('the FIRST tick of ANY gesture starts at precision (no first-tick seed)', () => {
    // Round 4 deliberately does NOT seed gain from the first tick's magnitude:
    // profile step size is unknown to accel.ts, so a ±1 and a ±2 first tick are
    // indistinguishable without timing. Every gesture starts at rest; the flick
    // is read from the NEXT tick's short gap. A hard ±3 first tick therefore
    // still lands at its own precision value.
    const first = new TickAccelerator().applyTick(3 * S, 500);
    expect(first).toBeCloseTo(3 * S * ACCEL_GAIN_MIN, 10);
  });

  it('an idle gap resets to precision gain (a fresh gesture starts fine-grained)', () => {
    const acc = new TickAccelerator();
    run(acc, 30, 2 * S, 10); // fast spin — gain far above minimum
    const spun = acc.applyTick(2 * S, 30 * 10);
    expect(Math.abs(spun)).toBeGreaterThan(2 * S); // gain > 1 while spinning
    const afterPause = acc.applyTick(S, 30 * 10 + ACCEL_IDLE_RESET_MS + 1);
    expect(afterPause).toBeCloseTo(S * ACCEL_GAIN_MIN, 10); // reset to precise
  });

  it('a direction change resets to precision gain — no carried momentum', () => {
    const acc = new TickAccelerator();
    run(acc, 30, 2 * S, 10); // fast CW spin
    const firstReverse = acc.applyTick(-S, 305); // immediate CCW tick
    expect(firstReverse).toBeCloseTo(-S * ACCEL_GAIN_MIN, 10);
  });

  it('a symmetric out-and-back at speed nets EXACTLY zero (reversal cleanliness)', () => {
    // Forward and back are timing-identical mirror gestures: each starts with
    // the same seed and evolves through the same alphas, so term-by-term the
    // reverse ticks equal the negated forward ticks.
    const acc = new TickAccelerator();
    const fwd = run(acc, 20, S, 25, 0);
    const back = run(acc, 20, -S, 25, 20 * 25);
    expect(sum(fwd) + sum(back)).toBeCloseTo(0, 12);
  });

  it('two isolated detents out-and-back cancel exactly too', () => {
    const acc = new TickAccelerator();
    const a = acc.applyTick(S, 0);
    const b = acc.applyTick(-S, 1000);
    expect(a + b).toBeCloseTo(0, 12);
  });

  it('same-timestamp ticks (one MIDI batch) do not spike the rate estimate', () => {
    const acc = new TickAccelerator();
    const a = acc.applyTick(S, 100);
    const b = acc.applyTick(S, 100); // zero gap → alpha 0 → estimate unchanged
    expect(a).toBeCloseTo(S * ACCEL_GAIN_MIN, 10);
    expect(b).toBeCloseTo(S * ACCEL_GAIN_MIN, 10);
  });
});
