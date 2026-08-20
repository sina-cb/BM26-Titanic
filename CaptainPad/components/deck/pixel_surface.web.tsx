/**
 * PixelSurface (WEB) — the drawing element the deck's PIXELS window and the
 * mixer's pixel-view bands paint onto, plus the two per-element signals that
 * tell them WHEN to paint.
 *
 * This is the browser half of the platform pair introduced by report _252 so
 * the same two surfaces render for real on the iPad (docs/60 §3.4). Nothing
 * about the web behaviour changed in the move: the element is still the same
 * raw `<canvas>` the two consumers used to create inline, and the shared
 * ResizeObserver / IntersectionObserver below were lifted verbatim out of
 * `pixel_view_band.tsx`.
 *
 * ── ONE OBSERVER PAIR FOR THE WHOLE PAGE ────────────────────────────────────
 *
 * ONE ResizeObserver and ONE IntersectionObserver for every surface on the
 * page (docs/58 §4.2). Nine bands plus the deck window would otherwise mean
 * twenty observers watching ten elements — the observers exist to be cheap, and
 * the browser batches a shared one's callbacks into a single delivery.
 */
import React, { useCallback, useEffect, useRef } from 'react';

import { createCanvasPaintTarget } from '@/components/deck/pixel_paint_target_canvas';
import type { PixelPaintTarget } from '@/components/deck/pixel_view_paint';

type ElementCallback = (entry?: IntersectionObserverEntry) => void;

let _resizeObserver: ResizeObserver | null = null;
const _resizeCallbacks = new Map<Element, ElementCallback>();

function observeResize(el: Element, cb: ElementCallback): () => void {
  const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  if (!RO) return () => undefined;
  if (!_resizeObserver) {
    _resizeObserver = new RO((entries) => {
      for (const entry of entries) {
        const fn = _resizeCallbacks.get(entry.target);
        if (fn) fn();
      }
    });
  }
  _resizeCallbacks.set(el, cb);
  _resizeObserver.observe(el);
  return () => {
    _resizeCallbacks.delete(el);
    if (_resizeObserver) _resizeObserver.unobserve(el);
  };
}

let _intersectionObserver: IntersectionObserver | null = null;
const _intersectionCallbacks = new Map<Element, ElementCallback>();

function observeIntersection(el: Element, cb: ElementCallback): () => void {
  const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;
  if (!IO) return () => undefined;
  if (!_intersectionObserver) {
    _intersectionObserver = new IO((entries) => {
      for (const entry of entries) {
        const fn = _intersectionCallbacks.get(entry.target);
        if (fn) fn(entry);
      }
    });
  }
  _intersectionCallbacks.set(el, cb);
  _intersectionObserver.observe(el);
  return () => {
    _intersectionCallbacks.delete(el);
    if (_intersectionObserver) _intersectionObserver.unobserve(el);
  };
}

export interface PixelSurfaceProps {
  /** The paint target for this surface, or null when it goes away. Called on
   *  mount/unmount only — never per frame. */
  onTarget: (target: PixelPaintTarget | null) => void;
  /** The surface changed size and owes a repaint. */
  onResize?: () => void;
  /** The surface scrolled on/off screen (web) or its screen gained/lost focus
   *  (native). Not called on web when the platform has no IntersectionObserver,
   *  which is why the consumer's default is `true`. */
  onVisibility?: (onScreen: boolean) => void;
}

export function PixelSurface({ onTarget, onResize, onVisibility }: PixelSurfaceProps) {
  const elementRef = useRef<HTMLCanvasElement | null>(null);
  /* The callbacks are read through a ref so a consumer that rebuilds them each
     render never re-runs the observer effect — the whole point of this surface
     is that steady-state painting causes no React work at all. */
  const callbacksRef = useRef({ onTarget, onResize, onVisibility });
  callbacksRef.current = { onTarget, onResize, onVisibility };

  const attach = useCallback((node: HTMLCanvasElement | null) => {
    elementRef.current = node;
    callbacksRef.current.onTarget(node ? createCanvasPaintTarget(node) : null);
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const offResize = observeResize(element, () => {
      const fn = callbacksRef.current.onResize;
      if (fn) fn();
    });
    const offIntersect = observeIntersection(element, (entry) => {
      const fn = callbacksRef.current.onVisibility;
      if (fn) fn(entry ? entry.isIntersecting : true);
    });
    return () => { offResize(); offIntersect(); };
  }, []);

  /* react-native-web passes an unknown string tag through as a real DOM
     element, which is how a raw canvas gets rendered from RN code. */
  return React.createElement('canvas', {
    ref: attach,
    style: { display: 'block', width: '100%', height: '100%' },
  });
}
