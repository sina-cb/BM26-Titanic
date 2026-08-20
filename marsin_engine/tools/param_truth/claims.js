// claims.js — map a parameter NAME to the behavioural claim it makes.
//
// A slider called `sliderLocalSpeed` claims "I change how fast this moves".
// That claim is testable: sweep it and the measured temporal rate must move
// monotonically and by a real margin. This file holds the name→claim table and
// every threshold, in one place, so a verdict can be traced to a number rather
// than to a judgement call.
//
// Names are tokenised on camelCase boundaries (`sliderWhiteKick` →
// ['white','kick']) and matched against the token table below. The FIRST
// family whose token appears wins, in the priority order of FAMILY_ORDER —
// so `whiteKick` is a WHITE claim (it promises white emitter level) rather
// than an AUDIO_DRIVE one, and `vortexSpeed` is SPEED.
//
// A name with no recognised token is deliberately NOT guessed at. It is
// classified UNKNOWN_CLAIM and its measured effect is recorded verbatim for
// human judgement (codex P0: never invent meaning).

/** Sweep points every parameter is measured at, in 0..1 control units. */
export const SWEEP_POINTS = [0.0, 0.25, 0.5, 0.75, 1.0];

/**
 * Frames rendered per sweep point, and leading frames discarded. At the show's
 * 40 fps this is a 3.6 s measurement window after a 0.9 s warmup — long enough
 * for the slowest breath/tide patterns to complete a cycle, so a slow pattern
 * is not mistaken for a dead one.
 */
export const MEASURE_FRAMES = 144;
export const WARMUP_FRAMES = 36;

/**
 * A DIRECTION claim is measured on a separate short window rendered from
 * t = 0 with NO warmup. Sweep patterns (cylon, chasers) ping-pong, so their
 * net drift over a long window averages to ~0 and cannot show a reversal; the
 * launch window catches which way the pattern sets off, which is exactly what
 * a direction knob promises.
 */
export const LAUNCH_FRAMES = 20;

/**
 * Period of the square wave used to probe a control that measured DEAD under
 * a static sweep. 40 frames at 40 fps = one pulse per second — slow enough for
 * a shockwave/flash envelope to decay between hits, fast enough to land
 * several pulses inside the measurement window.
 */
export const PULSE_PERIOD_FRAMES = 40;

// ── Thresholds ──────────────────────────────────────────────────────────
//
// All of these are in the normalised units metrics.js produces, i.e. a raw
// feature delta divided by FEATURE_SCALE. They are absolute, shared across
// every pattern, and never adapted per pattern.
export const THRESHOLDS = {
  // Below this normalised change on EVERY feature, the parameter did nothing
  // we can see anywhere in its range.
  dead: 0.005,
  // Between `dead` and `weak` the effect is real but so small an operator
  // would not find it on a fader.
  weak: 0.020,
  // A claim-specific feature must move at least this much to count as the
  // parameter honouring its name.
  claim: 0.020,
  // Emitter-level claims (white / amber / UV) are checked on a single channel
  // mean, where a smaller absolute swing is still plainly visible on the rig.
  emitter: 0.010,
  // Level-style claims (brightness, darkness, emitters, contrast) also pass on
  // RATIO. A sparse pattern — sparkle, glints, a single comet — can double the
  // light it puts out while barely moving the model-wide mean, and an operator
  // plainly sees that. A ratio pass still requires `relFloor` of absolute
  // movement so a ratio between two near-zero numbers cannot manufacture one.
  levelRatio: 1.25,
  relFloor: 0.0005,
  // A SPEED claim is judged on RATIO, not on absolute change: doubling a slow
  // pattern's rate is a small absolute delta but an obvious visual one.
  speedRatio: 1.25,
  // Signed drift below this (bins/frame) is not a trustworthy direction.
  driftFloor: 0.004,
  // Correlation between the per-frame velocity series at the bottom and the
  // top of a direction slider's range. Genuinely reversed motion runs opposite
  // and lands near -1; unchanged motion lands near +1. -0.3 is comfortably
  // inside the reversed half while leaving a wide neutral band.
  reversalCorrelation: -0.3,
  // Fraction by which a sweep series may dip against its overall trend and
  // still count as monotonic (5 % of the series range).
  monotonicSlack: 0.05,
  // Multiplier on the measured per-pattern noise floor. A change must clear
  // `noiseMultiple × noise` as well as its absolute threshold.
  noiseMultiple: 3.0,
};

export const FAMILY = {
  SPEED: 'SPEED',
  DIRECTION: 'DIRECTION',
  HUE: 'HUE',
  BRIGHTNESS: 'BRIGHTNESS',
  DARKNESS: 'DARKNESS',
  WHITE: 'WHITE',
  UV: 'UV',
  WARMTH: 'WARMTH',
  SPATIAL: 'SPATIAL',
  TRAIL: 'TRAIL',
  CONTRAST: 'CONTRAST',
  MAGNITUDE: 'MAGNITUDE',
  UNKNOWN_CLAIM: 'UNKNOWN_CLAIM',
};

// Families whose claim is only "there is an amount of me". They can be DEAD or
// WEAK, but never WRONG — the name makes no directional promise to contradict.
export const NON_FALSIFIABLE = new Set([FAMILY.MAGNITUDE, FAMILY.UNKNOWN_CLAIM]);

// Priority order. The first family with a token hit claims the name.
const FAMILY_ORDER = [
  FAMILY.DIRECTION,
  FAMILY.SPEED,
  FAMILY.UV,
  FAMILY.WHITE,
  FAMILY.WARMTH,
  FAMILY.HUE,
  FAMILY.DARKNESS,
  FAMILY.TRAIL,
  FAMILY.SPATIAL,
  FAMILY.CONTRAST,
  FAMILY.BRIGHTNESS,
  FAMILY.MAGNITUDE,
];

const TOKENS = {
  [FAMILY.DIRECTION]: ['direction', 'dir', 'reverse', 'heading', 'polarity', 'flip'],
  [FAMILY.SPEED]: ['speed', 'rate', 'tempo', 'freq', 'frequency', 'cadence', 'churn', 'rpm'],
  [FAMILY.UV]: ['uv'],
  [FAMILY.WHITE]: ['white', 'amber'],
  [FAMILY.WARMTH]: ['warmth', 'warm', 'temperature', 'tint'],
  [FAMILY.HUE]: ['hue', 'color', 'colour', 'palette', 'chroma', 'saturation', 'sat',
    'rainbow', 'spectrum'],
  [FAMILY.DARKNESS]: ['blackout', 'void', 'shadow', 'darkness', 'dim', 'gap'],
  [FAMILY.TRAIL]: ['trail', 'tail', 'fade', 'decay', 'afterglow', 'persistence',
    'smear', 'comet'],
  [FAMILY.SPATIAL]: ['radius', 'width', 'size', 'scale', 'spread', 'length', 'thickness',
    'detail', 'density', 'count', 'sections', 'section', 'feather', 'softness',
    'sharpness', 'sharp', 'focus', 'zoom', 'grain', 'bands', 'band', 'rings', 'ring',
    'beam', 'wedge', 'cells', 'cell', 'segments', 'ribbons', 'fronds', 'particles',
    'lattice', 'dune', 'spacing', 'coverage', 'reach', 'span', 'height', 'core'],
  [FAMILY.CONTRAST]: ['contrast'],
  [FAMILY.BRIGHTNESS]: ['level', 'brightness', 'bright', 'intensity', 'luminance',
    'lift', 'gain', 'glow', 'output'],
  [FAMILY.MAGNITUDE]: ['depth', 'amount', 'mix', 'blend', 'strength', 'impact', 'pulse',
    'swell', 'bite', 'flash', 'heat', 'pressure', 'foam', 'floor', 'base', 'kick',
    'audio', 'bass', 'mid', 'high', 'low', 'shimmer', 'sparkle', 'twinkle', 'noise',
    'jitter', 'wobble', 'chaos', 'turbulence', 'weight', 'bias', 'boost', 'drive',
    'energy', 'power', 'hit', 'punch', 'swing', 'sway', 'breath', 'wave', 'ripple',
    'warp', 'skew', 'offset', 'phase', 'balance', 'threshold', 'response', 'attack',
    'release', 'ball', 'signal', 'vintage', 'wall', 'vent', 'ember', 'boiler', 'wood',
    'wind', 'orbit', 'vortex', 'neighbor', 'neighbour', 'baseline', 'blinder'],
};

/**
 * Split a control name into lowercase tokens.
 *
 * @param {string} controlName — e.g. `sliderWhiteKick`.
 * @returns {string[]} e.g. ['white', 'kick'].
 */
export function tokenise(controlName) {
  const bare = controlName.replace(/^slider/, '');
  return bare
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map(t => t.toLowerCase());
}

/**
 * Classify a control name into the behavioural family it claims.
 *
 * `localSpeed` is a SPEED claim; `whiteKick` a WHITE claim; `zorble` an
 * UNKNOWN_CLAIM. Returns the matched token so a report can show WHY a name was
 * read the way it was.
 *
 * @param {string} controlName
 * @returns {{ family: string, token: string|null, tokens: string[] }}
 */
export function claimOf(controlName) {
  const tokens = tokenise(controlName);
  for (const family of FAMILY_ORDER) {
    for (const t of tokens) {
      if (TOKENS[family].includes(t)) return { family, token: t, tokens };
    }
  }
  return { family: FAMILY.UNKNOWN_CLAIM, token: null, tokens };
}

/**
 * Is a numeric series monotonic (either direction) within slack?
 *
 * @param {number[]} series
 * @returns {{ monotonic: boolean, direction: number }} direction +1 rising,
 *   -1 falling, 0 flat/non-monotonic.
 */
export function monotonicity(series) {
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const range = hi - lo;
  if (range <= 0) return { monotonic: true, direction: 0 };
  const slack = range * THRESHOLDS.monotonicSlack;

  let rising = true;
  let falling = true;
  for (let i = 1; i < series.length; i++) {
    if (series[i] < series[i - 1] - slack) rising = false;
    if (series[i] > series[i - 1] + slack) falling = false;
  }
  if (rising && !falling) return { monotonic: true, direction: 1 };
  if (falling && !rising) return { monotonic: true, direction: -1 };
  if (rising && falling) return { monotonic: true, direction: 0 };
  return { monotonic: false, direction: 0 };
}
