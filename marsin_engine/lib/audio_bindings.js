// audio_bindings.js - bind one audio signal to one effect slot or one group.
//
// WHY THIS EXISTS ALONGSIDE modulation_engine.js
//
// The modulation engine already maps an audio source onto a target with a
// curve, and it is the right tool - but its v1 target scope is 'pattern': the
// target must be a WASM export on the ACTIVE PATTERN, and the mappings ride on
// a playlist entry. Neither an effect slot nor a lighting group is addressable
// that way, and the operator surface needs to bind them per button and per
// fader, live, with no playlist involved.
//
// So this module owns the operator-facing binding table and turns it into a
// plain 0..1 GAIN per effect slot and per group. It deliberately does NOT
// reach into the engine: it is given already-normalised source values and
// returns numbers. Where those numbers are applied is the caller's business.
//
// TWO MODES, because one behaviour cannot serve all nine signals:
//
//   level  the gain FOLLOWS the signal. Bind HIGH to a group and it breathes
//          with the hi-hats. `depth` sets how much of the range the signal
//          owns: 1 = full authority, 0 = bound but inert.
//
//   hit    the gain is an ENVELOPE fired when the signal crosses `threshold`
//          going up, then decays. Bind KICK to a strobe and it punches once
//          per kick instead of stuttering with the waveform.
//
// Both hand back a 0..1 gain so every consumer treats them identically.
//
// A binding whose source is not in the incoming values is REPORTED, not
// silently treated as zero or as one - a missing signal means the Companion
// stopped sending, and a rig that quietly carries on at full brightness (or
// goes black) is exactly the fallback the codex forbids.

/** Modes a binding can run in. */
export const BINDING_MODES = Object.freeze(['level', 'hit']);

/** Scopes a binding can target. */
export const BINDING_SCOPES = Object.freeze(['effects', 'groups']);

// Signals that carry TEMPO rather than loudness. An effect bound to one of
// these in level mode is locked to the beat grid instead of having its depth
// ridden — see the tempoLocked block in evaluate(). `bpmPulse` is the engine's
// synthetic beat envelope (engine.js: `fall * fall`), which is precisely the
// shape that produced the operator's "it just pulses" complaint when it was
// multiplied into an effect's magnitude.
export const TEMPO_SOURCES = Object.freeze(['bpmPulse']);

const DEFAULT_DEPTH = 1;
const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_DECAY_MS = 220;
/** Below this the signal is treated as released, so a hit can re-arm. */
const RELEASE_FACTOR = 0.75;

/**
 * Validate one binding. Returns { ok, binding } or { ok:false, error }.
 * Malformed input is rejected with a specific message rather than coerced.
 */
export function validateBinding(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'binding must be an object' };
  }
  // A binding may name ONE source or SEVERAL. Several are combined by MAX:
  // whichever checked stem is loudest right now drives the target. Max rather
  // than sum because summing four stems clips to full and the fader stops
  // saying anything; max keeps every stem able to speak on its own.
  let sources;
  if (Array.isArray(raw.sources)) {
    sources = raw.sources.filter(x => typeof x === 'string' && x);
    if (!sources.length) return { ok: false, error: 'binding.sources must contain at least one signal key' };
  } else if (typeof raw.source === 'string' && raw.source) {
    sources = [raw.source];
  } else {
    return { ok: false, error: 'binding needs a source (or a non-empty sources list)' };
  }
  const mode = raw.mode === undefined ? 'level' : raw.mode;
  if (!BINDING_MODES.includes(mode)) {
    return { ok: false, error: `binding.mode='${mode}' must be one of ${BINDING_MODES.join('|')}` };
  }
  const num = (v, d) => (v === undefined ? d : v);
  const depth = num(raw.depth, DEFAULT_DEPTH);
  const threshold = num(raw.threshold, DEFAULT_THRESHOLD);
  const decayMs = num(raw.decayMs, DEFAULT_DECAY_MS);
  if (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0 || depth > 1) {
    return { ok: false, error: `binding.depth=${depth} must be a number in [0,1]` };
  }
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    return { ok: false, error: `binding.threshold=${threshold} must be a number in [0,1]` };
  }
  if (typeof decayMs !== 'number' || !Number.isFinite(decayMs) || decayMs < 0) {
    return { ok: false, error: `binding.decayMs=${decayMs} must be a non-negative number` };
  }
  return { ok: true, binding: { sources, source: sources[0], mode, depth, threshold, decayMs } };
}

export class AudioBindings {
  constructor() {
    /** scope -> id -> binding */
    this.table = { effects: {}, groups: {} };
    /** hit-envelope state, keyed `${scope}:${id}` */
    this._hit = {};
    /** Source keys asked for but absent from the last evaluation. */
    this.missingSources = [];
  }

  /**
   * Add or replace one binding. `id` is an effect slot id or a group name.
   * A null/undefined binding CLEARS it.
   */
  set(scope, id, raw) {
    if (!BINDING_SCOPES.includes(scope)) {
      throw new Error(`AudioBindings.set: scope='${scope}' must be one of ${BINDING_SCOPES.join('|')}`);
    }
    const key = String(id);
    if (raw === null || raw === undefined) {
      delete this.table[scope][key];
      delete this._hit[`${scope}:${key}`];
      return null;
    }
    const v = validateBinding(raw);
    if (!v.ok) throw new Error(`AudioBindings.set(${scope},${key}): ${v.error}`);
    this.table[scope][key] = v.binding;
    return v.binding;
  }

  clearAll() {
    this.table = { effects: {}, groups: {} };
    this._hit = {};
    this.missingSources = [];
  }

  getAll() {
    return {
      effects: JSON.parse(JSON.stringify(this.table.effects)),
      groups: JSON.parse(JSON.stringify(this.table.groups)),
    };
  }

  /**
   * Turn the table into gains.
   *
   * @param {object} sourceValues  key -> already-normalised 0..1 value.
   * @param {number} nowMs
   * @param {number} dtMs          ms since the previous evaluate call.
   * @returns {{effects: object, groups: object, missing: string[]}}
   */
  evaluate(sourceValues, nowMs, dtMs) {
    const out = { effects: {}, groups: {}, missing: [], tempoLocked: {} };
    const seenMissing = {};
    for (const scope of BINDING_SCOPES) {
      const rows = this.table[scope];
      for (const id of Object.keys(rows)) {
        const b = rows[id];
        // MAX across every checked stem. A stem that is not arriving is
        // skipped, not counted as zero - one silent stem must not drag a
        // working one down.
        let raw;
        let anyPresent = false;
        for (const key of b.sources) {
          const val = sourceValues ? sourceValues[key] : undefined;
          if (typeof val !== 'number' || !Number.isFinite(val)) {
            if (!seenMissing[key]) { seenMissing[key] = 1; out.missing.push(key); }
            continue;
          }
          anyPresent = true;
          if (raw === undefined || val > raw) raw = val;
        }
        if (!anyPresent) {
          // NONE of the chosen signals are arriving. Leave the target alone
          // (gain 1) rather than inventing a value or blacking it out.
          out[scope][id] = 1;
          continue;
        }
        const v = raw < 0 ? 0 : (raw > 1 ? 1 : raw);
        out[scope][id] = b.mode === 'hit'
          ? this._hitGain(`${scope}:${id}`, b, v, dtMs)
          : 1 - b.depth + b.depth * v;

        // TEMPO LOCK, not a level ride (operator: "it just goes to pulse rather
        // than driving the actual effect that I select").
        //
        // A tempo source in LEVEL mode used to multiply the effect's magnitude
        // — and every effect's declared primary is a DEPTH (Wash Depth, Pump
        // Depth, Sweep Depth, Flash Strength...), so the only thing the music
        // could ever do was make the effect bigger and smaller on the beat.
        // That is the pulse, and it happened on every effect by construction.
        //
        // Flagged here rather than guessed downstream: this is the only place
        // that knows WHICH SIGNAL a slot is bound to. An effect that owns a
        // rate/sync parameter is locked to the tempo instead, and its depth is
        // left exactly where the operator set it. HIT mode is untouched — a
        // stab on the beat is already "the effect doing its thing".
        if (scope === 'effects' && b.mode !== 'hit'
            && b.sources.every(k => TEMPO_SOURCES.includes(k))) {
          out.tempoLocked[id] = true;
        }
      }
    }
    this.missingSources = out.missing;
    return out;
  }

  /**
   * Envelope for 'hit'. Rises to full on a threshold crossing, decays after.
   * The re-arm is at a FRACTION of the threshold, not at the threshold itself:
   * a signal hovering on the line would otherwise re-fire every frame and read
   * as a buzz rather than a hit.
   */
  _hitGain(key, b, v, dtMs) {
    let st = this._hit[key];
    if (!st) { st = this._hit[key] = { level: 0, armed: true }; }
    if (st.armed && v >= b.threshold) {
      st.level = 1;
      st.armed = false;
    } else if (!st.armed && v < b.threshold * RELEASE_FACTOR) {
      st.armed = true;
    }
    if (st.level > 0 && b.decayMs > 0) {
      st.level -= (dtMs || 0) / b.decayMs;
      if (st.level < 0) st.level = 0;
    } else if (b.decayMs === 0) {
      st.level = 0;
    }
    return 1 - b.depth + b.depth * st.level;
  }
}
