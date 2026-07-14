// window_slot — pure mapping from a playlist row index to its APC pad slot.
//
// The APC mini's playlist browser windows WINDOW_SIZE consecutive entries onto
// a column of pads (profile `reverse: true` → top pad = top entry, so pad
// order matches the on-screen list order top-down). The manager publishes the
// live window as { start, size } (utils/midi/manager.ts onWindowChange →
// useMidiWindow); this helper is the ONE derivation the UI uses to decide
// whether a row is inside that window and which physical pad selects it.
// Kept dependency-free so it unit-tests without the React/controller stack.

/** The published browse window shape (structurally identical to
 *  `MidiWindow` in hooks/useMidiControl.ts — kept structural so this pure
 *  module never imports the hook layer). */
export interface BrowseWindow {
  start: number;
  size: number;
}

/**
 * 1-based pad number for the playlist row at `idx` inside the browse window,
 * or null when there is no window / the row falls outside it.
 *
 * Pad 1 is the TOP pad of the browse column and selects the window's first
 * (lowest-index) entry — the profile maps the column with `reverse: true`, so
 * physical pad order and list order agree top-down.
 *
 * @param window The live browse window (null when no controller window is
 *   published for this channel).
 * @param idx    Zero-based playlist row index.
 * @returns 1..window.size, or null when the row is not in the window.
 */
export function windowPadNumber(window: BrowseWindow | null | undefined, idx: number): number | null {
  if (!window) return null;
  if (idx < window.start || idx >= window.start + window.size) return null;
  return idx - window.start + 1;
}

/**
 * New browse-window START so the window SURROUNDS the active entry — the
 * "recenter the pad window around what's playing" rule. When the active row
 * already sits inside the window the start is returned UNCHANGED (so a manual
 * pad-scroll browse is never yanked back); when it falls outside, the window
 * re-centers on the active row, clamped to `[0, max]` where
 * `max = max(0, length - size)` (the window never runs past either end, and a
 * playlist shorter than the window pins to 0). No active row (`activeIndex < 0`
 * or out of range) leaves the window where it is (clamped in-bounds).
 *
 * Pure + dependency-free so both the MIDI manager (which owns the live cursor)
 * and the unit tests can call it without the controller stack.
 */
export function recenterWindowStart(args: {
  activeIndex: number;
  currentStart: number;
  size: number;
  length: number;
}): number {
  const { activeIndex, currentStart, size, length } = args;
  const max = Math.max(0, length - size);
  const clampedCur = Math.min(Math.max(0, currentStart), max);
  // No active row to follow → hold position (clamped in-bounds).
  if (activeIndex < 0 || activeIndex >= length) return clampedCur;
  // Already inside the window → don't churn (preserves a manual browse scroll).
  if (activeIndex >= clampedCur && activeIndex < clampedCur + size) return clampedCur;
  // Outside → centre the active row, clamped to the ends.
  const centered = activeIndex - Math.floor(size / 2);
  return Math.min(Math.max(0, centered), max);
}
