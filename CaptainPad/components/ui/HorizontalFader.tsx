import React, { useRef, useEffect } from 'react';
import { View, Animated, PanResponder } from 'react-native';

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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        draggingRef.current = true;
        if (onDragStart) onDragStart();
        const v = clamp01(evt.nativeEvent.locationX / widthRef.current);
        startValRef.current = v;
        animVal.setValue(v);
        onChange(v);
      },
      onPanResponderMove: (_evt, gs) => {
        const nv = clamp01(startValRef.current + gs.dx / widthRef.current);
        animVal.setValue(nv);
        const now = Date.now();
        if (now - lastSendRef.current > 50) { lastSendRef.current = now; onChange(nv); }
      },
      onPanResponderRelease: (_evt, gs) => {
        const nv = clamp01(startValRef.current + gs.dx / widthRef.current);
        draggingRef.current = false;
        onChange(nv);
        if (onRelease) onRelease();
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
