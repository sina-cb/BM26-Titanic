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
