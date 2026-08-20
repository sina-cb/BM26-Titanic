import { describe, expect, it } from 'vitest';

import {
  PAINT_BUDGET_MS,
  PixelPaintScheduler,
  createPixelPaintClock,
  isReactNativePixelPaintRuntime,
  resetSharedPixelPaintScheduler,
  sharedPixelPaintScheduler,
  type PaintClock,
} from './pixel_paint_scheduler';

/** A deterministic clock + frame pump. `tick()` runs exactly one scheduled
 *  animation frame; `costMs` is how much wall time each paint is pretended to
 *  consume, so the budget cutoff is testable without a real canvas. */
function fakeClock() {
  let t = 0;
  const frames: (() => void)[] = [];
  const clock: PaintClock = {
    now: () => t,
    schedule: (cb) => { frames.push(cb); },
  };
  return {
    clock,
    advance: (ms: number) => { t += ms; },
    get pendingFrames() { return frames.length; },
    tick(): boolean {
      const cb = frames.shift();
      if (!cb) return false;
      cb();
      return true;
    },
  };
}

/** A subscriber that records its paints and burns `costMs` of the fake clock. */
function painter(name: string, log: string[], harness: ReturnType<typeof fakeClock>, costMs = 0) {
  let visible = true;
  return {
    setVisible: (v: boolean) => { visible = v; },
    sub: {
      paint: () => { log.push(name); harness.advance(costMs); },
      isVisible: () => visible,
    },
  };
}

describe('PixelPaintScheduler', () => {
  it('paints on the next frame, never inline with the request', () => {
    const h = fakeClock();
    const s = new PixelPaintScheduler(h.clock);
    const log: string[] = [];
    const a = painter('a', log, h);

    const handle = s.subscribe(a.sub);
    handle.request();
    expect(log).toEqual([]);       // the vis callback did NOT paint
    expect(h.pendingFrames).toBe(1);

    h.tick();
    expect(log).toEqual(['a']);
  });

  it('collapses repeated requests into ONE paint (latest-buffer-wins)', () => {
    const h = fakeClock();
    const s = new PixelPaintScheduler(h.clock);
    const log: string[] = [];
    const a = painter('a', log, h);

    const handle = s.subscribe(a.sub);
    handle.request();
    handle.request();
    handle.request();
    // Three vis frames before the animation frame ran = one debt, one paint.
    expect(h.pendingFrames).toBe(1);
    h.tick();
    expect(log).toEqual(['a']);
    expect(s.pendingCount()).toBe(0);
  });

  it('stops at the budget and carries the rest to the next frame', () => {
    const h = fakeClock();
    const s = new PixelPaintScheduler(h.clock);
    const log: string[] = [];
    // 3 ms each: three paints (9 ms) crosses the 8 ms budget, so the drain
    // yields after the third and the remaining canvases ride later frames.
    const handles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((n) => {
      const p = painter(n, log, h, 3);
      const handle = s.subscribe(p.sub);
      handle.request();
      return handle;
    });
    expect(handles).toHaveLength(9);

    h.tick();
    expect(log).toEqual(['a', 'b', 'c']);
    expect(s.getStats().deferrals).toBe(1);
    expect(s.getStats().lastCarryOver).toBe(6);
    expect(s.getStats().lastDrainMs).toBe(9);

    h.tick();
    expect(log).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    h.tick();
    expect(log).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    // Nine 3 ms canvases spread over exactly three animation frames.
    expect(s.getStats().drains).toBe(3);
    expect(h.pendingFrames).toBe(0);
  });

  it('always paints at least one canvas even when it alone blows the budget', () => {
    const h = fakeClock();
    const s = new PixelPaintScheduler(h.clock);
    const log: string[] = [];
    const slow = painter('slow', log, h, 40);
    const next = painter('next', log, h, 1);
    s.subscribe(slow.sub).request();
    s.subscribe(next.sub).request();

    h.tick();
    expect(log).toEqual(['slow']);   // budget checked AFTER the paint
    h.tick();
    expect(log).toEqual(['slow', 'next']);
  });

  it('is round-robin fair: a canvas that just painted goes behind the waiting ones', () => {
    const h = fakeClock();
    const s = new PixelPaintScheduler(h.clock);
    const log: string[] = [];
    const a = painter('a', log, h, 5);
    const b = painter('b', log, h, 5);
    const c = painter('c', log, h, 5);
    const ha = s.subscribe(a.sub);
    const hb = s.subscribe(b.sub);
    const hc = s.subscribe(c.sub);

    ha.request(); hb.request(); hc.request();
    h.tick();
    // 5 + 5 = 10 ms ⇒ budget hit after b; c is carried over.
    expect(log).toEqual(['a', 'b']);
    // A new vis frame arrives for a and b BEFORE c has had its turn. They
    // queue behind c, so c is not starved.
    ha.request(); hb.request();
    h.tick();
    expect(log).toEqual(['a', 'b', 'c', 'a']);
  });

  it('skips invisible subscribers at drain time, for free', () => {
    const h = fakeClock();
    const s = new PixelPaintScheduler(h.clock);
    const log: string[] = [];
    const a = painter('a', log, h, 3);
    const b = painter('b', log, h, 3);
    const ha = s.subscribe(a.sub);
    s.subscribe(b.sub).request();
    ha.request();

    // The band collapsed / scrolled off AFTER its frame arrived but BEFORE
    // its turn came up — it must cost nothing.
    a.setVisible(false);
    h.tick();
    expect(log).toEqual(['b']);
    expect(s.getStats().skipped).toBe(1);
    expect(s.getStats().lastDrainMs).toBe(3);
  });

  it('drops a released subscriber, pending turn and all', () => {
    const h = fakeClock();
    const s = new PixelPaintScheduler(h.clock);
    const log: string[] = [];
    const a = painter('a', log, h);
    const b = painter('b', log, h);
    const ha = s.subscribe(a.sub);
    const hb = s.subscribe(b.sub);
    ha.request();
    hb.request();

    ha.release();
    h.tick();
    expect(log).toEqual(['b']);

    // A request after release is inert (an unmounted band's in-flight vis
    // callback must not resurrect it).
    ha.request();
    expect(h.pendingFrames).toBe(0);
    expect(s.pendingCount()).toBe(0);
  });

  it('measures its own duty so the budget can be proven, not asserted', () => {
    const h = fakeClock();
    const s = new PixelPaintScheduler(h.clock);
    const log: string[] = [];
    // The design's numbers: 3 bands at ~2.2 ms, then 9.
    for (let i = 0; i < 3; i += 1) s.subscribe(painter(`c${i}`, log, h, 2.2).sub).request();
    h.tick();
    expect(s.getStats().lastDrainMs).toBeCloseTo(6.6, 5);
    expect(s.getStats().deferrals).toBe(0);

    s.resetStats();
    for (let i = 0; i < 9; i += 1) s.subscribe(painter(`d${i}`, log, h, 2.2).sub).request();
    h.tick();
    expect(s.getStats().lastDrainMs).toBeLessThanOrEqual(PAINT_BUDGET_MS + 2.2);
    expect(s.getStats().deferrals).toBe(1);
  });

  it('refuses a non-positive budget', () => {
    const h = fakeClock();
    expect(() => new PixelPaintScheduler(h.clock, 0)).toThrow(/budgetMs must be positive/);
  });

  it('refuses to build a shared scheduler without the browser primitives', () => {
    resetSharedPixelPaintScheduler();
    const g = globalThis as { requestAnimationFrame?: unknown };
    const had = 'requestAnimationFrame' in g;
    const prev = g.requestAnimationFrame;
    delete g.requestAnimationFrame;
    try {
      expect(() => sharedPixelPaintScheduler()).toThrow(/no requestAnimationFrame/);
    } finally {
      if (had) g.requestAnimationFrame = prev;
      resetSharedPixelPaintScheduler();
    }
  });

  it('uses a next-JS-turn clock on React Native instead of waiting for rAF', () => {
    const turns: (() => void)[] = [];
    const runtime = {
      navigator: { product: 'ReactNative' },
      performance: { now: () => 42 },
      requestAnimationFrame: () => { throw new Error('native must not touch rAF'); },
      setImmediate: (cb: () => void) => { turns.push(cb); },
    };
    expect(isReactNativePixelPaintRuntime(runtime)).toBe(true);
    const clock = createPixelPaintClock(runtime);
    let painted = false;
    clock.schedule(() => { painted = true; });
    expect(painted).toBe(false);
    expect(turns).toHaveLength(1);
    turns.shift()?.();
    expect(painted).toBe(true);
    expect(clock.now()).toBe(42);
  });

  it('keeps requestAnimationFrame as the browser paint clock', () => {
    const frames: (() => void)[] = [];
    const runtime = {
      navigator: { product: 'Gecko' },
      performance: { now: () => 7 },
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        frames.push(() => cb(0));
        return 1;
      },
      setImmediate: () => { throw new Error('web must not touch setImmediate'); },
    };
    expect(isReactNativePixelPaintRuntime(runtime)).toBe(false);
    const clock = createPixelPaintClock(runtime);
    let painted = false;
    clock.schedule(() => { painted = true; });
    expect(frames).toHaveLength(1);
    frames.shift()?.();
    expect(painted).toBe(true);
    expect(clock.now()).toBe(7);
  });

  it('fails loudly when React Native lacks its required next-turn clock', () => {
    expect(() => createPixelPaintClock({
      navigator: { product: 'ReactNative' },
      performance: { now: () => 0 },
    })).toThrow(/React Native has no setImmediate/);
  });

  it('hands every caller the SAME shared instance', () => {
    resetSharedPixelPaintScheduler();
    const g = globalThis as {
      requestAnimationFrame?: (cb: (t: number) => void) => number;
      performance?: { now?: () => number };
    };
    const hadRaf = 'requestAnimationFrame' in g;
    const prevRaf = g.requestAnimationFrame;
    g.requestAnimationFrame = (cb) => { void cb; return 1; };
    try {
      expect(sharedPixelPaintScheduler()).toBe(sharedPixelPaintScheduler());
    } finally {
      if (hadRaf) g.requestAnimationFrame = prevRaf;
      else delete g.requestAnimationFrame;
      resetSharedPixelPaintScheduler();
    }
  });
});
