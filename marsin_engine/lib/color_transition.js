/**
 * color_transition.js — perceptually uniform color interpolation (OKLab/OKLCH).
 *
 * Replaces naive sRGB / HSV / CIELAB blending for every user-visible
 * color-to-color transition (gradient stops, palette crossfades). Naive sRGB
 * lerp collapses through muddy gray between complementary hues; HSV lerp is
 * perceptually non-uniform (its hue wheel bunches greens and stretches blues);
 * CIELAB (chroma.js 'lab', and the Java color libs of old) has a known hue
 * bend in the blue region. OKLab fixes those while staying two 3x3 matrices +
 * a cube root per conversion.
 *
 * Method (researched 2026-07-24, docs in .agent/reports/202607/20260724_38_*):
 *   - Space: OKLab (Björn Ottosson 2020, "A perceptual color space for image
 *     processing", https://bottosson.github.io/posts/oklab/ — public-domain
 *     reference implementation; adopted by CSS Color Module Level 4 as
 *     oklab()/oklch() and as a gradient interpolation space).
 *   - Path: default 'oklch' — cylindrical interpolation: lightness and chroma
 *     linear, hue along the SHORTEST arc, so saturated A→saturated B stays
 *     saturated the whole way (the "hue map gradient" behavior). Achromatic
 *     endpoints (chroma ≈ 0: white/gray/black) have no hue — they adopt the
 *     other endpoint's hue, which kills the classic off-axis "bow" artifact.
 *   - Alternative 'oklab' mode — straight line through OKLab. Slightly less
 *     vivid between complementary hues (passes near gray) but never detours
 *     through a third hue; this is what Tailwind v4 ships for CSS gradients.
 *     For stage lighting we default to 'oklch' (vivid > neutral), and every
 *     entry point takes a mode parameter so the choice is one argument away.
 *   - Gamut: OKLCH paths between in-gamut endpoints can exit sRGB. Converting
 *     back we clamp L to [0,1] and binary-search chroma down (hue and
 *     lightness held) until the color fits — CSS Color 4 §13-style chroma
 *     reduction — then clamp residual float dust. No raw channel clipping,
 *     so no hue/lightness skew artifacts.
 *
 * Performance: transitions precompute their endpoint OKLCH once
 * (makeRgbTransition/makeHsvTransition); gradients bake into a Float32Array
 * LUT (buildGradientLut) so per-pixel per-frame cost is one indexed read.
 * Module-level scratch buffers keep the hot paths allocation-free (single-
 * threaded use only, which is all this codebase does).
 *
 * This file is dependency-free and runs in both the browser and Node.
 * SIBLING COPY: simulation/src/core/color_transition.js — keep the math
 * identical (same constants, same behavior) when editing either.
 */

// ── sRGB transfer function ────────────────────────────────────────────────

function srgbChannelToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ── sRGB ↔ OKLab (Ottosson reference constants) ──────────────────────────

/**
 * Convert gamma-encoded sRGB [0,1] to OKLab.
 * @param {number} r @param {number} g @param {number} b
 * @param {number[]|Float64Array} out — length ≥ 3, receives [L, a, b]
 * @returns out
 */
export function srgbToOklab(r, g, b, out) {
  const lr = srgbChannelToLinear(r);
  const lg = srgbChannelToLinear(g);
  const lb = srgbChannelToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  out[0] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return out;
}

/** OKLab → LINEAR sRGB (may be out of [0,1] — caller gamut-maps). */
function oklabToLinearSrgb(L, a, b, out) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return out;
}

// Linear-space tolerance: anything this far outside [0,1] is float dust from
// the matrix round-trip, not a real gamut escape — clamp instead of remapping.
const GAMUT_LINEAR_EPS = 1e-6;
// OKLab chroma below which a color is achromatic (hue is meaningless).
const ACHROMATIC_CHROMA = 1e-4;
// Binary-search iterations for chroma reduction (2^-20 chroma precision).
const GAMUT_MAP_ITERATIONS = 20;

const _lin = new Float64Array(3); // scratch — NOT reentrant (single-threaded)

function _linearInGamut(lin) {
  return lin[0] >= -GAMUT_LINEAR_EPS && lin[0] <= 1 + GAMUT_LINEAR_EPS &&
         lin[1] >= -GAMUT_LINEAR_EPS && lin[1] <= 1 + GAMUT_LINEAR_EPS &&
         lin[2] >= -GAMUT_LINEAR_EPS && lin[2] <= 1 + GAMUT_LINEAR_EPS;
}

function _clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function _encodeClamped(lin, out) {
  out[0] = _clamp01(linearChannelToSrgb(_clamp01(lin[0])));
  out[1] = _clamp01(linearChannelToSrgb(_clamp01(lin[1])));
  out[2] = _clamp01(linearChannelToSrgb(_clamp01(lin[2])));
  return out;
}

/**
 * OKLab → gamma sRGB [0,1] with gamut mapping: L clamped to [0,1], then
 * chroma reduced by binary search (hue/lightness held) until inside sRGB.
 * @param {number} L @param {number} a @param {number} b
 * @param {number[]|Float32Array|Float64Array} out — length ≥ 3, receives [r, g, b]
 * @returns out
 */
export function oklabToSrgbGamutMapped(L, a, b, out) {
  if (L <= 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  if (L >= 1) { out[0] = 1; out[1] = 1; out[2] = 1; return out; }
  oklabToLinearSrgb(L, a, b, _lin);
  if (_linearInGamut(_lin)) return _encodeClamped(_lin, out);
  // Out of gamut — binary-search the largest in-gamut chroma fraction.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < GAMUT_MAP_ITERATIONS; i++) {
    const mid = (lo + hi) * 0.5;
    oklabToLinearSrgb(L, a * mid, b * mid, _lin);
    if (_linearInGamut(_lin)) lo = mid; else hi = mid;
  }
  oklabToLinearSrgb(L, a * lo, b * lo, _lin);
  return _encodeClamped(_lin, out);
}

// ── HSV ↔ RGB (Pixelblaze-style h/s/v all in [0,1], h wraps) ──────────────

/**
 * HSV → gamma sRGB. h wraps (any real), s/v clamped to [0,1].
 * @param {number[]|Float32Array|Float64Array} out — length ≥ 3
 * @returns out
 */
export function hsvToRgb(h, s, v, out) {
  const hh = ((h % 1) + 1) % 1;
  const ss = _clamp01(s);
  const vv = _clamp01(v);
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = vv * (1 - ss);
  const q = vv * (1 - f * ss);
  const t = vv * (1 - (1 - f) * ss);
  switch (i % 6) {
    case 0: out[0] = vv; out[1] = t; out[2] = p; break;
    case 1: out[0] = q; out[1] = vv; out[2] = p; break;
    case 2: out[0] = p; out[1] = vv; out[2] = t; break;
    case 3: out[0] = p; out[1] = q; out[2] = vv; break;
    case 4: out[0] = t; out[1] = p; out[2] = vv; break;
    default: out[0] = vv; out[1] = p; out[2] = q; break;
  }
  return out;
}

/**
 * gamma sRGB [0,1] → HSV (h/s/v in [0,1]; h = 0 for achromatic input).
 * @param {number[]|Float32Array|Float64Array} out — length ≥ 3, receives [h, s, v]
 * @returns out
 */
export function rgbToHsv(r, g, b, out) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  out[0] = h;
  out[1] = max === 0 ? 0 : d / max;
  out[2] = max;
  return out;
}

// ── Transition core (precomputed-endpoint interpolation) ──────────────────

const VALID_MODES = new Set(['oklch', 'oklab']);

function _assertMode(mode) {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`color_transition: unknown mode '${mode}' (use 'oklch' or 'oklab')`);
  }
}

function _assertRgb(rgb, label) {
  if (!rgb || rgb.length < 3 ||
      !Number.isFinite(rgb[0]) || !Number.isFinite(rgb[1]) || !Number.isFinite(rgb[2])) {
    throw new Error(`color_transition: ${label} must be a finite [r,g,b] triple, got ${JSON.stringify(rgb)}`);
  }
}

/**
 * Endpoint pre-computation shared by transitions and gradient segments.
 * Returns { L, C, h, hasHue } — hue in radians, hasHue false when achromatic.
 */
function _endpointLch(r, g, b) {
  const lab = srgbToOklab(r, g, b, new Float64Array(3));
  const C = Math.hypot(lab[1], lab[2]);
  const hasHue = C > ACHROMATIC_CHROMA;
  return { L: lab[0], A: lab[1], B: lab[2], C, h: hasHue ? Math.atan2(lab[2], lab[1]) : 0, hasHue };
}

/** Shortest signed hue arc from h1 to h2 (radians, result in (-π, π]). */
function _shortestArc(h1, h2) {
  let d = (h2 - h1) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Build a reusable transition between two gamma-sRGB colors.
 * Endpoints are converted to OKLab/OKLCH ONCE here; sample() is then cheap
 * and allocation-free. sample(0)/sample(1) return the exact endpoints.
 *
 * @param {number[]} fromRgb — [r,g,b] in [0,1]
 * @param {number[]} toRgb — [r,g,b] in [0,1]
 * @param {'oklch'|'oklab'} mode
 * @returns {{ sample(t: number, out: number[]): number[] }}
 */
export function makeRgbTransition(fromRgb, toRgb, mode = 'oklch') {
  _assertMode(mode);
  _assertRgb(fromRgb, 'fromRgb');
  _assertRgb(toRgb, 'toRgb');
  const f = _endpointLch(fromRgb[0], fromRgb[1], fromRgb[2]);
  const g = _endpointLch(toRgb[0], toRgb[1], toRgb[2]);
  const r0 = fromRgb[0], g0 = fromRgb[1], b0 = fromRgb[2];
  const r1 = toRgb[0], g1 = toRgb[1], b1 = toRgb[2];

  if (mode === 'oklab') {
    return {
      sample(t, out) {
        if (t <= 0) { out[0] = r0; out[1] = g0; out[2] = b0; return out; }
        if (t >= 1) { out[0] = r1; out[1] = g1; out[2] = b1; return out; }
        const L = f.L + (g.L - f.L) * t;
        const A = f.A + (g.A - f.A) * t;
        const B = f.B + (g.B - f.B) * t;
        return oklabToSrgbGamutMapped(L, A, B, out);
      },
    };
  }

  // oklch — resolve hues: an achromatic endpoint adopts the other's hue so
  // white→red fades in place instead of bowing through a phantom hue.
  let hFrom = f.h;
  let hTo = g.h;
  if (!f.hasHue && g.hasHue) hFrom = g.h;
  if (!g.hasHue && f.hasHue) hTo = f.h;
  const hArc = _shortestArc(hFrom, hTo);
  return {
    sample(t, out) {
      if (t <= 0) { out[0] = r0; out[1] = g0; out[2] = b0; return out; }
      if (t >= 1) { out[0] = r1; out[1] = g1; out[2] = b1; return out; }
      const L = f.L + (g.L - f.L) * t;
      const C = f.C + (g.C - f.C) * t;
      const h = hFrom + hArc * t;
      return oklabToSrgbGamutMapped(L, C * Math.cos(h), C * Math.sin(h), out);
    },
  };
}

// ── HSV transition (engine palette crossfade) ─────────────────────────────

const _hsvScratchA = new Float64Array(3);
const _hsvScratchB = new Float64Array(3);

/**
 * Build a transition between two Pixelblaze-style {h,s,v} colors that
 * interpolates PERCEPTUALLY (through OKLCH/OKLab) but speaks HSV at both
 * ends, so the caller can keep injecting h/s/v into pattern VMs.
 * sample(0)/sample(1) return exact copies of the endpoints (no round-trip
 * drift); mid-ramp values are the perceptual path re-expressed as HSV.
 *
 * @param {{h:number,s:number,v:number}} fromHsv
 * @param {{h:number,s:number,v:number}} toHsv
 * @param {'oklch'|'oklab'} mode
 * @returns {(t: number) => {h:number,s:number,v:number}}
 */
export function makeHsvTransition(fromHsv, toHsv, mode = 'oklch') {
  if (!fromHsv || !toHsv) {
    throw new Error('color_transition: makeHsvTransition requires two {h,s,v} endpoints');
  }
  const from = { h: fromHsv.h ?? 0, s: fromHsv.s ?? 1, v: fromHsv.v ?? 1 };
  const to = { h: toHsv.h ?? 0, s: toHsv.s ?? 1, v: toHsv.v ?? 1 };
  hsvToRgb(from.h, from.s, from.v, _hsvScratchA);
  hsvToRgb(to.h, to.s, to.v, _hsvScratchB);
  const transition = makeRgbTransition(
    [_hsvScratchA[0], _hsvScratchA[1], _hsvScratchA[2]],
    [_hsvScratchB[0], _hsvScratchB[1], _hsvScratchB[2]],
    mode
  );
  const rgb = new Float64Array(3);
  const hsv = new Float64Array(3);
  return function sampleHsv(t) {
    if (t <= 0) return { h: from.h, s: from.s, v: from.v };
    if (t >= 1) return { h: to.h, s: to.s, v: to.v };
    transition.sample(t, rgb);
    rgbToHsv(rgb[0], rgb[1], rgb[2], hsv);
    return { h: hsv[0], s: hsv[1], v: hsv[2] };
  };
}

// ── Gradient LUT (sim Lighting Engine gradient mode) ──────────────────────

/**
 * Parse '#rgb' or '#rrggbb' into [r,g,b] floats in [0,1]. Loud on garbage.
 * @param {string} hex
 * @param {number[]|Float32Array|Float64Array} out — length ≥ 3
 * @returns out
 */
export function parseHexColor(hex, out) {
  if (typeof hex !== 'string') {
    throw new Error(`color_transition: hex color must be a string, got ${typeof hex}`);
  }
  const s = hex.trim().replace(/^#/, '');
  let r;
  let g;
  let b;
  if (s.length === 3) {
    r = parseInt(s[0] + s[0], 16);
    g = parseInt(s[1] + s[1], 16);
    b = parseInt(s[2] + s[2], 16);
  } else if (s.length === 6) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
  } else {
    throw new Error(`color_transition: invalid hex color '${hex}'`);
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    throw new Error(`color_transition: invalid hex color '${hex}'`);
  }
  out[0] = r / 255;
  out[1] = g / 255;
  out[2] = b / 255;
  return out;
}

/**
 * Bake an evenly-spaced multi-stop gradient into a flat Float32Array LUT
 * ([r,g,b, r,g,b, …], gamma sRGB in [0,1], `size` entries). Index 0 is the
 * first stop, index size-1 the last; adjacent stops interpolate in OKLCH
 * (default) or OKLab. Build once per stops change, then sample per-pixel
 * with a single multiply+index — no allocation, no conversion.
 *
 * @param {string[]} hexStops — ≥ 1 hex color strings
 * @param {number} size — LUT entries (≥ 2)
 * @param {'oklch'|'oklab'} mode
 * @returns {Float32Array} length size*3
 */
export function buildGradientLut(hexStops, size = 1024, mode = 'oklch') {
  _assertMode(mode);
  if (!Array.isArray(hexStops) || hexStops.length < 1) {
    throw new Error('color_transition: buildGradientLut needs at least one stop');
  }
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`color_transition: LUT size must be an integer ≥ 2, got ${size}`);
  }
  const stops = hexStops.map(hx => parseHexColor(hx, new Float64Array(3)));
  const lut = new Float32Array(size * 3);
  const rgb = new Float64Array(3);

  if (stops.length === 1) {
    for (let i = 0; i < size; i++) {
      lut[i * 3] = stops[0][0];
      lut[i * 3 + 1] = stops[0][1];
      lut[i * 3 + 2] = stops[0][2];
    }
    return lut;
  }

  const segments = stops.length - 1;
  const transitions = [];
  for (let sIdx = 0; sIdx < segments; sIdx++) {
    transitions.push(makeRgbTransition(stops[sIdx], stops[sIdx + 1], mode));
  }
  for (let i = 0; i < size; i++) {
    const phase = i / (size - 1);
    let seg = Math.floor(phase * segments);
    if (seg >= segments) seg = segments - 1;
    const t = phase * segments - seg;
    transitions[seg].sample(t, rgb);
    lut[i * 3] = rgb[0];
    lut[i * 3 + 1] = rgb[1];
    lut[i * 3 + 2] = rgb[2];
  }
  return lut;
}
