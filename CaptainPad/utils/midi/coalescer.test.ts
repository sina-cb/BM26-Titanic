import { describe, it, expect } from 'vitest';
import { ControlCoalescer, CoalescerTimers } from './coalescer';

// Manual, deterministic timer fake. flushDue() fires every timer currently
// armed (clearing them first), so a callback that re-arms a timer adds a new
// one for the next flush — exactly the coalescer's trailing-window behaviour.
function makeFakeTimers() {
  let id = 0;
  const armed = new Map<number, () => void>();
  const timers: CoalescerTimers = {
    setTimeout: (cb: () => void) => {
      const h = ++id;
      armed.set(h, cb);
      return h as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (h) => { armed.delete(h as unknown as number); },
  };
  return {
    timers,
    pending: () => armed.size,
    flushDue() {
      const due = [...armed.entries()];
      armed.clear();
      for (const [, cb] of due) cb();
    },
  };
}

describe('ControlCoalescer', () => {
  it('fires the leading edge immediately', () => {
    const ft = makeFakeTimers();
    const out: number[] = [];
    const c = new ControlCoalescer<number>(33, (_id, v) => out.push(v), ft.timers);
    c.push('f1', 10);
    expect(out).toEqual([10]);
    expect(ft.pending()).toBe(1); // window armed
  });

  it('keeps only the latest value within a window, then flushes it', () => {
    const ft = makeFakeTimers();
    const out: number[] = [];
    const c = new ControlCoalescer<number>(33, (_id, v) => out.push(v), ft.timers);
    c.push('f1', 10); // leading → 10
    c.push('f1', 11); // pending
    c.push('f1', 12); // pending (latest)
    expect(out).toEqual([10]);
    ft.flushDue();    // trailing → 12, re-arms a window
    expect(out).toEqual([10, 12]);
    ft.flushDue();    // nothing pending → window closes
    expect(out).toEqual([10, 12]);
    expect(ft.pending()).toBe(0);
  });

  it('separates windows per control id', () => {
    const ft = makeFakeTimers();
    const out: Array<[string, number]> = [];
    const c = new ControlCoalescer<number>(33, (id, v) => out.push([id, v]), ft.timers);
    c.push('a', 1); // leading a
    c.push('b', 2); // leading b
    c.push('a', 3); // pending a
    expect(out).toEqual([['a', 1], ['b', 2]]);
    ft.flushDue();
    expect(out).toContainEqual(['a', 3]);
  });

  it('accumulate() sums deltas across a window and flushes the total once', () => {
    const ft = makeFakeTimers();
    const out: number[] = [];
    const c = new ControlCoalescer<number>(33, (_id, v) => out.push(v), ft.timers);
    const sum = (a: number, b: number) => a + b;
    // Unlike push(), accumulate does NOT fire a leading edge — it folds every
    // tick (so a delta lands on the value AT flush time, not double-applied).
    c.accumulate('k', 1, sum);
    c.accumulate('k', 2, sum);
    c.accumulate('k', 3, sum);
    expect(out).toEqual([]);       // nothing fired yet — all pending
    expect(ft.pending()).toBe(1);  // one window armed
    ft.flushDue();
    expect(out).toEqual([6]);      // 1+2+3 flushed as one
  });

  it('accumulate() flushes a lone tick on the first window', () => {
    const ft = makeFakeTimers();
    const out: number[] = [];
    const c = new ControlCoalescer<number>(33, (_id, v) => out.push(v), ft.timers);
    c.accumulate('k', 5, (a, b) => a + b);
    ft.flushDue();
    expect(out).toEqual([5]);
    ft.flushDue(); // nothing pending → window closes
    expect(out).toEqual([5]);
    expect(ft.pending()).toBe(0);
  });

  it('accumulate() keeps separate windows per control id', () => {
    const ft = makeFakeTimers();
    const out: Array<[string, number]> = [];
    const c = new ControlCoalescer<number>(33, (id, v) => out.push([id, v]), ft.timers);
    const sum = (a: number, b: number) => a + b;
    c.accumulate('a', 1, sum);
    c.accumulate('b', 10, sum);
    c.accumulate('a', 2, sum);
    ft.flushDue();
    expect(out).toContainEqual(['a', 3]);
    expect(out).toContainEqual(['b', 10]);
  });

  it('dispose() cancels armed timers', () => {
    const ft = makeFakeTimers();
    const c = new ControlCoalescer<number>(33, () => {}, ft.timers);
    c.push('a', 1);
    expect(ft.pending()).toBe(1);
    c.dispose();
    expect(ft.pending()).toBe(0);
  });

  // ── #7 cancel(controlId): drop a single pending slot without flushing it ──
  it('cancel() drops a control\'s pending value + timer without flushing it', () => {
    const ft = makeFakeTimers();
    const out: number[] = [];
    const c = new ControlCoalescer<number>(33, (_id, v) => out.push(v), ft.timers);
    const sum = (a: number, b: number) => a + b;
    c.accumulate('k', 5, sum); // pending, window armed
    expect(ft.pending()).toBe(1);
    c.cancel('k');             // drop the pending slot
    expect(ft.pending()).toBe(0);
    ft.flushDue();             // nothing to flush
    expect(out).toEqual([]);
  });

  it('cancel() on an idle/absent control is a no-op', () => {
    const ft = makeFakeTimers();
    const c = new ControlCoalescer<number>(33, () => {}, ft.timers);
    expect(() => c.cancel('nope')).not.toThrow();
    expect(ft.pending()).toBe(0);
  });

  it('cancel() leaves OTHER controls\' pending values intact', () => {
    const ft = makeFakeTimers();
    const out: Array<[string, number]> = [];
    const c = new ControlCoalescer<number>(33, (id, v) => out.push([id, v]), ft.timers);
    const sum = (a: number, b: number) => a + b;
    c.accumulate('a', 1, sum);
    c.accumulate('b', 2, sum);
    c.cancel('a');
    ft.flushDue();
    expect(out).toEqual([['b', 2]]); // a dropped, b flushed
  });

  // ── N5 dispose() FLUSHES pending trailing values (contract: never dropped) ──
  it('N5 dispose() flushes pending trailing values instead of dropping them', () => {
    const ft = makeFakeTimers();
    const out: Array<[string, number]> = [];
    const c = new ControlCoalescer<number>(33, (id, v) => out.push([id, v]), ft.timers);
    c.push('a', 1);        // leading flush → 1, window armed with no pending yet
    c.push('a', 2);        // pending 2 (the final resting position)
    c.accumulate('b', 9, (x, y) => x + y); // pending 9
    expect(out).toEqual([['a', 1]]);
    c.dispose();           // must FLUSH the pending 2 and 9, not drop them
    expect(out).toContainEqual(['a', 2]);
    expect(out).toContainEqual(['b', 9]);
    expect(ft.pending()).toBe(0); // no leaked timers
  });

  it('N5 dispose() does not re-arm timers when a flush callback re-enters push', () => {
    const ft = makeFakeTimers();
    const out: number[] = [];
    let c!: ControlCoalescer<number>;
    c = new ControlCoalescer<number>(33, (_id, v) => {
      out.push(v);
      if (v === 1) c.push('re', 99); // re-enter during the dispose flush
    }, ft.timers);
    c.push('x', 0); // leading → 0
    c.push('x', 1); // pending 1 → triggers re-entry on dispose flush
    c.dispose();
    // The re-entrant push fired a leading flush (99), but no timer must survive.
    expect(out).toContain(1);
    expect(ft.pending()).toBe(0);
  });
});
