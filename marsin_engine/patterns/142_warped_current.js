/*
  142_warped_current.js — "Warped Current"

  DOMAIN WARPING. A noise field is sampled not at u but at u displaced by a
  second noise field, which is itself displaced by a third: n(u + a*n(u + b*n(u))).
  Two levels of that turns smooth noise into something viscous and marbled —
  stretched filaments, folded sheets, the look of dye pulled through syrup. It is
  the most painterly member of the family and the one that reads least like a
  wave.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         the travel coordinate is continuous across it (SEG2_FLOW).
    moduleId     derived from z alone: floor(nz * 6) clamped to 0..5.
    Per-module character: the WARP AMPLITUDE is scaled by 0.6 + 0.16*moduleId, so
    module 1 stays a calm smooth current while module 6 is fully marbled — the
    room reads as a gradient of turbulence across the wall. `direction` reverses
    the top three modules against the bottom three, so the two halves of the room
    pull apart.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

AUDIO_MODULATION_V1:
  sliderWarp <- micLow range 0.30..0.90 curve pow2  # the low band folds the current
  # STATIC: localSpeed, direction, scale, whiteFoam, moduleHueShift, hueShiftFreq, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first, Direction
// always second; the shared per-module hue shift pair is always declared LAST.
export var localSpeed = 0.40;
export var direction = 0.72;
export var warp = 0.30;
export var scale = 0.45;
export var whiteFoam = 0.30;
export var moduleHueShift = 0.50;
export var hueShiftFreq = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue current body
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white filament
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderWarp(v) { warp = v; }
export function sliderScale(v) { scale = v; }
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
var BASE_RATE = 0.1900;    // current cycles/sec at localSpeed 0.5

// Per-module phases are ACCUMULATED, never a scaled copy of one clock, so the
// direction split changes the RATE and never jumps the field.
var flow = array(6);

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

  for (var mm = 0; mm < 6; mm++) {
    // The top three modules run against the bottom three: the room splits.
    var sgn = dSign;
    if (mm > 2.0) sgn = 0.0 - dSign;
    flow[mm] = flow[mm] + dt * BASE_RATE * localGain * sgn * dMag;
    if (flow[mm] >= PHASE_WRAP) flow[mm] = flow[mm] - PHASE_WRAP;
    if (flow[mm] <= 0.0 - PHASE_WRAP) flow[mm] = flow[mm] + PHASE_WRAP;
  }
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var mid = moduleIdOf(z);
  var ph = flow[mid];

  var kk = 1.20 + clamp01(scale) * 5.00;
  var a0 = s * kk;

  // Per-module warp amplitude: calm at the top of the room, wild at the bottom.
  var aw = clamp01(warp) * (0.60 + 0.16 * mid);

  // Two levels of domain warp. Each level samples a different row of the field
  // (an irrational multiple of moduleId) and drifts on its own slow axis.
  var q1 = perlin(a0 + ph, 3.10 + mid * PHI, ph * 0.610, 1.0);
  var q2 = perlin(a0 + aw * (q1 - 0.5) * 3.20 + ph * PHI, 7.70 + mid * SQRT2, ph * 0.430, 1.0);
  var q3 = perlin(a0 + aw * (q2 - 0.5) * 4.40, 11.30 + mid * 0.6180339, ph * 0.310, 1.0);

  var body = clamp01(q3);
  var fil = pow(body, 2.20);

  // Shaped wet sheen floor — the current is never a bare strand.
  var bri = clamp01(0.070 + 0.140 * body + 0.330 * fil);

  // cp2 is an ACCENT on the stretched filaments, where the two warp levels
  // disagree most — never a co-lead.
  var shear = clamp01(abs(q3 - q2) * 2.20);
  var mix = clamp01(pow(fil, 2.40) * 0.14 + shear * 0.12);

  var r = (mp1r[mid] + (mp2r[mid] - mp1r[mid]) * mix) * bri;
  var g = (mp1g[mid] + (mp2g[mid] - mp1g[mid]) * mix) * bri;
  var b = (mp1b[mid] + (mp2b[mid] - mp1b[mid]) * mix) * bri;

  var foam = clamp01((fil - 0.55) / 0.45) * clamp01(whiteFoam) * 0.90;
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
