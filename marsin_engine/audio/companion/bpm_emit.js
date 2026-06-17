/*
 * bpm_emit.js — the Companion's built-in BPM output guard.
 *
 * BPM is a DERIVED signal (DerivedSignals/BpmTracker), not a raw-source
 * designed signal, so the Companion emits it as a FIRST-CLASS, always-on
 * output rather than through the operator's osc_out chains. The curated CPC
 * contract (2026-06-17) maps it to the engine OSC address `/marsin/audio/bpm`
 * → CPC key `audioBpm`, which drives the engine's bpmSpeedSync.
 *
 * This module is the single source of truth for WHICH tempo values are safe to
 * emit. Codex P0 — fail SAFE, not silent-wrong: a 0 / non-finite / absurd BPM
 * is NOT sent, so the engine sync simply doesn't drive (no stale fallback)
 * rather than syncing SPEED to a wrong tempo. Kept tiny + pure so it's unit-
 * testable without booting the whole companion server.
 */

// The curated engine OSC address for BPM (contract §"CPC keys the Companion
// emits"): /marsin/audio/bpm → CPC key audioBpm.
export const BPM_OSC_ADDRESS = '/marsin/audio/bpm';

// Upper sanity bound — matches the audioBpm registry range [0, 300].
export const BPM_MAX = 300;

/**
 * Is this a finite, sane tempo worth emitting?
 * @param {number} bpm
 * @returns {boolean} true iff bpm is finite and in (0, BPM_MAX].
 */
export function isSaneBpm(bpm) {
  return Number.isFinite(bpm) && bpm > 0 && bpm <= BPM_MAX;
}

/**
 * Emit the Companion's derived BPM over OSC, guarded. Reads `audioBpm` from the
 * given paramCenter (written by DerivedSignals.tick) and, only when it is a
 * finite/sane tempo, sends it via `sendOsc` to `/marsin/audio/bpm`. Returns
 * true if a packet was sent, false if the value was dropped (fail-safe).
 *
 * @param {object} paramCenter — has `get(key) → number`.
 * @param {(address: string, value: number) => void} sendOsc — the UDP sender.
 * @returns {boolean}
 */
export function emitDerivedBpm(paramCenter, sendOsc) {
  const bpm = paramCenter.get('audioBpm');
  if (!isSaneBpm(bpm)) return false;   // fail safe, not silent-wrong
  sendOsc(BPM_OSC_ADDRESS, bpm);
  return true;
}
