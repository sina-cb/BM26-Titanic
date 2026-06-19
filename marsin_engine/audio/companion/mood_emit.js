/*
 * mood_emit.js — the Companion's built-in MUSIC-MOOD output guard.
 *
 * PARTY and STRUCTURE are DERIVED/DETECTED signals (PartyMode +
 * AudioStructureDetector), not raw-source designed signals, so the Companion
 * emits them as FIRST-CLASS, always-on outputs rather than through the
 * operator's osc_out chains — exactly like BPM (bpm_emit.js). The curated CPC
 * contract (2026-06-17) maps PARTY to the engine OSC address
 * `/marsin/audio/party` → CPC key `audioParty`; STRUCTURE rides the curated
 * `/marsin/audio/structure` → CPC key `audioStructure`. The Timeline companion
 * reads these live mood keys off the engine's param-broadcast WS (report
 * 202606/20260619_0_timeline_show_scheduler.md §3.2) — so the mood is LIVE
 * analysis, not a manual injection.
 *
 * These addresses MIRROR the engine's inbound `oscAddress` fields in
 * audio/postproc/audio_signals.js (audioParty → /marsin/audio/party,
 * audioStructure → /marsin/audio/structure). They are NOT slug-derived via
 * resolveOscOut: audioParty/audioStructure are NOT curated osc_out NAMES, so
 * resolveOscOut would slug them to /marsin/audio/audioparty (wrong). The single
 * source of truth for the wire address is the engine's canonical binding, which
 * this constant matches verbatim.
 *
 * This module is the single source of truth for WHICH mood values are safe to
 * emit. Codex P0 — fail SAFE, not silent-wrong: a NaN / non-finite / out-of-
 * range value is NOT sent, so the engine's mood key simply doesn't update (no
 * stale fallback) rather than landing garbage. Kept tiny + pure so it's unit-
 * testable without booting the whole companion server.
 */

// Curated engine OSC addresses (contract §"CPC keys the Companion emits" +
// audio/postproc/audio_signals.js oscAddress fields).
export const PARTY_OSC_ADDRESS = '/marsin/audio/party';
export const STRUCTURE_OSC_ADDRESS = '/marsin/audio/structure';

// audioParty is a 0/1 loud-music gate (range [0, 1], audio_signals.js DERIVED).
export const PARTY_MAX = 1;
// audioStructure is the structure-detector state (range [0, 2] — intro/build/
// drop/breakdown, audio_signals.js DETECTORS).
export const STRUCTURE_MAX = 2;

/**
 * Is this a finite party gate worth emitting? Party is a 0/1 scalar, so any
 * finite value in [0, PARTY_MAX] is valid (it is snapped to 1.0/0.0 on send).
 * @param {number} party
 * @returns {boolean}
 */
export function isSaneParty(party) {
  return Number.isFinite(party) && party >= 0 && party <= PARTY_MAX;
}

/**
 * Is this a finite structure state worth emitting?
 * @param {number} structure
 * @returns {boolean} true iff structure is finite and in [0, STRUCTURE_MAX].
 */
export function isSaneStructure(structure) {
  return Number.isFinite(structure) && structure >= 0 && structure <= STRUCTURE_MAX;
}

/**
 * Emit the Companion's derived MUSIC-MOOD signals over OSC, guarded. Reads
 * `audioParty` and `audioStructure` from the given paramCenter (party written
 * by DerivedSignals.tick, structure by AudioStructureDetector.tick) and, only
 * when each is finite/in-range, sends it via `sendOsc` to its curated address:
 *   - party    → /marsin/audio/party    as 1.0/0.0 (the gate value),
 *   - structure→ /marsin/audio/structure as its numeric state.
 * Each is independently guarded — a garbage value on ONE drops only that one
 * (fail safe, no stale). Returns the count of packets sent (0, 1, or 2).
 *
 * @param {object} paramCenter — has `get(key) → number`.
 * @param {(address: string, value: number) => void} sendOsc — the UDP sender.
 * @returns {number}
 */
export function emitDerivedMood(paramCenter, sendOsc) {
  let sent = 0;
  const party = paramCenter.get('audioParty');
  if (isSaneParty(party)) {
    sendOsc(PARTY_OSC_ADDRESS, party > 0 ? 1.0 : 0.0);
    sent++;
  }
  const structure = paramCenter.get('audioStructure');
  if (isSaneStructure(structure)) {
    sendOsc(STRUCTURE_OSC_ADDRESS, structure);
    sent++;
  }
  return sent;
}
