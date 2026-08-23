/*
  138_gerstner_swell.js — "Gerstner Swell"

  TROCHOIDAL (GERSTNER) OCEAN WAVES. A plain sine is a bad ocean: real swell has
  POINTED crests and wide flat troughs, because every water particle moves on a
  circle, not up and down. Three Gerstner components with steepness Q are summed
  here; the horizontal displacement that produces the trochoid is applied to the
  sampling coordinate, so the crests sharpen and the troughs broaden exactly as
  `steepness` rises, and foam only appears where the surface is genuinely steep.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         the Seg1/Seg2 boundary; the travel coordinate is CONTINUOUS
                 across it (SEG2_FLOW), so the swell stretches, never jumps.
    moduleId     derived from z alone: floor(nz * 6) clamped to 0..5.
    Per-module character is a SPEED SCALING 1 + 0.12*(moduleId - 2.5): the swell
    arrives at each module at its own pace, so a crest crossing the room fans
    into a diagonal. Below `cohesion` 0.5 the alternate modules also run against
    the `direction` knob, which reads as a cross-sea. Both effects fade out as
    `cohesion` -> 1, where every module carries one identical swell.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

AUDIO_MODULATION_V1:
  sliderSteepness <- micLow range 0.30..0.80 curve ease  # the low band sharpens the crests
  # STATIC: localSpeed, direction, wavelength, cohesion, whiteFoam, moduleHueShift, hueShiftFreq, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first, Direction
// always second; the shared per-module hue shift pair is always declared LAST.
export var localSpeed = 0.40;
export var direction = 0.74;
export var steepness = 0.30;
export var wavelength = 0.45;
export var cohesion = 0.30;
export var whiteFoam = 0.38;
export var moduleHueShift = 0.50;
export var hueShiftFreq = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue swell body
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white crest
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderSteepness(v) { steepness = v; }
export function sliderWavelength(v) { wavelength = v; }
export function sliderCohesion(v) { cohesion = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }
export function sliderModuleHueShift(v) { moduleHueShift = v; }
export function sliderHueShiftFreq(v) { hueShiftFreq = v; }

// ── Shared interior idiom (identical in 131-145) ─────────────────────────────
var SEAM = 0.5454545;         // Seg1/Seg2 boundary in normalized u (world x = 0.5)
var SEG2_FLOW = 1.15;         // downstream narrows: Seg2 runs ~15% faster
var PHI = 1.6180339;
var SQRT2 = 1.4142136;
var GOLDEN_ANGLE = 0.3819660; // 1 - 1/PHI — per-module step, never 1/6
var PHASE_WRAP = 10000.0;
var HUE_SHIFT_MAX = 0.054;    // hue-shift amplitude (~19 deg). Under the spec's
                              // 0.06 hard cap with margin: the cap is on the
                              // MEASURED output, and an 8-bit RGB frame only
                              // resolves hue to a few thousandths of a turn.

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// Module identity from geometry only: the six MODULES are parallel lines spread
// evenly along z, so nz alone names the module — floor(nz * 6) clamped to 0..5.
function moduleIdOf(zz) {
  var mid = floor(clamp01(zz) * 6.0);
  if (mid > 5.0) mid = 5.0;
  return mid;
}

// Continuous travel coordinate: Seg2 is compressed by SEG2_FLOW.
function travelOf(uu) {
  if (uu < SEAM) return uu;
  return SEAM + (uu - SEAM) / SEG2_FLOW;
}

// ── Shared per-module hue shift (identical in 136-145) ───────────────────────
// dH_m(t) = A * sin(2*pi*f*t + m * GOLDEN_ANGLE * 2*pi), with
// A = HUE_SHIFT_MAX * moduleHueShift and f = 0.005 + 0.095*hueShiftFreq^2 Hz.
// `wave(p)` IS 0.5 + 0.5*sin(2*pi*p); the phase is accumulated ALREADY SCALED by
// f, so the PHASE_WRAP (an integer number of turns) is exactly continuous and a
// slider move never steps. Only the HUE moves; at moduleHueShift 0 the baked
// palette equals the un-shifted palette exactly.
var hueShiftPhase = 0.0;
var bakeCursor = 0.0;         // round-robin pointer for the palette bake
var baked = 0;
var mp1r = array(6);
var mp1g = array(6);
var mp1b = array(6);
var mp2r = array(6);
var mp2g = array(6);
var mp2b = array(6);

function _hsvBake(hh, ss, vv, mm, slot) {
  var hv = hh - floor(hh); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = vv * (1.0 - ss);
  var qv = vv * (1.0 - fv * ss);
  var tv = vv * (1.0 - (1.0 - fv) * ss);
  var rr = vv; var gg = tv; var bb = pv;
  if      (iv == 1) { rr = qv;   gg = vv;   bb = pv;   }
  else if (iv == 2) { rr = pv;   gg = vv;   bb = tv;   }
  else if (iv == 3) { rr = pv;   gg = qv;   bb = vv;   }
  else if (iv == 4) { rr = tv;   gg = pv;   bb = vv;   }
  else if (iv == 5) { rr = vv;   gg = pv;   bb = qv;   }
  if (slot == 1) { mp1r[mm] = rr; mp1g[mm] = gg; mp1b[mm] = bb; }
  else           { mp2r[mm] = rr; mp2g[mm] = gg; mp2b[mm] = bb; }
}

function _advanceHueShift(dt) {
  var hf = clamp01(hueShiftFreq);
  hueShiftPhase = hueShiftPhase + dt * (0.005 + 0.095 * hf * hf);
  if (hueShiftPhase >= PHASE_WRAP) hueShiftPhase = hueShiftPhase - PHASE_WRAP;
}

function _bakeOne(mm) {
  var amp = HUE_SHIFT_MAX * clamp01(moduleHueShift);
  var dh = amp * (2.0 * wave(hueShiftPhase + mm * GOLDEN_ANGLE) - 1.0);
  _hsvBake(cp1H + dh, cp1S, cp1V, mm, 1);
  _hsvBake(cp2H + dh, cp2S, cp2V, mm, 2);
}

// The VM caps beforeRender at ~2000 bytecode instructions PER FRAME (measured:
// past the cap the rest of beforeRender is silently skipped), and a full
// six-module HSV bake alone is a third of that. The hue shift is a slow sine —
// one full cycle is 10 s even at hueShiftFreq 1 — so ONE module is re-baked per
// frame, round-robin: every module is current within 6 frames (150 ms, 1/66 of
// the fastest cycle), which is still perfectly smooth, and the rest of the
// budget stays with the composition. The first frame bakes all six, so no
// module is ever unlit.
function _bakeModulePalettes() {
  if (baked == 0) {
    for (var mm = 0; mm < 6; mm++) _bakeOne(mm);
    baked = 1;
  } else {
    _bakeOne(bakeCursor);
    bakeCursor = bakeCursor + 1.0;
    if (bakeCursor > 5.0) bakeCursor = 0.0;
  }
}

// ── Composition state ────────────────────────────────────────────────────────
var BASE_RATE = 0.1180;    // swell cycles/sec at localSpeed 0.5
// Per-module swell phases are ACCUMULATED at their own rate rather than scaled
// off one clock, so a speed-scaling or reversal change alters the RATE and never
// jumps the wave.
var swell = array(6);

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _advanceHueShift(dt);
  _bakeModulePalettes();

  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);

  var dSign = 1.0;
  if (clamp01(direction) < 0.5) dSign = -1.0;
  var dMag = 0.30 + 1.40 * abs(clamp01(direction) - 0.5) * 2.0;

  var spread = 1.0 - clamp01(cohesion);
  for (var mm = 0; mm < 6; mm++) {
    // The swell reaches each module at its own pace; the spread closes as
    // cohesion rises, so at cohesion 1 all six phases advance identically.
    var sc = 1.0 + 0.12 * (mm - 2.5) * spread;
    var sgn = dSign;
    // Alternate modules run against the knob below cohesion 0.5. This is a
    // SNAP in the slider (never in time) for the same reason 133 snaps: a
    // blended heading crosses zero and leaves those modules stalled, and a
    // stalled swell is not a swell.
    if (spread > 0.5 && (mm % 2) == 1) sgn = 0.0 - dSign;
    swell[mm] = swell[mm] + dt * BASE_RATE * localGain * sc * sgn * dMag;
    if (swell[mm] >= PHASE_WRAP) swell[mm] = swell[mm] - PHASE_WRAP;
    if (swell[mm] <= 0.0 - PHASE_WRAP) swell[mm] = swell[mm] + PHASE_WRAP;
  }
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var mid = moduleIdOf(z);
  var ph = swell[mid];

  // Three components on irrational wavenumber ratios — a real sea state, never
  // a single sine and never an integer harmonic stack.
  var wl = clamp01(wavelength);
  var k1 = 1.1000 + wl * 2.6000;
  var k2 = k1 * PHI;
  var k3 = k1 * SQRT2 * 2.0;
  var a1 = 0.52;
  var a2 = 0.31;
  var a3 = 0.17;

  var qq = clamp01(steepness);

  // Trochoid: each particle's HORIZONTAL displacement is the cosine of its own
  // phase. Feeding that displacement back into the sampling coordinate is what
  // turns the sine into a Gerstner wave — pointed crests, wide troughs.
  var t1 = k1 * s - ph;
  var t2 = k2 * s - ph * PHI;
  var t3 = k3 * s - ph * 0.6180339;
  var dsp = a1 * (2.0 * wave(t1 + 0.25) - 1.0)
          + a2 * (2.0 * wave(t2 + 0.25) - 1.0)
          + a3 * (2.0 * wave(t3 + 0.25) - 1.0);
  var s2 = s - qq * 0.150 * dsp;

  var h1 = k1 * s2 - ph;
  var h2 = k2 * s2 - ph * PHI;
  var h3 = k3 * s2 - ph * 0.6180339;
  var hh = a1 * (2.0 * wave(h1) - 1.0)
         + a2 * (2.0 * wave(h2) - 1.0)
         + a3 * (2.0 * wave(h3) - 1.0);
  var surf = clamp01(0.5 + 0.5 * hh);

  // Crest sharpness: steepness raises the exponent, so the lit band narrows onto
  // the peaks while the troughs open out.
  var crest = pow(surf, 1.40 + qq * 3.20);

  // Shaped wet sheen floor — a trough is dark water, never a bare strand.
  var bri = clamp01(0.070 + 0.090 * surf + 0.360 * crest);

  // cp2 is an ACCENT on the sharpest peaks only, never a co-lead.
  var mix = clamp01(pow(crest, 2.60) * 0.24);

  var r = (mp1r[mid] + (mp2r[mid] - mp1r[mid]) * mix) * bri;
  var g = (mp1g[mid] + (mp2g[mid] - mp1g[mid]) * mix) * bri;
  var b = (mp1b[mid] + (mp2b[mid] - mp1b[mid]) * mix) * bri;

  // whiteFoam desaturates only genuinely STEEP peaks — foam is a property of
  // steepness, not of height, so it needs both the crest and the knob.
  var foam = clamp01((crest - 0.50) / 0.50) * clamp01(whiteFoam) * (0.35 + qq * 0.60);
  if (foam > 0.0) {
    var mx = r;
    if (g > mx) mx = g;
    if (b > mx) mx = b;
    r = r + (mx - r) * foam;
    g = g + (mx - g) * foam;
    b = b + (mx - b) * foam;
  }

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
