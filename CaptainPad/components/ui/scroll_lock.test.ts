// scroll_lock.test.ts — the NATIVE gesture armor's store.
//
// The store is deliberately pure TS (no `react-native` import) precisely so it
// can be tested for real here rather than only grepped: the one thing that
// MUST hold on a live iPad is that a lock always comes back. A leaked lock is
// a deck whose columns never scroll again until the app is restarted, which is
// a worse bug than the one the lock fixes.

import { describe, expect, it } from 'vitest';

import {
  acquireScrollLock,
  resolveFastPathScrollEnabled,
  scrollLockActive,
  scrollLockHolders,
  subscribeScrollLock,
} from './scroll_lock';

describe('scroll_lock — the lock itself', () => {
  it('starts idle', () => {
    expect(scrollLockActive()).toBe(false);
    expect(scrollLockHolders()).toBe(0);
  });

  it('a single acquire locks, and its release unlocks', () => {
    const held = acquireScrollLock();
    expect(scrollLockActive()).toBe(true);
    expect(scrollLockHolders()).toBe(1);
    held.release();
    expect(scrollLockActive()).toBe(false);
    expect(scrollLockHolders()).toBe(0);
  });

  it('stays locked until the LAST holder releases (two fingers, two controls)', () => {
    const a = acquireScrollLock();
    const b = acquireScrollLock();
    expect(scrollLockHolders()).toBe(2);
    a.release();
    // Still held — b has not let go, and a scroll view that unfroze here would
    // pan out from under b's finger.
    expect(scrollLockActive()).toBe(true);
    b.release();
    expect(scrollLockActive()).toBe(false);
  });

  it('a double release is inert — it cannot free somebody ELSE\'S lock', () => {
    // This is the release/terminate ordering the PanResponder actually
    // produces: a gesture can be terminated after it released, and unmount
    // calls release again on top of both.
    const a = acquireScrollLock();
    const b = acquireScrollLock();
    a.release();
    a.release();
    a.release();
    expect(scrollLockHolders()).toBe(1);
    expect(scrollLockActive()).toBe(true);
    b.release();
    expect(scrollLockHolders()).toBe(0);
  });

  it('never drives the holder count negative', () => {
    const a = acquireScrollLock();
    a.release();
    a.release();
    expect(scrollLockHolders()).toBe(0);
    // …and the store is still usable afterwards (a corrupted counter would
    // leave the next acquire unable to reach "active").
    const b = acquireScrollLock();
    expect(scrollLockActive()).toBe(true);
    b.release();
    expect(scrollLockActive()).toBe(false);
  });
});

describe('scroll_lock — subscription (what makes a host re-render)', () => {
  it('notifies on the idle→locked and locked→idle transitions', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeScrollLock(() => { seen.push(scrollLockActive()); });
    const held = acquireScrollLock();
    held.release();
    unsubscribe();
    expect(seen).toEqual([true, false]);
  });

  it('does not notify for a nested acquire/release (no needless host renders)', () => {
    const a = acquireScrollLock();
    let calls = 0;
    const unsubscribe = subscribeScrollLock(() => { calls += 1; });
    const b = acquireScrollLock();
    b.release();
    expect(calls).toBe(0);
    a.release();
    expect(calls).toBe(1);
    unsubscribe();
  });

  it('an unsubscribed listener stops hearing', () => {
    let calls = 0;
    const unsubscribe = subscribeScrollLock(() => { calls += 1; });
    unsubscribe();
    const held = acquireScrollLock();
    held.release();
    expect(calls).toBe(0);
  });

  it('survives a listener that unsubscribes itself DURING the notification', () => {
    // React's useSyncExternalStore can tear down a subscription from inside a
    // render triggered by the notification. Iterating the live Set would throw
    // or skip; the store copies first.
    const order: string[] = [];
    const unsubscribeSelf = subscribeScrollLock(() => {
      order.push('self');
      unsubscribeSelf();
    });
    const unsubscribeOther = subscribeScrollLock(() => { order.push('other'); });
    const held = acquireScrollLock();
    expect(order).toEqual(['self', 'other']);
    held.release();
    // Only 'other' is left to hear the unlock.
    expect(order).toEqual(['self', 'other', 'other']);
    unsubscribeOther();
  });
});

describe('resolveFastPathScrollEnabled — the setNativeProps fast path (docs/69 §3.2)', () => {
  // Locked always wins, regardless of what the caller asked for — a lock
  // held by ANY control must hard-disable scrolling, full stop.
  it('locked + callerProp true → false', () => {
    expect(resolveFastPathScrollEnabled(true, true)).toBe(false);
  });

  it('locked + callerProp false → false', () => {
    expect(resolveFastPathScrollEnabled(true, false)).toBe(false);
  });

  it('locked + callerProp undefined → false', () => {
    expect(resolveFastPathScrollEnabled(true, undefined)).toBe(false);
  });

  // Unlocked forwards the caller's own prop verbatim — EXCEPT undefined,
  // which `setNativeProps` cannot express as "unset", so it is coerced to
  // native's own default of `true`. This is the only coercion in the table.
  it('unlocked + callerProp true → true', () => {
    expect(resolveFastPathScrollEnabled(false, true)).toBe(true);
  });

  it('unlocked + callerProp false → false', () => {
    expect(resolveFastPathScrollEnabled(false, false)).toBe(false);
  });

  it('unlocked + callerProp undefined → true (the one coercion)', () => {
    expect(resolveFastPathScrollEnabled(false, undefined)).toBe(true);
  });
});

describe('scroll_lock — the release-safety net (the wedges a real gesture could hit)', () => {
  // Mirrors the EXACT idiom both HorizontalFader and hue_wheel use for their
  // own `scrollLockRef`: at most one handle live at a time, acquired only if
  // nothing is already held, released only if something is. This is the
  // guard the release-safety audit found is what stops a second GRANT from
  // overwriting a still-held handle and orphaning the first token forever —
  // see the matching source-text pin in native_gesture_armor.test.ts.
  function makeGestureLock() {
    let handle: ReturnType<typeof acquireScrollLock> | null = null;
    return {
      grant(): void { if (handle) return; handle = acquireScrollLock(); },
      release(): void { if (!handle) return; const h = handle; handle = null; h.release(); },
    };
  }

  it('the orphaned-handle scenario: acquiring twice and releasing only the SECOND leaves the store honestly still locked', () => {
    // This is the failure this whole file exists to catch. A caller whose ref
    // got overwritten by a second acquire before releasing the first could
    // only ever reach the second handle again — the first token has nobody
    // left accountable for it. The store's job is to report that truthfully,
    // not drift back to idle just because the caller's own bookkeeping lost
    // track of one token.
    const a = acquireScrollLock();
    const b = acquireScrollLock();
    b.release();
    expect(scrollLockHolders()).toBe(1);
    expect(scrollLockActive()).toBe(true);
    // Clean up so this doesn't leak into the next test.
    a.release();
    expect(scrollLockActive()).toBe(false);
  });

  it('a double-grant guarded the way the components guard it cannot orphan the first token', () => {
    const gesture = makeGestureLock();
    gesture.grant();
    gesture.grant(); // a hypothetical second GRANT before Release/Terminate
    expect(scrollLockHolders()).toBe(1);
    gesture.release();
    expect(scrollLockHolders()).toBe(0);
    expect(scrollLockActive()).toBe(false);
  });

  it('release after every listener has unsubscribed still balances the holder count', () => {
    // A scroll host can unmount (and unsubscribe) while a gesture is still
    // holding the lock elsewhere; the LATER release must still land cleanly
    // with nobody left to hear it.
    let calls = 0;
    const unsubscribe = subscribeScrollLock(() => { calls += 1; });
    const held = acquireScrollLock();
    unsubscribe();
    held.release();
    expect(calls).toBe(1); // only the acquire's idle→locked transition was heard
    expect(scrollLockHolders()).toBe(0);
    expect(scrollLockActive()).toBe(false);
  });

  it('interleaved acquire/release across multiple simulated gestures ends free', () => {
    // Dial grabs first, fader grabs while the dial is still down (two
    // fingers), dial lets go first, then the fader. Then a SECOND round with
    // the release order reversed, plus a simulated unmount-cleanup call
    // landing on top of an already-released gesture — exactly what
    // `unlockScroll`'s effect cleanup does after Release already fired.
    const dial = makeGestureLock();
    const fader = makeGestureLock();

    dial.grant();
    fader.grant();
    expect(scrollLockHolders()).toBe(2);
    dial.release();
    expect(scrollLockActive()).toBe(true);
    fader.release();
    expect(scrollLockActive()).toBe(false);

    fader.grant();
    dial.grant();
    fader.release();
    dial.release();
    dial.release(); // simulated unmount cleanup firing again after Release
    expect(scrollLockHolders()).toBe(0);
    expect(scrollLockActive()).toBe(false);
  });

  it('scrollLockActive() returns to false after every simulated gesture lifecycle', () => {
    // grant → move (no lock traffic) → release
    const a = makeGestureLock();
    a.grant();
    expect(scrollLockActive()).toBe(true);
    a.release();
    expect(scrollLockActive()).toBe(false);

    // grant → terminate → unmount-cleanup landing on top (must stay inert)
    const b = makeGestureLock();
    b.grant();
    expect(scrollLockActive()).toBe(true);
    b.release(); // terminate
    b.release(); // unmount cleanup, nothing held — must not throw or double-free
    expect(scrollLockActive()).toBe(false);
    expect(scrollLockHolders()).toBe(0);
  });
});
