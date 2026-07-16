// pattern_scroll_logic — pure decisions for the playlist auto-scroll.
//
// The deck/mixer playlist list auto-scrolls to keep the active pattern (and the
// MIDI browse window) visible when the change comes from ELSEWHERE — a MIDI pad,
// autopilot, or a cross-tab switch. But a change the OPERATOR just made by
// tapping a row must NEVER scroll the list out from under their finger (operator
// report: tapping a pattern outside the blue window jumped the list back to the
// window). These helpers encode that split so PlaylistPanel stays declarative
// and the rules are unit-testable without React / layout.

/** Grace window (ms) after a user tap during which NO auto-scroll fires. It must
 *  outlast the engine round-trip that recenters the MIDI browse window around the
 *  tapped entry (the window move arrives a beat after the optimistic selection),
 *  so the follow-up window shift doesn't sneak a scroll past the tap suppression. */
export const USER_SELECT_GRACE_MS = 1200;

/** Was the active-entry / window change driven by the operator's own recent tap?
 *  True while we're inside the grace window after `userSelectAtMs`. A change with
 *  no recent tap (0 / far in the past) is treated as external. */
export function isUserInitiated(userSelectAtMs: number, nowMs: number, graceMs = USER_SELECT_GRACE_MS): boolean {
  if (!userSelectAtMs) return false;
  return nowMs - userSelectAtMs < graceMs;
}

/** Is the row (at `rowY`, height `rowH`) fully within the current viewport
 *  (`scrollY`..`scrollY + viewportH`)? A zero/negative viewport height is treated
 *  as "not measured yet" → visible (so we never scroll on a bogus measurement). */
export function isRowVisible(args: {
  rowY: number;
  rowH: number;
  scrollY: number;
  viewportH: number;
}): boolean {
  const { rowY, rowH, scrollY, viewportH } = args;
  if (viewportH <= 0) return true;
  return rowY >= scrollY && rowY + rowH <= scrollY + viewportH;
}

/** Should we auto-scroll this change into view? Only when it was NOT user-driven
 *  AND the target row is currently off-screen. This is the single gate both the
 *  active-entry effect and the window-follow effect route through. */
export function shouldScrollIntoView(args: { userInitiated: boolean; visible: boolean }): boolean {
  return !args.userInitiated && !args.visible;
}

/** Y offset that centres a row of height `rowH` at `rowY` in a `viewportH` tall
 *  viewport (pre-clamp). */
export function centeredScrollTarget(rowY: number, rowH: number, viewportH: number): number {
  return rowY + rowH / 2 - viewportH / 2;
}

/** Clamp a scroll target to `[0, max(0, contentH - viewportH)]` so we never try
 *  to scroll past either content edge (RN would clip silently; explicit clamping
 *  avoids a janky overscroll bounce). */
export function clampScrollTarget(targetY: number, contentH: number, viewportH: number): number {
  return Math.max(0, Math.min(targetY, Math.max(0, contentH - viewportH)));
}
