/**
 * colors_window_logic — the PURE brain of the Deck COLORS window
 * (docs/53 §4 two-colour select, §5 PALETTE TURNS).
 *
 * Zero React / React Native imports on purpose: the vitest config only admits
 * pure `.ts` under `components/**`, and every rule that can be stated as a
 * function belongs here rather than inside a component where it can only be
 * checked by eye.
 *
 * The interaction contract this implements is the operator-approved prototype
 * `docs/ui/color_palette_prototype.html` (report _199). Three of its behaviours
 * are load-bearing and are ported EXACTLY, not re-derived:
 *
 *   1. THE PIN POLICY IS ONE FUNCTION. Every write path — wheel, Live Touch
 *      chip, saved pair, show palette — goes through `pinned()`, so what the
 *      wheel can reach and what a slot holds can never disagree. House policy
 *      (docs/36) is S = V = 1: the Deck's two CPC slots are hue-only.
 *
 *   2. SELECTION IS DERIVED, NEVER STORED. A chip is badged iff its colour,
 *      under the pin policy, EQUALS a live slot. Drag the wheel and the badge
 *      leaves, because the chip is no longer what is on the ship. Nothing
 *      caches "which preset is selected", so nothing can go stale.
 *
 *   3. THE GLASS SHOWS THE SHIP. There is no local animation clock anywhere in
 *      this window (docs/55 §2.2, superseding the `_211` preview transport).
 *      The crossfade is a 2-entry rotation on the ENGINE's colour-autopilot
 *      daemon, and the card's wash / blend readout are DERIVED from the
 *      broadcast `colorPalette1/2`. The parked position and the running
 *      position cannot disagree because there is only one source: the rig.
 *      STOP freezes in place because the engine's `_cancelTween` abandons
 *      without writing — the freeze is native, not simulated.
 */

import {
  ANALOGOUS_STEPS as CORE_ANALOGOUS_STEPS,
  COMP_OFFSETS as CORE_COMP_OFFSETS,
  COLOUR_EPS as CORE_COLOUR_EPS,
  GOLDEN_ANGLE_DEG as CORE_GOLDEN_ANGLE_DEG,
  MIN_CONTINUOUS_FADE_S as CORE_MIN_CONTINUOUS_FADE_S,
  MIN_CONTINUOUS_METHOD_FADE_S as CORE_MIN_CONTINUOUS_METHOD_FADE_S,
  MONO_STEPS as CORE_MONO_STEPS,
  SCHEME_BASE_S as CORE_SCHEME_BASE_S,
  SCHEME_IDS as CORE_SCHEME_IDS,
  SCHEME_MIN_V as CORE_SCHEME_MIN_V,
  SCHEME_ROTATION_MIN_V as CORE_SCHEME_ROTATION_MIN_V,
  SPLIT_STEPS as CORE_SPLIT_STEPS,
  TETRAD_STEPS as CORE_TETRAD_STEPS,
  TRIADIC_STEPS as CORE_TRIADIC_STEPS,
  asHsv as coreAsHsv,
  assertMethodTiming as coreAssertMethodTiming,
  assertRotationTiming as coreAssertRotationTiming,
  assertSchemeSubset as coreAssertSchemeSubset,
  channelForWire as coreChannelForWire,
  crossfadeAutopilotPatch as coreCrossfadeAutopilotPatch,
  followNoteAutopilotPatch as coreFollowNoteAutopilotPatch,
  generateScheme as coreGenerateScheme,
  orbitDistance as coreOrbitDistance,
  orbitStep as coreOrbitStep,
  orbitPairs as coreOrbitPairs,
  paletteWritePayload as corePaletteWritePayload,
  reduceColorControlState as coreReduceColorControlState,
  rotateHue as coreRotateHue,
  rotationAutopilotPatch as coreRotationAutopilotPatch,
  schemeFromSteps as coreSchemeFromSteps,
  turnsAutopilotPatch as coreTurnsAutopilotPatch,
  turnsPairs as coreTurnsPairs,
  type ColorAutopilotState as CoreColorAutopilotState,
} from '../../shared/color_control_core.js';

// ── Colours ─────────────────────────────────────────────────────────────────

export type Hsv = { h: number; s: number; v: number };
/** A colour PAIR as the SAVED-PAIR gallery carries it: two hues (S = V = 1).
 *  The A/B surface and its wheel stay hue-only for ever (docs/36); full HSV
 *  exists only inside rotation rings — see `ColorPair` below. */
export type HuePair = { c1: number; c2: number };

/**
 * ONE CHANNEL of a rotation-ring pair on the engine wire (D2, docs/55 §1).
 *
 * A plain number is a HUE that the engine resolves at `s = 1, v = 1` — the
 * historical wire, byte-unchanged. An `{h,s,v}` object carries the colour
 * verbatim, which is what makes the Live Touch MASTER/HUE generators (they
 * vary `v`) expressible at all. Clients EMIT the number form whenever
 * `s = 1 ∧ v = 1` (`channelForWire`), so every hue-only ring keeps exactly the
 * wire it has today.
 */
export type ColorChannel = number | Hsv;
/** A rotation-ring pair: either channel may be a hue or a full colour. */
export type ColorPair = { c1: ColorChannel; c2: ColorChannel };

/** The hue of a channel, whichever form it is in. */
export function hueOf(c: ColorChannel): number {
  return typeof c === 'number' ? c : c.h;
}

/** A channel as a full colour. A bare hue means the engine's pinned s=v=1. */
export function asHsv(c: ColorChannel): Hsv {
  return coreAsHsv(c);
}

/**
 * WIRE MINIMIZATION (docs/55 §1 D2): emit a plain number when the colour is at
 * full saturation and brightness, an object otherwise. Every ring the Deck
 * could already express keeps its exact current wire, so no persisted config
 * changes shape just because the schema widened.
 */
export function channelForWire(c: Hsv): ColorChannel {
  return coreChannelForWire(c);
}

export function colour(h: number, s: number, v: number): Hsv {
  return { h, s, v };
}

/** Two colours are the same when every channel matches to within ε. */
export const COLOUR_EPS = CORE_COLOUR_EPS;
export function sameColour(a: Hsv, b: Hsv): boolean {
  return Math.abs(a.h - b.h) < COLOUR_EPS
    && Math.abs(a.s - b.s) < COLOUR_EPS
    && Math.abs(a.v - b.v) < COLOUR_EPS;
}

/**
 * THE PIN POLICY, in one place (docs/36 house rule; _196 decision 4 confirmed).
 * The Deck's picker is hue-only, so a colour lands as its hue at full
 * saturation and brightness. This is a STATED policy the window shows on its
 * face, not a silent correction.
 */
export function pinned(c: Hsv): Hsv {
  return colour(c.h, 1, 1);
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1;
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

function byte(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 255);
}

export function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${byte(rgb[0])}, ${byte(rgb[1])}, ${byte(rgb[2])})`;
}

export function hsvCss(c: Hsv): string {
  return rgbCss(hsvToRgb(c.h, c.s, c.v));
}

/** Hue → the CSS colour the rig shows for it under the pin policy. */
export function hueCss(h: number): string {
  return rgbCss(hsvToRgb(h, 1, 1));
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Exact inverse of hsvToRgb. A grey has no hue BY DEFINITION, so h = 0 and
 * s = 0 — that is the maths, not a default standing in for a missing value.
 */
export function rgbToHsv(rgb: [number, number, number]): Hsv {
  const [r, g, b] = rgb;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (((h / 6) % 1) + 1) % 1;
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}

// ── OKLCH interpolation ─────────────────────────────────────────────────────
// Ported from marsin_engine/lib/color_transition.js so a blend previewed here
// bends the way the engine's crossfade bends: lightness and chroma move
// linearly, hue takes the SHORTEST arc, and an out-of-gamut result has its
// chroma binary-searched down rather than its channels clipped.

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function srgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

const GAMUT_EPS = 1e-6;
const ACHROMATIC_CHROMA = 1e-4;
const GAMUT_ITERATIONS = 20;

function inGamut(lin: [number, number, number]): boolean {
  return lin[0] >= -GAMUT_EPS && lin[0] <= 1 + GAMUT_EPS
    && lin[1] >= -GAMUT_EPS && lin[1] <= 1 + GAMUT_EPS
    && lin[2] >= -GAMUT_EPS && lin[2] <= 1 + GAMUT_EPS;
}

function encodeClamped(lin: [number, number, number]): [number, number, number] {
  const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return [
    c01(linearToSrgb(c01(lin[0]))),
    c01(linearToSrgb(c01(lin[1]))),
    c01(linearToSrgb(c01(lin[2]))),
  ];
}

function oklabToSrgbGamutMapped(L: number, a: number, b: number): [number, number, number] {
  if (L <= 0) return [0, 0, 0];
  if (L >= 1) return [1, 1, 1];
  const lin = oklabToLinearSrgb(L, a, b);
  if (inGamut(lin)) return encodeClamped(lin);
  let lo = 0, hi = 1;
  for (let i = 0; i < GAMUT_ITERATIONS; i++) {
    const mid = (lo + hi) * 0.5;
    if (inGamut(oklabToLinearSrgb(L, a * mid, b * mid))) lo = mid; else hi = mid;
  }
  return encodeClamped(oklabToLinearSrgb(L, a * lo, b * lo));
}

function endpointLch(rgb: [number, number, number]) {
  const lab = srgbToOklab(rgb[0], rgb[1], rgb[2]);
  const C = Math.hypot(lab[1], lab[2]);
  const hasHue = C > ACHROMATIC_CHROMA;
  return { L: lab[0], C, h: hasHue ? Math.atan2(lab[2], lab[1]) : 0, hasHue };
}

function shortestArc(h1: number, h2: number): number {
  let d = (h2 - h1) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** OKLCH mix of two {h,s,v} colours → a CSS string. t ≤ 0 / t ≥ 1 are exact. */
export function mixHsv(a: Hsv, b: Hsv, t: number): string {
  if (t <= 0) return hsvCss(a);
  if (t >= 1) return hsvCss(b);
  const f = endpointLch(hsvToRgb(a.h, a.s, a.v));
  const g = endpointLch(hsvToRgb(b.h, b.s, b.v));
  let hFrom = f.h, hTo = g.h;
  if (!f.hasHue && g.hasHue) hFrom = g.h;
  if (!g.hasHue && f.hasHue) hTo = f.h;
  const arc = shortestArc(hFrom, hTo);
  const L = f.L + (g.L - f.L) * t;
  const C = f.C + (g.C - f.C) * t;
  const h = hFrom + arc * t;
  return rgbCss(oklabToSrgbGamutMapped(L, C * Math.cos(h), C * Math.sin(h)));
}

// ── Live Touch sample swatches ──────────────────────────────────────────────
// The five Palette-slot swatches of the Live Touch COLOURS panel, verbatim from
// docs/ui/touch_control.html (lines 1680-1684), including that panel's own
// ENGINE / LOCAL tags. Declared as HEX and converted by the exact rgbToHsv
// above, so a chip here is bit-identical to the chip over there. Provenance +
// the honest caveat that these are the DESIGNED samples (a running Live Touch
// boots all five to one purple until a scheme is picked): report _199 §2.

export type LiveTouchSwatch = { hex: string; role: 'ENGINE' | 'LOCAL'; c: Hsv };

export const LIVE_TOUCH_SWATCHES: LiveTouchSwatch[] = [
  { hex: '#9b5cff', role: 'ENGINE', c: rgbToHsv(hexToRgb('#9b5cff')) },
  { hex: '#36d7ff', role: 'ENGINE', c: rgbToHsv(hexToRgb('#36d7ff')) },
  { hex: '#ff9d3f', role: 'LOCAL',  c: rgbToHsv(hexToRgb('#ff9d3f')) },
  { hex: '#8be84d', role: 'LOCAL',  c: rgbToHsv(hexToRgb('#8be84d')) },
  { hex: '#ffd84d', role: 'LOCAL',  c: rgbToHsv(hexToRgb('#ffd84d')) },
];

// ── Wheel geometry ──────────────────────────────────────────────────────────
// The Live Touch read model (hue = angle around the centre, 0 = UP, increasing
// clockwise), with the white-core / black-rim radius bands deliberately DROPPED:
// S and V are pinned, so radius carries no information and a drag clamps to the
// ring. `hueFromPoint` and `unitPointForHue` are exact inverses, so a handle
// lands where a finger would have to land to pick that same hue.
//
// NOTE (_242): the ring still MAPS angle↔hue exactly as below — that is what
// puts a handle where its colour is. What changed is how a TOUCH is read: the
// dial section further down turns a drag into a relative rotation instead of an
// absolute placement. `hueFromPoint` is now the dial's angle sensor, not the
// value it writes.

/** Wrap any real number into 0..1. Exported because every angle/hue path here
 *  needs the same wrap and three hand-rolled copies is three chances to differ. */
export function wrap01(x: number): number {
  // The in-range case returns the value ITSELF, bit for bit. The general
  // `((x % 1) + 1) % 1` form is not exact — it puts 0.1 through 1.1 and hands
  // back 0.10000000000000009 — and a hue that changes in the twelfth decimal
  // just by being read would make a saved palette fail to match itself.
  if (x >= 0 && x < 1) return x;
  return ((x % 1) + 1) % 1;
}

/** Touch point (relative to the wheel's centre, y DOWN) → hue in 0..1. */
export function hueFromPoint(dx: number, dy: number): number {
  const ang = Math.atan2(dy, dx) + Math.PI / 2;
  return wrap01(ang / (Math.PI * 2));
}

/** Signed a→b delta on the SHORT arc, in (-0.5, +0.5]. One turn == 1.0. */
export function turnDelta(from: number, to: number): number {
  let d = to - from;
  d -= Math.floor(d);
  if (d > 0.5) d -= 1;
  return d;
}

/** Hue → a unit offset from the wheel's centre (x right, y DOWN). */
export function unitPointForHue(h: number): { x: number; y: number } {
  const ang = h * Math.PI * 2;
  return { x: Math.sin(ang), y: -Math.cos(ang) };
}

/**
 * Which of the handles should a touch at this hue grab? The NEAREST by angular
 * distance on the ring (the Live Touch "grab the closer handle" rule), so the
 * operator never has to hit a 20 pt dot precisely. Ties go to the lower index,
 * which keeps the choice deterministic.
 */
export function nearestSlot(hue: number, hues: number[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < hues.length; i++) {
    const raw = Math.abs(hue - hues[i]) % 1;
    const d = Math.min(raw, 1 - raw);
    if (d < bestD - 1e-12) { bestD = d; best = i; }
  }
  return best;
}

// ── THE DIAL: relative rotation, not absolute placement (_242 order 1) ──────
//
// OPERATOR ORDER: "the color wheel, when i click, it has an unpleasant jump.
// can you make it a dial of some sort that I can consistently control by touch".
//
// THE JUMP, NAMED. The ring used to be an ABSOLUTE control: `onPanResponderGrant`
// converted the touch point straight into a hue through `hueFromPoint` and wrote
// it. Touching the ring therefore TELEPORTED the armed slot to whatever angle
// happened to be under the finger — and a finger is ~40 pt wide on a 190 pt
// wheel, so "put my thumb on the handle" was never accurate enough to mean
// "change nothing". Every single grab began with a lurch, of up to half a
// revolution if the operator reached for the near side of the ring.
//
// THE FIX is the jog-wheel / rotary-encoder model: touch-down ANCHORS, it does
// not set. From there the hue follows the ACCUMULATED ANGULAR DELTA of the
// finger around the centre, scaled by a gain. Four consequences, each of them
// the point rather than a side effect:
//
//   1. A PLAIN TAP MOVES NOTHING. Zero accumulated delta is zero change, by
//      construction — there is no tap-tolerance threshold to tune and no
//      "close enough" rule that could ever fire by accident.
//   2. THE GRAB POINT IS IRRELEVANT. Grab the ring, the rim, the hub, the
//      overshoot area outside the wheel — all of them steer identically,
//      because only the CHANGE in angle is read.
//   3. PRECISION IS A DESIGN PARAMETER. At `DIAL_GAIN` = 0.5 one full physical
//      revolution of the finger is HALF a hue revolution, so the whole wheel
//      takes two laps and a 10° twist of the wrist is a 5° hue move — twice the
//      resolution the absolute ring could offer at any size.
//   4. WRAPPING IS FREE. Every sample is a SHORT-ARC delta from the PREVIOUS
//      sample, never a difference of two absolutes, so dragging across the
//      0°/360° seam is an ordinary step and a multi-lap drag accumulates
//      instead of folding back on itself.
//
// The grip is a plain value (`DialGrip`) and every transition is a pure
// function, so the wrap, the accumulation and the gain are checked by the suite
// rather than eyeballed inside a PanResponder closure.

/** Hue turns per turn of the finger. < 1 means the dial is GEARED DOWN: a full
 *  physical revolution covers only this fraction of the hue circle, which is
 *  where the fine control comes from. */
export const DIAL_GAIN = 0.5;

/** Inside this radius (in wheel points) a touch carries no usable angle — a
 *  2 pt wobble across the exact centre is a 180° swing. This is geometry, not a
 *  tolerance: there genuinely is no angle at the centre of a circle. */
export const DIAL_DEAD_RADIUS_PX = 14;

/**
 * A live dial grab.
 *   anchorHue — the value at touch-down; the drag is measured FROM here.
 *   lastAngle — the previous sample's ring angle (turns, 0..1), or NULL when
 *               there is no usable reference: the finger is in the hub, or the
 *               grab itself started there. The next sample outside the hub
 *               re-establishes the reference WITHOUT moving the value, which is
 *               what makes a swipe straight through the centre freeze the dial
 *               instead of reading as a 180° rotation. A stroke across the
 *               middle is a line, not a turn.
 *   turns     — signed physical revolutions accumulated so far (may exceed ±1).
 */
export type DialGrip = { anchorHue: number; lastAngle: number | null; turns: number };

/** The ring angle of a touch, or null when it is too close to the centre to
 *  have one. */
function dialAngle(dx: number, dy: number): number | null {
  return Math.hypot(dx, dy) < DIAL_DEAD_RADIUS_PX ? null : hueFromPoint(dx, dy);
}

/** The hue a grip currently commands. */
export function dialHue(grip: DialGrip, gain: number = DIAL_GAIN): number {
  return wrap01(grip.anchorHue + grip.turns * gain);
}

/**
 * Touch-down. Records where the value IS and where the finger IS, and changes
 * nothing — `dialHue(beginDial(h, …)) === wrap01(h)` for every h, which is the
 * "a tap does not move the value" rule stated as an identity.
 */
export function beginDial(anchorHue: number, dx: number, dy: number): DialGrip {
  return { anchorHue: wrap01(anchorHue), lastAngle: dialAngle(dx, dy), turns: 0 };
}

export type DialSample = { grip: DialGrip; hue: number; moved: boolean };

/**
 * One drag sample, in wheel-centre coordinates (y DOWN). Returns the advanced
 * grip, the hue it now commands, and whether this sample moved anything at all
 * (the caller uses that to keep a no-op tap from writing the rig).
 *
 * A non-positive gain THROWS (codex P0): a zero-gain dial is a control that
 * silently cannot be moved, which is indistinguishable from a broken one.
 */
export function dialSample(
  grip: DialGrip, dx: number, dy: number, gain: number = DIAL_GAIN,
): DialSample {
  if (!(gain > 0)) {
    throw new Error(`[colors_window] dial gain must be positive, got ${gain}`);
  }
  const angle = dialAngle(dx, dy);
  // No angle here, or none on the previous sample: carry the new reference and
  // move nothing. This is the ONE guarantee that no jump can ever come out of
  // the hub — a value change requires two consecutive samples that both have a
  // real angle.
  if (angle === null || grip.lastAngle === null) {
    return { grip: { ...grip, lastAngle: angle }, hue: dialHue(grip, gain), moved: false };
  }
  const d = turnDelta(grip.lastAngle, angle);
  const next: DialGrip = { anchorHue: grip.anchorHue, lastAngle: angle, turns: grip.turns + d };
  return { grip: next, hue: dialHue(next, gain), moved: d !== 0 };
}

/**
 * THE DIAL'S TICK RING. Evenly spaced marks in TURNS (0..1), every `MAJOR`th one
 * long — the printed scale that tells the operator this thing rotates and how
 * far they have turned it. Pure so the count/spacing is asserted rather than
 * counted by eye in a screenshot.
 */
export const DIAL_TICKS = 36;
export const DIAL_TICK_MAJOR_EVERY = 3;

export type DialTick = { turn: number; major: boolean };
export function dialTicks(count: number = DIAL_TICKS, majorEvery: number = DIAL_TICK_MAJOR_EVERY): DialTick[] {
  if (!Number.isInteger(count) || count < 2) {
    throw new Error(`[colors_window] dial tick count must be an integer >= 2, got ${count}`);
  }
  if (!Number.isInteger(majorEvery) || majorEvery < 1) {
    throw new Error(`[colors_window] dial major-tick spacing must be a positive integer, got ${majorEvery}`);
  }
  return Array.from({ length: count }, (_, i) => ({ turn: i / count, major: i % majorEvery === 0 }));
}

// ── Derived selection (badges) ──────────────────────────────────────────────

/**
 * Does this source colour, under the pin policy, EQUAL one of the live slots?
 * Returns that slot's INDEX, or -1. Derived every render, never stored.
 */
export function slotIndexFor(c: Hsv, slots: Hsv[]): number {
  const want = pinned(c);
  for (let i = 0; i < slots.length; i++) {
    if (sameColour(want, slots[i])) return i;
  }
  return -1;
}

/** A saved pair is LIVE when both of its hues are the two on the ship. */
export function pairIsLive(p: HuePair, slots: Hsv[]): boolean {
  if (slots.length < 2) return false;
  return sameColour(pinned(colour(p.c1, 1, 1)), slots[0])
    && sameColour(pinned(colour(p.c2, 1, 1)), slots[1]);
}

// ── Crossfade: the SHORT ARC, shared with the engine ────────────────────────

/**
 * SHORTEST-ARC hue interpolation — the EXACT formula of the engine's
 * `lerpHue` (marsin_engine/lib/color_autopilot.js, D1 / docs/55 §1). The
 * reference table below is pinned in BOTH suites (`colors_window_logic.test.ts`
 * and `tests/effects/color_autopilot.test.js`), so a change to either
 * implementation breaks a test on both sides and the two can never drift:
 *
 *   lerpHue(0.9, 0.1, 0.5) === 0.0     (wraps forward through 1.0)
 *   lerpHue(0.1, 0.9, 0.5) === 0.0     (wraps backward through 0.0)
 *   lerpHue(0.2, 0.6, 0.5) === 0.4     (no wrap — plain midpoint)
 *   lerpHue(0.0, 0.5, 0.5) === 0.25    (exact-half tie resolves FORWARD)
 *   lerpHue(x,   x,   any) === x
 *   t <= 0 / t >= 1 return the EXACT endpoints
 *
 * Sharing it is what makes the BLEND scrubber honest: a scrub writes
 * `lerpHue(hA, hB, t)`, the engine's tween walks the identical arc, so a
 * frozen fade position round-trips exactly to the scrub value.
 */
export function lerpHue(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  let d = b - a;
  d -= Math.floor(d);
  if (d > 0.5) d -= 1;
  const h = a + d * t;
  return ((h % 1) + 1) % 1;
}

/**
 * WHERE ON THE A→B SHORT ARC is the rig sitting right now? The card's blend
 * readout, derived from the BROADCAST slot — never from a local clock.
 *
 * Returns 0..1, or null when the live hue is not on the A→B arc at all (the
 * palette was changed by something else, or the endpoints coincide). The card
 * shows "—" for null rather than a confident wrong number.
 */
export function blendFromBroadcast(hA: number, hB: number, hLive: number): number | null {
  const arc = (() => {
    let d = hB - hA;
    d -= Math.floor(d);
    if (d > 0.5) d -= 1;
    return d;
  })();
  if (Math.abs(arc) < 1e-9) return null;
  let off = hLive - hA;
  off -= Math.floor(off);
  if (off > 0.5) off -= 1;
  const t = off / arc;
  if (t < -1e-6 || t > 1 + 1e-6) return null;
  return Math.min(1, Math.max(0, t));
}

export function blendLabel(t: number): string {
  if (t < 0.005) return 'A';
  if (t > 0.995) return 'B';
  return `${Math.round(t * 100)}% B`;
}

// ── Live Touch SCHEME GENERATORS (docs/55 §2.1) ─────────────────────────────
// The four palette generators of the Live Touch COLOURS panel, ported VERBATIM
// from docs/ui/touch_control.html (the PALETTE GENERATORS block, ~3249-3302 —
// the old TS module was deleted, so the HTML is the canonical source). Every
// constant below is that file's, unchanged:
//
//   BASE.s = 0.95   the base saturation; the wheel supplies only `h`
//   MONO_STEPS      five brightnesses, UNEVEN on purpose — perceived
//                   brightness is roughly the square of the linear value, so
//                   even steps look bunched at the top
//   COMP_OFFSETS    analogous spread; slot 1 keeps the operator's colour and
//                   slot 2 takes the FAR edge (+60°), which is why the two
//                   ENGINE-backed slots end up 60° apart. The minimum step is
//                   30° and not 20° because at the identical S and V these
//                   slots share, anything closer reads as one colour someone
//                   got slightly wrong.
//   CONTRAST        an even 72° pentad — maximally distinct for five colours.
//
// Live Touch's `BASE.h = 0.72` is only its boot default and does NOT port: on
// the Deck the base hue is the ARMED SLOT's hue, the same hue the wheel edits.
// The NOTE (audio-follow) modifier is deliberately out of scope — it is a
// latching modifier over a live audio feed the Deck does not consume.

// The four Live Touch ports come FIRST and in their original order, so the
// operator's muscle memory for the row is unchanged. The five after them are
// the _224 additions (operator: "add a few more technique to sample nice
// looking color duos or 5 samples") — classic colour-wheel constructions, each
// shaped into FIVE slots that also read well as the adjacent DUOS a rotation
// puts on the rig two at a time.
export const SCHEME_IDS = CORE_SCHEME_IDS;
export type SchemeId = (typeof SCHEME_IDS)[number];

/** Live Touch `BASE.s`. The wheel is hue-only, so S comes from here. */
export const SCHEME_BASE_S = CORE_SCHEME_BASE_S;
/** Live Touch `MONO_STEPS` — the HUE scheme's five brightnesses. */
export const MONO_STEPS = CORE_MONO_STEPS;
/** Live Touch `COMP_OFFSETS`, in DEGREES. */
export const COMP_OFFSETS = CORE_COMP_OFFSETS;
/** Live Touch's `v` floor on the HUE ramp — a slot never goes fully dark. */
export const SCHEME_MIN_V = CORE_SCHEME_MIN_V;

/** Live Touch `rot(h, deg)`: rotate a hue by whole degrees, wrapping. */
export function rotateHue(h: number, deg: number): number {
  return coreRotateHue(h, deg);
}

// ── The _224 generators (operator: "a few more technique to sample nice
// looking color duos or 5 samples") ─────────────────────────────────────────
//
// Each is a classic colour-wheel construction expressed as five
// `[degrees, brightness]` STEPS from the armed hue. Two rules shape them, and
// both are about what the RIG does with a ring rather than what a colour-theory
// diagram looks like:
//
//   1. PAIRS OF THE RING ARE THE PRODUCT. A rotation shows two slots at a time
//      and slides that window one step per turn (`orbitPairs`), so the ORDER of
//      the five is a design decision: every pair the window can land on —
//      including the ones that straddle the T5→T1 wrap — has to be a duo the
//      operator would have picked on purpose. These five are shaped around the
//      ADJACENT window because that is the default spacing; a wider orbit
//      re-pairs them, which is exactly the freedom the operator asked for.
//   2. NO DEAD BEAT. A ring that repeats a colour at the same brightness gives
//      one turn where nothing visibly changes. Where a construction naturally
//      repeats its base (TETRAD's fifth slot, TRIADIC's and SPLIT's echoes) the
//      repeat is DIMMED instead, which keeps the turn alive and gives the
//      pattern a light/dark beat.
//
// NIGHT-VISIBILITY FLOOR (`SCHEME_ROTATION_MIN_V`): the mission's first line is
// "highly visible at night", so these five clamp at v = 0.25 — the HUE scheme's
// darkest step, the precedent the operator already accepted (docs/55 §8.1). The
// four Live Touch ports above keep their own verbatim `SCHEME_MIN_V = 0.1`
// floor: they are a port, and quietly re-flooring a ported algorithm would make
// the Deck and Live Touch disagree about what MASTER/HUE mean.
export const SCHEME_ROTATION_MIN_V = CORE_SCHEME_ROTATION_MIN_V;

/** `[degreesFromBase, brightness]` — the shape every _224 generator is built from. */
export type SchemeStep = readonly [number, number];

/** ANALOGOUS — a tight ±30° family: one mood, five shades of it. The order
 *  alternates sides of the base so no two neighbours are 60° apart. */
export const ANALOGOUS_STEPS = CORE_ANALOGOUS_STEPS;
/** TRIADIC — the even 120° triad, then its first two arms again at half
 *  brightness. Five distinct turns out of a three-colour construction. */
export const TRIADIC_STEPS = CORE_TRIADIC_STEPS;
/** SPLIT-COMPLEMENT — the base plus the two colours flanking its complement
 *  (150° / 210°), which reads as contrast without the flat tension of a true
 *  180°. The two flanks return dimmed. */
export const SPLIT_STEPS = CORE_SPLIT_STEPS;
/** TETRAD — the 90° square, plus the base once more at half brightness so the
 *  wrap turn is a beat rather than a repeat of T1. */
export const TETRAD_STEPS = CORE_TETRAD_STEPS;
/** GOLDEN — five steps of the golden angle (137.5°). Nothing lands on a
 *  symmetry, so the spread reads organic rather than constructed: the hues come
 *  out at 0 / 137.5 / 275 / 52.5 / 190 degrees from the base. */
export const GOLDEN_ANGLE_DEG = CORE_GOLDEN_ANGLE_DEG;

/** Five `[deg, v]` steps → five colours from a base hue, at the shared base
 *  saturation and under the night-visibility floor. */
export function schemeFromSteps(steps: readonly SchemeStep[], baseH: number): Hsv[] {
  return coreSchemeFromSteps(steps, baseH);
}

/**
 * Generate a scheme's five colours from a base hue — the operator's ARMED slot.
 * Total over `SCHEME_IDS`; an unknown id THROWS (codex P0), because a scheme
 * button that quietly painted nothing would be indistinguishable from broken.
 */
export function generateScheme(scheme: SchemeId, baseH: number): Hsv[] {
  return coreGenerateScheme(scheme, baseH);
}

/** Operator-facing scheme names, in row order. */
export const SCHEME_TITLES: Readonly<Record<SchemeId, string>> = {
  master: 'MASTER',
  hue: 'HUE',
  complement: 'COMPLEMENT',
  contrast: 'CONTRAST',
  analogous: 'ANALOGOUS',
  triadic: 'TRIADIC',
  split: 'SPLIT',
  tetrad: 'TETRAD',
  golden: 'GOLDEN',
};

// ── PALETTE TURNS ───────────────────────────────────────────────────────────

/** The five colours a TURNS rotation cycles through. */
export const TURNS_SLOT_COUNT = 5;

/** The spacing every TURNS ring ran at before the orbit: adjacent slots. */
export const ORBIT_DISTANCE_DEFAULT = 1;

/**
 * THE ORBIT'S SPACING — how many slots apart COLOUR A and COLOUR B sit, counted
 * to the RIGHT around the ring: `d = (selB - selA) mod n`.
 *
 * THROWS on a selection the ring cannot hold, and on `d === 0` (both channels on
 * one slot). `selectSchemePair` already refuses that gesture with a sentence, so
 * reaching here with it is a caller bug rather than an operator action — and an
 * orbit of distance zero would spend five turns crossfading a colour to itself.
 */
export function orbitDistance(sel: SchemePairSel, ringLength: number): number {
  return coreOrbitDistance(sel, ringLength);
}

/**
 * THE ORBIT'S STEP (docs/75 §4, D1/D2) — how many slots the WINDOW ITSELF
 * advances each turn, as distinct from `distance` (`d`): `d` is the fixed
 * spacing between COLOUR A and COLOUR B, `s` is how far the WHOLE WINDOW
 * jumps to reach the next turn.
 *
 * OPERATOR ORDER: *"in the turning style, the colors aren't window turning
 * correctly. We need to select two, and the window will move both in a
 * rotating window queue style."* Named, the defect was this: at `s = 1` (the
 * only step TURNS had ever used) turn *k+1*'s LEADING channel is turn *k*'s
 * TRAILING channel — every turn, one channel merely inherits what the other
 * channel just showed, so the pair reads on the rig as a one-colour shift
 * register, not two colours turning.
 *
 * THE FIX is the smallest `s >= 1` for which two CONSECUTIVE windows never
 * share a staged slot — `{0, d} ∩ {s, s+d} = ∅ (mod n)` — so every turn lands
 * BOTH channels on colours neither channel just showed. `gcd(s, n) === 1` is
 * required alongside it, so one lap of `n` turns still visits every staged
 * slot exactly once and wraps cleanly rather than orbiting a subset forever.
 * D1/D2 (docs/75 §9): this applies to the DEFAULT `sel = [0,1]` too — the
 * adjacent pick is not special-cased away from the fix, because the operator's
 * complaint was filed against exactly that default. For a 5-slot ring this
 * works out to `s = 2` for an ADJACENT pick (`d` = 1 or 4) and `s = 1` for a
 * SPACED one (`d` = 2 or 3, already disjoint — untouched).
 *
 * When no disjoint `s` exists at all — the crossfade's 2-slot ring, or any
 * ring too short for a window to dodge itself — the search returns `1`:
 * today's behaviour, because there is nothing to fix. That is what keeps the
 * crossfade wire, and any ring shorter than 5, byte-identical to before this
 * change.
 */
export function orbitStep(distance: number, ringLength: number): number {
  return coreOrbitStep(distance, ringLength);
}

/**
 * THE RING THE ENGINE ROTATES: the operator's A/B pair ORBITING the staged
 * colours at constant spacing, the window itself advancing by the STEP
 * `orbitStep` computes.
 *
 * OPERATOR ORDER: *"for the PALETTE TURNS we have 2 selected colors — keep their
 * distance, and rotate them in a window to the right, and then loop back when
 * going over the end."* Then, once the shipped `s = 1` window turned out to
 * read as a shift register rather than two colours turning: *"in the turning
 * style, the colors aren't window turning correctly. We need to select two,
 * and the window will move both in a rotating window queue style."*
 *
 * With two engine slots, the honest rendering of a five-colour rotation is a
 * WINDOW over the ring. What the operator's A/B pick decides is how WIDE that
 * window is (`d`, `orbitDistance`) and where it STARTS; the STEP (`s`,
 * `orbitStep`) decides how far the window jumps each turn so both ends keep
 * landing on FRESH colours: turn *k* shows slots `selA + k·s` and
 * `selA + k·s + d` (mod n). The spacing `d` never changes turn to turn, and
 * because `s` and `n` are coprime, after n turns the window is back where it
 * began having visited every staged slot exactly once per channel.
 *
 *   sel (T1,T2) → d 1, s 2:  (T1,T2) (T3,T4) (T5,T1) (T2,T3) (T4,T5)
 *   sel (T1,T3) → d 2, s 1:  (T1,T3) (T2,T4) (T3,T5) (T4,T1) (T5,T2)
 *   sel (T3,T5) → d 2, s 1:  (T3,T5) (T4,T1) (T5,T2) (T1,T3) (T2,T4)
 *
 * The adjacent pick (T1,T2) — also the DEFAULT selection, `orbitDistance` = 1
 * — is the case the operator's complaint was about, and D2 (docs/75 §9)
 * deliberately does not special-case it back to the old `s = 1` slide: the
 * queue steps by 2 there too, retiring the `_224` adjacent behaviour for
 * everyone. A SPACED pick (`d` = 2 or 3 on a 5-ring) was already disjoint at
 * `s = 1`, so `orbitStep` reports 1 there and the wire is unchanged.
 *
 * IT STARTS WHERE THE OPERATOR IS. The ring is posted BEGINNING at COLOUR A's
 * slot, not at T1, because a restage resets the daemon's cursor and the first
 * window it plays is entry 0 — so starting at A is what makes START TURNS, and a
 * mid-rotation A/B pick, both land on the pair already lit instead of jumping to
 * a different one. At the default (T1,T2) that start is T1 and the whole list is
 * byte-identical to the adjacent ring TURNS has always posted, EXCEPT for the
 * step: entries 1.. now land on the `s = 2` slots rather than sliding by one.
 *
 * THE ENGINE IS UNCHANGED AND UNAWARE. `colorAutopilot.palettes` is validated
 * entry by entry and cycled sequentially with a lerp between consecutive
 * entries; nothing in the daemon ever asks whether two pairs share a colour, or
 * how far apart consecutive entries' colours are. The stepped orbit is a
 * client-side construction of the SAME wire shape TURNS has always posted.
 */
export function orbitPairs(colours: Hsv[], sel: SchemePairSel): ColorPair[] {
  return coreOrbitPairs(colours, sel);
}

/**
 * The DEFAULT-SELECTION ring — `orbitPairs` at (T1,T2), which is the
 * degenerate `d = 1` orbit. Kept as its own name because the CROSSFADE is a
 * two-entry ring with no A/B selection of its own to speak of — its `d = 1`
 * orbit over a 2-slot ring has no disjoint step (`orbitStep` returns 1), so
 * this stays the exact chained pair the crossfade has always posted.
 */
export function turnsPairs(colours: Hsv[]): ColorPair[] {
  return coreTurnsPairs(colours);
}

// ── ONE TRANSPORT FOR BOTH RINGS (_224, operator order 1) ───────────────────
//
// "the turning is smooth and needs to happen on the same timescale as the two
// color crossfader" / "use the same fade time out and interval as the two
// color".
//
// So TURNS and the crossfade no longer have separate timing models. They share
// ONE hold row and ONE fade row, and both build their config through
// `rotationAutopilotPatch` below. Two consequences, both deliberate:
//
//   - `derivedTransitionMs` (the old "fade = 25 % of the turn, clamped 0.5-3 s"
//     heuristic) is GONE. It was a reasonable guess while TURNS had a cadence
//     of its own; with the fade under the operator's thumb a derived value is
//     just a second opinion the surface cannot show.
//   - `delay_s: 0` (CONT) is reachable from TURNS too, superseding docs/55
//     §2.3's "TURNS keeps its cadence floor". In CONT a five-colour ring slides
//     its window continuously, exactly as the two-colour ring does.
//
// The presets are a SUPERSET of the crossfade card's original hold row, not a
// different row: 30 s and 60 s are there so the old set-and-forget cadences
// stay reachable, and BOTH cards render this same row.

/** HOLD presets, shared by both rings. 0 == CONT (continuous, no hold). */
export const ROTATION_HOLD_PRESETS_S: readonly number[] = [0, 1, 2, 5, 10, 30, 60];
/** FADE presets (seconds), shared by both rings — the `_211` card's, as `transitionMs`. */
export const ROTATION_FADE_PRESETS_S: readonly number[] = [0.4, 0.8, 1.5, 3];
/** The engine's CONT floor (`MIN_CONTINUOUS_TRANSITION_MS`), mirrored so the
 *  client refuses exactly what the engine would refuse. */
export const MIN_CONTINUOUS_FADE_S = CORE_MIN_CONTINUOUS_FADE_S;

/**
 * The timing contract both rings obey, in one place. THROWS rather than clamps
 * (codex P0): zero hold plus a near-zero fade is a hard-cut spin loop hammering
 * the CPC at timer resolution, and the engine's `validate` refuses exactly this
 * — the client refusing it too means the operator sees the sentence instead of
 * a rejected POST.
 */
export function assertRotationTiming(holdS: number, fadeS: number): void {
  coreAssertRotationTiming(holdS, fadeS);
}

/**
 * THE colour-autopilot patch, for a ring of ANY length. Both transports post
 * this: an orbiting-pair ring, no shuffle (the operator chose the ORDER), the
 * shared hold as `delay_s` and the shared fade as `transitionMs`.
 *
 * That the crossfade is just this at length 2 is not a coincidence to be
 * maintained by hand — it is the whole point of docs/55 §2.2, so it is one
 * function rather than two that must be kept in step.
 *
 * `sel` is the operator's A/B pick, which decides the orbit's spacing and start
 * (`orbitPairs`). ABSENT means the adjacent ring: the crossfade has no ring
 * selection of its own, and omitting it reproduces the pre-orbit wire exactly.
 */
export function rotationAutopilotPatch(
  colours: Hsv[], holdS: number, fadeS: number, sel?: SchemePairSel,
) {
  return coreRotationAutopilotPatch(colours, holdS, fadeS, sel);
}

/**
 * The EXACT patch START TURNS posts: the five staged colours as the operator's
 * A/B pair orbiting them, on the SHARED transport.
 */
export function turnsAutopilotPatch(
  colours: Hsv[], holdS: number, fadeS: number, sel?: SchemePairSel,
) {
  return coreTurnsAutopilotPatch(colours, holdS, fadeS, sel);
}

// ── FOLLOW NOTE (docs/59) ───────────────────────────────────────────────────
//
// OPERATOR ORDER: *"add a new option in the color to use the note as the main
// color … follow note, and have the method cycling smoothly on a timer"*.
//
// A THIRD MODE OF THE ONE DAEMON, not a sibling. The engine already has the
// note (the companion publishes `audioNote`/`audioNoteHue` into the CPC at
// 10 Hz and holds the last committed pitch class through silence), so the loop
// runs engine-side inside `lib/color_autopilot.js`: the note drives the BASE
// HUE, and the SCHEME GENERATOR applied to that hue cycles on its own timer.
// Mutual exclusion with TURNS / crossfade / palette-set is therefore BY
// CONSTRUCTION — one daemon, one mode — rather than by a second active flag
// every surface has to remember to check.
//
// Everything below is the CLIENT half: the wire builder, the sparse-patch
// rules and the state grammar. None of it animates anything; the card's
// picture comes from the broadcast, as everywhere else in this window.

export type ColorAutopilotMode = 'palettes' | 'followNote';

/**
 * THE DEFAULT METHOD SUBSET: the seven MULTI-HUE generators (docs/59 §7).
 *
 * MASTER and HUE ship OFF. They render the pair monochrome — one hue at two
 * brightnesses — and the mission's first line is "highly visible at night",
 * which wants two-hue pairs by default. They are one tap away, because a
 * monochrome beat in the cycle is a legitimate choice; it is just the
 * operator's to make rather than ours to assume.
 */
export const FOLLOW_NOTE_DEFAULT_SCHEMES: readonly SchemeId[] = [
  'complement', 'contrast', 'analogous', 'triadic', 'split', 'tetrad', 'golden',
];

/** METHOD HOLD presets (seconds). Deliberately NOT the `_224` shared row: that
 *  one is the PAIR cadence (seconds-scale), this is a MOOD cadence
 *  (minutes-scale), and pretending they are one row would put 1 s method thrash
 *  one tap away. 0 == CONT (continuous method morphing). */
export const METHOD_HOLD_PRESETS_S: readonly number[] = [0, 10, 30, 60, 120, 300];
export const METHOD_HOLD_DEFAULT_S = 60;
/** METHOD FADE presets (seconds). "Cycling smoothly" is the order — 0.4 s is a
 *  cut, not a cycle — so the row starts at 1.5 s. */
export const METHOD_FADE_PRESETS_S: readonly number[] = [1.5, 3, 6, 10];
export const METHOD_FADE_DEFAULT_S = 3;
/** NOTE FADE presets (ms). 0 == SNAP, the honest Live Touch-parity escape
 *  hatch; 400 ms is the default (under the eye's "did it follow the music"
 *  threshold, over its "did it glitch" one). */
export const NOTE_FADE_PRESETS_MS: readonly number[] = [0, 400, 1000, 2000];
export const NOTE_FADE_DEFAULT_MS = 400;
/** The engine's continuous-method floor, mirrored so the client refuses exactly
 *  what the engine would refuse (and shows the sentence instead of a 400). */
export const MIN_CONTINUOUS_METHOD_FADE_S = CORE_MIN_CONTINUOUS_METHOD_FADE_S;

/** Pitch class 0-11 → letter. The companion's own table
 *  (`audio/signals/note_estimator.js:44`), so the card says the same letter the
 *  companion UI says about the same note. */
export const NOTE_NAMES: readonly string[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The letter for a broadcast `notePc`, or '—' when there is no committed note
 *  yet. Never invents a note: an out-of-range or absent pitch class is a fact
 *  about the feed, and the card shows it as one. */
export function noteName(pc: number | null | undefined): string {
  if (typeof pc !== 'number' || !Number.isInteger(pc) || pc < 0 || pc >= NOTE_NAMES.length) return '—';
  return NOTE_NAMES[pc];
}

/** The `audioSilence` level at or above which the card says the feed is quiet.
 *  The companion still HOLDS its last committed note through silence, so this
 *  changes what the card SAYS, never what the rig does (docs/59 §8). */
export const AUDIO_SILENCE_THRESHOLD = 0.5;

/** The follow-note block as it rides the wire. */
export type FollowNoteConfig = {
  schemes: SchemeId[];
  methodHoldS: number;
  methodFadeS: number;
  noteFadeMs: number;
  sel: [number, number];
  shuffle: boolean;
  /** The scheme-tap override — present only in flight, consumed by the next
   *  method advance. */
  method?: SchemeId;
};

/**
 * The timing contract of the METHOD cycle, mirroring `assertRotationTiming`
 * and the engine's `validateFollowNote`. THROWS rather than clamps: a zero
 * hold with a near-zero fade is a hard-cut spin loop hammering the CPC at
 * timer resolution, and the engine refuses exactly this.
 */
export function assertMethodTiming(holdS: number, fadeS: number): void {
  coreAssertMethodTiming(holdS, fadeS);
}

/**
 * THE EXACT PATCH "START FOLLOW NOTE" POSTS.
 *
 * Mirrors the engine's `validateFollowNote` refusal for refusal, so the
 * operator sees the sentence on the message line instead of watching a POST
 * come back 400. An EMPTY subset is the one an operator can actually reach (by
 * toggling the last chip off), so it gets the sentence the UI spec names.
 */
export function followNoteAutopilotPatch(args: {
  schemes: readonly SchemeId[];
  methodHoldS: number;
  methodFadeS: number;
  noteFadeMs: number;
  sel: SchemePairSel;
  shuffle?: boolean;
}) {
  return coreFollowNoteAutopilotPatch(args);
}

/** A method subset the engine would accept: non-empty, no repeats, known ids. */
export function assertSchemeSubset(schemes: readonly SchemeId[]): SchemeId[] {
  return coreAssertSchemeSubset(schemes);
}

/** Toggle one generator in the cycle subset. Refuses to empty it, with the
 *  sentence the engine's validator would also produce — the operator can reach
 *  this state with one tap, so it must not be a silent no-op. */
export type SchemeSubsetResult =
  | { ok: true; schemes: SchemeId[] }
  | { ok: false; reason: string };
export function toggleSchemeSubset(schemes: readonly SchemeId[], id: SchemeId): SchemeSubsetResult {
  if (!schemes.includes(id)) {
    // Keep the canonical row order, so the cycle plays in the order the chips
    // are laid out rather than in tap order.
    return { ok: true, schemes: SCHEME_IDS.filter((s) => s === id || schemes.includes(s)) as SchemeId[] };
  }
  if (schemes.length === 1) return { ok: false, reason: 'The cycle needs at least one method.' };
  return { ok: true, schemes: schemes.filter((s) => s !== id) };
}

/**
 * THE FOLLOW-NOTE STATE LINE (docs/59 §7.1), derived from the BROADCAST alone.
 *
 * Deadman rule: every word of this comes off the engine's payload — the note,
 * the current method, the next one. Nothing here is clocked, which is why the
 * SECONDS are deliberately NOT in this string: the live countdown is the
 * self-ticking `<SwapCountdown>` chip (the `_211` idiom the deck's palette
 * countdown already uses), so the one node that must re-render every second is
 * a chip rather than this whole window. When the rig stops moving the sentence
 * stops with it instead of counting down against a rotation that is not
 * running.
 */
export function followNoteStateLine(args: {
  active: boolean;
  currentScheme?: SchemeId | null;
  schemes?: readonly SchemeId[];
  notePc?: number | null;
  audioSilence?: number;
}): string {
  if (!args.active) return 'FOLLOW NOTE — parked';
  const letter = noteName(args.notePc);
  const parts: string[] = [`NOTE IS DRIVING — ${letter}`];
  const cur = args.currentScheme;
  if (cur) {
    const next = nextMethodOf(args.schemes, cur);
    parts.push(next
      ? `${SCHEME_TITLES[cur]} → ${SCHEME_TITLES[next]}`
      : SCHEME_TITLES[cur]);
  }
  let line = parts.join(' · ');
  // SILENCE IS SAID, not acted on. The companion holds the last committed note
  // through silence and the method cycle keeps breathing on that held hue —
  // hold-with-a-sentence is the only behaviour compatible with the no-fallback
  // rule, so the sentence is the feature.
  if (typeof args.audioSilence === 'number' && args.audioSilence >= AUDIO_SILENCE_THRESHOLD) {
    line += ' · HOLDING LAST NOTE (audio silent)';
  }
  return line;
}

/** Which generator the cycle advances to after `current`. Null when the subset
 *  cannot answer (the current method is a tap override outside it, or there is
 *  only one method — a cycle of one has no "next" worth naming). */
export function nextMethodOf(
  schemes: readonly SchemeId[] | undefined, current: SchemeId,
): SchemeId | null {
  if (!Array.isArray(schemes) || schemes.length < 2) return null;
  const i = schemes.indexOf(current);
  if (i < 0) return schemes[0];
  return schemes[(i + 1) % schemes.length];
}

// ── LIVE RETUNE (docs/59 §5) ────────────────────────────────────────────────
//
// OPERATOR ORDER: *"make sure the changing of the parameters for those
// existing ones too doesn't need a full stop and start again"*.
//
// A POST is a full REPLACE: it bumps the daemon's generation, kills the
// in-flight tween, resets the cursor and re-arms the hold from zero — a
// running rotation visibly restarts. A PATCH applies the moved knob IN PLACE.
// The two functions below are the client's half of that contract: WHICH
// fields a running rotation will take live, and WHAT the sparse body looks
// like. Stated as pure functions so the §5.1 table is checked by the suite
// rather than trusted to a handler.

/** The retune fields, by family. */
export type RetuneField =
  | 'delay_s' | 'transitionMs' | 'palettes' | 'shuffle'
  | 'methodHoldS' | 'methodFadeS' | 'noteFadeMs' | 'schemes' | 'sel' | 'method';

const PALETTE_RETUNE_FIELDS: readonly RetuneField[] = ['delay_s', 'transitionMs', 'palettes', 'shuffle'];
const FOLLOW_RETUNE_FIELDS: readonly RetuneField[] = ['methodHoldS', 'methodFadeS', 'noteFadeMs', 'schemes', 'sel', 'method'];

/**
 * Can this field be retuned LIVE on a rotation of this kind? `false` means the
 * control stages only — either nothing is running, or the field belongs to the
 * other mode and sending it would be refused by the engine.
 *
 * `active` and `mode` are deliberately absent from `RetuneField`: they are
 * TAKEOVERS, they stay on POST, and making them unrepresentable here is
 * cheaper than a runtime refusal nobody reads.
 */
export function retunableLive(kind: RotationKind, field: RetuneField): boolean {
  if (kind === 'none') return false;
  if (kind === 'follow-note') return FOLLOW_RETUNE_FIELDS.includes(field);
  // A palette-set rotation belongs to the AUTOPILOT window; the COLORS window
  // retunes the rings it started (crossfade / TURNS) and stages for the rest.
  if (kind === 'crossfade' || kind === 'turns') return PALETTE_RETUNE_FIELDS.includes(field);
  return false;
}

/** WHEN a retune shows on the rig — the §5.1 table as a sentence, so the pill
 *  rows can tag themselves honestly instead of implying everything is instant. */
export function retuneTiming(field: RetuneField): 'now' | 'next-fade' | 'next-transition' | 'next-pick' {
  switch (field) {
    case 'delay_s': case 'methodHoldS': return 'now';
    case 'transitionMs': case 'methodFadeS': case 'noteFadeMs': return 'next-fade';
    case 'palettes': case 'schemes': return 'next-transition';
    case 'shuffle': return 'next-pick';
    case 'sel': case 'method': return 'now';
    default:
      throw new Error(`[colors_window] unknown retune field '${field}'`);
  }
}

export const RETUNE_TIMING_TAGS: Readonly<Record<ReturnType<typeof retuneTiming>, string>> = {
  now: 'applies now',
  'next-fade': 'from the next fade',
  'next-transition': 'from the next transition',
  'next-pick': 'from the next pick',
};

/**
 * BUILD the sparse PATCH body for a set of moved fields. Follow-note fields are
 * nested under `followNote`, palettes-mode fields sit at the top level —
 * exactly the shape `ColorAutopilot.patchState` validates.
 *
 * THROWS on an empty patch (a PATCH that changes nothing is a caller bug, and
 * a no-op round trip would still broadcast) and on a field the running kind
 * cannot take live, which is the same refusal the engine would make — stated
 * here so the operator gets a sentence rather than a 400.
 */
export function rotationRetunePatch(
  kind: RotationKind, fields: Partial<Record<RetuneField, unknown>>,
): Record<string, unknown> {
  const keys = Object.keys(fields) as RetuneField[];
  if (keys.length === 0) {
    throw new Error('[colors_window] a retune patch must carry at least one field');
  }
  const out: Record<string, unknown> = {};
  const nested: Record<string, unknown> = {};
  for (const k of keys) {
    if (!retunableLive(kind, k)) {
      throw new Error(`[colors_window] '${k}' cannot be retuned live on a '${kind}' rotation`);
    }
    if (FOLLOW_RETUNE_FIELDS.includes(k)) nested[k] = fields[k];
    else out[k] = fields[k];
  }
  if (Object.keys(nested).length > 0) out.followNote = nested;
  return out;
}

/**
 * The EXACT patch the CROSSFADE card's RUN posts.
 *
 * A crossfade A↔B IS a two-entry chained ring — `turnsPairs([A, B])` is
 * literally `[{c1:A,c2:B},{c1:B,c2:A}]` — so this is `rotationAutopilotPatch`
 * with a two-colour ring, and the hue-only A/B surface (docs/36) makes both
 * channels minimize to plain hue numbers on the wire, byte-identical to the
 * `_217` crossfade wire.
 */
export function crossfadeAutopilotPatch(hA: number, hB: number, holdS: number, fadeS: number) {
  return coreCrossfadeAutopilotPatch(hA, hB, holdS, fadeS);
}

/**
 * WHAT KIND of rotation is the daemon running? Drives the §2.6 interaction
 * table — every control needs to know whether a scheme tap restages, stages
 * quietly, or is refused, and guessing from `active` alone cannot tell a
 * crossfade from a five-colour ring from a library palette set.
 */
export type RotationKind = 'none' | 'crossfade' | 'turns' | 'palette-set' | 'follow-note';
export function rotationKind(
  active: boolean | undefined,
  palettes: readonly PaletteEntry[] | undefined,
  mode?: ColorAutopilotMode,
): RotationKind {
  if (!active) return 'none';
  // FOLLOW NOTE is decided by the broadcast MODE, never inferred from the
  // palette shapes (docs/59 §6). It has no `palettes` at all — the ring is
  // re-derived engine-side on every committed note — so shape-sniffing would
  // call it a palette-set and hand it the wrong interaction row.
  if (mode === 'followNote') return 'follow-note';
  if (!isTurnsConfig(palettes)) return 'palette-set';
  return (palettes as ColorPair[]).length === 2 ? 'crossfade' : 'turns';
}

// ── The single-writer gate (docs/53 §4.4) ───────────────────────────────────

export type WriterGate =
  | { canWrite: true }
  | { canWrite: false; reason: string };

/**
 * May a MANUAL palette edit go out right now? No, when the colour-autopilot
 * daemon is running a family (its ticks own colorPalette1/2 and a manual
 * write would fight it between ticks), and no when the surface is offline /
 * plan-locked. A refusal always carries a sentence the window SHOWS — a tap
 * that silently does nothing is indistinguishable from a broken control.
 *
 * KIND-NAMED (docs/61 §4.2, D4): `rotationKind` now decides from the
 * broadcast `mode` + ring shape and cannot name the wrong one, so the old
 * kind-agnostic sentence ("A colour rotation is driving…") is retired. Order
 * of checks is unchanged: driving beats offline.
 */
export function manualWriteGate(disabled: boolean, kind: RotationKind): WriterGate {
  switch (kind) {
    case 'follow-note':
      return { canWrite: false, reason: 'FOLLOW NOTE is driving the colours — STOP it to edit.' };
    case 'turns':
      return { canWrite: false, reason: 'PALETTE TURNS is driving the colours — STOP it to edit.' };
    case 'crossfade':
      return { canWrite: false, reason: 'The crossfade is driving the colours — STOP it to edit.' };
    case 'palette-set':
      return { canWrite: false, reason: 'An AUTOPILOT palette set is driving the colours — STOP it to edit.' };
    case 'none':
      break;
    default:
      throw new Error(`[colors_window] unknown rotation kind '${kind}'`);
  }
  if (disabled) {
    return { canWrite: false, reason: 'The rig is offline or the SHOW PLAN is driving — colours are read-only.' };
  }
  return { canWrite: true };
}

// ── docs/75 §5 — the gate becomes a ROUTER for colour gestures ──────────────
//
// OPERATOR ORDER: *"selecting a new contrast or split or whatever method or
// color in the UI should update the ongoing program when it's running — right
// now I have to stop the program then start again to take the new changes."*
//
// `manualWriteGate` answers ONE question — "may a manual write go out at
// all?" — with two outcomes: yes, or the same refusal sentence for anyone who
// asks. That was honest while every colour edit was a full `/param-center`
// POST, because a POST while a family runs really would fight the daemon's
// own ticks. It stopped being honest the moment `ColorAutopilot.patchState`
// shipped a phase-preserving PATCH front door (docs/59 §5.1) that `crossfade`
// and `turns` already listed as accepting `palettes` live (`retunableLive`)
// — nothing had ever spent that acceptance. `colourGestureOutcome` is what
// spends it: a THIRD outcome, `'retarget'`, for the two families whose
// running ring a colour gesture can rebuild and PATCH in place instead of
// being refused.
export type ColourGestureAction = 'write' | 'retarget' | 'refuse';
export type ColourGestureOutcome = { action: ColourGestureAction; reason?: string };

/**
 * WHAT A COLOUR GESTURE DOES (wheel drag, chip tap, saved-pair load, A/B
 * pick — every write that used to go straight at `manualWriteGate`), given
 * only WHICH FAMILY is currently running:
 *
 *   none                    → 'write' — the ordinary manual path, unchanged.
 *   crossfade                 'retarget' — rebuild the 2-entry ring from the
 *                              new A/B and PATCH `{palettes: […]}`. A PATCH
 *                              can never touch `active`/`mode`, so the ring
 *                              staying length 2 keeps the kind `crossfade`
 *                              — there is no path from here to a 5-entry
 *                              takeover, which is exactly why this is safe
 *                              to do unconditionally instead of behind a
 *                              confirmation.
 *   turns                     'retarget' — rebuild the 5-entry ring from the
 *                              edited draft and PATCH it. Cadence, cursor and
 *                              generation all survive (`patchState` again),
 *                              closing the restart the old full-POST restage
 *                              apologized for in its own comment.
 *   follow-note              → 'refuse', with the EXISTING `manualWriteGate`
 *                              sentence for `'follow-note'` (D7 — the note
 *                              owns the hue; the only live levers for this
 *                              family are `sel`/`method`/`schemes`, already
 *                              wired through `retunableLive`).
 *   palette-set               'refuse', with the EXISTING `manualWriteGate`
 *                              sentence for `'palette-set'` (the config
 *                              belongs to the AUTOPILOT window; docs/61 §5).
 *
 * `surface` is accepted, not branched on: every colour gesture this answers
 * for already arrives from its own family's card by construction — the A/B
 * wheel exists only on the TWO COLOUR card, the per-slot wheel only on the
 * TURNS card — so there is no "wrong card" reading to disambiguate the way
 * `schemeTapOutcome` needs to (a scheme tap's CONTRAST/SPLIT/… row exists on
 * all three cards at once). It is kept in the signature for parity with that
 * function and so a future gesture that genuinely is cross-card has
 * somewhere to plug in without a signature break.
 *
 * OFFLINE / PLAN-LOCKED is deliberately NOT this function's business — that
 * check is orthogonal to which family is running and stays exactly where it
 * has always lived, in `manualWriteGate(disabled, kind)`. `colourGestureOutcome`
 * is KIND-ONLY: callers check `disabled` themselves (offline wins first, the
 * same order `manualWriteGate` has always enforced) and consult this table
 * only once they know the surface is live.
 *
 * Reuses `manualWriteGate`'s own sentences (never restates them) so the two
 * can never drift — the operator reads the identical refusal whichever path
 * produced it. THROWS on an unknown kind, matching `schemeTapOutcome` and
 * `manualWriteGate`'s own `default:` arm (codex P0): a colour gesture that
 * quietly did nothing would be indistinguishable from a broken control.
 */
export function colourGestureOutcome(kind: RotationKind, surface: ColorsCard): ColourGestureOutcome {
  switch (kind) {
    case 'none':
      return { action: 'write' };
    case 'crossfade':
    case 'turns': {
      void surface; // accepted for signature parity — see doc comment above.
      return { action: 'retarget' };
    }
    case 'follow-note':
    case 'palette-set': {
      const gate = manualWriteGate(false, kind);
      if (gate.canWrite) {
        throw new Error(`[colors_window] colourGestureOutcome expected '${kind}' to be refused`);
      }
      return { action: 'refuse', reason: gate.reason };
    }
    default:
      throw new Error(`[colors_window] unknown rotation kind '${kind}'`);
  }
}

/**
 * WHAT A SCHEME TAP DOES, given what the daemon is currently running AND
 * WHICH CARD the operator tapped from (docs/61 §5, fixing C3). A pure
 * function so the table is CHECKED rather than eyeballed in a handler.
 *
 *   none                                     → stage the ring AND write A/B
 *                                               (the ordinary manual path)
 *   turns,       tapped from the 'turns' card → ONE-TAP RESTAGE: a config
 *                                               write through the daemon's
 *                                               own front door, so the single
 *                                               writer never changes hands.
 *                                               docs/75 §5 changed WHAT that
 *                                               write is — a sparse PATCH
 *                                               `{palettes: […]}`, not the
 *                                               full POST this restage used
 *                                               to send — so cadence and the
 *                                               running cursor now survive
 *                                               the tap instead of resetting;
 *                                               see `turnsRetargetRing`.
 *   follow-note, tapped from the 'follow' card → METHOD OVERRIDE (below).
 *   turns / follow-note, any OTHER card       → stage only — a tap on the
 *                                               TWO COLOUR card while TURNS
 *                                               or FOLLOW NOTE drives from
 *                                               elsewhere must never be read
 *                                               as "restage"/"override".
 *   crossfade                                 → RETARGET (docs/75 §5,
 *                                               superseding docs/61 §5's
 *                                               "crossfade → stage-only on
 *                                               every card"): a scheme tap
 *                                               while the crossfade runs
 *                                               rebuilds the 2-entry ring
 *                                               from the tapped scheme's
 *                                               first two colours and PATCHes
 *                                               it in place. The kind still
 *                                               cannot change — a PATCH never
 *                                               touches `active`/`mode`, and
 *                                               the ring stays length 2 — so
 *                                               the old worry (a restage here
 *                                               would silently take the
 *                                               rotation from 2 entries to 5)
 *                                               no longer applies; that
 *                                               5-entry takeover still lives
 *                                               only behind the explicit
 *                                               START TURNS button.
 *   palette-set                               → stage only, on every card.
 *                                               The config belongs to the
 *                                               AUTOPILOT window; overwriting
 *                                               it from here would destroy
 *                                               another surface's work
 *                                               without being asked.
 *
 * NOTHING here ever auto-pauses the daemon (_211 §D): every stage-only case
 * names the driver AND the button that WOULD take over, on the message line.
 */
export type SchemeTapAction = 'stage-and-write' | 'restage' | 'retarget' | 'stage-only' | 'method-override';
export function schemeTapOutcome(
  kind: RotationKind, schemeTitle: string, surface: ColorsCard,
): { action: SchemeTapAction; message: string } {
  switch (kind) {
    case 'none':
      return { action: 'stage-and-write', message: `${schemeTitle} staged — A and B are live.` };
    case 'turns':
      if (surface === 'turns') {
        return { action: 'restage', message: `Rotation restaged to ${schemeTitle}.` };
      }
      return {
        action: 'stage-only',
        message: `${kindLabel(kind)} is driving — this stages only. STOP it (strip above) to write A/B.`,
      };
    case 'follow-note':
      if (surface === 'follow') {
        // METHOD OVERRIDE (docs/59 §6): the `_224` restage idiom, scoped to
        // the method axis. The write goes through the daemon's OWN front
        // door (a sparse `followNote.method` PATCH), so the single writer
        // never changes hands and the daemon crossfades to the tapped
        // generator over its own methodFadeS — identical on the rig to a
        // timer-driven advance, because that is exactly what it is.
        return { action: 'method-override', message: `Method set to ${schemeTitle} — cycle continues from here.` };
      }
      return {
        action: 'stage-only',
        message: `${kindLabel(kind)} is driving — this stages only. STOP it (strip above) to write A/B.`,
      };
    case 'crossfade':
      // docs/75 §5: a PATCH retarget, not the stage-only refusal docs/61 §5
      // shipped — see the table comment above for why the kind is safe.
      return {
        action: 'retarget',
        message: `${schemeTitle} retunes the running crossfade — from the next fade.`,
      };
    case 'palette-set':
      return {
        action: 'stage-only',
        message: 'AUTOPILOT palette set is driving — START TURNS to take over.',
      };
    default:
      throw new Error(`[colors_window] unknown rotation kind '${kind}'`);
  }
}

/**
 * RETARGET BUILDERS (docs/75 §5) — the small pure helpers a colour handler
 * uses to build the ring half of a `rotationRetunePatch(kind, { palettes })`
 * call once `colourGestureOutcome` says `'retarget'`. Both are exactly
 * `orbitPairs` at the shape each family's ring already has; kept as named
 * wrappers so a call site reads "build the crossfade's retarget ring" rather
 * than repeating the `orbitPairs([...], [0,1])` construction inline.
 *
 * Nothing else is required to make the retarget land: `retunableLive` already
 * lists `palettes` as live on both `crossfade` and `turns`, so
 * `rotationRetunePatch(kind, { palettes: ring })` already produces the
 * correct sparse `{palettes: […]}` PATCH body for either — that unused row is
 * the whole feature docs/75 §1 points at.
 */
export function crossfadeRetargetRing(hA: number, hB: number): ColorPair[] {
  return orbitPairs([colour(hA, 1, 1), colour(hB, 1, 1)], [0, 1]);
}

export function turnsRetargetRing(colours: Hsv[], sel: SchemePairSel): ColorPair[] {
  return orbitPairs(colours, sel);
}

// ── WHICH TWO OF THE FIVE FEED A AND B (_224, operator order 3) ─────────────
//
// "in the two-color mode with a scheme latched: the 5 swatches show, and the
//  ACTIVE TWO feeding colorPalette1/2 are selectable — slots 1+2 are the
//  default selection, but the operator can pick any other slot to be palette 1
//  or palette 2".
//
// The selection is a pair of RING INDICES, not colours, and that is the whole
// design: while a scheme is latched a wheel drag re-generates all five colours,
// and a selection stored as indices follows the re-theme (slots 2+4 stay slots
// 2+4 in the new palette) where a selection stored as colours would silently
// stop matching anything.
//
// The gesture is the window's existing one, not a new one: the COLOUR A /
// COLOUR B buttons ARM a channel exactly as they always have, and tapping a
// scheme slot assigns it to the armed channel — the same "arm, then tap a
// source" grammar the Live Touch sample chips and the saved-pair gallery
// already use. Which two are live is marked on the slots themselves with the
// same A / B badges the sample chips wear.
export const SCHEME_PAIR_DEFAULT: readonly [number, number] = [0, 1];
export type SchemePairSel = readonly [number, number];
/** 0 = COLOUR A (colorPalette1), 1 = COLOUR B (colorPalette2). */
export type PairChannel = 0 | 1;
export const PAIR_CHANNEL_LABELS: readonly string[] = ['A', 'B'];

export type SchemePairSelectResult =
  | { ok: true; sel: [number, number] }
  | { ok: false; reason: string };

/**
 * Assign ring slot `index` to channel `channel`.
 *
 * REFUSED, visibly, when that slot is already the OTHER channel's: A and B
 * would then be the same slot, the crossfade between them would be a fade from
 * a colour to itself, and a control that silently produces a dead transport is
 * worse than one that says why. An out-of-range index is a caller bug, not an
 * operator action, so it THROWS (codex P0).
 */
export function selectSchemePair(
  sel: SchemePairSel,
  channel: PairChannel,
  index: number,
  ringLength: number = TURNS_SLOT_COUNT,
): SchemePairSelectResult {
  if (!Number.isInteger(index) || index < 0 || index >= ringLength) {
    throw new Error(`[colors_window] scheme slot index ${index} is outside the ring of ${ringLength}`);
  }
  const other: PairChannel = channel === 0 ? 1 : 0;
  if (sel[other] === index) {
    return {
      ok: false,
      reason: `T${index + 1} is already COLOUR ${PAIR_CHANNEL_LABELS[other]} — pick a different slot for ${PAIR_CHANNEL_LABELS[channel]}.`,
    };
  }
  return { ok: true, sel: channel === 0 ? [index, sel[1]] : [sel[0], index] };
}

/** The two colours a selection picks out of a staged ring. THROWS on an index
 *  the ring cannot answer — a silently-substituted slot would put a colour on
 *  the rig the operator never chose. */
export function schemePairColours(ring: readonly Hsv[], sel: SchemePairSel): [Hsv, Hsv] {
  for (const i of sel) {
    if (!ring[i]) throw new Error(`[colors_window] scheme pair slot ${i} is not in a ring of ${ring.length}`);
  }
  return [ring[sel[0]], ring[sel[1]]];
}

export type PaletteEntry = string | ColorPair;

function isChannel(v: unknown): v is ColorChannel {
  if (typeof v === 'number') return Number.isFinite(v);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const c = v as Hsv;
  return typeof c.h === 'number' && typeof c.s === 'number' && typeof c.v === 'number';
}

export function isInlinePair(entry: unknown): entry is ColorPair {
  return !!entry && typeof entry === 'object' && !Array.isArray(entry)
    && isChannel((entry as ColorPair).c1)
    && isChannel((entry as ColorPair).c2);
}

/** Two ring channels are the same colour when every channel matches to within ε. */
function sameChannel(a: ColorChannel, b: ColorChannel): boolean {
  return sameColour(asHsv(a), asHsv(b));
}

/** A live TURNS config, read back off the wire: the ring of chosen colours (the
 *  pairs' first channels, de-stepped back into staged order) and the spacing
 *  and step the pair orbits at. */
export type TurnsOrbit = { ring: Hsv[]; distance: number; step: number };

function gcdLocal(a: number, b: number): number {
  return b === 0 ? a : gcdLocal(b, a % b);
}

/**
 * Is the live colour-autopilot config a TURNS ORBIT, and at what spacing AND
 * step?
 *
 * GENERALIZED for the stepped queue (docs/75 §4): a d = 1 pick now posts at
 * `s = 2`, so the old s = 1-only CHAIN test (`pairs[i].c2` is `pairs[i+d].c1`)
 * no longer recognizes every ring TURNS posts — it would read the daemon's own
 * s = 2 wire as `palette-set` and the window would lose the ring it is
 * rotating.
 *
 * THE SEARCH IS `d` OUTER, ascending from 1, and for each `d` it tries only
 * the step(s) that `orbitPairs` could actually have built AT THAT `d`:
 * `s = 1` always (the unstepped chain), and — when `orbitStep(d, n)` differs
 * from 1 — that builder step too. This is a correction to the CONTRACT's
 * literal "try s = 1 first, then s = 2" phrasing (docs/75 §4), which reads as
 * `s` OUTER, `d` inner: **that ordering is wrong** and _315 review caught it.
 * Concretely, on a 5-ring with a real `d = 1, s = 2` wire (the operator's
 * default pick), trying `s = 1` across ALL `d` before ever trying `s = 2`
 * finds a FALSE match at `d = 3` — the de-stepped `s = 1` ring at `d = 3`
 * happens to satisfy the chain test too, because a step-2 wire IS a step-1
 * chain of a differently-ordered ring. Reading `d` first and asking "what
 * step would THIS `d` have used" never reaches that alias: `d = 1` is tried
 * before `d = 3` regardless of which step recognizes it, so the genuine
 * `(1, 2)` match wins outright and the spurious `(3, 1)` reading (a REORDERED
 * ring — exactly the "Adoption hazard" docs/75 §4 names) is never returned.
 *
 * For each candidate the wire is DE-STEPPED back into staged order first:
 * wire entry `k` holds staged slot `k·s mod n` (by construction, `orbitPairs`
 * builds `c1` from exactly that slot), so `ring[(k·s) % n] = pairs[k].c1`
 * recovers the candidate ring directly, with no division or modular inverse
 * required. The candidate is valid iff every entry's `c2` lands on the
 * recovered ring's `d`-th-along slot: `pairs[k].c2 === ring[(k·s + d) % n]`
 * for every k — precisely the structure `orbitPairs` builds, read backwards.
 *
 * Trying `s = 1` before the builder step at EVERY `d` (not just d = 1) is
 * what keeps a MASTER ring (five copies of one colour) reporting
 * `{distance: 1, step: 1}`: every candidate fits a ring where every colour is
 * identical, so the first one tried — `d = 1, s = 1` — wins, exactly the
 * byte-identical readout TURNS has always shown for MASTER. A SPACED pick
 * (`d` = 2 or 3, posted at `s = 1` because `orbitStep` found it already
 * disjoint) is recognized on `d`'s own `s = 1` pass with no second step to
 * try. An ADJACENT pick (`d` = 1 or 4) fails at `s = 1` for any real
 * (non-degenerate) ring and resolves on that `d`'s `s = 2` pass instead.
 *
 * `staged`, when given, disambiguates equivalent wire aliases: only a
 * de-stepped ring that is a rotation of the operator's staged ring may win.
 * Without that context, a permuted ring can describe the same pairs at a
 * different distance.
 *
 * `gcd(s, n) !== 1` candidates are skipped outright: `orbitPairs` never posts
 * a step that is not coprime with the ring length (a lap would then miss
 * slots), so such a step could never be what is on the wire.
 *
 * Anything that never validates at any `d` (library ids, a hand-posted set of
 * unrelated pairs) is the ordinary palette-set autopilot and TURNS must not
 * claim it: the window would then show a ring the engine is not rotating.
 *
 * The test compares FULL COLOURS, not just hues (D2): a HUE-scheme ring is five
 * entries at one hue and five brightnesses, so a hue-only comparison would call
 * any five of them an orbit.
 */
export function turnsOrbit(
  palettes: readonly PaletteEntry[] | undefined,
  staged?: readonly Hsv[],
): TurnsOrbit | null {
  if (!Array.isArray(palettes) || palettes.length < 2) return null;
  if (!palettes.every(isInlinePair)) return null;
  const pairs = palettes as ColorPair[];
  const n = pairs.length;
  for (let d = 1; d < n; d++) {
    const builderStep = orbitStep(d, n);
    const candidateSteps = builderStep === 1 ? [1] : [1, builderStep];
    for (const s of candidateSteps) {
      if (s >= n || gcdLocal(s, n) !== 1) continue;
      const ring: ColorChannel[] = new Array(n);
      for (let k = 0; k < n; k++) ring[(k * s) % n] = pairs[k].c1;
      if (pairs.every((p, k) => sameChannel(p.c2, ring[(k * s + d) % n]))) {
        const hsvRing = ring.map(asHsv);
        if (staged && orbitPhase(staged, hsvRing) === null) continue;
        return { ring: hsvRing, distance: d, step: s };
      }
    }
  }
  return null;
}

/** Is the live colour-autopilot config a TURNS ring at any spacing? */
export function isTurnsConfig(palettes: readonly PaletteEntry[] | undefined): boolean {
  return turnsOrbit(palettes) !== null;
}

/** The ring of chosen COLOURS behind a TURNS config, in WIRE order — which
 *  begins at COLOUR A's slot, not necessarily at the staged T1 (`orbitPhase`
 *  recovers the offset). Supersedes the hue-only `turnsHues`. */
export function turnsColors(
  palettes: readonly PaletteEntry[] | undefined,
  staged?: readonly Hsv[],
): Hsv[] {
  return turnsOrbit(palettes, staged)?.ring ?? [];
}

/**
 * WHERE THE WIRE'S RING STARTS inside the STAGED one: the offset `k` for which
 * `wire[i]` is `staged[(k + i) % n]` at every i, or null when the wire is not
 * this ring at all (another surface staged different colours).
 *
 * The window posts its ring beginning at COLOUR A, so a non-default pick puts a
 * ROTATION of the five staged colours on the wire. Recovering `k` is what lets
 * the card keep the operator's own T1..T5 numbering while the rail and the "on
 * the rig now" line still read the wire: renumbering the staged slots under the
 * operator's fingers every time TURNS started would be a worse lie than the
 * phase is a complication.
 *
 * The SMALLEST k wins, so a ring whose colours repeat (MASTER) reports 0.
 */
export function orbitPhase(staged: readonly Hsv[], wire: readonly Hsv[]): number | null {
  const n = staged.length;
  if (n === 0 || wire.length !== n) return null;
  for (let k = 0; k < n; k++) {
    if (wire.every((c, i) => sameColour(c, staged[(k + i) % n]))) return k;
  }
  return null;
}

/**
 * The two STAGED slots a live orbit's pair `pairIndex` lights up — the wire's
 * window mapped back through `orbitPhase` into the operator's own numbering.
 *
 * `step` (docs/75 §4, defaulting to 1 — the pre-orbit identity) is how many
 * staged slots the window's LEADING end travels for each turn `pairIndex`
 * advances: `a = (phase + pairIndex·step) mod n`. At `step = 1` this reduces
 * exactly to the original adjacent-slide formula — every caller that has not
 * been updated to pass the daemon's actual step keeps compiling and keeps
 * behaving exactly as before. At `step = 2` (the queue's default for an
 * adjacent pick) turn *k*'s leading slot jumps two staged slots ahead of turn
 * *k-1*'s, matching the fresh-every-turn wire `orbitPairs` now posts.
 */
export function orbitWindowSlots(
  pairIndex: number, distance: number, phase: number, ringLength: number, step: number = 1,
): [number, number] {
  if (!(ringLength >= 2)) {
    throw new Error(`[colors_window] an orbit window needs a ring of at least 2, got ${ringLength}`);
  }
  const a = (((phase + pairIndex * step) % ringLength) + ringLength) % ringLength;
  return [a, (a + distance) % ringLength];
}

/**
 * Which pair of a live TURNS ring is on the rig right now? Derived from the
 * broadcast palettes + the reconciled colorPalette1/2 — never a local guess at
 * where the engine's cursor is. -1 when the rig is mid-crossfade between two
 * pairs (no pair matches exactly), which the UI shows as "fading", not as a
 * wrong highlight.
 *
 * Compares every channel (h, s AND v) at ε 1e-4, so a HUE ring — whose five
 * pairs share one hue and differ only in brightness — highlights the right
 * turn instead of always matching the first.
 */
export const LIT_PAIR_EPS = 1e-4;
function nearColour(a: Hsv, b: Hsv): boolean {
  return Math.abs(a.h - b.h) < LIT_PAIR_EPS
    && Math.abs(a.s - b.s) < LIT_PAIR_EPS
    && Math.abs(a.v - b.v) < LIT_PAIR_EPS;
}
export function litPairIndex(
  palettes: readonly PaletteEntry[] | undefined,
  c1: Hsv,
  c2: Hsv,
): number {
  if (!Array.isArray(palettes)) return -1;
  for (let i = 0; i < palettes.length; i++) {
    const p = palettes[i];
    if (!isInlinePair(p)) continue;
    if (nearColour(asHsv(p.c1), c1) && nearColour(asHsv(p.c2), c2)) return i;
  }
  return -1;
}

// ── THE SLIDING WINDOW, read off the rig (_224, operator order 2) ───────────
//
// "the rotation is a sliding adjacent-pair window over the 5 slots:
//  [c1],[c2],c3,c4,c5 → c1,[c2],[c3],c4,c5 → … wrapping"
//
// That IS what `turnsPairs` builds and what the daemon rotates. What was
// missing is the READOUT: `litPairIndex` only recognises the rig when it sits
// EXACTLY on a pair — i.e. during the hold — so in CONT, where the ring is
// always mid-fade, the highlight would never light at all and the window would
// never appear to slide.
//
// `rotationCursor` fixes that by INVERTING the engine's own tween. During a
// fade the daemon writes `lerpParams(pair[i-1], pair[i], t)`: `h` along the
// short arc (`lerpHue`), `s` and `v` linear. Six components, one unknown — so
// the progress is a least-squares projection of the live palette onto the
// from→to segment, plus a residual check that rejects a palette which is not on
// that segment at all. The result is the window index the ring is arriving at
// and how far through the arrival it is.
//
// DEADMAN RULE (docs/53 §5.2): this is DERIVED, never clocked. It moves only
// because the engine's tween frames arrive on the sharedParams broadcast, so
// the highlight animates from the rig and stops dead when the rig does. There
// is still no timer in this window.

/** How far off the from→to segment a palette may sit and still be called ON it.
 *  The engine writes exact `lerpParams` output and nothing re-slews it on the
 *  way to the broadcast, so a real fade frame lands at float precision; this is
 *  wide enough for JSON round-tripping and tight enough that a palette some
 *  OTHER writer set is rejected rather than mapped onto a plausible-looking
 *  progress. */
export const CURSOR_FIT_EPS = 2e-3;

/**
 * Least-squares progress of the live palette along one from→to segment, with
 * the worst per-component residual. null when the two endpoints coincide —
 * there is then no direction to measure progress along, and inventing one would
 * be a fallback.
 */
function fitSegment(from: ColorPair, to: ColorPair, live1: Hsv, live2: Hsv): { t: number; err: number } | null {
  const f = [asHsv(from.c1), asHsv(from.c2)];
  const g = [asHsv(to.c1), asHsv(to.c2)];
  const live = [live1, live2];
  const d: number[] = [];
  const e: number[] = [];
  for (let i = 0; i < 2; i++) {
    d.push(turnDelta(f[i].h, g[i].h)); e.push(turnDelta(f[i].h, live[i].h));
    d.push(g[i].s - f[i].s); e.push(live[i].s - f[i].s);
    d.push(g[i].v - f[i].v); e.push(live[i].v - f[i].v);
  }
  let num = 0;
  let den = 0;
  for (let k = 0; k < d.length; k++) { num += d[k] * e[k]; den += d[k] * d[k]; }
  if (den < 1e-12) return null;
  const t = Math.min(1, Math.max(0, num / den));
  let err = 0;
  for (let k = 0; k < d.length; k++) err = Math.max(err, Math.abs(e[k] - d[k] * t));
  return { t, err };
}

/**
 * WHERE THE ROTATION'S WINDOW IS RIGHT NOW.
 *
 *   index — the pair the ring is ON (settled) or ARRIVING AT (fading). Pair i
 *           is the window over slots i and i+1 (wrapping), so the window slides
 *           one slot each time this advances.
 *   t     — 1 when the rig is settled on that pair (the hold), otherwise how far
 *           through the fade FROM pair i-1 it is.
 *
 * null when the rig is not on the ring at all (another surface wrote the
 * palette, or the config is not a chained ring) — the card then says so instead
 * of highlighting a window that is not live.
 */
export type RotationCursor = { index: number; t: number };
export function rotationCursor(
  palettes: readonly PaletteEntry[] | undefined,
  c1: Hsv,
  c2: Hsv,
): RotationCursor | null {
  if (!Array.isArray(palettes) || palettes.length < 2) return null;
  if (!palettes.every(isInlinePair)) return null;
  const pairs = palettes as ColorPair[];
  // Settled on a pair — the HOLD. Checked first so a stationary ring reports
  // the exact window rather than an arbitrary segment that happens to end there.
  const settled = litPairIndex(pairs, c1, c2);
  if (settled >= 0) return { index: settled, t: 1 };
  const n = pairs.length;
  let best: { index: number; t: number; err: number } | null = null;
  for (let i = 0; i < n; i++) {
    const fit = fitSegment(pairs[(i - 1 + n) % n], pairs[i], c1, c2);
    if (!fit || fit.err > CURSOR_FIT_EPS) continue;
    if (!best || fit.err < best.err - 1e-12) best = { index: i, t: fit.t, err: fit.err };
  }
  return best ? { index: best.index, t: best.t } : null;
}

/**
 * The window's LEADING end as a fraction of the ring, for the sliding rail: pair
 * `index` puts COLOUR A on staged slot `phase + index·step`, and a fade toward
 * it is that end travelling from `phase + (index-1)·step`. Returns the left
 * edge in ring units (0..n), which the rail divides by n. Kept here, not in
 * the component, because "where the highlight sits" is a rule about the
 * engine's cursor.
 *
 * `phase` is `orbitPhase`'s offset between the wire's ring and the staged one;
 * it defaults to 0, which is both the pre-orbit behaviour and what a
 * default-selection ring reports.
 *
 * `step` (docs/75 §4) is how many staged slots the window's leading end
 * travels per turn — `raw = (index - 1 + t)·step + phase`, so the fraction
 * `t` through a fade scales by the SAME step as a whole turn does, and the
 * rail's highlight covers `step` cells of ground during each fade rather than
 * one. Defaults to 1, the pre-orbit identity: every existing caller that has
 * not been updated to pass the daemon's actual step keeps compiling and keeps
 * animating exactly as before.
 */
export function cursorRailOffset(
  cursor: RotationCursor, ringLength: number, phase = 0, step: number = 1,
): number {
  const raw = (cursor.index - 1 + cursor.t) * step + phase;
  return ((raw % ringLength) + ringLength) % ringLength;
}

/** One highlighted stretch of the rail, in ring units. `left` may run past the
 *  ring's end — the rail draws every segment twice (at `left` and one lap back)
 *  inside a clipping container, so a window crossing the T5→T1 seam slides
 *  through it instead of teleporting. */
export type RailSegment = { left: number; width: number };

/**
 * THE RAIL'S HIGHLIGHT for a live orbit: where COLOUR A's cell is, and where
 * COLOUR B's cell is `distance` slots along.
 *
 * ADJACENT ENDS ARE ONE CAPSULE, NOT TWO PILLS. At distance 1 the two cells
 * touch, so this returns the single 2-cell segment the rail has always drawn —
 * splitting it would put a visible notch in a highlight that never had one.
 * Past that the two lit cells are genuinely separated and the rail says so with
 * two 1-cell segments, which is the whole point of the orbit: the operator can
 * see the spacing being kept as the window travels.
 *
 * `step` (docs/75 §4) passes straight through to `cursorRailOffset` — it only
 * changes WHERE the window's leading edge sits and how far it travels per
 * turn, never the two-cells-vs-capsule shape rule above, which is purely a
 * function of `distance`. Defaults to 1, the pre-orbit identity.
 */
export function cursorRailSegments(
  cursor: RotationCursor, ringLength: number, distance: number, phase = 0, step: number = 1,
): RailSegment[] {
  const a = cursorRailOffset(cursor, ringLength, phase, step);
  if (distance === 1) return [{ left: a, width: 2 }];
  return [{ left: a, width: 1 }, { left: a + distance, width: 1 }];
}

// ── The atomic engine write ─────────────────────────────────────────────────

/**
 * The ONE payload shape for a two-colour write: BOTH slots in a single
 * `/param-center` POST so the engine broadcasts one sharedParams update and the
 * rig never flickers through a half-applied pair. Same recipe as
 * ColorPickerModal's `writeColors` (docs/36); the engine slews the change over
 * `colorTransitionMs`.
 */
export function paletteWritePayload(h1: number, h2: number) {
  return corePaletteWritePayload(h1, h2);
}

/** Canonical GET/WS reconciliation shared with non-React colour surfaces. */
export function reduceColorControlState<T extends CoreColorAutopilotState>(
  previous: T,
  payload: Record<string, unknown>,
): T {
  return coreReduceColorControlState(previous, payload);
}

// ── The saved colour-pair gallery ───────────────────────────────────────────
// Scene-owned (engine `/color-pairs`, states/<scene>/color_pairs_state.yaml) so
// every iPad sees the same list — the operator's ruling. The prototype's
// localStorage is scaffolding and is NOT used: a browser copy would be a
// per-device shadow of show state.

export const COLOR_PAIRS_MAX = 24;

// ── PRESET PALETTES (_242 orders 2 + 4) ─────────────────────────────────────
//
// OPERATOR ORDERS: "add feature to store the colors as preset palettes" and
// "when storing generate the icon and ask for a name too - by default accept an
// empty name too for no name on the screen".
//
// This EXTENDS the existing SAVE PAIR store rather than adding a sibling one.
// Two galleries of saved colours, one holding pairs and one holding palettes,
// would make "where did I save that" an operator question with two answers; and
// the pair IS the degenerate palette, so one store with richer entries is the
// honest model.
//
// THE ENTRY. Every preset carries the A/B pair it puts on the rig — that field
// is REQUIRED and byte-identical to the v1 shape, which is what makes the
// migration free: a v1 file's entries are already valid v2 entries, and the load
// path that turns a preset into `colorPalette1/2` is unchanged. Everything the
// v2 shape adds is OPTIONAL:
//
//   name    the operator's label. ABSENT means unnamed, and unnamed is a
//           first-class outcome the operator can choose (order 4) — the chip
//           then shows its generated icon and its two angles, nothing else.
//           An empty string is never stored; absence is the single
//           representation of "no name", so two encodings can never disagree.
//   ring    the five staged TURNS colours, when there are any. This is what
//           makes an entry a PALETTE rather than a pair.
//   sel     which two ring slots feed A and B (`SchemePairSel`).
//   scheme  the latched generator id, and
//   base    the hue it was latched at — together they restore the LATCH, so a
//           recalled palette still re-themes on a wheel drag the way it did
//           when it was saved. Stored ALONGSIDE the ring, not instead of it:
//           the ring is what the operator saw (they may have hand-edited a
//           slot), the latch is how it re-generates. Deriving either from the
//           other would let the two disagree.
//
// GROUPING RULES, validated loudly rather than papered over:
//   * `ring` and `sel` are all-or-nothing — a ring with no selection cannot say
//     which colours are live, and a selection with no ring indexes nothing.
//   * `scheme` and `base` are all-or-nothing, and both require a `ring`.
export const COLOR_PRESETS_SCHEMA_VERSION = 2;

/** Longest name the field accepts. A chip is ~110 pt wide; past this the label
 *  is ellipsed on the glass and the operator cannot read their own preset. */
export const PRESET_NAME_MAX = 24;

export type PalettePreset = HuePair & {
  name?: string;
  ring?: Hsv[];
  sel?: [number, number];
  scheme?: SchemeId;
  base?: number;
};

function isUnitNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function isHsv(v: unknown): v is Hsv {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const c = v as Hsv;
  return isUnitNumber(c.h) && isUnitNumber(c.s) && isUnitNumber(c.v);
}

/**
 * VALIDATE the v2 block of one entry, in place, and THROW on anything it does
 * not understand (codex P0 — the brief's "no silent coercion of unknown
 * shapes"). Silently dropping a malformed `ring` is the worst available
 * outcome: the preset would still load, as a bare pair, and put two colours on
 * the rig where the operator saved five.
 *
 * Returns the validated optional fields, or an empty object for a plain v1 pair.
 */
function presetExtras(p: Record<string, unknown>, where: string): Omit<PalettePreset, 'c1' | 'c2'> {
  const out: Omit<PalettePreset, 'c1' | 'c2'> = {};
  if (p.name !== undefined) {
    if (typeof p.name !== 'string') {
      throw new Error(`${where}.name must be a string, got ${JSON.stringify(p.name)}`);
    }
    // Absence is the ONE representation of "unnamed" — normalize '' away here
    // so nothing downstream has to test for both.
    const trimmed = p.name.trim();
    if (trimmed) out.name = trimmed.slice(0, PRESET_NAME_MAX);
  }
  const hasRing = p.ring !== undefined;
  const hasSel = p.sel !== undefined;
  if (hasRing !== hasSel) {
    throw new Error(`${where}: 'ring' and 'sel' must be present together (a ring with no selection cannot say which two colours are live)`);
  }
  if (hasRing) {
    if (!Array.isArray(p.ring) || p.ring.length < 2) {
      throw new Error(`${where}.ring must be an array of at least 2 {h,s,v} colours`);
    }
    const ring = p.ring.map((c, i) => {
      if (!isHsv(c)) throw new Error(`${where}.ring[${i}] must be {h,s,v} with every channel in [0,1], got ${JSON.stringify(c)}`);
      return colour(c.h, c.s, c.v);
    });
    if (!Array.isArray(p.sel) || p.sel.length !== 2) {
      throw new Error(`${where}.sel must be a two-element array of ring indices`);
    }
    const sel = p.sel.map((i, k) => {
      if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= ring.length) {
        throw new Error(`${where}.sel[${k}] must be an integer index into a ring of ${ring.length}, got ${JSON.stringify(i)}`);
      }
      return i as number;
    });
    if (sel[0] === sel[1]) {
      throw new Error(`${where}.sel picks slot ${sel[0]} for BOTH channels — A and B would be the same colour`);
    }
    out.ring = ring;
    out.sel = [sel[0], sel[1]];
  }
  const hasScheme = p.scheme !== undefined;
  const hasBase = p.base !== undefined;
  if (hasScheme !== hasBase) {
    throw new Error(`${where}: 'scheme' and 'base' must be present together — a latch is a generator AND the hue it was generated from`);
  }
  if (hasScheme) {
    if (!hasRing) throw new Error(`${where}: 'scheme' requires a 'ring' — there is nothing for the latch to re-theme`);
    if (typeof p.scheme !== 'string' || !(SCHEME_IDS as readonly string[]).includes(p.scheme)) {
      throw new Error(`${where}.scheme must be one of ${SCHEME_IDS.join(', ')}, got ${JSON.stringify(p.scheme)}`);
    }
    if (!isUnitNumber(p.base)) {
      throw new Error(`${where}.base must be a hue in [0,1], got ${JSON.stringify(p.base)}`);
    }
    out.scheme = p.scheme as SchemeId;
    out.base = p.base;
  }
  return out;
}

/**
 * Normalizer for anything that claims to be the saved list.
 *
 * TOTAL over junk in the PAIR fields — an entry whose c1/c2 are unusable is
 * skipped, exactly as in v1, because the engine already warns about those on
 * read and a half-written hue must never reach the rig. Anything that claims
 * the v2 shape and gets it WRONG throws instead (see `presetExtras`), as does a
 * `schemaVersion` from the future: a newer client's file may carry fields whose
 * meaning we do not know, and rendering it as if we did is the lie this refuses
 * to tell.
 */
export function normalizeColorPairs(input: unknown): PalettePreset[] {
  let raw: unknown[] = [];
  if (Array.isArray(input)) {
    raw = input;
  } else if (input && typeof input === 'object') {
    const env = input as Record<string, unknown>;
    if (env.schemaVersion !== undefined) {
      if (typeof env.schemaVersion !== 'number' || !Number.isInteger(env.schemaVersion) || env.schemaVersion < 1) {
        throw new Error(`color presets: schemaVersion must be a positive integer, got ${JSON.stringify(env.schemaVersion)}`);
      }
      if (env.schemaVersion > COLOR_PRESETS_SCHEMA_VERSION) {
        throw new Error(`color presets: file is schemaVersion ${env.schemaVersion}, this build understands up to ${COLOR_PRESETS_SCHEMA_VERSION} — upgrade CaptainPad rather than showing a palette it cannot read.`);
      }
    }
    if (Array.isArray(env.pairs)) raw = env.pairs;
  }
  const out: PalettePreset[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const rec = p as Record<string, unknown>;
    if (!isUnitNumber(rec.c1) || !isUnitNumber(rec.c2)) continue;
    out.push({ c1: rec.c1, c2: rec.c2, ...presetExtras(rec, `color presets[${i}]`) });
    if (out.length >= COLOR_PAIRS_MAX) break;
  }
  return out;
}

export function samePair(a: HuePair, b: HuePair): boolean {
  return Math.abs(a.c1 - b.c1) < COLOUR_EPS && Math.abs(a.c2 - b.c2) < COLOUR_EPS;
}

/**
 * Two presets are the SAME saved thing when they put the same colours on the
 * rig: the pair, and the ring if either has one. The NAME is deliberately not
 * part of identity — re-saving the identical palette under a second name would
 * give the gallery two chips that light together and delete separately.
 */
export function samePreset(a: PalettePreset, b: PalettePreset): boolean {
  if (!samePair(a, b)) return false;
  const ra = a.ring ?? [];
  const rb = b.ring ?? [];
  if (ra.length !== rb.length) return false;
  return ra.every((c, i) => sameColour(c, rb[i]));
}

export type PresetAddResult =
  | { ok: true; presets: PalettePreset[] }
  | { ok: false; reason: string };

/**
 * Add a preset to the gallery. A duplicate and a full gallery are REFUSED with
 * a message the pane shows — never silently dropped, never silently evicting
 * somebody else's save (the list is shared across iPads).
 */
export function addPalettePreset(
  presets: readonly PalettePreset[], next: PalettePreset,
): PresetAddResult {
  if (presets.length >= COLOR_PAIRS_MAX) {
    return { ok: false, reason: `Full at ${COLOR_PAIRS_MAX} palettes — delete one first (EDIT).` };
  }
  if (presets.some((p) => samePreset(p, next))) {
    return { ok: false, reason: 'That palette is already saved.' };
  }
  return { ok: true, presets: [...presets, next] };
}

export function removeColorPairAt<T>(presets: readonly T[], index: number): T[] {
  if (index < 0 || index >= presets.length) return [...presets];
  return presets.filter((_, i) => i !== index);
}

/**
 * BUILD the preset a save would store, from what the window currently holds.
 * A pure function so "what exactly gets saved" is a checked rule rather than an
 * inline object literal in a handler: the ring block rides along only when
 * there IS a ring, and the latch block only when a scheme is latched — which is
 * precisely the grouping `presetExtras` validates on the way back in.
 */
export function buildPalettePreset(args: {
  c1: number; c2: number;
  name: string;
  ring?: readonly Hsv[];
  sel?: SchemePairSel;
  latch?: { scheme: SchemeId; base: number } | null;
}): PalettePreset {
  const preset: PalettePreset = { c1: args.c1, c2: args.c2 };
  const name = args.name.trim().slice(0, PRESET_NAME_MAX);
  if (name) preset.name = name;
  if (args.ring && args.ring.length >= 2) {
    if (!args.sel) {
      throw new Error('[colors_window] a saved ring needs its A/B selection — refusing to store a palette that cannot say which two colours are live');
    }
    preset.ring = args.ring.map((c) => colour(c.h, c.s, c.v));
    preset.sel = [args.sel[0], args.sel[1]];
    if (args.latch) {
      preset.scheme = args.latch.scheme;
      preset.base = wrap01(args.latch.base);
    }
  }
  return preset;
}

/**
 * THE GENERATED ICON, as data (order 4: "generate the icon"). A preset's chip
 * and its name dialog both draw THIS list — a wedge per colour, in ring order —
 * so the picture the operator approves while naming is byte-identical to the
 * one that lands in the gallery. Deterministic from the colours alone: no image
 * file, no hash, no stored asset, nothing to go stale when a colour changes.
 *
 * A ring shows its five true colours (brightness included, so a HUE ramp reads
 * as a ramp); a bare pair shows its two hues at the pin, which is exactly what
 * that preset puts on the rig.
 */
export function presetIconColours(p: PalettePreset): string[] {
  if (p.ring && p.ring.length >= 2) return p.ring.map(hsvCss);
  return [hueCss(p.c1), hueCss(p.c2)];
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function degrees(h: number): number {
  return Math.round(wrap01(h) * 360);
}

export function pairLabel(p: HuePair): string {
  return `${degrees(p.c1)}° / ${degrees(p.c2)}°`;
}

/** What a preset's chip says. An unnamed preset falls back to nothing invented
 *  — it shows the two angles it always showed, which is a fact about it. */
export function presetLabel(p: PalettePreset): string {
  return p.name ? p.name : pairLabel(p);
}

/** Screen-reader / message-line description of a preset. */
export function presetDescription(p: PalettePreset): string {
  const ring = p.ring ? `, ${p.ring.length}-colour palette` : '';
  return `${presetLabel(p)}${ring}`;
}

// ── The COLORS window contract (docs/61 — W1) ───────────────────────────────
//
// OPERATOR ORDER (verbatim): "check the color live control in the deck tab
// please. I just got a conflict with follow note. when going from follow
// note to another tab for example, it should safely disable the follow note
// so it's not confusing. for the others too — plan interaction and mechanism
// of the color."
//
// Everything below is PURE — no timers, no React, no clock (`_217` no-timer
// rule, grep-gated). It is the single arbitration surface W2/W3/W4 compile
// against; see docs/61 §2.1/§3/§4.1/§4.2/§4.4/§5 for the normative text this
// ports.

/** The COLORS window's three mode cards. Was a local `type Mode` in
 *  `colors_window.tsx`; canonicalised here because W2/W3 both need it. */
export type ColorsCard = 'two' | 'turns' | 'follow';

/**
 * Which card OWNS a running family (docs/61 §4.1/§4.3/§2.1). `palette-set`
 * has no card of its own in this window (its controls live in the AUTOPILOT
 * window), and `none` owns nothing — both answer `null`.
 */
export function cardForKind(kind: RotationKind): ColorsCard | null {
  switch (kind) {
    case 'follow-note': return 'follow';
    case 'turns': return 'turns';
    case 'crossfade': return 'two';
    case 'palette-set': return null;
    case 'none': return null;
    default:
      throw new Error(`[colors_window] unknown rotation kind '${kind}'`);
  }
}

/** Human name of a running family, for sentences (docs/61 §4.2/§5). `none`
 *  answers '' — callers must never render it; every caller here either
 *  branches away from `'none'` first or is unreachable for it. */
export function kindLabel(kind: RotationKind): string {
  switch (kind) {
    case 'follow-note': return 'FOLLOW NOTE';
    case 'turns': return 'PALETTE TURNS';
    case 'crossfade': return 'the crossfade';
    case 'palette-set': return 'an AUTOPILOT palette set';
    case 'none': return '';
    default:
      throw new Error(`[colors_window] unknown rotation kind '${kind}'`);
  }
}

// ── §2.1 — the YIELD rule ────────────────────────────────────────────────
//
// "When an intent gesture takes the operator away from the FOLLOW NOTE card
// while follow-note is driving, the client stops it: POST
// /deck/color-autopilot {active:false} — narrated, freeze-in-place."
//
// Precisely, yield fires iff ALL FOUR hold (docs/61 §2.1):
//   1. the gesture's own veto constant is on;
//   2. the surface is not disabled (offline / plan-locked);
//   3. the running kind is one D2 says should yield (`YIELD_KINDS`);
//   4. the card being LEFT is that kind's own card — tapping TURNS while
//      follow-note runs armed elsewhere is NOT leaving follow-note.
//
// D1 — one constant per trigger, so an operator veto of a single leg is a
// one-liner rather than a code change to `yieldDecision` itself.
export const YIELD_ON_CARD_SWITCH: boolean = true;   // L1
export const YIELD_ON_WINDOW_HIDE: boolean = true;   // L2
export const YIELD_ON_TAB_LEAVE: boolean = true;     // L3

/** D2 veto — WHICH families yield on an intent gesture. TURNS/crossfade are
 *  staged, cadenced ambience by design (docs/61 §2 D2) and persist on every
 *  navigation; only the invisible-driver family (FOLLOW NOTE) yields. A D2
 *  reversal is adding `'turns'`/`'crossfade'` to this one array. */
export const YIELD_KINDS: readonly RotationKind[] = ['follow-note'];

/** §2.1 narration — success. */
export const YIELD_SAY = 'FOLLOW NOTE stopped — colours frozen in place.';
/** §2.1 narration — the POST was rejected or the engine was unreachable. */
export const YIELD_FAIL_SAY = "Couldn't stop FOLLOW NOTE — it is still driving.";

export type YieldGesture = 'card' | 'hide' | 'tab';
export type YieldDecision = { yield: boolean; post?: { active: false }; say: string };

/**
 * The §2.1 rule as ONE total function. The body of a yield POST is EXACTLY
 * `{active:false}` — a bare stop (§2.1 "load-bearing: `inferMode` keeps the
 * live mode on a field-less body"). A non-yield answer carries no `post` key
 * at all (never `post: undefined`), so a caller that does `if (d.post)` never
 * has to distinguish the two encodings of "nothing to send".
 */
export function yieldDecision(args: {
  gesture: YieldGesture; leavingCard: ColorsCard; kind: RotationKind; disabled: boolean;
}): YieldDecision {
  const gestureArmed = args.gesture === 'card' ? YIELD_ON_CARD_SWITCH
    : args.gesture === 'hide' ? YIELD_ON_WINDOW_HIDE
    : YIELD_ON_TAB_LEAVE;
  const shouldYield = gestureArmed
    && !args.disabled
    && YIELD_KINDS.includes(args.kind)
    && args.leavingCard === cardForKind(args.kind);
  if (shouldYield) {
    return { yield: true, post: { active: false }, say: YIELD_SAY };
  }
  return { yield: false, say: '' };
}

// ── §4.1 — the DRIVING STRIP ─────────────────────────────────────────────

/** The fields of the colour-autopilot broadcast the strip reads. 100 %
 *  deadman: every word on the strip comes off THIS, never a clock. */
export type DrivingBroadcast = {
  palettes?: readonly PaletteEntry[];
  delay_s?: number;
  transitionMs?: number;
  notePc?: number | null;
  currentScheme?: string | null;
};
export type DrivingStripModel = { show: boolean; title: string; detail: string };

/** `delay_s` → the HOLD half of a driving-strip detail. 0 is CONT; a missing
 *  or non-finite value is a fact about the feed, shown as '—', never guessed. */
function drivingHoldLabel(delay_s: number | undefined): string {
  if (typeof delay_s !== 'number' || !Number.isFinite(delay_s)) return '—';
  return delay_s === 0 ? 'CONT' : `${delay_s}s`;
}
/** `transitionMs` → the FADE half of a driving-strip detail, same '—' rule. */
function drivingFadeLabel(transitionMs: number | undefined): string {
  if (typeof transitionMs !== 'number' || !Number.isFinite(transitionMs)) return '—';
  return `${transitionMs / 1000}s`;
}

/**
 * The strip's content, 100 % broadcast-derived (docs/61 §4.1). `show` is
 * false whenever nothing is driving, OR the driving family's OWN card is the
 * one currently visible — the strip only ever appears to say what is
 * happening SOMEWHERE ELSE. `palette-set` has no own card (`cardForKind`
 * answers `null`, which never equals a real `ColorsCard`), so it shows on
 * every card, as the contract requires.
 */
export function drivingStripModel(
  kind: RotationKind, visibleCard: ColorsCard, broadcast: DrivingBroadcast,
): DrivingStripModel {
  if (kind === 'none' || cardForKind(kind) === visibleCard) {
    return { show: false, title: '', detail: '' };
  }
  switch (kind) {
    case 'follow-note': {
      const scheme = broadcast.currentScheme;
      const schemeTitle = typeof scheme === 'string' && (SCHEME_IDS as readonly string[]).includes(scheme)
        ? SCHEME_TITLES[scheme as SchemeId]
        : '—';
      return {
        show: true,
        title: 'FOLLOW NOTE IS DRIVING',
        detail: `${noteName(broadcast.notePc)} · ${schemeTitle}`,
      };
    }
    case 'turns': {
      const n = Array.isArray(broadcast.palettes) ? broadcast.palettes.length : 0;
      return {
        show: true,
        title: 'PALETTE TURNS IS DRIVING',
        detail: `${n} colours · ${drivingHoldLabel(broadcast.delay_s)}/${drivingFadeLabel(broadcast.transitionMs)}`,
      };
    }
    case 'crossfade': {
      const timing = `${drivingHoldLabel(broadcast.delay_s)}/${drivingFadeLabel(broadcast.transitionMs)}`;
      const pair = Array.isArray(broadcast.palettes) ? broadcast.palettes[0] : undefined;
      if (pair !== undefined && isInlinePair(pair)) {
        const hA = degrees(hueOf(pair.c1));
        const hB = degrees(hueOf(pair.c2));
        return { show: true, title: 'CROSSFADE IS DRIVING', detail: `${hA}° ↔ ${hB}° · ${timing}` };
      }
      // Not a readable 2-entry pair — detail is just the timing half rather
      // than a guessed/invented pair of degrees.
      return { show: true, title: 'CROSSFADE IS DRIVING', detail: timing };
    }
    case 'palette-set': {
      const n = Array.isArray(broadcast.palettes) ? broadcast.palettes.length : 0;
      return {
        show: true,
        title: 'AUTOPILOT PALETTE SET IS DRIVING',
        detail: `${n} palettes · controls in the AUTOPILOT window`,
      };
    }
    default:
      throw new Error(`[colors_window] unknown rotation kind '${kind}'`);
  }
}

// ── §4.4 — the app-wide COLOR chip ──────────────────────────────────────────

/** The shared-header chip's label. `null` means render nothing (the chip is
 *  visible only while `colorAutopilot.active`). */
export function colorChipLabel(kind: RotationKind, notePc: number | null | undefined): string | null {
  switch (kind) {
    case 'follow-note': return `COLORS · FOLLOW ${noteName(notePc)}`;
    case 'turns': return 'COLORS · TURNS';
    case 'crossfade': return 'COLORS · XFADE';
    case 'palette-set': return 'COLORS · SET';
    case 'none': return null;
    default:
      throw new Error(`[colors_window] unknown rotation kind '${kind}'`);
  }
}

// ── §5 row 1 — the takeover message names the LOSER ─────────────────────────

/**
 * A START posted while another family was running is an explicit takeover
 * (docs/61 §5): the message NAMES the loser. '' when there was no previous
 * family, or the family did not change (a retune/restart of the SAME kind is
 * not a takeover).
 */
export function takeoverNote(prevKind: RotationKind, nextKind: RotationKind): string {
  if (prevKind === 'none' || prevKind === nextKind) return '';
  return `${kindLabel(nextKind).toUpperCase()} replaced ${kindLabel(prevKind).toUpperCase()}.`;
}
