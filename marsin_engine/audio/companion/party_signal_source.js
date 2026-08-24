/*
 * party_signal_source.js — the pure decision behind the ONE key the show
 * director trusts: `audioPartyStrong`.
 *
 * Two detectors always run in the Companion, every hop, whatever is selected:
 *
 *   QUALIFIED (PartyModeStrong) — LEVEL + BEAT + SHAPE + QUIET, all held
 *       continuously for `onSustainMs`. Rejects room noise and far camps. This
 *       is what `derived.tick()` publishes into `audioPartyStrong` by itself,
 *       and it is the default source.
 *   SIMPLE (PartyMode) — the band-loudness Schmitt trigger published as
 *       `audioParty` and shown as the DERIVED readout's PARTY pill. It trips on
 *       any loud sound; it exists as the operator's escape hatch for a night
 *       where the gates will not close on what plainly IS a party.
 *
 * PRECEDENCE — override > source > detectors:
 *
 *   1. the FAKE TRIGGER (`partyOverride`, runtime-only) wins over everything,
 *   2. otherwise the persisted `party.source` picks whose verdict is published,
 *   3. and that detector's own latch is the value.
 *
 * Keeping the decision here (instead of inline in the audio hot path) is what
 * lets `node --test` pin the precedence without booting a companion.
 */
import { parsePartySource } from './party_tuning.js';

/**
 * FAKE TRIGGER modes — a manual override of the PUBLISHED value so the operator
 * can drive the whole downstream chain with no audio at all. Runtime-only.
 */
export const PARTY_OVERRIDE_MODES = Object.freeze(['auto', 'party', 'off']);

/**
 * Decide what `audioPartyStrong` must carry this hop.
 *
 * `writer` is the ParamCenter writer tag for the republish, or NULL when the
 * qualified detector's own publish already stands and must NOT be rewritten
 * (that keeps `derivedSignals` as the writer of record in the default case).
 *
 * Every input is validated: a bad mode, a bad source, or a missing verdict for
 * the SELECTED source throws rather than publishing a guessed party state.
 *
 * @param {{source:string, override:string, qualifiedParty:boolean, simpleParty:boolean|null}} input
 * @returns {{value:number, writer:string|null, reason:'override'|'simple'|'qualified'}}
 */
export function resolvePartySignal({ source, override, qualifiedParty, simpleParty }) {
  parsePartySource(source);
  if (!PARTY_OVERRIDE_MODES.includes(override)) {
    throw new Error(
      `party override must be one of ${PARTY_OVERRIDE_MODES.join('/')}, got ${JSON.stringify(override)}`);
  }
  if (typeof qualifiedParty !== 'boolean') {
    throw new TypeError(
      `party signal: qualifiedParty must be a boolean, got ${JSON.stringify(qualifiedParty)}`);
  }
  if (simpleParty !== null && typeof simpleParty !== 'boolean') {
    throw new TypeError(
      `party signal: simpleParty must be a boolean or null, got ${JSON.stringify(simpleParty)}`);
  }
  // 1. FAKE TRIGGER — sits on top of the source selection, exactly as it always
  //    sat on top of the detector. The meters keep reporting the truth.
  if (override !== 'auto') {
    return { value: override === 'party' ? 1 : 0, writer: 'partyOverride', reason: 'override' };
  }
  // 2. SIMPLE selected — republish the band-loudness flag over the gate's.
  if (source === 'simple') {
    if (simpleParty === null) {
      throw new Error(
        'party source "simple": the simple detector is not publishing audioParty — '
        + 'refusing to guess a party verdict');
    }
    return { value: simpleParty ? 1 : 0, writer: 'partySource', reason: 'simple' };
  }
  // 3. QUALIFIED — `derived.tick()` already published exactly this value.
  return { value: qualifiedParty ? 1 : 0, writer: null, reason: 'qualified' };
}

/**
 * Read a published 0/1 CPC value as a verdict. Null in ⇒ null out ("this build
 * does not publish that key"), which the UIs render as "n/a" — never as calm.
 *
 * @param {number|null} value
 * @returns {boolean|null}
 */
export function partyVerdictOf(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) {
    throw new TypeError(`party verdict: expected a finite 0/1, got ${JSON.stringify(value)}`);
  }
  return value >= 0.5;
}
