import React, { useCallback, useRef, useEffect } from 'react';
import { View, Animated, PanResponder, Platform } from 'react-native';

import { acquireScrollLock, type ScrollLockHandle } from '@/components/ui/scroll_lock';

export const HorizontalFader = ({ value, onChange, onRelease, trackStyle, fillStyle, thumbStyle, onDragStart, fadingTarget, fadingDurationMs }: any) => {
  const widthRef = useRef(1);
  const animVal = useRef(new Animated.Value(value)).current;
  const draggingRef = useRef(false);
  const startValRef = useRef(value);
  const lastSendRef = useRef(0);
  // Latest fade duration, read inside the fade effect WITHOUT re-keying it on
  // every broadcast (remainingMs ticks each push — keying on it would restart
  // the timing animation ~10×/s and stutter the bar).
  const fadingDurationRef = useRef(fadingDurationMs);
  fadingDurationRef.current = fadingDurationMs;
  // The PanResponder is built ONCE (useRef) so its gesture handlers capture the
  // FIRST-render onChange/onDragStart/onRelease forever. Reading them through
  // refs that we refresh every render fixes a stale-closure data-loss bug: a
  // caller whose onChange closes over other state (e.g. the cue editor's
  // `setAction({ ...pl, hue })`, or ColorPickerModal's `liveWrite(v, h2)`) would
  // otherwise write a stale snapshot on drag, silently reverting edits made
  // since the fader mounted. Keep the latest callbacks live here.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;

  // Sync from external when not dragging — but NOT while a timed fade is in
  // flight: during a fade the value arrives as coarse, broadcast-rate steps,
  // and snapping animVal to each one is exactly why the master slider "didn't
  // animate" on TO BLACK / UP. While fading we let the timing effect below own
  // animVal; when the fade ends (fadingTarget back to null) we settle on the
  // latest external value here.
  useEffect(() => {
    if (draggingRef.current) return;
    if (fadingTarget == null) animVal.setValue(value);
  }, [value, fadingTarget]);

  // Smooth timed fade: animate animVal toward the fade target (0 = TO BLACK,
  // 1 = UP) over the fade's duration. Re-keyed ONLY on the target so per-
  // broadcast remainingMs updates don't restart the animation. Non-master
  // faders never pass fadingTarget, so this is inert for them.
  useEffect(() => {
    if (draggingRef.current || fadingTarget == null) return;
    const duration = fadingDurationRef.current;
    if (!(typeof duration === 'number' && duration > 0)) {
      animVal.setValue(fadingTarget);
      return;
    }
    const anim = Animated.timing(animVal, {
      toValue: fadingTarget,
      duration,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
    // animVal is a stable ref value; fadingDurationRef is read live by design
    // (see fadingDurationRef above) — re-key ONLY on the target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fadingTarget]);

  const clamp01 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;

  // ── NATIVE SCROLL LOCK (the iPad half of the capture armor below) ────────
  // The capture handlers + termination refusal are React responder-system
  // moves, and a native `ScrollView` is a `UIScrollView` whose pan recognizer
  // never consults that system: under the New Architecture RN drops
  // `blockNativeResponder`, and the scroll view's own cancel decision only
  // looks for a JS responder among its ANCESTORS. So on the iPad a fader drag
  // inside a scroll column scrolled the column and lost the drag. Freezing the
  // owning scroll view for the life of the gesture is the remedy — the same
  // one `dimmer_rack.tsx` hand-wires for its fader row. Full citation:
  // `components/ui/scroll_lock.ts`.
  //
  // It is OPT-IN on the host side: only a `LockableScrollView` listens, so
  // every plain ScrollView in the app (mixer strips, timeline, the dimmer
  // rack's own already-gated row) behaves exactly as it did.
  const scrollLockRef = useRef<ScrollLockHandle | null>(null);
  const lockScroll = useCallback(() => {
    // WEB IS UNTOUCHED: the browser armor already works there.
    if (Platform.OS === 'web') return;
    if (scrollLockRef.current) return;
    scrollLockRef.current = acquireScrollLock();
  }, []);
  const unlockScroll = useCallback(() => {
    const held = scrollLockRef.current;
    if (!held) return;
    scrollLockRef.current = null;
    held.release();
  }, []);
  // A fader unmounted mid-drag (modal dismissed, row re-keyed, tab teardown)
  // fires neither Release nor Terminate. Without this the host stays frozen.
  useEffect(() => unlockScroll, [unlockScroll]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // CAPTURE the gesture before any ancestor (e.g. a horizontal ScrollView
      // around the mixer channel strips) can claim it. Without this, dragging a
      // fader inside a scrollable row scrolled the row instead of moving the
      // fader. The fader is a leaf interactive control, so it should always own
      // a drag that starts on it; the ScrollView still scrolls on touches that
      // begin OUTSIDE any fader (headers, gaps).
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        // FIRST, on touch-down: the scroll view decides whether to cancel the
        // content view's touches within a few points of travel.
        lockScroll();
        draggingRef.current = true;
        if (onDragStartRef.current) onDragStartRef.current();
        const v = clamp01(evt.nativeEvent.locationX / widthRef.current);
        startValRef.current = v;
        animVal.setValue(v);
        onChangeRef.current(v);
      },
      onPanResponderMove: (_evt, gs) => {
        const nv = clamp01(startValRef.current + gs.dx / widthRef.current);
        animVal.setValue(nv);
        const now = Date.now();
        if (now - lastSendRef.current > 50) { lastSendRef.current = now; onChangeRef.current(nv); }
      },
      onPanResponderRelease: (_evt, gs) => {
        unlockScroll();
        const nv = clamp01(startValRef.current + gs.dx / widthRef.current);
        draggingRef.current = false;
        onChangeRef.current(nv);
        if (onReleaseRef.current) onReleaseRef.current();
      },
      // A cancelled gesture (browser pointercancel, focus loss) never fires
      // Release — mirror it so draggingRef and the caller's drag-guard clear,
      // otherwise external value-sync freezes and a modal's backdrop-dismiss
      // guard sticks on forever.
      onPanResponderTerminate: (_evt, gs) => {
        unlockScroll();
        const nv = clamp01(startValRef.current + gs.dx / widthRef.current);
        draggingRef.current = false;
        onChangeRef.current(nv);
        if (onReleaseRef.current) onReleaseRef.current();
      }
    })
  ).current;

  const fillWidth = animVal.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    // trackStyle stays on the measured/touchable ROOT so its flex/width
    // actually applies (an inner-only trackStyle collapsed the drag area —
    // faders stopped responding). overflow:'visible' (not hidden) lets the
    // thumb overhang the track ends at 0/100 without being sliced; the fill
    // keeps its own borderRadius so it still reads rounded.
    <View
      style={[trackStyle, { overflow: 'visible' }]}
      onLayout={e => { widthRef.current = Math.max(1, e.nativeEvent.layout.width); }}
      {...panResponder.panHandlers}
    >
      <Animated.View style={[fillStyle, { width: fillWidth }]} />
      {thumbStyle && (
        <Animated.View style={[thumbStyle, { position: 'absolute', left: fillWidth }]} />
      )}
    </View>
  );
};
