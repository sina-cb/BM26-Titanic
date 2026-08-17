/**
 * PixelSurface (NATIVE) — the iPad's real pixel-map drawing surface.
 *
 * The web peer renders a raw `<canvas>` and paints it with a 2D context. Here
 * the same `paintPixelView` pass order records an `SkPicture` through the Skia
 * paint target, and the finished picture is handed to a Reanimated shared value
 * that RN Skia redraws from on the render thread (report _252, docs/60 §3.3).
 *
 * ── ZERO REACT COMMITS PER VIS FRAME ────────────────────────────────────────
 *
 * `picture` is a shared value, not state. A vis frame therefore travels
 * subscriber-ref → paint scheduler → recorder → `picture.value = …` and never
 * touches the React tree. This component re-renders only when its screen's
 * focus changes — which is the one thing here that IS React state, because a
 * band that lost focus must stop costing anything.
 *
 * ── WHY THE PAINTS AND THE RECORDER LIVE HERE ───────────────────────────────
 *
 * This is the ONLY file in the pixel-view stack that imports Skia. The adapter
 * (`pixel_paint_target_skia.ts`) takes its factories by injection so it stays
 * plain TypeScript and node-testable; the two `SkPaint`s are built ONCE here
 * and reused for every glyph of every frame.
 */
import { useIsFocused } from '@react-navigation/native';
import {
  BlendMode,
  Canvas,
  Picture,
  Skia,
  type SkPicture,
} from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { createSkiaPaintTarget } from '@/components/deck/pixel_paint_target_skia';
import type { PixelPaintTarget } from '@/components/deck/pixel_view_paint';

export interface PixelSurfaceProps {
  /** The paint target for this surface, or null when it goes away. Called on
   *  mount/unmount only — never per frame. */
  onTarget: (target: PixelPaintTarget | null) => void;
  /** The surface changed size and owes a repaint. */
  onResize?: () => void;
  /** The surface's screen gained or lost focus. The mixer is a single
   *  non-virtualized page, so a focused, expanded band counts as on screen;
   *  the scheduler's 8 ms budget is what bounds the cost of that simplification
   *  (docs/60 §3.4). */
  onVisibility?: (onScreen: boolean) => void;
}

/** An `SkPicture` that draws nothing, so the shared value is never null and
 *  `<Picture>` keeps its non-nullable prop type. */
function emptyPicture(): SkPicture {
  const recorder = Skia.PictureRecorder();
  recorder.beginRecording({ x: 0, y: 0, width: 0, height: 0 });
  return recorder.finishRecordingAsPicture();
}

export function PixelSurface({ onTarget, onResize, onVisibility }: PixelSurfaceProps) {
  const initialPicture = useMemo(emptyPicture, []);
  const picture = useSharedValue<SkPicture>(initialPicture);
  const sizeRef = useRef({ w: 0, h: 0 });
  const isFocused = useIsFocused();

  /* Read through a ref so a consumer that rebuilds its callbacks each render
     never rebuilds the target — the paints behind it are meant to outlive
     every render this surface will ever do. */
  const callbacksRef = useRef({ onTarget, onResize, onVisibility });
  callbacksRef.current = { onTarget, onResize, onVisibility };

  const target = useMemo<PixelPaintTarget>(() => {
    const haloPaint = Skia.Paint();
    haloPaint.setAntiAlias(true);
    // The additive halo pass: overlapping strands bloom into each other the way
    // real LEDs do, exactly as `globalCompositeOperation = 'lighter'` does on
    // the web.
    haloPaint.setBlendMode(BlendMode.Plus);
    const corePaint = Skia.Paint();
    corePaint.setAntiAlias(true);
    corePaint.setBlendMode(BlendMode.SrcOver);

    return createSkiaPaintTarget<SkPicture>({
      createRecorder: () => Skia.PictureRecorder(),
      haloPaint,
      corePaint,
      getSize: () => sizeRef.current,
      onPicture: (next) => { picture.value = next; },
    });
  }, [picture]);

  useEffect(() => {
    callbacksRef.current.onTarget(target);
    return () => { callbacksRef.current.onTarget(null); };
  }, [target]);

  useEffect(() => {
    const fn = callbacksRef.current.onVisibility;
    if (fn) fn(isFocused);
  }, [isFocused]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (sizeRef.current.w === width && sizeRef.current.h === height) return;
    sizeRef.current = { w: width, h: height };
    const fn = callbacksRef.current.onResize;
    if (fn) fn();
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} onLayout={handleLayout}>
      <Canvas style={styles.canvas}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
  },
});
