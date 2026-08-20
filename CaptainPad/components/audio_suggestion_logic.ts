// audio_suggestion_logic — the PURE decisions behind the ♪ audio-suggestion
// badge and its prefill. No React, no I/O, so it is unit-testable in the plain
// node vitest env (same posture as the other components/*_logic.ts modules).
//
// BACKGROUND (report 20260806_184). A pattern can declare, in its
// `AUDIO_MODULATION_V1` header, which audio signal it recommends for each of
// its parameters, over what range, with what curve, and why. The engine parses
// that block and stamps the recommendation onto the parameter's export as
// `audioSuggestion`. It is METADATA:
//
//   - the parameter's NAME and VALUE are unaffected by its presence or absence;
//   - nothing is auto-created and nothing is auto-selected;
//   - a suggestion only ever PREFILLS the modulation-create flow when the
//     operator explicitly enters from the suggestion badge. The plain "add
//     modulation" flow stays exactly as it always was — neutral defaults, every
//     live signal bindable (operator adjudication);
//   - an EXISTING saved mapping always wins. Operator work is never overwritten
//     by a pattern author's hint.
//
// Absence is absence: a parameter with no suggestion simply has none, and this
// module never invents one.

import type { AudioSuggestion, ModulationCurve, ModulationMode } from '../utils/api';

/** How the modulation editor was opened. */
export type SuggestionEntry = 'plain' | 'suggestion';

/** The fields a NEW mapping starts from. */
export interface ModulationSeed {
  source: string;
  mode: ModulationMode;
  range: [number, number];
  curve: ModulationCurve;
}

/** The neutral seed the plain add-modulation flow has always used. */
export const NEUTRAL_SEED: Readonly<ModulationSeed> = Object.freeze({
  source: 'micLow',
  mode: 'offset' as ModulationMode,
  range: [0, 0.35] as [number, number],
  curve: 'linear' as ModulationCurve,
});

/**
 * Is a suggestion allowed to prefill the editor right now?
 *
 * Only when ALL of these hold:
 *   - the parameter actually declares one,
 *   - the operator entered from the ♪ badge (an explicit "use the author's
 *     recommendation" tap, not merely opening the editor),
 *   - there is no existing mapping to overwrite.
 */
export function shouldPrefill(
  suggestion: AudioSuggestion | null | undefined,
  entry: SuggestionEntry,
  hasExistingMapping: boolean,
): boolean {
  return !!suggestion && entry === 'suggestion' && !hasExistingMapping;
}

/**
 * The seed for a NEW mapping.
 *
 * A prefilled seed is an OVERRIDE range — `param = lerp(min, max,
 * curve(signal))` — because that is the semantics the header block documents
 * and the engine applies for a declared mapping. `modulationCurve` is the
 * suggestion's curve already expressed in this app's vocabulary (the engine
 * translates block `pow2`→`easeIn`, `ease`→`easeOut` once, so no client keeps
 * a second table).
 *
 * `fallbackSource` is what the plain flow would have chosen (micLow when live,
 * else the first live signal) — passed in so this stays pure.
 */
export function modulationSeed(
  suggestion: AudioSuggestion | null | undefined,
  entry: SuggestionEntry,
  hasExistingMapping: boolean,
  fallbackSource: string = NEUTRAL_SEED.source,
): ModulationSeed {
  if (!shouldPrefill(suggestion, entry, hasExistingMapping)) {
    return { ...NEUTRAL_SEED, source: fallbackSource, range: [...NEUTRAL_SEED.range] };
  }
  const s = suggestion as AudioSuggestion;
  return {
    source: s.signal,
    mode: 'override',
    range: [s.range[0], s.range[1]],
    curve: s.modulationCurve,
  };
}

/**
 * Should the ♪ badge be TAPPABLE (i.e. offer the prefill shortcut)?
 * It is always VISIBLE when a suggestion exists — it explains what the
 * parameter is for — but it only acts when there is a playlist entry to write
 * to and no mapping it would silently compete with.
 */
export function suggestionBadgeIsActionable(
  suggestion: AudioSuggestion | null | undefined,
  entryEditable: boolean,
  hasExistingMapping: boolean,
): boolean {
  return !!suggestion && entryEditable && !hasExistingMapping;
}
