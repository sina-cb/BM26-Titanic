/**
 * scroll_lock — the NATIVE half of the deck's gesture armor.
 *
 * ── WHY THIS EXISTS (the _211 armor is a no-op on the iPad) ────────────────
 *
 * Every drag control on the deck (the COLORS hue dial, HorizontalFader, the
 * playlist split divider) claims its gesture the React way: set the responder
 * on start AND move, CAPTURE ahead of every ancestor, and refuse the
 * ScrollView's termination request. On WEB that is the whole story, because
 * `touchAction:'none'` also stops the browser panning a scrollable ancestor.
 *
 * On NATIVE iOS it buys us nothing against a ScrollView, and the reason is in
 * React Native's own source rather than in ours. A `ScrollView` is a real
 * `UIScrollView`; its pan gesture recognizer lives entirely OUTSIDE React's JS
 * responder system, so no amount of capturing or termination-refusal in JS is
 * even visible to it. React Native's only bridge between the two is
 * `blockNativeResponder`, and under the New Architecture (this app:
 * `newArchEnabled: true`, RN 0.81, Expo 54) that bridge is severed at both
 * ends:
 *
 *   - `RCTMountingManager setIsJSResponder:blockNativeResponder:forShadowView:`
 *     receives `blockNativeResponder` and DROPS it — it forwards only
 *     `[componentView setIsJSResponder:]`.
 *   - `RCTScrollViewComponentView touchesShouldCancelInContentView:` answers
 *     from `_shouldDisableScrollInteraction`, which walks `self.superview`
 *     UPWARD looking for a JS responder. Our dial is a DESCENDANT of the
 *     scroll view, so it is never on that path: the check returns NO, the
 *     scroll view cancels the touches in its content view, and the pane pans
 *     while the drag it stole dies as a responder TERMINATE.
 *
 * (The old architecture is no better — `RCTUIManager setJSResponder:` declares
 * the flag `__unused`.) `dimmer_rack.tsx` already learned this the hard way and
 * gates its fader row with `scrollEnabled={!faderDragging}`; this module is
 * that same remedy, generalised so a control deep inside a window can reach the
 * scroll view that owns it without every layer in between having to pass a prop.
 *
 * ── THE SHAPE ─────────────────────────────────────────────────────────────
 *
 * A module-level store, deliberately NOT a React context: a context would need
 * a provider wrapped around the deck screen, and the components that must
 * cooperate (a dial in `components/deck/`, a scroll host in `app/(tabs)/`) have
 * no common ancestor worth threading. A gesture ACQUIRES a lock on grant and
 * RELEASES it on release/terminate; `LockableScrollView` (its .tsx sibling)
 * subscribes and hard-disables scrolling while any lock is held.
 *
 * BALANCE BY CONSTRUCTION. `acquireScrollLock()` hands back a handle whose
 * `release()` is idempotent because it deletes a unique token from a Set —
 * a double release is a `Set.delete` that returns false, not a counter driven
 * negative. There is no "if depth > 0" guard anywhere, because there is no
 * state a caller could corrupt: this is not a fallback, it is an API that
 * cannot be unbalanced.
 *
 * PLATFORM GATING LIVES AT THE CALL SITES, not here. This module is pure TS
 * with no `react-native` import (so the vitest `components/**\/*.test.ts` glob
 * can load it), and every caller wraps its acquire in `Platform.OS !== 'web'`.
 * Nothing on web ever acquires, so `scrollLockActive()` is permanently false
 * there and `LockableScrollView` passes `scrollEnabled` through untouched —
 * the working web armor is not disturbed by one byte.
 */

/** A held lock. `release()` is safe to call any number of times. */
export interface ScrollLockHandle {
  release(): void;
}

/** One token per live hold. A Set, not a counter, so release is idempotent. */
const holders = new Set<symbol>();
const listeners = new Set<() => void>();

function notify(): void {
  // Copy before iterating: a listener that unsubscribes during notification
  // would otherwise mutate the Set mid-iteration.
  for (const listener of Array.from(listeners)) listener();
}

/**
 * Take a scroll lock. While ANY lock is held every `LockableScrollView` in the
 * tree renders with `scrollEnabled={false}`.
 *
 * Call this from a gesture's GRANT handler — the touch-down, not the first
 * move. `UIScrollView` decides whether to cancel the content view's touches as
 * soon as the finger has travelled its slop distance, so the prop has to be on
 * its way to the main queue before the operator has moved a hair.
 */
export function acquireScrollLock(): ScrollLockHandle {
  const token = Symbol('scroll-lock');
  holders.add(token);
  if (holders.size === 1) notify();
  return {
    release(): void {
      // `delete` returns false on a token already gone, so a second release
      // (terminate arriving after release, an unmount after both) is inert.
      if (holders.delete(token) && holders.size === 0) notify();
    },
  };
}

/** Is any lock held? The `getSnapshot` for `useSyncExternalStore` — a boolean,
 *  so React's Object.is bail-out keeps a re-lock from re-rendering hosts. */
export function scrollLockActive(): boolean {
  return holders.size > 0;
}

/** How many locks are held. Diagnostics + tests only; hosts read the boolean. */
export function scrollLockHolders(): number {
  return holders.size;
}

/** Subscribe to lock/unlock transitions. Returns the unsubscribe. */
export function subscribeScrollLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Resolve the `scrollEnabled` value for the FAST PATH — the imperative
 * `setNativeProps` call a scroll host's lock listener fires synchronously on
 * acquire/release, ahead of the React re-render that would otherwise be the
 * only way the prop reaches the native `UIScrollView`.
 *
 * `locked === true` always wins: `false`, full stop.
 *
 * `locked === false` cannot simply forward `callerProp`, because
 * `setNativeProps` has no way to express "unset this prop" — passing
 * `undefined` through it does not restore native's own default the way an
 * `undefined` React prop does. So on UNLOCK, a host that never passed
 * `scrollEnabled` (`callerProp === undefined`) must be nudged back to
 * `true`, which is exactly what native defaults to when the prop is absent.
 *
 * This coercion is deliberately confined to the fast path. The RENDER path
 * (`scrollEnabled={locked ? false : scrollEnabled}` in
 * `lockable_scroll_view.tsx`) still passes `undefined` through verbatim —
 * that ternary is the _263 pin and stays byte-identical. The very next
 * render after any lock transition reconverges the two paths anyway, because
 * the rendered `scrollEnabled` value changes (`false` vs `scrollEnabled`) on
 * every lock/unlock, so React re-renders and re-applies the authoritative
 * value on top of whatever the fast path guessed.
 */
export function resolveFastPathScrollEnabled(locked: boolean, callerProp: boolean | undefined): boolean {
  if (locked) return false;
  return callerProp ?? true;
}
