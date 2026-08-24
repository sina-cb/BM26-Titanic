/*
  136_curl_drift.js — "Curl Drift"

  CURL-NOISE ADVECTION. A smoky, swirling interior current built from the 2-D
  CURL of a value-noise potential: the along-line velocity is the cross-axis
  derivative of the potential, which makes the flow DIVERGENCE-FREE — particles
  are carried around each other instead of piling up, so the line never bunches
  into a static bright knot the way a plain noise-brightness pattern does.
  Brightness is particle DENSITY: the same noise field read back along three
  incompressible streamlines (three advection lags), summed. All six MODULES
  share one potential field but sample different ROWS of it, so the eddies line
  up loosely across the wall rather than marching in lockstep.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         the Seg1/Seg2 boundary (world x = 0.5 -> u ~ 0.545). Seg2 is
                 the narrower downstream half and runs SEG2_FLOW faster; the
                 travel coordinate is CONTINUOUS across it.
    moduleId     derived from z alone: the six modules are parallel lines spread
                 evenly across z, so moduleId = floor(nz * 6) clamped to 0..5.
    Per-module variation is a deterministic PHI row offset plus an EVEN-MODULE
    REVERSAL: with `cohesion` below 0.5 the even modules' current runs against
    the `direction` knob, so the room reads as interleaved counter-currents.
    `cohesion` -> 1 collapses every module onto one identical drift.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

AUDIO_MODULATION_V1:
  sliderDensity <- micLow range 0.40..0.85 curve ease  # the smoke thickens with the low band
  # STATIC: localSpeed, direction, scale, cohesion, whiteFoam, moduleHueShift, hueShiftFreq, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first, Direction
// always second (memory note `pattern-param-order`); the shared per-module hue
// shift pair is always declared LAST.
export var localSpeed = 0.44;
export var direction = 0.72;
export var scale = 0.42;
export var density = 0.40;
export var cohesion = 0.35;
export var whiteFoam = 0.30;
export var moduleHueShift = 0.50;
export var hueShiftFreq = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue body
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white shear
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderScale(v) { scale = v; }
export function sliderDensity(v) { density = v; }
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
// Modules 1-3 (BoilderRoom-A) land on 0..2, modules 4-6 (BoilderRoom-B) on 3..5.
function moduleIdOf(zz) {
  var mid = floor(clamp01(zz) * 6.0);
  if (mid > 5.0) mid = 5.0;
  return mid;
}

// Continuous travel coordinate: Seg2 is compressed by SEG2_FLOW so the same
// phase covers more physical line there — the current speeds up downstream
// without a seam in the wave itself.
function travelOf(uu) {
  if (uu < SEAM) return uu;
  return SEAM + (uu - SEAM) / SEG2_FLOW;
}

// ── Shared per-module hue shift (identical in 136-145) ───────────────────────
// dH_m(t) = A * sin(2*pi*f*t + m * GOLDEN_ANGLE * 2*pi), with
// A = HUE_SHIFT_MAX * moduleHueShift  (hard cap 0.06 of the hue circle) and
// f = 0.005 + 0.095 * hueShiftFreq^2 Hz (~3 min ... ~10 s period).
// `wave(p)` IS 0.5 + 0.5*sin(2*pi*p), so 2*wave(p) - 1 is exactly that sine on a
// 0..1 turn. The phase is accumulated ALREADY SCALED by f, so the PHASE_WRAP (an
// integer number of turns) is exactly continuous and a slider move never steps.
// Only the HUE moves: S and V are untouched, and at moduleHueShift 0 the baked
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
var BASE_RATE = 0.0900;    // advection cycles/sec at localSpeed 0.5
var BOIL_RATE = 0.0410;    // the potential's own evolution — never stops
var FD_H = 0.35;           // finite-difference step for the curl

var boilPhase = 0.0;
var drift = array(6);      // per-module advection phase (accumulated, never scaled)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _advanceHueShift(dt);
  _bakeModulePalettes();

  // Canonical local-speed law: 0.5 -> 1x, 1 -> 4x, 0 -> 0.25x.
  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);

  // Direction is a true reversal; the centre still drifts (a current never
  // stops) but at the slowest magnitude.
  var dSign = 1.0;
  if (clamp01(direction) < 0.5) dSign = -1.0;
  var dMag = 0.30 + 1.40 * abs(clamp01(direction) - 0.5) * 2.0;

  // The potential keeps evolving on its own axis whatever the current does, so
  // no module is ever frozen.
  boilPhase = boilPhase + dt * BOIL_RATE * localGain;
  if (boilPhase >= PHASE_WRAP) boilPhase = boilPhase - PHASE_WRAP;

  // Per-module phases are ACCUMULATED, never a scaled copy of one clock, so a
  // reversal or a cohesion move changes the RATE and never jumps the field.
  var spread = 1.0 - clamp01(cohesion);
  for (var mm = 0; mm < 6; mm++) {
    var sgn = dSign;
    if (spread > 0.5 && (mm % 2) == 0) sgn = 0.0 - dSign;
    drift[mm] = drift[mm] + dt * BASE_RATE * localGain * sgn * dMag;
    if (drift[mm] >= PHASE_WRAP) drift[mm] = drift[mm] - PHASE_WRAP;
    if (drift[mm] <= 0.0 - PHASE_WRAP) drift[mm] = drift[mm] + PHASE_WRAP;
  }
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var mid = moduleIdOf(z);
  var spread = 1.0 - clamp01(cohesion);

  // Field row: at cohesion 1 every module reads the SAME row of the potential.
  var row = mid * PHI * spread;
  var kk = 1.60 + clamp01(scale) * 6.40;
  var aa = s * kk + mid * GOLDEN_ANGLE * 7.0 * spread;
  var bb = row + boilPhase;

  // CURL of the potential: the along-line velocity is d(psi)/d(cross-axis).
  // Taking a derivative of a scalar potential is what makes the field
  // divergence-free, so the advected density can never accumulate.
  var psiUp = perlin(aa, bb + FD_H, boilPhase * 0.31, 1.0);
  var psiDn = perlin(aa, bb - FD_H, boilPhase * 0.31, 1.0);
  var vel = (psiUp - psiDn) / (2.0 * FD_H);

  // Three incompressible streamlines: the same density field read back at three
  // irrational advection lags. Their sum is a smoke that swirls but never bunches.
  var flow = drift[mid];
  var n1 = perlin(aa - vel * 0.55 + flow, bb * 0.5 + 11.7, boilPhase * 0.17, 1.0);
  var n2 = perlin(aa - vel * 1.30 + flow * PHI, bb * 0.5 + 11.7, boilPhase * 0.17, 1.0);
  var n3 = perlin(aa - vel * 2.10 + flow * SQRT2, bb * 0.5 + 11.7, boilPhase * 0.17, 1.0);
  var dens = clamp01(n1 * 0.45 + n2 * 0.33 + n3 * 0.22);

  var dn = clamp01(density);
  var core = pow(dens, 2.40 - dn * 1.40);

  // Floor is a shaped wet sheen, never flat and never black (interior rule);
  // the crest gain deliberately stops short of full scale so a saturated cp1
  // reads as depth rather than as a lit tube.
  var bri = clamp01(0.060 + 0.130 * dens + (0.070 + dn * 0.460) * core);

  // cp2 is an ACCENT on shear (where the curl is strongest) and on the sharpest
  // density crests — never a co-lead, so the room keeps one colour.
  var shear = clamp01(abs(vel) * 0.90);
  var mix = clamp01(pow(core, 3.00) * 0.16 + shear * 0.10);

  var r = (mp1r[mid] + (mp2r[mid] - mp1r[mid]) * mix) * bri;
  var g = (mp1g[mid] + (mp2g[mid] - mp1g[mid]) * mix) * bri;
  var b = (mp1b[mid] + (mp2b[mid] - mp1b[mid]) * mix) * bri;

  // whiteFoam desaturates the densest core toward S ~= 0.1. The pattern emits
  // RGB only — the rig derives W natively — so a near-white core is what
  // actually lights the W element.
  var foam = clamp01((core - 0.55) / 0.45) * clamp01(whiteFoam) * 0.90;
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
