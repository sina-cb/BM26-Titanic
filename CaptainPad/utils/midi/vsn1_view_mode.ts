// Pure logic for the VSN1 small-button sb_0 VIEW MODE control (2026-07-09).
//
// sb_0 single click → DRUM view; double click → EFFECT view. The device Lua
// must NOT do timing (its VM restarts on every page load), so the HOST detects
// single-vs-double from the note timestamps and OWNS the current view mode,
// echoing it to the device as a feedback CC that survives page changes.
//
// These helpers carry ONLY the decision math as pure, side-effect-free
// functions so they are unit-testable in plain Node (utils/midi/*.test.ts),
// away from the timer + transport wiring in the manager. The manager keeps the
// last-press timestamp + a deferred-resolve timer and calls these to decide.

/** The two view modes the device renders (host-echoed as a feedback CC).
 *  DRUM: a key press triggers now; the LCD shows only the pressed effect's
 *  name/value/mode, no grid. EFFECT: first press selects (LCD shows the grid +
 *  the selected effect), second press triggers. */
export type Vsn1ViewMode = 'drum' | 'effect';

/** The feedback-CC value for a view mode: 0 = DRUM, 1 = EFFECT. This is the byte
 *  the device receiver applies to `vm` (see encoder_init.lua). */
export function viewModeCcValue(mode: Vsn1ViewMode): 0 | 1 {
  return mode === 'effect' ? 1 : 0;
}

/** Max gap (ms) between two sb_0 presses to count as a DOUBLE click. A press
 *  landing within this window of the previous one is the second half of a
 *  double click (→ EFFECT); a press outside it is a fresh single click
 *  candidate (→ DRUM, after the window proves no second press followed). */
export const DOUBLE_CLICK_MS = 350;

/** Classify an sb_0 press from the gap to the PREVIOUS sb_0 press.
 *
 *  `prevPressMs` is the timestamp of the last press that was NOT already
 *  consumed as the first half of a double click (null = no prior press, or the
 *  prior one was already paired). Returns:
 *    'double' — this press is the second half of a double click (EFFECT). The
 *               caller should CONSUME the pairing (don't chain a third press
 *               into another double) and cancel any pending single-click.
 *    'single' — this press starts a fresh single-click candidate (DRUM). The
 *               caller records this timestamp and arms a deferred resolve so a
 *               following press within DOUBLE_CLICK_MS can upgrade it to a
 *               double. */
export function classifySb0Press(
  prevPressMs: number | null,
  curPressMs: number,
  windowMs: number = DOUBLE_CLICK_MS,
): 'single' | 'double' {
  if (prevPressMs !== null && curPressMs - prevPressMs <= windowMs) return 'double';
  return 'single';
}
