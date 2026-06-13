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

  it('dispose() cancels armed timers', () => {
    const ft = makeFakeTimers();
    const c = new ControlCoalescer<number>(33, () => {}, ft.timers);
    c.push('a', 1);
    expect(ft.pending()).toBe(1);
    c.dispose();
    expect(ft.pending()).toBe(0);
  });
});
