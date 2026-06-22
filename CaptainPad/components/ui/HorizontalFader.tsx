import React, { useRef, useEffect } from 'react';
import { View, Animated, PanResponder } from 'react-native';

export const HorizontalFader = ({ value, onChange, onRelease, trackStyle, fillStyle, thumbStyle, onDragStart }: any) => {
  const widthRef = useRef(1);
  const animVal = useRef(new Animated.Value(value)).current;
  const draggingRef = useRef(false);
  const startValRef = useRef(value);
  const lastSendRef = useRef(0);

  // Sync from external when not dragging
  useEffect(() => {
    if (!draggingRef.current) animVal.setValue(value);
  }, [value]);

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
    // Outer wrapper sizes to the track and does NOT clip — so a thumb that
    // overhangs the track ends (the normal slider look at 0/100) stays whole
    // instead of being sliced in half. The FILL keeps its own overflow:hidden
    // layer so it still clips to the rounded track; only the thumb escapes the
    // clip (fader-thumb clipping bug, QA round 11).
    <View
      style={{ position: 'relative', justifyContent: 'center' }}
      onLayout={e => { widthRef.current = Math.max(1, e.nativeEvent.layout.width); }}
      {...panResponder.panHandlers}
    >
      <View style={[trackStyle, { overflow: 'hidden' }]}>
        <Animated.View style={[fillStyle, { width: fillWidth }]} />
      </View>
      {thumbStyle && (
        <Animated.View style={[thumbStyle, { position: 'absolute', left: fillWidth }]} />
      )}
    </View>
  );
};
