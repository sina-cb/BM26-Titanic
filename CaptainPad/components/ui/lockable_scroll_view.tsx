/**
 * LockableScrollView — a drop-in `ScrollView` that a leaf drag control can
 * freeze for the duration of its gesture.
 *
 * WHY a scroll view has to be told at all, rather than the drag control simply
 * winning the responder negotiation: see the docblock in `scroll_lock.ts`. The
 * short version is that under the New Architecture a `UIScrollView` cannot see
 * a JS responder that lives INSIDE it, so `scrollEnabled={false}` is the only
 * lever left.
 *
 * IT IS OPT-IN, and that is the whole blast-radius story: `acquireScrollLock()`
 * is inert for every plain `ScrollView` in the app. Swapping this component in
 * is what enlists a scroll host, so the mixer's channel strips, the timeline
 * and the dimmer rack (which already carries its own `scrollEnabled` gate) are
 * untouched by the deck's dial.
 *
 * TWO PATHS, one authoritative and one a head start (docs/69 §3.2). The
 * operator's "tiny glitch at the very start": acquisition already happens in
 * the GRANT handler (touch-down), but PROPAGATION — acquire → notify →
 * `useSyncExternalStore` → React re-render → Fabric commit — is slow enough
 * that `UIScrollView`'s own pan recognizer, which starts after ~10pt of
 * travel, can begin before `scrollEnabled=false` lands. So:
 *
 *   - RENDER path (`scrollEnabled={locked ? false : scrollEnabled}` below) is
 *     the source of truth — untouched, byte-identical to the _263 pin.
 *   - FAST path is a `useEffect` that subscribes directly to the lock store
 *     and calls `setNativeProps` on the underlying native scroll view the
 *     instant a lock transition fires, bypassing React's render/commit cycle
 *     entirely. Fabric's `setNativeProps` on a host component is a real
 *     synchronous UI-thread update in this RN version, so the disable can
 *     land in the same frame as the grant, inside the pan slop.
 *
 * The fast path's guess (`resolveFastPathScrollEnabled` in `scroll_lock.ts`)
 * is reconciled by the very next render regardless, because the rendered
 * `scrollEnabled` value changes on every lock transition — so a fast-path
 * value that turns out to disagree with the caller's real prop is corrected
 * within one frame, never stuck.
 *
 * WEB IS BYTE-IDENTICAL. No caller acquires on web (they all gate on
 * `Platform.OS !== 'web'`), so `locked` is permanently false there and the
 * caller's own `scrollEnabled` — including `undefined`, which is not the same
 * prop as `true` for a host that never set it — is passed straight through by
 * the render path. The fast-path effect still subscribes on web (subscribing
 * is free), but its listener body is fully gated on `Platform.OS !== 'web'`,
 * so it never calls `setNativeProps` there — nothing ever acquires on web
 * anyway, so the listener would never fire in practice even without the gate.
 */
import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Platform, ScrollView, type ScrollViewProps } from 'react-native';

import {
  resolveFastPathScrollEnabled,
  scrollLockActive,
  subscribeScrollLock,
} from '@/components/ui/scroll_lock';

export const LockableScrollView = React.forwardRef<ScrollView, ScrollViewProps>(
  function LockableScrollView({ scrollEnabled, ...rest }, ref) {
    // Third argument (getServerSnapshot) matters for the web export's static
    // render, where no lock can be held — the same reader is correct there.
    const locked = useSyncExternalStore(subscribeScrollLock, scrollLockActive, scrollLockActive);

    const internalRef = useRef<ScrollView | null>(null);
    // The fast-path listener reads this every fire; it must NOT be a
    // subscription dependency (re-subscribing on every render of a fader's
    // parent would be needless churn), so a ref updated each render is the
    // way the listener sees the current caller prop without re-subscribing.
    const scrollEnabledRef = useRef(scrollEnabled);
    scrollEnabledRef.current = scrollEnabled;

    const setRef = useCallback(
      (instance: ScrollView | null) => {
        internalRef.current = instance;
        if (typeof ref === 'function') {
          ref(instance);
        } else if (ref) {
          ref.current = instance;
        }
      },
      [ref],
    );

    useEffect(() => {
      return subscribeScrollLock(() => {
        if (Platform.OS !== 'web') {
          internalRef.current?.getNativeScrollRef()?.setNativeProps({
            scrollEnabled: resolveFastPathScrollEnabled(scrollLockActive(), scrollEnabledRef.current),
          });
        }
      });
    }, []);

    return <ScrollView ref={setRef} scrollEnabled={locked ? false : scrollEnabled} {...rest} />;
  },
);
