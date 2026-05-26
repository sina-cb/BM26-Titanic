/**
 * audio_post_processing — per-signal post-processing framework.
 *
 * The architecture (operator brief, 2026-05-26): AudioAnalyzer and
 * OscListener are pure DATA SOURCES — they produce raw band/stem
 * values. This module is the post-processing framework that turns
 * raw → post-processed values via a per-signal pipeline. The engine
 * writes BOTH the raw AND post-processed values to ParamCenter so
 * downstream consumers (patterns, modulation, iPad meters, iPad
 * trail/instant plots) can read either.
 *
 * Pipeline V1 (today): just per-key gain × clamp. The chain is
 * trivial because gain is the only op shipped so far.
 *
 * Pipeline V2 (docs/29 — node-based audio post-processing): a chain
 * of ops per signal — Gain → LPF → Schmitt → Hold → Compressor → …
 * The shape of `processSignal()` is intentionally future-proofed:
 * the call site never has to know which ops are in the chain, it
 * just hands the framework a raw value + signal key and gets back
 * a post-processed value. When V2 lands, this module grows; every
 * call site picks up the new ops for free.
 *
 * Why a single framework instead of per-call-site math:
 *   - The mic side (AudioAnalyzer) and the stems side (OscListener)
 *     MUST run the exact same pipeline — any divergence means the
 *     operator's knobs behave differently for mic vs stems, which is
 *     a class of bug that's invisible at code review but obvious on
 *     stage. One module, two call sites, zero drift.
 *   - The framework is the canonical place to add new ops later
 *     (docs/29). Nothing else has to change when ops are added.
 *
 * Public API:
 *   - GAIN_BY_KEY            — frozen map of signalKey → gainKey.
 *     Used by OscListener for boot-time validation that every active
 *     live key has its gain partner registered (Codex P0 — half-wired
 *     gain crashes the engine instead of doing nothing at runtime).
 *   - processSignal(pc, signalKey, raw) → post   — single signal.
 *   - processAndPair(pc, signalKey, raw) → { raw, post }   — helper
 *     for call sites that want to write both to ParamCenter in one
 *     setMany batch.
 *
 * Codex P0:
 *   - `processSignal` reads the gain via `paramCenter.get(gainKey)`.
 *     The real ParamCenter throws on unknown keys — this function
 *     does NOT catch it. A missing gain key surfaces as a hot-path
 *     crash, never as "knob silently does nothing".
 *   - Unknown signalKey throws too — no fallback to identity. If a
 *     call site asks the framework to process a key the framework
 *     doesn't know about, that's a programmer error worth crashing
 *     on (and the OscListener validates at boot anyway).
 *
 * Output range — `[0, 1]`. The live-key contract requires normalized
 * values on the wire. Negative gains, NaN gains, gain×raw > 1: all
 * clamped here so a downstream consumer can't ever see a denormal.
 */

/**
 * signalKey → gainKey map. Every live audio signal that the operator
 * can scale with a CPC `*Gain` param lives here.
 *
 * Adding a new gainable live key means adding it here AND in
 * `param_center.PARAM_REGISTRY` — there is no auto-discovery, because
 * silent miss = "gain knob does nothing", which is exactly the bug
 * this whole framework exists to prevent. `OscListener` validates at
 * boot that every (signalKey → gainKey) pair whose signalKey is in
 * the active registry also has its gainKey present, so a half-wired
 * addition crashes the engine instead of shipping silently.
 */
export const GAIN_BY_KEY = Object.freeze({
  stemsBass:   'stemsBassGain',
  stemsDrums:  'stemsDrumsGain',
  stemsVocals: 'stemsVocalsGain',
  micLow:      'micLowGain',
  micMid:      'micMidGain',
  micHigh:     'micHighGain',
  micKick:     'micKickGain',
});

/**
 * Process a single raw audio value through the post-processing
 * pipeline for one signal key.
 *
 * V1 pipeline: `gain × clamp`. The function reads the per-signal
 * gain from CPC (the gain key derives from the signal key via
 * `GAIN_BY_KEY`), multiplies, and clamps the result to [0, 1].
 *
 * V2 (docs/29 — coming): the function walks a per-signal op chain
 * loaded from config (Gain → LPF → Schmitt → Hold → Compressor → …).
 * Call sites never have to change.
 *
 * @param {{ get: (key: string) => number }} paramCenter — CPC instance
 *   (or a test stand-in with the same `.get` contract — throws on
 *   unknown key).
 * @param {string} signalKey — CPC live signal key (e.g. 'micLow',
 *   'stemsBass'). MUST be a known signal key in `GAIN_BY_KEY` —
 *   unknown keys throw (Codex P0, no silent fallback to identity).
 * @param {number} rawValue — pre-processing value, typically in [0, 1].
 * @returns {number} post-processed value, clamped to [0, 1].
 *
 * Defensive clamping: even though the live-key contract says raw
 * values arrive in [0, 1] and gains are non-negative, the final
 * product is clamped to [0, 1] (negative → 0, NaN → 0, > 1 → 1). A
 * future op upstream of gain might emit signed values; pinning the
 * output to the contracted range keeps every downstream consumer
 * safe regardless of input pathology.
 */
export function processSignal(paramCenter, signalKey, rawValue) {
  const gainKey = GAIN_BY_KEY[signalKey];
  if (gainKey === undefined) {
    // Codex P0: unknown signal key is a programmer error. The
    // OscListener validates at boot that every active live key has
    // an entry here; if we land here it means a call site is asking
    // the framework to process a key that was never wired up.
    throw new Error(
      `audio_post_processing.processSignal: unknown signalKey "${signalKey}" ` +
      `(no entry in GAIN_BY_KEY — add it here and register a *Gain partner).`,
    );
  }
  // Let paramCenter.get throw on an unknown gainKey — that's the
  // contract. No try/catch: silent fallback to "no gain" is the
  // failure mode this whole framework exists to prevent.
  const gain = paramCenter.get(gainKey);
  const gained = rawValue * gain;
  if (!(gained > 0)) return 0;        // NaN and negative both fall here
  return gained < 1 ? gained : 1;
}

/**
 * Convenience helper for call sites that want to publish BOTH the
 * raw AND post-processed value to CPC in a single batch. Returns
 * the pair so the caller can splat it into `setMany`.
 *
 * @example
 *   const { raw, post } = processAndPair(paramCenter, 'micLow', lowRaw);
 *   paramCenter.setMany([
 *     { kind: 'scalar', key: 'micLowRaw', value: raw  },
 *     { kind: 'scalar', key: 'micLow',    value: post },
 *   ], 'audio', 'audio:mic');
 *
 * @param {{ get: (key: string) => number }} paramCenter
 * @param {string} signalKey
 * @param {number} rawValue
 * @returns {{ raw: number, post: number }}
 */
export function processAndPair(paramCenter, signalKey, rawValue) {
  const post = processSignal(paramCenter, signalKey, rawValue);
  return { raw: rawValue, post };
}

/**
 * Legacy adapter — kept so older call sites that imported applyGain
 * keep working. New code should call `processSignal(pc, signalKey, raw)`
 * instead, which derives the gain key from the signal key via
 * GAIN_BY_KEY (one less thing for the caller to keep in sync).
 *
 * @deprecated use `processSignal(pc, signalKey, raw)` instead.
 * @param {{ get: (key: string) => number }} paramCenter
 * @param {string} gainKey
 * @param {number} value
 * @returns {number}
 */
export function applyGain(paramCenter, gainKey, value) {
  const gain = paramCenter.get(gainKey);
  const gained = value * gain;
  if (!(gained > 0)) return 0;
  return gained < 1 ? gained : 1;
}
