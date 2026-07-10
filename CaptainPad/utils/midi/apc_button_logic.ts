// Pure decision logic for the APC operator-re-layout buttons (2026-07).
//
// These functions carry the BEHAVIOUR the operator specified — the "which way
// does this toggle go?" decisions — as pure, side-effect-free helpers so they
// are unit-testable in plain Node (utils/midi/*.test.ts), away from the
// React-Native / expo-router imports in useMidiControl.ts. The hook's injected
// api methods (toggleCombinedAutopilot / toggleMasterFade) call these to decide
// the target state, then perform the engine writes.

/** Is the deck COLOUR autopilot actually WRITABLE right now?
 *
 *  The engine validates every `/deck/color-autopilot` POST strictly (codex P0):
 *  the MERGED config must carry a NON-EMPTY `palettes` array of known ids, or the
 *  write 400s — for BOTH directions, `active:true` AND `active:false` alike (the
 *  validator checks palettes before it ever looks at `active`). So when no
 *  palettes are configured the colour autopilot cannot be toggled at all: it is
 *  definitionally OFF (it can't run without a palette set) and any write we send
 *  just 400s. This pure predicate is the ONE place that fact lives — the toggle
 *  reads it to skip the guaranteed-400 colour write, and the direction/LED
 *  helpers read it to fall back to pattern-only. `undefined`/malformed palettes
 *  read as not-writable (never fabricate a set). */
export function colorAutopilotWritable(palettes: unknown): boolean {
  return Array.isArray(palettes) && palettes.length > 0;
}

/** Combined pattern+color autopilot direction (APC clip_stop).
 *
 *  Operator contract: pressing turns BOTH on when AT LEAST ONE is currently on;
 *  when BOTH are already on, pressing turns BOTH off. (So: both-on → off,
 *  everything else → on.) Returns the state to WRITE.
 *
 *  `colorToggleable` degrades the combined concept when the colour autopilot is
 *  UNWRITABLE (no palettes configured — see colorAutopilotWritable): the colour
 *  side can never be on, so "both on" is unreachable and the "both-on → off"
 *  branch would never turn anything off. In that case the press is a PURE PATTERN
 *  toggle (`!patternOn`) and the caller writes ONLY the pattern autopilot. When
 *  the colour side IS toggleable the original both-aware rule applies and the
 *  caller writes both. */
export function combinedAutopilotTarget(
  patternOn: boolean,
  colorOn: boolean,
  colorToggleable = true,
): boolean {
  if (!colorToggleable) return !patternOn;
  return !(patternOn && colorOn);
}

/** The APC clip_stop LED state — "the autopilot is on" as the OPERATOR reads it
 *  (the state a press turns OFF). When the colour autopilot is TOGGLEABLE the LED
 *  needs BOTH autopilots on (the combined state). When it is NOT toggleable (no
 *  palettes) the combined state is unreachable, so the LED tracks the PATTERN
 *  autopilot alone — otherwise a clip_stop that correctly turns pattern autopilot
 *  on would leave the light dark and read as "did nothing". Pure. */
export function combinedAutopilotLedOn(
  patternOn: boolean,
  colorOn: boolean,
  colorToggleable = true,
): boolean {
  return colorToggleable ? (patternOn && colorOn) : patternOn;
}

/** The one-shot exemption of the clip_stop / combined-autopilot press from the
 *  activity-based PATTERN-autopilot auto-disable, as a pure state machine.
 *
 *  The auto-disable in useMidiControl turns pattern autopilot OFF on the first
 *  inbound MIDI after a long idle (so faders stay authoritative). But the APC
 *  clip_stop press (autopilotToggle → toggleCombinedAutopilot) exists precisely
 *  to turn pattern autopilot ON, so when the activity IS that toggle its own
 *  turn-on must NOT be stomped by the disable. The toggle CLAIMS the current
 *  activity window synchronously (before any await); the auto-disable then asks
 *  `shouldRunPatternDisable()`, which returns false EXACTLY ONCE per claim (and
 *  clears it) so the pattern disable is skipped for that window and runs
 *  normally for every subsequent, unclaimed activity.
 *
 *  Ordering that makes the plain flag sufficient (no deferral): onMessage fires
 *  the activity callback FIRST — but the auto-disable only reaches its pattern
 *  write after two awaited engine round-trips — THEN synchronously dispatches,
 *  and the toggle's synchronous prefix calls `claim()` before its own first
 *  await. So the flag is always set before `shouldRunPatternDisable()` is read.
 *
 *  Kept as a pure factory (no module singletons, no side effects) so the whole
 *  exemption contract is unit-tested in plain Node, away from the hook's
 *  RN/expo-router imports. */
export interface AutopilotToggleExemption {
  /** Called synchronously by toggleCombinedAutopilot to claim THIS window. */
  claim(): void;
  /** Called by the auto-disable to decide whether to run the PATTERN disable.
   *  Returns false (skip) exactly once per claim, consuming the claim; true
   *  (run) otherwise. */
  shouldRunPatternDisable(): boolean;
}

export function createAutopilotToggleExemption(): AutopilotToggleExemption {
  let claimed = false;
  return {
    claim(): void { claimed = true; },
    shouldRunPatternDisable(): boolean {
      if (claimed) { claimed = false; return false; }
      return true;
    },
  };
}

/** Deck ↔ Mixer view toggle decision (APC Shift → toggleDeckMixerView).
 *
 *  From the CURRENT MIDI mapping context, decide (a) the router target and (b)
 *  the MIDI context to publish — as ONE pure decision so the two can NEVER
 *  diverge. This is the fix for the "mixer local knobs do nothing" bug: on the
 *  APC-Shift `router.navigate` path, the destination screen's `useFocusEffect`
 *  (which publishes context) could be skipped or lag, leaving the knobs in
 *  'deck' context while the operator is looking at the mixer — so the local
 *  knobs wrote the deck channel instead of the focused overlay. By deriving the
 *  target route and the published context from the SAME `activeContext` here,
 *  navigation and context are always in agreement regardless of how the mixer
 *  was reached.
 *
 *  Rule: 'mixer' → go to Deck; every other context (deck + the utility tabs) →
 *  go to Mixer. So Shift from anywhere non-mixer lands on the Mixer, and the
 *  published context always matches the route we navigate to. Pure. */
export interface DeckMixerToggleTarget {
  /** expo-router path to navigate to. */
  route: string;
  /** MIDI mapping context to publish (matches the route). */
  context: 'deck' | 'mixer';
}

export function deckMixerToggleTarget(activeContext: string): DeckMixerToggleTarget {
  const toMixer = activeContext !== 'mixer';
  return toMixer
    ? { route: '/(tabs)/mixer', context: 'mixer' }
    : { route: '/(tabs)', context: 'deck' };
}

/** A master at or below this counts as "already black" for the fade toggle. A
 *  timed fade rarely lands EXACTLY on 0 on the throttled engine echo, so a small
 *  epsilon keeps a fade-up from immediately reading as "not black" and vice
 *  versa. */
export const MASTER_BLACK_EPSILON = 0.02;

/** Master FADE toggle target (APC stop_all_clips): if the master is NOT already
 *  black, fade TO BLACK (0); if it IS already black, fade UP (1). Returns the
 *  target master value. */
export function masterFadeTarget(master: number): 0 | 1 {
  return master <= MASTER_BLACK_EPSILON ? 1 : 0;
}
