/**
 * Platform-neutral colour-control domain shared by CaptainPad surfaces.
 *
 * This module owns colour math and wire/state shapes only. React Native and
 * browser surfaces keep separate renderers and gesture systems.
 */

export const COLOUR_EPS = 1e-6;
export const CORE_API_VERSION = 1;
export const SCHEME_IDS = Object.freeze([
  'master', 'hue', 'complement', 'contrast',
  'analogous', 'triadic', 'split', 'tetrad', 'golden',
]);
export const SCHEME_BASE_S = 0.95;
export const MONO_STEPS = Object.freeze([1.0, 0.78, 0.58, 0.40, 0.25]);
export const COMP_OFFSETS = Object.freeze([0, 60, 30, -30, -60]);
export const SCHEME_MIN_V = 0.1;
export const SCHEME_ROTATION_MIN_V = 0.25;
export const ANALOGOUS_STEPS = Object.freeze([
  Object.freeze([0, 1]), Object.freeze([15, 1]), Object.freeze([-15, 1]),
  Object.freeze([30, 1]), Object.freeze([-30, 1]),
]);
export const TRIADIC_STEPS = Object.freeze([
  Object.freeze([0, 1]), Object.freeze([120, 1]), Object.freeze([240, 1]),
  Object.freeze([0, 0.55]), Object.freeze([120, 0.55]),
]);
export const SPLIT_STEPS = Object.freeze([
  Object.freeze([0, 1]), Object.freeze([150, 1]), Object.freeze([210, 1]),
  Object.freeze([150, 0.55]), Object.freeze([210, 0.55]),
]);
export const TETRAD_STEPS = Object.freeze([
  Object.freeze([0, 1]), Object.freeze([90, 1]), Object.freeze([180, 1]),
  Object.freeze([270, 1]), Object.freeze([0, 0.55]),
]);
export const GOLDEN_ANGLE_DEG = 137.5;
export const MIN_CONTINUOUS_FADE_S = 0.1;
export const MIN_CONTINUOUS_METHOD_FADE_S = 0.1;

export function colour(h, s, v) {
  return { h, s, v };
}

export function asHsv(channel) {
  return typeof channel === 'number'
    ? { h: channel, s: 1, v: 1 }
    : { h: channel.h, s: channel.s, v: channel.v };
}

export function channelForWire(value) {
  return Math.abs(value.s - 1) < COLOUR_EPS && Math.abs(value.v - 1) < COLOUR_EPS
    ? value.h
    : { h: value.h, s: value.s, v: value.v };
}

export function rotateHue(h, deg) {
  const wrappedDegrees = ((deg % 360) + 360) % 360;
  return (h + wrappedDegrees / 360) % 1;
}

export function schemeFromSteps(steps, baseH) {
  return steps.map(([deg, value]) => colour(
    rotateHue(baseH, deg),
    SCHEME_BASE_S,
    Math.max(SCHEME_ROTATION_MIN_V, value),
  ));
}

export function generateScheme(scheme, baseH) {
  switch (scheme) {
    case 'master':
      return MONO_STEPS.map(() => colour(baseH, SCHEME_BASE_S, 1));
    case 'hue':
      return MONO_STEPS.map((value) => colour(
        baseH,
        SCHEME_BASE_S,
        Math.max(SCHEME_MIN_V, value),
      ));
    case 'complement':
      return COMP_OFFSETS.map((deg) => colour(rotateHue(baseH, deg), SCHEME_BASE_S, 1));
    case 'contrast':
      return [0, 1, 2, 3, 4].map((index) => colour(
        rotateHue(baseH, 72 * index),
        SCHEME_BASE_S,
        1,
      ));
    case 'analogous':
      return schemeFromSteps(ANALOGOUS_STEPS, baseH);
    case 'triadic':
      return schemeFromSteps(TRIADIC_STEPS, baseH);
    case 'split':
      return schemeFromSteps(SPLIT_STEPS, baseH);
    case 'tetrad':
      return schemeFromSteps(TETRAD_STEPS, baseH);
    case 'golden':
      return schemeFromSteps(
        [0, 1, 2, 3, 4].map((index) => [GOLDEN_ANGLE_DEG * index, 1]),
        baseH,
      );
    default:
      throw new Error(`[colors_window] unknown scheme '${scheme}'`);
  }
}

export function orbitDistance(selection, ringLength) {
  for (const index of selection) {
    if (!Number.isInteger(index) || index < 0 || index >= ringLength) {
      throw new Error(
        `[colors_window] orbit selection [${selection[0]}, ${selection[1]}] `
          + `is outside a ring of ${ringLength}`,
      );
    }
  }
  const distance = (((selection[1] - selection[0]) % ringLength) + ringLength) % ringLength;
  if (distance === 0) {
    throw new Error(
      '[colors_window] COLOUR A and COLOUR B are on the same slot — '
        + 'an orbit of distance 0 would crossfade a colour to itself',
    );
  }
  return distance;
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * THE ORBIT'S STEP (docs/75 §4) — how many slots the WINDOW ITSELF advances
 * each turn. This is distinct from `distance` (`d`), the fixed spacing
 * between the window's two ends: `d` says how far apart COLOUR A and COLOUR B
 * sit, `s` says how far the whole window jumps to reach the NEXT turn.
 *
 * At `s = 1` (the pre-orbit behaviour, every ring ever posted before this)
 * each turn's TRAILING channel is exactly last turn's LEADING channel — a
 * one-colour shift register, not two fresh colours moving — which is the
 * defect the operator named ("the colors aren't window turning correctly.
 * We need to select two, and the window will move both in a rotating window
 * queue style").
 *
 * THE FIX: the smallest `s >= 1` for which two CONSECUTIVE windows never
 * share a slot — `{0, d} ∩ {s, s+d} = ∅ (mod n)` — so every turn hands the
 * rig two colours neither channel showed a moment ago. `gcd(s, n) === 1` is
 * required too, so a full lap of `n` turns still visits every slot exactly
 * once and wraps cleanly instead of orbiting a subset of the ring forever.
 *
 * When NO such `s` exists — the crossfade's 2-slot ring can never produce
 * disjoint windows (there are only two slots to share), and the same is true
 * of any ring too short for a window to dodge itself — the search returns
 * `1`: today's behaviour, because there is nothing to fix. This is what
 * keeps the crossfade wire, and every ring shorter than 5, byte-identical.
 */
export function orbitStep(distance, ringLength) {
  const n = ringLength;
  const d = ((distance % n) + n) % n;
  for (let s = 1; s < n; s++) {
    if (gcd(s, n) !== 1) continue;
    const b0 = ((s % n) + n) % n;
    const b1 = ((s + d) % n + n) % n;
    if (b0 !== 0 && b0 !== d && b1 !== 0 && b1 !== d) return s;
  }
  return 1;
}

export function orbitPairs(colours, selection) {
  if (colours.length < 2) {
    throw new Error(`orbitPairs needs at least 2 colours, got ${colours.length}`);
  }
  const ringLength = colours.length;
  const distance = orbitDistance(selection, ringLength);
  const step = orbitStep(distance, ringLength);
  return colours.map((_, index) => ({
    c1: channelForWire(colours[(selection[0] + index * step) % ringLength]),
    c2: channelForWire(colours[(selection[0] + index * step + distance) % ringLength]),
  }));
}

export function turnsPairs(colours) {
  return orbitPairs(colours, [0, 1]);
}

export function assertRotationTiming(holdS, fadeS) {
  if (!(holdS >= 0)) {
    throw new Error(`HOLD must be 0 (continuous) or a positive number of seconds, got ${holdS}`);
  }
  if (!(fadeS > 0)) {
    throw new Error(`FADE must be a positive number of seconds, got ${fadeS}`);
  }
  if (holdS === 0 && fadeS < MIN_CONTINUOUS_FADE_S) {
    throw new Error(
      `CONT (no hold) needs a fade of at least ${MIN_CONTINUOUS_FADE_S}s — `
        + 'otherwise the rig hard-cuts on a spin loop.',
    );
  }
}

export function rotationAutopilotPatch(colours, holdS, fadeS, selection) {
  assertRotationTiming(holdS, fadeS);
  const pairSelection = selection || [0, 1];
  return {
    active: true,
    shuffle: false,
    delay_s: holdS,
    transitionMs: Math.round(fadeS * 1000),
    palettes: orbitPairs(colours, pairSelection),
  };
}

export function turnsAutopilotPatch(colours, holdS, fadeS, selection) {
  return rotationAutopilotPatch(colours, holdS, fadeS, selection);
}

export function crossfadeAutopilotPatch(hA, hB, holdS, fadeS) {
  return rotationAutopilotPatch(
    [colour(hA, 1, 1), colour(hB, 1, 1)],
    holdS,
    fadeS,
  );
}

export function assertMethodTiming(holdS, fadeS) {
  if (!(holdS >= 0)) {
    throw new Error(
      `METHOD HOLD must be 0 (continuous) or a positive number of seconds, got ${holdS}`,
    );
  }
  if (!(fadeS > 0)) {
    throw new Error(`METHOD FADE must be a positive number of seconds, got ${fadeS}`);
  }
  if (holdS === 0 && fadeS < MIN_CONTINUOUS_METHOD_FADE_S) {
    throw new Error(
      `CONT (no method hold) needs a fade of at least ${MIN_CONTINUOUS_METHOD_FADE_S}s — `
        + 'otherwise the rig hard-cuts on a spin loop.',
    );
  }
}

export function assertSchemeSubset(schemes) {
  if (!schemes || schemes.length === 0) {
    throw new Error('The cycle needs at least one method.');
  }
  const seen = new Set();
  for (const scheme of schemes) {
    if (!SCHEME_IDS.includes(scheme)) {
      throw new Error(`"${scheme}" is not a known method.`);
    }
    if (seen.has(scheme)) {
      throw new Error(`The cycle lists ${scheme.toUpperCase()} twice — it is a SET of methods.`);
    }
    seen.add(scheme);
  }
  return [...schemes];
}

export function followNoteAutopilotPatch(args) {
  const schemes = assertSchemeSubset(args.schemes);
  assertMethodTiming(args.methodHoldS, args.methodFadeS);
  if (!(args.noteFadeMs >= 0) || !Number.isFinite(args.noteFadeMs)) {
    throw new Error(
      `NOTE FADE must be 0 (snap) or a positive number of milliseconds, got ${args.noteFadeMs}`,
    );
  }
  if (args.sel[0] === args.sel[1]) {
    throw new Error(
      `T${args.sel[0] + 1} cannot feed BOTH A and B — pick a different slot for one of them.`,
    );
  }
  return {
    active: true,
    mode: 'followNote',
    followNote: {
      schemes,
      methodHoldS: args.methodHoldS,
      methodFadeS: args.methodFadeS,
      noteFadeMs: args.noteFadeMs,
      sel: [args.sel[0], args.sel[1]],
      shuffle: args.shuffle === true,
    },
  };
}

export function paletteWritePayload(h1, h2) {
  return {
    colorPalette1: { h: h1, s: 1, v: 1 },
    colorPalette2: { h: h2, s: 1, v: 1 },
  };
}

function normalizeMode(value, fallback) {
  if (value === 'palettes' || value === 'followNote') return value;
  if (value === undefined) return fallback;
  throw new Error(`colorAutopilot.mode must be palettes or followNote, got ${JSON.stringify(value)}`);
}

function cloneColorValue(value) {
  if (Array.isArray(value)) return value.map(cloneColorValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneColorValue(entry)]),
    );
  }
  return value;
}

/**
 * Reconcile a GET/WS colour-autopilot payload into one stable client shape.
 * Runtime fields are cleared outside follow-note mode so stale note facts can
 * never survive a mode change.
 */
export function reduceColorControlState(previous, payload) {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
    throw new Error('previous color control state must be an object');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('color control payload must be an object');
  }
  const mode = normalizeMode(payload.mode, previous.mode || 'palettes');
  const next = {
    ...previous,
    active: typeof payload.active === 'boolean' ? payload.active : previous.active,
    mode,
    palettes: Array.isArray(payload.palettes)
      ? payload.palettes.map((entry) => (
        typeof entry === 'object' && entry !== null ? cloneColorValue(entry) : entry
      ))
      : (mode === 'followNote' ? [] : previous.palettes),
  };
  for (const key of ['delay_s', 'transitionMs', 'nextSwapAtMs']) {
    if (typeof payload[key] === 'number' || payload[key] === null) next[key] = payload[key];
  }
  if (typeof payload.shuffle === 'boolean') next.shuffle = payload.shuffle;
  if (payload.followNote && typeof payload.followNote === 'object' && !Array.isArray(payload.followNote)) {
    next.followNote = cloneColorValue(payload.followNote);
  }
  if (mode === 'followNote') {
    next.currentScheme = payload.currentScheme ?? null;
    next.notePc = payload.notePc ?? null;
    next.noteHue = payload.noteHue ?? null;
    next.nextMethodAtMs = payload.nextMethodAtMs ?? null;
  } else {
    delete next.currentScheme;
    delete next.notePc;
    delete next.noteHue;
    delete next.nextMethodAtMs;
  }
  return next;
}
