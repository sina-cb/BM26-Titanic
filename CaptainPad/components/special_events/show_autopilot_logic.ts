// show_autopilot_logic — the pure logic behind the simplified SHOW AUTOPILOT
// card (docs/57 §4, report `_240`).
//
// Operator, verbatim: *"show the current pattern name on the auto pilot, and
// simplify the auto pilot, play, and time, 5, 15, 30, 60 seconds."*
//
// The card draws NAME, PLAY/PAUSE, four time pills, and one deliberately tiny
// transition-style choice: SINGLE or SHUFFLE ALL. Pattern shuffle, group
// mode/size/dwell, and the selected single transition remain show-authored.
// The DECK tab's own panel is untouched and stays full-featured.
//
// THE UNIT IS SECONDS. Baby Tease and the revealed family are short-form
// ceremonial playlists: 5 / 15 / 30 / 60 seconds, with 15 seconds authored as
// the default. The 1 second transition is short enough that every cadence has
// a complete hold between swaps.
//
// A LIVE VALUE MATCHING NO PILL LIGHTS NO PILL. The card never snaps a value
// it did not set and never lies about what the rig is doing: an off-pill
// cadence lights nothing and prints the real number beside the bar. That keeps
// a hand-authored `everySec: 20` honest instead of rounding it to 1 MINUTE on
// screen.

/** The pills, in seconds, left to right — exactly the `everySec` wire values. */
export const PILL_SECONDS = [5, 15, 30, 60] as const;

/** The complete simplified transition-style choice, in operator order. */
export const TRANSITION_SELECTIONS = [
  { label: 'SINGLE', shuffle: false },
  { label: 'SHUFFLE ALL', shuffle: true },
] as const;

/** Seconds for a pill. */
export function pillSeconds(seconds: number): number {
  return seconds;
}

/**
 * Which pill (in seconds) the live cadence lights, or `null` when it matches
 * none — an authored value the card must show rather than round.
 */
export function litPillSeconds(everySec: number | null): number | null {
  if (everySec === null || !Number.isFinite(everySec)) return null;
  const found = PILL_SECONDS.find((seconds) => seconds === everySec);
  return found === undefined ? null : found;
}

/**
 * The small secondary caption beside the pill bar, or `null` when a pill is
 * lit and the bar already says it. Reads as a duration a human would say out
 * loud: "20 SEC", "2 MIN", "1 MIN 30 SEC".
 */
export function offPillCaption(everySec: number | null): string | null {
  if (everySec === null || !Number.isFinite(everySec)) return null;
  if (litPillSeconds(everySec) !== null) return null;
  return formatCadence(everySec);
}

/** A cadence in seconds, spoken the way an operator would say it. */
export function formatCadence(everySec: number): string {
  const total = Math.max(0, Math.round(everySec));
  if (total < 60) return `${total} SEC`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return sec === 0 ? `${min} MIN` : `${min} MIN ${sec} SEC`;
}
