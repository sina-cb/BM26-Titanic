/**
 * pixel_surface_visibility (WEB) — "is the host actually being looked at?"
 *
 * Moved verbatim out of `pixel_view_band.tsx`'s `documentVisible()` (report
 * _252) so the deck window and the mixer bands ask ONE question with ONE
 * platform answer. A backgrounded browser tab's bands cost 0 ms — rAF is
 * already throttled there, but the gate makes it explicit and keeps the paint
 * scheduler's own accounting honest.
 *
 * The per-ELEMENT signals (size changed, scrolled on/off screen) are not here:
 * they belong to the element, so `PixelSurface` owns them and reports them
 * through its `onResize` / `onVisibility` props. This module is only the
 * process-wide one.
 */
export function isPixelSurfaceHostVisible(): boolean {
  const doc = (globalThis as { document?: { visibilityState?: string } }).document;
  if (!doc || typeof doc.visibilityState !== 'string') return true;
  return doc.visibilityState === 'visible';
}
