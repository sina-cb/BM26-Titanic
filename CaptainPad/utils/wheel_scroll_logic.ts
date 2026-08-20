// wheel_scroll_logic — pure mapping from browser WheelEvent deltas to a
// horizontal scrollLeft delta for horizontal-only scrollers (RN-web).
//
// Desktop mice emit VERTICAL wheel deltas (deltaY); over an element that
// can only scroll horizontally the browser drops them — the row never
// moves (dimmer rack repro, report 20260725_130: scrollLeft pinned at 0).
// This maps deltaY onto the horizontal axis. Horizontal-dominant deltas
// (trackpad two-finger pan, Chrome's shift+wheel axis swap) already
// scroll the element natively, so the mapper returns null and the caller
// must stay out of the browser's way (no preventDefault).

/** Pixels per line for deltaMode=1 (Firefox line scrolling). */
export const WHEEL_LINE_PX = 40;

export interface WheelDeltas {
  deltaX: number;
  deltaY: number;
  /** WheelEvent.deltaMode: 0=pixel, 1=line, 2=page. */
  deltaMode: number;
}

/**
 * Translate a wheel event into a horizontal scroll delta.
 *
 * @param ev wheel deltas from the browser event
 * @param pageSizePx the scroller's visible width — one "page" for deltaMode=2
 * @returns pixels to add to scrollLeft, or null when the event is
 *   horizontal-dominant (or empty) and native handling must keep it
 */
export function wheelToHorizontalDelta(ev: WheelDeltas, pageSizePx: number): number | null {
  if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return null;
  if (ev.deltaMode === 1) return ev.deltaY * WHEEL_LINE_PX;
  if (ev.deltaMode === 2) return ev.deltaY * pageSizePx;
  return ev.deltaY;
}
