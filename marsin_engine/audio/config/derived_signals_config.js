import { BAND_ONSET_DEFAULTS } from '../signals/band_onsets.js';
import { DROP_COUNTDOWN_DEFAULTS } from '../signals/drop_countdown.js';
import {
  NOTE_ESTIMATOR_DEFAULTS,
  requireNoteEstimatorOrdering,
  validateNoteEstimatorField,
} from '../signals/note_estimator.js';
import { PARTY_MODE_DEFAULTS } from '../signals/party_mode.js';
import { PHRASE_TRACKER_DEFAULTS } from '../signals/phrase_tracker.js';
import { SUB_BASS_DEFAULTS } from '../signals/sub_bass.js';
import { SWITCH_DEFAULTS } from '../signals/switch_signals.js';
import { TRACK_CHANGE_DEFAULTS } from '../signals/track_change.js';

function frozenCopy(value) {
  return Object.freeze({ ...value });
}

// Bright note colours transcribed from the operator's circle-of-fifths wheel.
// Values are HUE ONLY in the engine's normalized [0,1) hue domain. Patterns
// keep full control of saturation/value; the Companion preview deliberately
// renders these at HSV saturation=100%, value=100%.
export const NOTE_COLOR_PITCH_KEYS = Object.freeze([
  'c', 'cSharp', 'd', 'dSharp', 'e', 'f',
  'fSharp', 'g', 'gSharp', 'a', 'aSharp', 'b',
]);

export const NOTE_COLOR_WHEEL_DEFAULTS = Object.freeze({
  c: 0.15,       // 54°  yellow
  cSharp: 0.94,  // 338° rose (D♭ sector)
  d: 0.44,       // 158° green-cyan
  dSharp: 0.04,  // 14°  orange-red (E♭ sector)
  e: 0.62,       // 223° blue
  f: 0.12,       // 43°  amber
  fSharp: 0.86,  // 310° magenta
  g: 0.27,       // 97°  green
  gSharp: 0.99,  // 356° red (A♭ sector)
  a: 0.56,       // 202° cyan-blue
  aSharp: 0.08,  // 29°  orange (B♭ sector)
  b: 0.70,       // 252° violet
});

/** Canonical, corpus-tuned configuration for operator-facing derived signals. */
export const DERIVED_SIGNALS_DEFAULTS = Object.freeze({
  noteTracking: frozenCopy(NOTE_ESTIMATOR_DEFAULTS),
  noteColors: frozenCopy(NOTE_COLOR_WHEEL_DEFAULTS),
  party: frozenCopy(PARTY_MODE_DEFAULTS),
  trackChange: frozenCopy(TRACK_CHANGE_DEFAULTS),
  switch: frozenCopy(SWITCH_DEFAULTS),
  bandOnsets: frozenCopy(BAND_ONSET_DEFAULTS),
  chestHit: frozenCopy(SUB_BASS_DEFAULTS),
  phrase: frozenCopy(PHRASE_TRACKER_DEFAULTS),
  dropCountdown: frozenCopy(DROP_COUNTDOWN_DEFAULTS),
});

export const DERIVED_SIGNAL_GROUPS = Object.freeze(Object.keys(DERIVED_SIGNALS_DEFAULTS));

export const DERIVED_SIGNALS_LIVE_FIELDS = Object.freeze({
  noteTracking: Object.freeze(Object.keys(NOTE_ESTIMATOR_DEFAULTS)),
  noteColors: Object.freeze([...NOTE_COLOR_PITCH_KEYS]),
  party: Object.freeze([
    'loudTau', 'onThresh', 'offThresh', 'holdMs', 'offConfirmMs', 'warmupMs',
  ]),
  trackChange: Object.freeze([
    'loudTau', 'onThresh', 'offThresh', 'silenceConfirmMs', 'gapMinMs',
    'changeRefractoryMs', 'tempoUnlockMs', 'tempoJumpBpm', 'warmupMs',
  ]),
  switch: Object.freeze(Object.keys(SWITCH_DEFAULTS)),
  bandOnsets: Object.freeze(Object.keys(BAND_ONSET_DEFAULTS)),
  chestHit: Object.freeze(Object.keys(SUB_BASS_DEFAULTS)),
  phrase: Object.freeze(Object.keys(PHRASE_TRACKER_DEFAULTS)),
  dropCountdown: Object.freeze(Object.keys(DROP_COUNTDOWN_DEFAULTS)),
});

// noteTracking is absent from every table below on purpose: its types and
// ranges come from NOTE_ESTIMATOR_RANGES (see validateField).
const BOOLEAN_FIELDS = Object.freeze({
  switch: Object.freeze(['quantizeToBeat']),
});

const INTEGER_FIELDS = Object.freeze({
  bandOnsets: Object.freeze(['warmupHops']),
  chestHit: Object.freeze(['warmupHops']),
  phrase: Object.freeze(['phraseBars']),
});

const NORMALIZED_FIELDS = new Set([
  'wLow', 'wMid', 'wHigh',
  'onThresh', 'offThresh', 'energyRegimeHi', 'energyRegimeLo', 'dropPulseFire',
  'slowZoneHi', 'slowZoneLo', 'absFloor', 'emaAlphaUp', 'emaAlphaDown',
  'tHigh', 'tLow', 'downbeatFire', 'dropFire', 'peakScore', 'dropPeakExit',
  'climbFromScore', 'minConfArm', 'beatFire', 'beatRearm',
]);

const STRICT_NORMALIZED_FIELDS = new Set(['emaAlphaUp', 'emaAlphaDown']);

const POSITIVE_FIELDS = new Set([
  'loudTau', 'patternUrgeTau', 'colorUrgeTau', 'threshold', 'droneTau',
  'tempoJumpBpm',
]);

const MILLISECOND_FIELDS = new Set([
  'holdMs', 'offConfirmMs', 'warmupMs', 'silenceConfirmMs', 'gapMinMs',
  'changeRefractoryMs', 'tempoUnlockMs', 'startupGuardMs', 'patternMinDwellMs',
  'dropMinDwellMs', 'regimeHoldMs', 'quantizeMaxWaitMs', 'colorMinDwellMs',
  'noteChangeMinDwellMs', 'refractoryMs', 'decayMs', 'dropReanchorMs',
  'peakHoldMs', 'climbWindowMs', 'peakMaxMs', 'dropRefractoryMs', 'pulseDecayMs',
]);

function cloneConfig(config) {
  const out = {};
  for (const group of DERIVED_SIGNAL_GROUPS) out[group] = { ...config[group] };
  return out;
}

function validateField(group, field, value) {
  // noteTracking ranges live with the estimator that consumes them
  // (NOTE_ESTIMATOR_RANGES) so the constructor and this operator-facing
  // validator can never drift apart. They are MUSICAL bounds, deliberately
  // narrower than the generic ones below: a value the Companion UI accepts
  // must still leave a working note tracker.
  if (group === 'noteTracking') {
    validateNoteEstimatorField(field, value, 'audio.derivedSignals.noteTracking');
    return;
  }
  const booleans = BOOLEAN_FIELDS[group] || [];
  if (booleans.includes(field)) {
    if (typeof value !== 'boolean') {
      throw new TypeError(`audio.derivedSignals.${group}.${field} must be a boolean`);
    }
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`audio.derivedSignals.${group}.${field} must be a finite number`);
  }
  if (group === 'noteColors' && (value < 0 || value >= 1)) {
    throw new RangeError(`audio.derivedSignals.noteColors.${field} must be in [0, 1)`);
  }
  const integers = INTEGER_FIELDS[group] || [];
  if (integers.includes(field) && (!Number.isInteger(value) || value < 1 || value > 10000)) {
    throw new RangeError(
      `audio.derivedSignals.${group}.${field} must be an integer in [1, 10000]`,
    );
  }
  if (NORMALIZED_FIELDS.has(field) && (value < 0 || value > 1)) {
    throw new RangeError(`audio.derivedSignals.${group}.${field} must be in [0, 1]`);
  }
  if (STRICT_NORMALIZED_FIELDS.has(field) && (value <= 0 || value > 1)) {
    throw new RangeError(`audio.derivedSignals.${group}.${field} must be in (0, 1]`);
  }
  if (POSITIVE_FIELDS.has(field) && (value <= 0 || value > 600)) {
    throw new RangeError(`audio.derivedSignals.${group}.${field} must be in (0, 600]`);
  }
  if (MILLISECOND_FIELDS.has(field) && (value < 0 || value > 600000)) {
    throw new RangeError(`audio.derivedSignals.${group}.${field} must be in [0, 600000]`);
  }
}

function requireOrdering(config, group, lowField, highField) {
  const values = config[group];
  if (values[lowField] >= values[highField]) {
    throw new RangeError(
      `audio.derivedSignals.${group} requires ${lowField} < ${highField}`,
    );
  }
}

/** Validate a complete derivedSignals configuration. No defaults are filled. */
export function validateDerivedSignalsConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('audio analysis config requires object "audio.derivedSignals"');
  }
  for (const group of Object.keys(config)) {
    if (!DERIVED_SIGNAL_GROUPS.includes(group)) {
      throw new TypeError(`audio.derivedSignals has unknown group "${group}"`);
    }
  }
  for (const group of DERIVED_SIGNAL_GROUPS) {
    const values = config[group];
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new TypeError(`audio analysis config requires object "audio.derivedSignals.${group}"`);
    }
    const defaults = DERIVED_SIGNALS_DEFAULTS[group];
    for (const field of Object.keys(values)) {
      if (!(field in defaults)) {
        throw new TypeError(`audio.derivedSignals.${group} has unknown field "${field}"`);
      }
    }
    for (const field of Object.keys(defaults)) {
      if (!(field in values)) {
        throw new TypeError(`audio analysis config requires "audio.derivedSignals.${group}.${field}"`);
      }
      validateField(group, field, values[field]);
    }
  }
  requireOrdering(config, 'party', 'offThresh', 'onThresh');
  // minPitchHz < maxPitchHz AND nearHoldHops >= holdHops — shared with the
  // estimator's own constructor check, so the two can never disagree.
  requireNoteEstimatorOrdering(config.noteTracking, 'audio.derivedSignals.noteTracking');
  requireOrdering(config, 'trackChange', 'offThresh', 'onThresh');
  requireOrdering(config, 'switch', 'energyRegimeLo', 'energyRegimeHi');
  requireOrdering(config, 'switch', 'slowZoneLo', 'slowZoneHi');
  requireOrdering(config, 'chestHit', 'tLow', 'tHigh');
  requireOrdering(config, 'dropCountdown', 'dropPeakExit', 'peakScore');
  requireOrdering(config, 'dropCountdown', 'climbFromScore', 'peakScore');
  requireOrdering(config, 'dropCountdown', 'beatRearm', 'beatFire');
  for (const group of ['party', 'trackChange']) {
    const weights = config[group].wLow + config[group].wMid + config[group].wHigh;
    if (Math.abs(weights - 1) > 1e-9) {
      throw new RangeError(`audio.derivedSignals.${group} band weights must sum to 1`);
    }
  }
  if (config.dropCountdown.peakHoldMs > config.dropCountdown.peakMaxMs) {
    throw new RangeError(
      'audio.derivedSignals.dropCountdown requires peakHoldMs <= peakMaxMs',
    );
  }
  // NOTE: there is deliberately NO "medianN must be odd" rule. It was a
  // leftover from the original numeric-median implementation, where an even
  // window has no single middle element. The estimator now takes the HISTOGRAM
  // MODE of the pitch-class ring with an explicit tie-break (toward the
  // committed class, then the pending candidate), so window parity carries no
  // meaning at all — an even medianN is exactly as well-defined as an odd one.
  return config;
}

/** Validate a partial live PATCH without inventing omitted values. */
export function validateDerivedSignalsPatch(partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('"derivedSignals" must be an object of {group: fields}');
  }
  const out = {};
  if (Object.keys(partial).length === 0) {
    throw new TypeError('"derivedSignals" patch must contain at least one group');
  }
  for (const [group, values] of Object.entries(partial)) {
    if (!DERIVED_SIGNAL_GROUPS.includes(group)) {
      throw new TypeError(`audio.derivedSignals has unknown group "${group}"`);
    }
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new TypeError(`"derivedSignals.${group}" must be an object of {field: value}`);
    }
    if (Object.keys(values).length === 0) {
      throw new TypeError(`"derivedSignals.${group}" patch must contain at least one field`);
    }
    out[group] = {};
    for (const [field, value] of Object.entries(values)) {
      if (!DERIVED_SIGNALS_LIVE_FIELDS[group].includes(field)) {
        throw new TypeError(`audio.derivedSignals.${group}.${field} is not live-tunable`);
      }
      validateField(group, field, value);
      out[group][field] = value;
    }
  }
  return out;
}

/** Deep-merge a validated partial, then validate all cross-field invariants. */
export function mergeDerivedSignalsConfig(current, partial) {
  validateDerivedSignalsConfig(current);
  const patch = validateDerivedSignalsPatch(partial);
  const next = cloneConfig(current);
  for (const [group, values] of Object.entries(patch)) {
    next[group] = { ...next[group], ...values };
  }
  validateDerivedSignalsConfig(next);
  return next;
}

/** Build the required constructor payload from the effective audio config. */
export function buildDerivedSignalsOptions(audioConfig) {
  if (!audioConfig || typeof audioConfig !== 'object') {
    throw new TypeError('buildDerivedSignalsOptions requires the effective audio config');
  }
  validateDerivedSignalsConfig(audioConfig.derivedSignals);
  return cloneConfig(audioConfig.derivedSignals);
}
